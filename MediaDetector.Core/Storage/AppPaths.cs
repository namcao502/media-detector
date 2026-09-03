using System.Runtime.Versioning;

namespace MediaDetector.Core.Storage;

// Where settings, logs and the downloaded yt-dlp live. User downloads are
// deliberately NOT here -- see OutputPaths; burying gigabytes in the program
// folder would make the app unmovable, which is the opposite of the goal.
[SupportedOSPlatform("windows")]
public static class AppPaths
{
    // Probed once -- the answer cannot change mid-process and it touches disk.
    private static readonly Lazy<string> Root = new(Resolve);

    public static string DataRoot => Root.Value;

    // Read-only: where everything written before the app went portable lives.
    public static string LegacyRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MediaDetector");

    // App-local so a copied folder keeps its settings, falling back when the app
    // directory is read-only -- portable must not break an install in Program Files.
    private static string Resolve()
    {
        var appLocal = Path.Combine(AppContext.BaseDirectory, "data");
        return IsWritable(appLocal) ? appLocal : LegacyRoot;
    }

    // Probed by writing, not by reading ACLs: UAC virtualization makes the
    // permission bits an unreliable predictor of whether a write lands.
    private static bool IsWritable(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
            var probe = Path.Combine(dir, $".write-probe-{Guid.NewGuid():N}");
            File.WriteAllText(probe, "");
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }

    // Writers always target DataRoot, so the first save migrates.
    public static string ExistingOrDefault(string relativePath)
    {
        var current = Path.Combine(DataRoot, relativePath);
        if (File.Exists(current))
        {
            return current;
        }

        var legacy = Path.Combine(LegacyRoot, relativePath);
        return File.Exists(legacy) ? legacy : current;
    }
}
