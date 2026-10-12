using System.Text.Json;
using System.Text.Json.Serialization;
using Tilorama.Server.Endpoints;
using Tilorama.Server.Services;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

// Uploads are streamed to disk, so large limits are safe.
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = 16L * 1024 * 1024 * 1024);

builder.Services.Configure<TileCacheOptions>(builder.Configuration.GetSection(TileCacheOptions.Section));
builder.Services.ConfigureHttpJsonOptions(json =>
    json.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<CacheManager>();
builder.Services.AddSingleton<SettingsStore>();
builder.Services.AddSingleton<TilingService>();
builder.Services.AddSingleton<JobManager>();
builder.Services.AddHostedService(services => services.GetRequiredService<JobManager>());

var app = builder.Build();

VipsSetup.Initialize(app.Logger);

var cache = app.Services.GetRequiredService<CacheManager>();
var settings = app.Services.GetRequiredService<SettingsStore>();
cache.CleanupLeftovers();
cache.EnforceLimit(settings.Current.CacheLimitBytes, new HashSet<string>(), new HashSet<string>());
app.Logger.LogInformation("Tile cache: {Root}", cache.Root);

app.UseExceptionHandler();
app.UseStatusCodePages();

// The built React app (client/ → wwwroot) when running as a single process.
app.UseDefaultFiles();
app.UseStaticFiles();

// Tiles never change for a given id (the id contains content hash + settings), so cache them forever.
var tileContentTypes = new FileExtensionContentTypeProvider();
tileContentTypes.Mappings[".dzi"] = "application/xml";
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(cache.TilesDir),
    RequestPath = "/tiles",
    ContentTypeProvider = tileContentTypes,
    OnPrepareResponse = context =>
        context.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable",
});

app.MapImageEndpoints();
app.MapJobEndpoints();
app.MapSettingsEndpoints();
app.MapCacheEndpoints();
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
