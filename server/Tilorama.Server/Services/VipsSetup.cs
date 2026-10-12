using NetVips;

namespace Tilorama.Server.Services;

public static class VipsSetup
{
    public static string Version { get; private set; } = "unknown";

    public static void Initialize(ILogger logger)
    {
        if (!ModuleInitializer.VipsInitialized)
            throw new InvalidOperationException("libvips could not be initialized.", ModuleInitializer.Exception);

        // The operation cache would keep source files open (Windows then refuses to delete them)
        // and brings nothing for one-shot streaming pipelines.
        Cache.Max = 0;
        Cache.MaxFiles = 0;
        Cache.MaxMem = 0;

        Version = $"{NetVips.NetVips.Version(0)}.{NetVips.NetVips.Version(1)}.{NetVips.NetVips.Version(2)}";
        logger.LogInformation("libvips {Version} ready", Version);
    }
}
