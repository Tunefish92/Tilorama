using Tilorama.Server.Models;
using Tilorama.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Tilorama.Tests;

public sealed class CacheManagerTests : IDisposable
{
    private static readonly IReadOnlySet<string> None = new HashSet<string>();

    private readonly string _root = Path.Combine(Path.GetTempPath(), "tilorama-tests", Guid.NewGuid().ToString("N"));
    private readonly CacheManager _cache;

    public CacheManagerTests()
    {
        _cache = new CacheManager(Options.Create(new TileCacheOptions { Root = _root }), NullLogger<CacheManager>.Instance);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void EnforceLimit_EvictsLeastRecentlyUsedFirst()
    {
        var old = FakeImage("aaa", sizeBytes: 600, lastAccessed: DateTime.UtcNow.AddHours(-2));
        var recent = FakeImage("bbb", sizeBytes: 600, lastAccessed: DateTime.UtcNow);

        _cache.EnforceLimit(limitBytes: 1000, None, None);

        Assert.Null(_cache.TryGetImage(old.Id));
        Assert.NotNull(_cache.TryGetImage(recent.Id));
    }

    [Fact]
    public void EnforceLimit_NeverEvictsProtectedImages()
    {
        var old = FakeImage("aaa", sizeBytes: 600, lastAccessed: DateTime.UtcNow.AddHours(-2));
        var recent = FakeImage("bbb", sizeBytes: 600, lastAccessed: DateTime.UtcNow);

        _cache.EnforceLimit(limitBytes: 1000, new HashSet<string> { old.Id }, None);

        Assert.NotNull(_cache.TryGetImage(old.Id));
        Assert.Null(_cache.TryGetImage(recent.Id));
    }

    [Fact]
    public void EnforceLimit_UnderLimit_KeepsEverything()
    {
        FakeImage("aaa", sizeBytes: 100, lastAccessed: DateTime.UtcNow);
        FakeImage("bbb", sizeBytes: 100, lastAccessed: DateTime.UtcNow);

        _cache.EnforceLimit(limitBytes: 1000, None, None);

        Assert.Equal(2, _cache.ListImages().Count);
    }

    [Fact]
    public void DeleteImageStepwise_HidesImageAtOnceAndReportsEveryFile()
    {
        var image = FakeImage("aaa", sizeBytes: 1, lastAccessed: DateTime.UtcNow);
        var levelDir = Path.Combine(_cache.ImageDir(image.Id), "image_files", "3");
        Directory.CreateDirectory(levelDir);
        for (var i = 0; i < 25; i++)
            File.WriteAllText(Path.Combine(levelDir, $"{i}_0.webp"), "tile");

        using var steps = _cache.DeleteImageStepwise(image.Id).GetEnumerator();
        Assert.True(steps.MoveNext());
        Assert.Equal(new CacheManager.DeleteProgress(0, 26), steps.Current); // 25 tiles + meta.json
        Assert.Null(_cache.TryGetImage(image.Id)); // gone from the cache before the files are
        Assert.Empty(_cache.ListImages());

        var last = steps.Current;
        while (steps.MoveNext())
            last = steps.Current;

        Assert.Equal(new CacheManager.DeleteProgress(26, 26), last);
        Assert.Empty(Directory.EnumerateFileSystemEntries(_cache.TilesDir));
    }

    [Fact]
    public void Touch_UpdatesLastAccess()
    {
        var image = FakeImage("aaa", sizeBytes: 1, lastAccessed: DateTime.UtcNow.AddDays(-1));

        _cache.Touch(image);

        Assert.True(_cache.TryGetImage(image.Id)!.LastAccessedUtc > DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public void CleanupLeftovers_RemovesPartialPyramidsAndUploads()
    {
        Directory.CreateDirectory(_cache.NewPartialDir("aaa_t512"));
        File.WriteAllText(_cache.NewUploadPath(), "x");
        var finished = FakeImage("bbb", sizeBytes: 1, lastAccessed: DateTime.UtcNow);

        _cache.CleanupLeftovers();

        Assert.Single(Directory.EnumerateDirectories(_cache.TilesDir));
        Assert.Empty(Directory.EnumerateFiles(_cache.UploadsDir));
        Assert.NotNull(_cache.TryGetImage(finished.Id));
    }

    [Fact]
    public void Settings_Validation_RejectsUnsupportedValues()
    {
        var valid = new AppSettings();
        var invalid = new AppSettings { Tiling = new TilingSettings { TileSize = 300, Quality = 0 }, CacheLimitGb = 0 };

        Assert.Empty(valid.Validate());
        Assert.Equal(3, invalid.Validate().Count());
    }

    private ImageMeta FakeImage(string sha, long sizeBytes, DateTime lastAccessed)
    {
        var tiling = new TilingSettings();
        var meta = new ImageMeta
        {
            Id = CacheManager.ImageId(sha, tiling),
            SourceSha = sha,
            FileName = $"{sha}.jpg",
            FileSize = 1,
            Loader = "jpeg",
            Width = 10,
            Height = 10,
            Bands = 3,
            Tiling = tiling,
            MinLevel = 0,
            MaxLevel = 4,
            TileCount = 5,
            SizeBytes = sizeBytes,
            TilingMs = 1,
            CreatedUtc = lastAccessed,
            LastAccessedUtc = lastAccessed,
        };
        var dir = _cache.ImageDir(meta.Id);
        Directory.CreateDirectory(dir);
        _cache.WriteMeta(dir, meta);
        return meta;
    }
}
