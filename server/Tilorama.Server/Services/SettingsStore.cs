using System.Text.Json;
using Tilorama.Server.Models;

namespace Tilorama.Server.Services;

/// <summary>Persists <see cref="AppSettings"/> as settings.json inside the cache folder.</summary>
public sealed class SettingsStore
{
    private readonly string _path;
    private readonly ILogger<SettingsStore> _log;
    private readonly Lock _lock = new();
    private volatile AppSettings _current;

    public SettingsStore(CacheManager cache, ILogger<SettingsStore> log)
    {
        _log = log;
        _path = Path.Combine(cache.Root, "settings.json");
        _current = Load();
    }

    public AppSettings Current => _current;

    /// <summary>Validates and saves. Returns the validation errors (empty on success).</summary>
    public IReadOnlyList<string> TryUpdate(AppSettings settings)
    {
        var errors = settings.Validate().ToList();
        if (errors.Count > 0)
            return errors;

        lock (_lock)
        {
            File.WriteAllText(_path, JsonSerializer.Serialize(settings, CacheManager.Json));
            _current = settings;
        }

        return errors;
    }

    private AppSettings Load()
    {
        try
        {
            if (File.Exists(_path)
                && JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_path), CacheManager.Json) is { } loaded
                && !loaded.Validate().Any())
            {
                return loaded;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _log.LogWarning(ex, "Could not read {Path}, using defaults", _path);
        }

        return new AppSettings();
    }
}
