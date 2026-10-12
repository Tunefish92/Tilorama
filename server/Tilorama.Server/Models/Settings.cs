namespace Tilorama.Server.Models;

public enum TileFormat
{
    Webp,
    Jpeg,
    Png,
}

public enum PyramidDepth
{
    /// <summary>Full pyramid down to a 1×1 pixel level (standard Deep Zoom).</summary>
    OnePixel,

    /// <summary>Stop once the whole image fits into a single tile (fewer, smaller levels).</summary>
    OneTile,
}

/// <summary>Settings that influence the generated tiles. Changing any of them yields a different cache entry.</summary>
public sealed record TilingSettings
{
    public static readonly int[] AllowedTileSizes = [64, 128, 256, 512, 1024, 2048];

    public int TileSize { get; init; } = 512;
    public int Overlap { get; init; } = 1;
    public TileFormat Format { get; init; } = TileFormat.Webp;
    public int Quality { get; init; } = 85;
    public PyramidDepth Depth { get; init; } = PyramidDepth.OnePixel;

    public string Extension => Format switch
    {
        TileFormat.Jpeg => "jpg",
        TileFormat.Png => "png",
        _ => "webp",
    };

    /// <summary>Human readable, filesystem safe key, e.g. <c>t512-o1-webp-q85-px</c>.</summary>
    public string CacheKey =>
        $"t{TileSize}-o{Overlap}-{Extension}-q{(Format == TileFormat.Png ? 0 : Quality)}-{(Depth == PyramidDepth.OnePixel ? "px" : "tile")}";

    public IEnumerable<string> Validate()
    {
        if (!AllowedTileSizes.Contains(TileSize))
            yield return $"Tile size must be one of {string.Join(", ", AllowedTileSizes)}.";
        if (Overlap is < 0 or > 8)
            yield return "Overlap must be between 0 and 8 pixels.";
        if (Quality is < 1 or > 100)
            yield return "Quality must be between 1 and 100.";
    }
}

public sealed record AppSettings
{
    public TilingSettings Tiling { get; init; } = new();
    public double CacheLimitGb { get; init; } = 10;

    public long CacheLimitBytes => (long)(CacheLimitGb * 1024 * 1024 * 1024);

    public IEnumerable<string> Validate()
    {
        foreach (var error in Tiling.Validate())
            yield return error;
        if (CacheLimitGb is < 0.5 or > 2048)
            yield return "Cache limit must be between 0.5 and 2048 GB.";
    }
}
