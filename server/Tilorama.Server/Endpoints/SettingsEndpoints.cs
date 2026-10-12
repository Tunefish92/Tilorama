using Tilorama.Server.Models;
using Tilorama.Server.Services;

namespace Tilorama.Server.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/health", (CacheManager cache, JobManager jobs) => Results.Ok(new
        {
            Status = "ok",
            VipsVersion = VipsSetup.Version,
            CacheRoot = cache.Root,
            ActiveJobs = jobs.ActiveCount,
        }));

        api.MapGet("/settings", (SettingsStore settings) => Results.Ok(settings.Current));

        api.MapPut("/settings", (AppSettings update, SettingsStore settings, CacheManager cache, JobManager jobs) =>
        {
            var errors = settings.TryUpdate(update);
            if (errors.Count > 0)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["settings"] = [.. errors] });

            cache.EnforceLimit(settings.Current.CacheLimitBytes, jobs.ActiveImageIds, jobs.ActiveSourceShas);
            return Results.Ok(settings.Current);
        });
    }
}
