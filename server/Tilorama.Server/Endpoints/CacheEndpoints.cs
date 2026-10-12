using Tilorama.Server.Services;

namespace Tilorama.Server.Endpoints;

public static class CacheEndpoints
{
    public static void MapCacheEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/cache");

        api.MapGet("/", (CacheManager cache, SettingsStore settings) =>
            Results.Ok(cache.GetStats(settings.Current.CacheLimitBytes)));

        // Everything except what running jobs are writing right now.
        api.MapDelete("/", (CacheManager cache, SettingsStore settings, JobManager jobs) =>
        {
            cache.Clear(jobs.ActiveImageIds, jobs.ActiveSourceShas);
            return Results.Ok(cache.GetStats(settings.Current.CacheLimitBytes));
        });
    }
}
