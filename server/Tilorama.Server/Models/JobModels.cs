namespace Tilorama.Server.Models;

public enum JobStage
{
    Queued,
    Analyzing,
    Tiling,
    Thumbnail,
    Finalizing,
    Done,
    Failed,
    Cancelled,
}

public sealed record JobSnapshot
{
    public required string JobId { get; init; }
    public required string ImageId { get; init; }
    public required string FileName { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required JobStage Stage { get; init; }

    /// <summary>Progress of the current stage, 0–100.</summary>
    public double Percent { get; init; }

    public string Message { get; init; } = "";
    public long ElapsedMs { get; init; }
    public long? EtaMs { get; init; }
    public ImageMeta? Image { get; init; }
    public string? Error { get; init; }

    public bool IsTerminal => Stage is JobStage.Done or JobStage.Failed or JobStage.Cancelled;
}
