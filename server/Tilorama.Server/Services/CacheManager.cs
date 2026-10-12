using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Tilorama.Server.Models;
using Microsoft.Extensions.Options;

namespace Tilorama.Server.Services;

public sealed class TileCacheOptions
{
    public const string Section = "TileCache";

    /// <summary>Cache folder. Empty means <c>%TEMP%\tilorama-tiles</c>.</summary>
    public string? Root { get; set; }
}

/// <summary>
/// Owns the on-disk cache:
/// <code>
/// {root}/sources/{sha}{ext}        uploaded originals (+ {sha}.json)
/// {root}/tiles/{sha}_{settings}/   image.dzi, image_files/{level}/{col}_{row}.{ext}, thumb.webp, meta.json
/// {root}/uploads/                  in-flight uploads
/// {root}/settings.json
/// </code>
/// </summary>
public sealed class CacheManager
{
    public const string MetaFileName = "meta.json";
    public const string ThumbFileName = "thumb.webp";
    private const string PartialMarker = ".partial-";
    private const string DeletingMarker = ".deleting-";

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly ILogger<CacheManager> _log;
    private readonly Lock _writeLock = new();

    public CacheManager(IOptions<TileCacheOptions> options, ILogger<CacheManager> log)
    {
        _log = log;
        Root = string.IsNullOrWhiteSpace(options.Value.Root)
            ? Path.Combine(Path.GetTempPath(), "tilorama-tiles")
            : Path.GetFullPath(options.Value.Root);
        TilesDir = Path.Combine(Root, "tiles");
        SourcesDir = Path.Combine(Root, "sources");
        UploadsDir = Path.Combine(Root, "uploads");

        Directory.CreateDirectory(TilesDir);
        Directory.CreateDirectory(SourcesDir);
        Directory.CreateDirectory(UploadsDir);
    }

    public string Root { get; }
    public string TilesDir { get; }
    public string SourcesDir { get; }
    public string UploadsDir { get; }

    public static string ImageId(string sha, TilingSettings tiling) => $"{sha}_{tiling.CacheKey}";

    /// <summary>Ids end up in paths, so only allow a safe character set (no traversal).</summary>
    public static bool IsValidId(string id) =>
        id.Length is > 0 and < 200 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    public string ImageDir(string id) => Path.Combine(TilesDir, id);

    public string NewPartialDir(string id) => Path.Combine(TilesDir, $"{id}{PartialMarker}{Guid.NewGuid():N}");

    public string NewUploadPath() => Path.Combine(UploadsDir, $"{Guid.NewGuid():N}.upload");

    /// <summary>Folders of pyramids being written or deleted right now; never listed as images.</summary>
    private static bool IsWorkDir(string dir) =>
        Path.GetFileName(dir) is var name && (name.Contains(PartialMarker) || name.Contains(DeletingMarker));

    /// <summary>Removes interrupted uploads, half-written and half-deleted pyramids from a previous run.</summary>
    public void CleanupLeftovers()
    {
        foreach (var file in Directory.EnumerateFiles(UploadsDir))
            TryDeleteFile(file);
        foreach (var dir in Directory.EnumerateDirectories(TilesDir).Where(IsWorkDir))
            TryDeleteDirectory(dir);
    }

    // ---------------------------------------------------------------- sources

    public string SourcePath(SourceInfo source) => Path.Combine(SourcesDir, source.Sha + source.Extension);

    private string SourceInfoPath(string sha) => Path.Combine(SourcesDir, sha + ".json");

    public SourceInfo? TryGetSource(string sha)
    {
        if (!IsValidId(sha))
            return null;
        var info = ReadJson<SourceInfo>(SourceInfoPath(sha));
        return info is not null && File.Exists(SourcePath(info)) ? info : null;
    }

    /// <summary>Moves a finished upload into the source store. Returns the stored info (an existing one wins).</summary>
    public SourceInfo AddSource(string uploadPath, SourceInfo info)
    {
        lock (_writeLock)
        {
            if (TryGetSource(info.Sha) is { } existing)
            {
                TryDeleteFile(uploadPath);
                return existing;
            }

            File.Move(uploadPath, SourcePath(info), overwrite: true);
            WriteJson(SourceInfoPath(info.Sha), info);
            return info;
        }
    }

    public IReadOnlyList<SourceInfo> ListSources() =>
        Directory.EnumerateFiles(SourcesDir, "*.json")
            .Select(ReadJson<SourceInfo>)
            .OfType<SourceInfo>()
            .ToList();

    public void DeleteSource(string sha)
    {
        if (TryGetSource(sha) is { } source)
            TryDeleteFile(SourcePath(source));
        TryDeleteFile(SourceInfoPath(sha));
    }

    // ----------------------------------------------------------------- images

    public ImageMeta? TryGetImage(string id) =>
        IsValidId(id) ? ReadJson<ImageMeta>(Path.Combine(ImageDir(id), MetaFileName)) : null;

    public IReadOnlyList<ImageMeta> ListImages() =>
        Directory.EnumerateDirectories(TilesDir)
            .Where(d => !IsWorkDir(d))
            .Select(d => ReadJson<ImageMeta>(Path.Combine(d, MetaFileName)))
            .OfType<ImageMeta>()
            .ToList();

    public void WriteMeta(string dir, ImageMeta meta) => WriteJson(Path.Combine(dir, MetaFileName), meta);

    /// <summary>Marks an image as recently used (drives the LRU eviction).</summary>
    public ImageMeta Touch(ImageMeta meta)
    {
        var touched = meta with { LastAccessedUtc = DateTime.UtcNow };
        var dir = ImageDir(meta.Id);
        if (Directory.Exists(dir))
            WriteMeta(dir, touched);
        return touched;
    }

    public bool DeleteImage(string id) => IsValidId(id) && TryDeleteDirectory(ImageDir(id));

    public readonly record struct DeleteProgress(int DeletedFiles, int TotalFiles);

    /// <summary>
    /// Deletes a pyramid file by file and reports progress (at most every 50 ms, plus start and end).
    /// The folder is renamed first, so the image leaves the cache at once and a half-deleted
    /// pyramid can never be opened; leftovers of an interrupted delete are removed at startup.
    /// </summary>
    public IEnumerable<DeleteProgress> DeleteImageStepwise(string id)
    {
        if (!IsValidId(id))
            yield break;

        var dir = ImageDir(id);
        var trash = Path.Combine(TilesDir, $"{id}{DeletingMarker}{Guid.NewGuid():N}");
        if (!TryMoveDirectory(dir, trash))
            trash = dir; // locked right now, delete in place

        var files = Directory.Exists(trash)
            ? Directory.EnumerateFiles(trash, "*", SearchOption.AllDirectories).ToList()
            : [];
        yield return new DeleteProgress(0, files.Count);

        var sinceReport = Stopwatch.StartNew();
        for (var i = 0; i < files.Count; i++)
        {
            TryDeleteFileQuietly(files[i]);
            if (sinceReport.ElapsedMilliseconds >= 50)
            {
                sinceReport.Restart();
                yield return new DeleteProgress(i + 1, files.Count);
            }
        }

        TryDeleteDirectory(trash); // empty level folders, plus any file that was locked a moment ago
        yield return new DeleteProgress(files.Count, files.Count);
    }

    // ------------------------------------------------------------ maintenance

    public CacheStats GetStats(long limitBytes)
    {
        var images = ListImages();
        var sources = ListSources();
        var sourceBytes = sources.Sum(s => s.FileSize);
        var tileBytes = images.Sum(i => i.SizeBytes);
        return new CacheStats
        {
            Root = Root,
            TileBytes = tileBytes,
            SourceBytes = sourceBytes,
            TotalBytes = tileBytes + sourceBytes,
            ImageCount = images.Count,
            SourceCount = sources.Count,
            LimitBytes = limitBytes,
        };
    }

    /// <summary>Evicts least recently used pyramids (and originals nobody references anymore) until under the limit.</summary>
    public void EnforceLimit(long limitBytes, IReadOnlySet<string> protectedImageIds, IReadOnlySet<string> protectedShas)
    {
        var images = ListImages().ToList();
        var sources = ListSources();
        var total = images.Sum(i => i.SizeBytes) + sources.Sum(s => s.FileSize);
        if (total <= limitBytes)
            return;

        foreach (var image in images.OrderBy(i => i.LastAccessedUtc).ToList())
        {
            if (total <= limitBytes)
                break;
            if (protectedImageIds.Contains(image.Id) || !DeleteImage(image.Id))
                continue;

            total -= image.SizeBytes;
            images.Remove(image);
            _log.LogInformation("Evicted {ImageId} ({Bytes} bytes) from the tile cache", image.Id, image.SizeBytes);

            if (images.All(i => i.SourceSha != image.SourceSha) && !protectedShas.Contains(image.SourceSha))
            {
                total -= sources.FirstOrDefault(s => s.Sha == image.SourceSha)?.FileSize ?? 0;
                DeleteSource(image.SourceSha);
            }
        }
    }

    /// <summary>Deletes an original if no pyramid uses it (e.g. after a cancelled job).</summary>
    public void DeleteSourceIfOrphan(string sha, IReadOnlySet<string> protectedShas)
    {
        if (!protectedShas.Contains(sha) && ListImages().All(i => i.SourceSha != sha))
            DeleteSource(sha);
    }

    public void Clear(IReadOnlySet<string> protectedImageIds, IReadOnlySet<string> protectedShas)
    {
        foreach (var dir in Directory.EnumerateDirectories(TilesDir))
        {
            if (!IsWorkDir(dir) && !protectedImageIds.Contains(Path.GetFileName(dir)))
                TryDeleteDirectory(dir);
        }

        foreach (var source in ListSources().Where(s => !protectedShas.Contains(s.Sha)))
            DeleteSource(source.Sha);
    }

    // ---------------------------------------------------------------- helpers

    public static long DirectorySize(string dir, out int fileCount)
    {
        long size = 0;
        fileCount = 0;
        foreach (var file in new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories))
        {
            size += file.Length;
            fileCount++;
        }

        return size;
    }

    private T? ReadJson<T>(string path) where T : class
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                if (!File.Exists(path))
                    return null;
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                return JsonSerializer.Deserialize<T>(stream, Json);
            }
            catch (IOException)
            {
                Thread.Sleep(20); // concurrent atomic replace, try again
            }
            catch (JsonException ex)
            {
                _log.LogWarning(ex, "Ignoring corrupt cache file {Path}", path);
                return null;
            }
        }

        return null;
    }

    private void WriteJson<T>(string path, T value)
    {
        lock (_writeLock)
        {
            var tmp = $"{path}.{Guid.NewGuid():N}.tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(value, Json));
            File.Move(tmp, path, overwrite: true);
        }
    }

    private void TryDeleteFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _log.LogWarning(ex, "Could not delete {Path}", path);
        }
    }

    private static void TryDeleteFileQuietly(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // retried by the final recursive delete
        }
    }

    private static bool TryMoveDirectory(string from, string to)
    {
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                Directory.Move(from, to);
                return true;
            }
            catch (DirectoryNotFoundException)
            {
                return false;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Thread.Sleep(50 * attempt); // a tile may be being served at this very moment
            }
        }

        return false;
    }

    private bool TryDeleteDirectory(string path)
    {
        // Tiles may be read by the static file middleware at the same moment; Windows then refuses the delete.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                if (Directory.Exists(path))
                    Directory.Delete(path, recursive: true);
                return true;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (attempt == 4)
                    _log.LogWarning(ex, "Could not delete {Path}", path);
                Thread.Sleep(100 * (attempt + 1));
            }
        }

        return false;
    }
}
