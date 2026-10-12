using Tilorama.Server.Models;
using Tilorama.Server.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NetVips;

namespace Tilorama.Tests;

public sealed class TilingServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "tilorama-tests", Guid.NewGuid().ToString("N"));
    private readonly CacheManager _cache;
    private readonly TilingService _tiler;

    public TilingServiceTests()
    {
        VipsSetup.Initialize(NullLogger.Instance); // same libvips configuration as the server
        _cache = new CacheManager(Options.Create(new TileCacheOptions { Root = _root }), NullLogger<CacheManager>.Instance);
        _tiler = new TilingService(_cache, NullLogger<TilingService>.Instance);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void Generate_FullPyramid_HasEveryLevelDownToOnePixel()
    {
        var source = AddSource(1000, 600);
        var tiling = new TilingSettings { TileSize = 256, Overlap = 1, Format = TileFormat.Webp, Depth = PyramidDepth.OnePixel };
        var stages = new List<JobStage>();

        var meta = _tiler.Generate(source, tiling, p => stages.Add(p.Stage), CancellationToken.None);

        Assert.Equal((1000, 600), (meta.Width, meta.Height));
        Assert.Equal(0, meta.MinLevel);
        Assert.Equal(10, meta.MaxLevel); // ceil(log2(1000))
        Assert.Equal(ExpectedTileCount(1000, 600, 256, meta.MinLevel, meta.MaxLevel), meta.TileCount);

        var dir = _cache.ImageDir(meta.Id);
        Assert.True(File.Exists(Path.Combine(dir, "image.dzi")));
        Assert.True(File.Exists(Path.Combine(dir, CacheManager.ThumbFileName)));
        Assert.True(File.Exists(Path.Combine(dir, "image_files", "10", "3_2.webp")));
        Assert.Equal(meta, _cache.TryGetImage(meta.Id));
        Assert.Contains(JobStage.Tiling, stages);
        Assert.Equal(JobStage.Finalizing, stages[^1]);
    }

    [Fact]
    public void Generate_OneTileDepth_StopsAtFirstLevelThatFitsOneTile()
    {
        var source = AddSource(1000, 600);
        var tiling = new TilingSettings { TileSize = 256, Format = TileFormat.Jpeg, Depth = PyramidDepth.OneTile };

        var meta = _tiler.Generate(source, tiling, _ => { }, CancellationToken.None);

        // Level 8 is 250×150 px, the first to fit into a 256 px tile.
        Assert.Equal(8, meta.MinLevel);
        Assert.Equal(10, meta.MaxLevel);
        Assert.False(Directory.Exists(Path.Combine(_cache.ImageDir(meta.Id), "image_files", "7")));
        Assert.True(File.Exists(Path.Combine(_cache.ImageDir(meta.Id), "image_files", "8", "0_0.jpg")));
    }

    [Fact]
    public void Generate_WhenCancelled_LeavesNoPartialPyramid()
    {
        var source = AddSource(800, 800);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        Assert.ThrowsAny<OperationCanceledException>(() =>
            _tiler.Generate(source, new TilingSettings(), _ => { }, cts.Token));

        Assert.Empty(Directory.EnumerateFileSystemEntries(_cache.TilesDir));
    }

    [Fact]
    public void ImageId_DependsOnContentAndSettings()
    {
        var a = CacheManager.ImageId("abc", new TilingSettings { TileSize = 256 });
        var b = CacheManager.ImageId("abc", new TilingSettings { TileSize = 512 });
        var c = CacheManager.ImageId("abc", new TilingSettings { TileSize = 512, Format = TileFormat.Png, Quality = 10 });
        var d = CacheManager.ImageId("abc", new TilingSettings { TileSize = 512, Format = TileFormat.Png, Quality = 90 });

        Assert.NotEqual(a, b);
        Assert.NotEqual(b, c);
        Assert.Equal(c, d); // quality is irrelevant for lossless PNG
        Assert.True(CacheManager.IsValidId(a));
        Assert.False(CacheManager.IsValidId("..\\evil"));
    }

    private SourceInfo AddSource(int width, int height)
    {
        var upload = _cache.NewUploadPath();
        using (var gradient = Image.Xyz(width, height))
        using (var bands = gradient.Bandjoin(gradient[0]))
        using (var rgb = bands.Cast(Enums.BandFormat.Uchar).Copy(interpretation: Enums.Interpretation.Srgb))
            rgb.Pngsave(upload);

        var sha = Guid.NewGuid().ToString("N")[..24];
        return _cache.AddSource(upload, new SourceInfo
        {
            Sha = sha,
            FileName = "gradient.png",
            Extension = ".png",
            FileSize = new FileInfo(upload).Length,
            Loader = "png",
            Width = width,
            Height = height,
            UploadedUtc = DateTime.UtcNow,
        });
    }

    private static int ExpectedTileCount(int width, int height, int tileSize, int minLevel, int maxLevel)
    {
        var count = 0;
        for (var level = minLevel; level <= maxLevel; level++)
        {
            var scale = Math.Pow(2, maxLevel - level);
            count += (int)(Math.Ceiling(Math.Ceiling(width / scale) / tileSize) * Math.Ceiling(Math.Ceiling(height / scale) / tileSize));
        }

        return count;
    }
}
