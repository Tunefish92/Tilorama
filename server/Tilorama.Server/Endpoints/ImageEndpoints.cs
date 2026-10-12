using System.Buffers;
using System.Security.Cryptography;
using System.Text.Json;
using Tilorama.Server.Models;
using Tilorama.Server.Services;
using NetVips;

namespace Tilorama.Server.Endpoints;

public static class ImageEndpoints
{
    private const int MaxRecentImages = 48;

    public static void MapImageEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");
        api.MapPost("/images", Upload);
        api.MapGet("/images", ListRecent);
        api.MapGet("/images/{id}", Get);
        api.MapDelete("/images/{id}", Delete);
        api.MapPost("/sources/{sha}/open", OpenSource);
    }

    /// <summary>
    /// Raw request body = file content, name in the <c>X-File-Name</c> header (URI encoded).
    /// The body is streamed to disk while hashing, so uploads of any size never sit in memory.
    /// </summary>
    private static async Task<IResult> Upload(HttpRequest request, CacheManager cache, SettingsStore settings, JobManager jobs, CancellationToken ct)
    {
        var fileName = SanitizeFileName(Uri.UnescapeDataString(request.Headers["X-File-Name"].ToString()));
        var uploadPath = cache.NewUploadPath();
        long size = 0;
        string sha;

        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = ArrayPool<byte>.Shared.Rent(1 << 20);
            try
            {
                await using var file = new FileStream(uploadPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16,
                    FileOptions.Asynchronous | FileOptions.SequentialScan);
                int read;
                while ((read = await request.Body.ReadAsync(buffer, ct)) > 0)
                {
                    hash.AppendData(buffer, 0, read);
                    await file.WriteAsync(buffer.AsMemory(0, read), ct);
                    size += read;
                }
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }

            sha = Convert.ToHexStringLower(hash.GetHashAndReset())[..24];
        }
        catch
        {
            File.Delete(uploadPath); // aborted by the client or disk full
            throw;
        }

        if (size == 0)
        {
            File.Delete(uploadPath);
            return Results.Problem(title: "Empty file", detail: "The uploaded file is empty.", statusCode: StatusCodes.Status400BadRequest);
        }

        var source = cache.TryGetSource(sha);
        if (source is null)
        {
            ProbeResult probe;
            try
            {
                probe = TilingService.Probe(uploadPath);
            }
            catch (VipsException)
            {
                File.Delete(uploadPath);
                return Results.Problem(
                    title: "Unsupported image",
                    detail: $"\"{fileName}\" is not an image format the tiler can read.",
                    statusCode: StatusCodes.Status415UnsupportedMediaType);
            }

            source = cache.AddSource(uploadPath, new SourceInfo
            {
                Sha = sha,
                FileName = fileName,
                Extension = SanitizeExtension(Path.GetExtension(fileName)),
                FileSize = size,
                Loader = probe.Loader,
                Width = probe.Width,
                Height = probe.Height,
                UploadedUtc = DateTime.UtcNow,
            });
        }
        else
        {
            File.Delete(uploadPath); // already known, reuse the stored original
        }

        return Results.Ok(Open(source, cache, settings, jobs));
    }

    private static IResult ListRecent(CacheManager cache) =>
        Results.Ok(cache.ListImages()
            .OrderByDescending(i => i.LastAccessedUtc)
            .DistinctBy(i => i.SourceSha)
            .Take(MaxRecentImages));

    private static IResult Get(string id, CacheManager cache) =>
        cache.TryGetImage(id) is { } meta ? Results.Ok(cache.Touch(meta)) : Results.NotFound();

    /// <summary>
    /// Streams the deletion progress as NDJSON, one <c>{"deletedFiles":n,"totalFiles":m}</c> per line.
    /// If the client goes away, the deletion still runs to the end.
    /// </summary>
    private static IResult Delete(string id, CacheManager cache, JobManager jobs)
    {
        if (cache.TryGetImage(id) is not { } meta)
            return Results.NotFound();
        if (jobs.ActiveImageIds.Contains(id))
            return Results.Problem(title: "Image busy", detail: "Tiles for this image are being generated right now.", statusCode: StatusCodes.Status409Conflict);

        return Results.Stream(async body =>
        {
            var clientGone = false;
            foreach (var progress in cache.DeleteImageStepwise(id))
            {
                if (clientGone)
                    continue;
                try
                {
                    await body.WriteAsync(JsonSerializer.SerializeToUtf8Bytes(progress, ProgressJson));
                    await body.WriteAsync("\n"u8.ToArray());
                    await body.FlushAsync();
                }
                catch (Exception ex) when (ex is IOException or OperationCanceledException)
                {
                    clientGone = true;
                }
            }

            cache.DeleteSourceIfOrphan(meta.SourceSha, jobs.ActiveSourceShas);
        }, "application/x-ndjson");
    }

    private static readonly JsonSerializerOptions ProgressJson = new(JsonSerializerDefaults.Web);

    /// <summary>Opens a stored original with the current tiling settings (used to regenerate after a settings change).</summary>
    private static IResult OpenSource(string sha, CacheManager cache, SettingsStore settings, JobManager jobs) =>
        cache.TryGetSource(sha) is { } source ? Results.Ok(Open(source, cache, settings, jobs)) : Results.NotFound();

    private static OpenResult Open(SourceInfo source, CacheManager cache, SettingsStore settings, JobManager jobs)
    {
        var tiling = settings.Current.Tiling;
        var id = CacheManager.ImageId(source.Sha, tiling);
        if (cache.TryGetImage(id) is { } meta)
            return new OpenResult { Status = OpenStatus.Ready, ImageId = id, Image = cache.Touch(meta), Source = source };

        var job = jobs.Enqueue(source, tiling);
        return new OpenResult { Status = OpenStatus.Processing, ImageId = id, JobId = job.Id, Source = source };
    }

    private static string SanitizeFileName(string name)
    {
        name = Path.GetFileName(name.Trim());
        var invalid = Path.GetInvalidFileNameChars();
        name = new string(name.Where(c => !invalid.Contains(c)).ToArray());
        return string.IsNullOrWhiteSpace(name) ? "image" : name[..Math.Min(name.Length, 200)];
    }

    private static string SanitizeExtension(string extension)
    {
        extension = extension.ToLowerInvariant();
        return extension.Length is > 1 and <= 8 && extension[1..].All(char.IsAsciiLetterOrDigit) ? extension : ".img";
    }
}
