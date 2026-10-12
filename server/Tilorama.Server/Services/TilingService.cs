using System.Diagnostics;
using System.Numerics;
using Tilorama.Server.Models;
using NetVips;

namespace Tilorama.Server.Services;

public sealed record ProbeResult(int Width, int Height, int Bands, string Loader);

public sealed record TilingProgress(JobStage Stage, double Percent, string Message);

/// <summary>Turns an original into a Deep Zoom tile pyramid using libvips' dzsave.</summary>
public sealed class TilingService(CacheManager cache, ILogger<TilingService> log)
{
    private const int ThumbnailSize = 384;

    /// <summary>Reads only the header. Throws <see cref="VipsException"/> for unsupported or corrupt files.</summary>
    public static ProbeResult Probe(string path)
    {
        using var image = Image.NewFromFile(path);
        var swap = SwapsAxes(Orientation(image));
        return new ProbeResult(swap ? image.Height : image.Width, swap ? image.Width : image.Height, image.Bands, Loader(image));
    }

    public ImageMeta Generate(SourceInfo source, TilingSettings tiling, Action<TilingProgress> report, CancellationToken ct)
    {
        var id = CacheManager.ImageId(source.Sha, tiling);
        var finalDir = cache.ImageDir(id);
        if (Directory.Exists(finalDir) && cache.TryGetImage(id) is null)
            cache.DeleteImage(id); // leftover without metadata, rebuild it

        var workDir = cache.NewPartialDir(id);
        Directory.CreateDirectory(workDir);
        var stopwatch = Stopwatch.StartNew();
        var owned = new List<Image>();

        try
        {
            report(new(JobStage.Analyzing, 0, "Reading image header"));
            var path = cache.SourcePath(source);
            int orientation;
            using (var header = Image.NewFromFile(path))
                orientation = Orientation(header);

            // EXIF rotation needs random access. Everything else streams top to bottom through libvips,
            // which keeps memory flat even for gigapixel images.
            var access = orientation > 1 ? Enums.Access.Random : Enums.Access.Sequential;
            var loaded = Image.NewFromFile(path, access: access);
            owned.Add(loaded);
            var image = Prepare(loaded, orientation, tiling, owned);
            report(new(JobStage.Analyzing, 100, $"{image.Width:N0} × {image.Height:N0} px, {image.Bands} bands"));
            ct.ThrowIfCancellationRequested();

            var message = $"Generating {tiling.TileSize} px {tiling.Extension.ToUpperInvariant()} tiles";
            report(new(JobStage.Tiling, 0, message));
            image.SetProgress(new InlineProgress(percent => report(new(JobStage.Tiling, percent, message))), ct);
            image.Dzsave(
                Path.Combine(workDir, "image"),
                layout: Enums.ForeignDzLayout.Dz,
                suffix: Suffix(tiling),
                overlap: tiling.Overlap,
                tileSize: tiling.TileSize,
                depth: tiling.Depth == PyramidDepth.OneTile ? Enums.ForeignDzDepth.Onetile : Enums.ForeignDzDepth.Onepixel,
                keep: Enums.ForeignKeep.None);
            ct.ThrowIfCancellationRequested();

            var filesDir = Path.Combine(workDir, "image_files");
            var (minLevel, maxLevel) = NormalizeLevels(filesDir, image.Width, image.Height);

            report(new(JobStage.Thumbnail, 0, "Creating preview"));
            CreateThumbnail(filesDir, tiling, image.Width, image.Height, minLevel, maxLevel, Path.Combine(workDir, CacheManager.ThumbFileName));

            report(new(JobStage.Finalizing, 0, "Writing cache entry"));
            var tileCount = Directory.EnumerateFiles(filesDir, $"*.{tiling.Extension}", SearchOption.AllDirectories).Count();
            var now = DateTime.UtcNow;
            var meta = new ImageMeta
            {
                Id = id,
                SourceSha = source.Sha,
                FileName = source.FileName,
                FileSize = source.FileSize,
                Loader = source.Loader,
                Width = image.Width,
                Height = image.Height,
                Bands = image.Bands,
                Tiling = tiling,
                MinLevel = minLevel,
                MaxLevel = maxLevel,
                TileCount = tileCount,
                SizeBytes = CacheManager.DirectorySize(workDir, out _),
                TilingMs = stopwatch.ElapsedMilliseconds,
                CreatedUtc = now,
                LastAccessedUtc = now,
            };
            cache.WriteMeta(workDir, meta);

            // Publish atomically: tiles only become visible once the pyramid is complete.
            if (!Publish(workDir, finalDir))
            {
                DeleteQuietly(workDir); // another job finished the same pyramid first
                return cache.TryGetImage(id) ?? throw new IOException($"Could not publish {id}, the target folder already exists.");
            }

            log.LogInformation("Tiled {FileName} ({Width}×{Height}) into {Tiles} tiles in {Ms} ms",
                source.FileName, meta.Width, meta.Height, tileCount, meta.TilingMs);
            report(new(JobStage.Finalizing, 100, "Done"));
            return meta;
        }
        catch (VipsException) when (ct.IsCancellationRequested)
        {
            DeleteQuietly(workDir);
            throw new OperationCanceledException(ct);
        }
        catch
        {
            DeleteQuietly(workDir);
            throw;
        }
        finally
        {
            for (var i = owned.Count - 1; i >= 0; i--)
                owned[i].Dispose();
        }
    }

    private static Image Prepare(Image image, int orientation, TilingSettings tiling, List<Image> owned)
    {
        if (orientation > 1)
            image = Own(image.Autorot());

        // Bake the colour profile into sRGB pixels, so tiles can be stored without metadata and still look right.
        if (image.Interpretation == Enums.Interpretation.Cmyk || image.Contains("icc-profile-data"))
        {
            try
            {
                image = Own(image.IccTransform("srgb", embedded: true, intent: Enums.Intent.Perceptual));
            }
            catch (VipsException)
            {
                // Broken profile: libvips' default conversion on save is good enough.
            }
        }

        if (tiling.Format == TileFormat.Jpeg && image.HasAlpha())
        {
            var max = image.Format == Enums.BandFormat.Ushort ? 65535 : 255;
            image = Own(image.Flatten(background: [max, max, max], maxAlpha: max));
        }

        return image;

        Image Own(Image created)
        {
            owned.Add(created);
            return created;
        }
    }

    /// <summary>
    /// Deep Zoom level n has a size of ceil(dim / 2^(max-n)) with max = ceil(log2(max(w, h))).
    /// With depth "onetile" libvips numbers the smallest generated level 0 instead, so shift the
    /// folders to their canonical numbers; the viewer can then use the standard level math.
    /// </summary>
    private static (int MinLevel, int MaxLevel) NormalizeLevels(string filesDir, int width, int height)
    {
        var levels = Directory.EnumerateDirectories(filesDir)
            .Select(d => int.TryParse(Path.GetFileName(d), out var level) ? level : -1)
            .Where(level => level >= 0)
            .OrderDescending()
            .ToList();

        var largest = Math.Max(width, height);
        var canonicalMax = largest <= 1 ? 0 : BitOperations.Log2((uint)(largest - 1)) + 1;
        var offset = canonicalMax - levels[0];
        if (offset > 0)
        {
            foreach (var level in levels) // highest first, so targets never collide
                Directory.Move(Path.Combine(filesDir, level.ToString()), Path.Combine(filesDir, (level + offset).ToString()));
        }

        return (levels[^1] + offset, canonicalMax);
    }

    /// <summary>Moves the finished pyramid into place. Returns false if the destination already exists.</summary>
    private static bool Publish(string workDir, string finalDir)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                Directory.Move(workDir, finalDir);
                return true;
            }
            catch (IOException) when (Directory.Exists(finalDir))
            {
                return false;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException && attempt < 6)
            {
                // Virus scanners and the search indexer briefly lock freshly written files on Windows.
                Thread.Sleep(100 * attempt);
            }
        }
    }

    private static string Suffix(TilingSettings tiling) => tiling.Format switch
    {
        TileFormat.Jpeg => $".jpg[Q={tiling.Quality}]",
        TileFormat.Png => ".png[compression=4]",
        _ => $".webp[Q={tiling.Quality},effort=2]", // low effort: much faster encoding, barely larger files
    };

    /// <summary>
    /// The highest level that still fits into one tile contains the whole image in a single file,
    /// which is a perfect (and free) source for the preview thumbnail.
    /// </summary>
    private static void CreateThumbnail(string filesDir, TilingSettings tiling, int width, int height, int minLevel, int maxLevel, string target)
    {
        var level = minLevel;
        for (var candidate = minLevel + 1; candidate <= maxLevel; candidate++)
        {
            var scale = Math.Pow(2, maxLevel - candidate);
            var levelWidth = (int)Math.Ceiling(width / scale);
            var levelHeight = (int)Math.Ceiling(height / scale);
            if (levelWidth > tiling.TileSize || levelHeight > tiling.TileSize || Math.Max(levelWidth, levelHeight) > ThumbnailSize * 2)
                break;
            level = candidate;
        }

        // From memory, so no file handle inside the pyramid folder outlives this call (it gets moved next).
        var tile = File.ReadAllBytes(Path.Combine(filesDir, level.ToString(), $"0_0.{tiling.Extension}"));
        using var thumb = Image.ThumbnailBuffer(tile, ThumbnailSize);
        thumb.Webpsave(target, q: 70);
    }

    private static int Orientation(Image image) =>
        image.Contains("orientation") && image.Get("orientation") is int orientation ? orientation : 1;

    private static bool SwapsAxes(int orientation) => orientation is >= 5 and <= 8;

    private static string Loader(Image image) =>
        image.Contains("vips-loader") && image.Get("vips-loader") is string loader
            ? loader.Split("load")[0]
            : "unknown";

    private void DeleteQuietly(string dir)
    {
        try
        {
            if (Directory.Exists(dir))
                Directory.Delete(dir, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            log.LogWarning(ex, "Could not remove {Dir}", dir);
        }
    }

    /// <summary>Unlike <see cref="Progress{T}"/> this reports synchronously, so updates never arrive out of order.</summary>
    private sealed class InlineProgress(Action<int> onReport) : IProgress<int>
    {
        public void Report(int value) => onReport(value);
    }
}
