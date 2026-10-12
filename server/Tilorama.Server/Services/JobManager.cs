using System.Collections.Concurrent;
using System.Threading.Channels;
using Tilorama.Server.Models;
using NetVips;

namespace Tilorama.Server.Services;

/// <summary>
/// Queues tiling jobs and runs them one at a time. libvips already uses every core for a single image,
/// so running several jobs in parallel would only compete for CPU and memory.
/// </summary>
public sealed class JobManager(CacheManager cache, SettingsStore settings, TilingService tiler, ILogger<JobManager> log)
    : BackgroundService
{
    private static readonly TimeSpan KeepFinishedJobs = TimeSpan.FromHours(1);

    private readonly Channel<TilingJob> _queue = Channel.CreateUnbounded<TilingJob>(new UnboundedChannelOptions { SingleReader = true });
    private readonly ConcurrentDictionary<string, TilingJob> _jobs = new();
    private readonly Lock _enqueueLock = new();

    /// <summary>Starts a job, or returns the one already working on the same image and settings.</summary>
    public TilingJob Enqueue(SourceInfo source, TilingSettings tiling)
    {
        lock (_enqueueLock)
        {
            var imageId = CacheManager.ImageId(source.Sha, tiling);
            if (_jobs.Values.FirstOrDefault(j => j.ImageId == imageId && !j.Snapshot.IsTerminal) is { } running)
                return running;

            PruneFinished();
            var job = new TilingJob(source, tiling);
            _jobs[job.Id] = job;
            _queue.Writer.TryWrite(job);
            return job;
        }
    }

    public TilingJob? Get(string jobId) => _jobs.GetValueOrDefault(jobId);

    public bool Cancel(string jobId)
    {
        if (!_jobs.TryGetValue(jobId, out var job) || job.Snapshot.IsTerminal)
            return false;

        job.Cancellation.Cancel();
        if (job.Snapshot.Stage == JobStage.Queued)
            job.MarkCancelled();
        return true;
    }

    public IReadOnlySet<string> ActiveImageIds =>
        _jobs.Values.Where(j => !j.Snapshot.IsTerminal).Select(j => j.ImageId).ToHashSet();

    public IReadOnlySet<string> ActiveSourceShas =>
        _jobs.Values.Where(j => !j.Snapshot.IsTerminal).Select(j => j.Source.Sha).ToHashSet();

    public int ActiveCount => _jobs.Values.Count(j => !j.Snapshot.IsTerminal);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            if (job.Cancellation.IsCancellationRequested)
            {
                job.MarkCancelled();
                AfterJob(job);
                continue;
            }

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(job.Cancellation.Token, stoppingToken);
            try
            {
                var meta = await Task.Run(() => tiler.Generate(job.Source, job.Tiling, job.Report, linked.Token), CancellationToken.None);
                job.Complete(meta);
            }
            catch (OperationCanceledException)
            {
                log.LogInformation("Tiling of {FileName} cancelled", job.Source.FileName);
                job.MarkCancelled();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Tiling of {FileName} failed", job.Source.FileName);
                job.Fail(Describe(ex));
            }

            AfterJob(job);
        }
    }

    private void AfterJob(TilingJob job)
    {
        try
        {
            // This job is terminal now, so the active sets only contain *other* jobs.
            if (job.Snapshot.Stage != JobStage.Done)
            {
                cache.DeleteSourceIfOrphan(job.Source.Sha, ActiveSourceShas);
                return;
            }

            // The freshly generated image is about to be opened, never evict it right away.
            var protectedIds = new HashSet<string>(ActiveImageIds) { job.ImageId };
            var protectedShas = new HashSet<string>(ActiveSourceShas) { job.Source.Sha };
            cache.EnforceLimit(settings.Current.CacheLimitBytes, protectedIds, protectedShas);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Cache maintenance after job {JobId} failed", job.Id);
        }
    }

    private void PruneFinished()
    {
        var cutoff = DateTime.UtcNow - KeepFinishedJobs;
        foreach (var (id, job) in _jobs)
        {
            if (job.Snapshot.IsTerminal && job.CreatedUtc < cutoff)
                _jobs.TryRemove(id, out _);
        }
    }

    private static string Describe(Exception ex) => ex switch
    {
        VipsException vips => "The image could not be processed: " + vips.Message.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).LastOrDefault(),
        IOException io => "Disk error: " + io.Message,
        _ => ex.Message,
    };
}
