namespace Tilorama.Server.Models;

/// <summary>An uploaded original, stored once per content hash.</summary>
public sealed record SourceInfo
{
    public required string Sha { get; init; }
    public required string FileName { get; init; }
    public required string Extension { get; init; }
    public required long FileSize { get; init; }
    public required string Loader { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required DateTime UploadedUtc { get; init; }
}

/// <summary>A finished tile pyramid of one source with one set of tiling settings.</summary>
public sealed record ImageMeta
{
    public required string Id { get; init; }
    public required string SourceSha { get; init; }
    public required string FileName { get; init; }
    public required long FileSize { get; init; }
    public required string Loader { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required int Bands { get; init; }
    public required TilingSettings Tiling { get; init; }
    public required int MinLevel { get; init; }
    public required int MaxLevel { get; init; }
    public required int TileCount { get; init; }
    public required long SizeBytes { get; init; }
    public required long TilingMs { get; init; }
    public required DateTime CreatedUtc { get; init; }
    public DateTime LastAccessedUtc { get; init; }

    public string TileBaseUrl => $"/tiles/{Id}/image_files";
    public string ThumbUrl => $"/tiles/{Id}/thumb.webp";
}

public enum OpenStatus
{
    Ready,
    Processing,
}

/// <summary>Answer to "open this image": either the tiles are cached, or a job was started.</summary>
public sealed record OpenResult
{
    public required OpenStatus Status { get; init; }
    public required string ImageId { get; init; }
    public ImageMeta? Image { get; init; }
    public string? JobId { get; init; }
    public SourceInfo? Source { get; init; }
}

public sealed record CacheStats
{
    public required string Root { get; init; }
    public required long TotalBytes { get; init; }
    public required long TileBytes { get; init; }
    public required long SourceBytes { get; init; }
    public required int ImageCount { get; init; }
    public required int SourceCount { get; init; }
    public required long LimitBytes { get; init; }
}
