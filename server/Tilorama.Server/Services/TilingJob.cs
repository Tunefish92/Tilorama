using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Tilorama.Server.Models;

namespace Tilorama.Server.Services;

/// <summary>One queued/running tiling operation. Broadcasts its latest <see cref="JobSnapshot"/> to any number of listeners.</summary>
public sealed class TilingJob
{
    private readonly Lock _lock = new();
    private readonly List<Channel<JobSnapshot>> _subscribers = [];
    private readonly Stopwatch _elapsed = new();
    private readonly Stopwatch _stageElapsed = new();
    private JobSnapshot _snapshot;

    public TilingJob(SourceInfo source, TilingSettings tiling)
    {
        Id = Guid.NewGuid().ToString("N");
        Source = source;
        Tiling = tiling;
        ImageId = CacheManager.ImageId(source.Sha, tiling);
        _snapshot = new JobSnapshot
        {
            JobId = Id,
            ImageId = ImageId,
            FileName = source.FileName,
            Width = source.Width,
            Height = source.Height,
            Stage = JobStage.Queued,
            Message = "Waiting for the tiler",
        };
    }

    public string Id { get; }
    public string ImageId { get; }
    public SourceInfo Source { get; }
    public TilingSettings Tiling { get; }
    public CancellationTokenSource Cancellation { get; } = new();
    public DateTime CreatedUtc { get; } = DateTime.UtcNow;

    public JobSnapshot Snapshot
    {
        get
        {
            lock (_lock)
                return _snapshot;
        }
    }

    public void Report(TilingProgress progress)
    {
        lock (_lock)
        {
            if (_snapshot.IsTerminal)
                return;
            if (!_elapsed.IsRunning)
                _elapsed.Start();
            if (progress.Stage != _snapshot.Stage)
                _stageElapsed.Restart();

            // Linear extrapolation of the current stage; only meaningful once a few percent are done.
            long? eta = progress.Percent is > 2 and < 100
                ? (long)(_stageElapsed.ElapsedMilliseconds * (100 - progress.Percent) / progress.Percent)
                : null;

            Publish(_snapshot with
            {
                Stage = progress.Stage,
                Percent = progress.Percent,
                Message = progress.Message,
                ElapsedMs = _elapsed.ElapsedMilliseconds,
                EtaMs = eta,
            });
        }
    }

    public void Complete(ImageMeta image) =>
        Finish(s => s with { Stage = JobStage.Done, Percent = 100, Message = "Tiles ready", Image = image });

    public void Fail(string error) =>
        Finish(s => s with { Stage = JobStage.Failed, Message = "Tiling failed", Error = error });

    public void MarkCancelled() =>
        Finish(s => s with { Stage = JobStage.Cancelled, Message = "Cancelled" });

    /// <summary>Streams the current snapshot followed by every change, ending after the terminal one.</summary>
    public async IAsyncEnumerable<JobSnapshot> WatchAsync([EnumeratorCancellation] CancellationToken ct)
    {
        // Capacity 1 + DropOldest: slow clients always get the newest state instead of a backlog.
        var channel = Channel.CreateBounded<JobSnapshot>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

        lock (_lock)
        {
            channel.Writer.TryWrite(_snapshot);
            if (_snapshot.IsTerminal)
                channel.Writer.TryComplete();
            else
                _subscribers.Add(channel);
        }

        try
        {
            await foreach (var snapshot in channel.Reader.ReadAllAsync(ct))
                yield return snapshot;
        }
        finally
        {
            lock (_lock)
                _subscribers.Remove(channel);
        }
    }

    private void Finish(Func<JobSnapshot, JobSnapshot> update)
    {
        lock (_lock)
        {
            if (_snapshot.IsTerminal)
                return;
            _elapsed.Stop();
            Publish(update(_snapshot) with { ElapsedMs = _elapsed.ElapsedMilliseconds, EtaMs = null });
            foreach (var subscriber in _subscribers)
                subscriber.Writer.TryComplete();
            _subscribers.Clear();
        }
    }

    private void Publish(JobSnapshot snapshot)
    {
        _snapshot = snapshot;
        foreach (var subscriber in _subscribers)
            subscriber.Writer.TryWrite(snapshot);
    }
}
