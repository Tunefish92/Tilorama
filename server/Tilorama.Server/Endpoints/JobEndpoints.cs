using Tilorama.Server.Services;

namespace Tilorama.Server.Endpoints;

public static class JobEndpoints
{
    public static void MapJobEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/jobs");

        api.MapGet("/{id}", (string id, JobManager jobs) =>
            jobs.Get(id) is { } job ? Results.Ok(job.Snapshot) : Results.NotFound());

        // Server-Sent Events: the current state immediately, then every change until the job ends.
        api.MapGet("/{id}/events", (string id, JobManager jobs, CancellationToken ct) =>
            jobs.Get(id) is { } job ? Results.ServerSentEvents(job.WatchAsync(ct)) : Results.NotFound());

        api.MapDelete("/{id}", (string id, JobManager jobs) =>
            jobs.Cancel(id) ? Results.NoContent() : Results.NotFound());
    }
}
