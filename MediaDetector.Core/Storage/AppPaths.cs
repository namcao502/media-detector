using System.Runtime.Versioning;

namespace MediaDetector.Core.Storage;

// Settings and logs. Tools are a sibling (ToolResolver.VendorDir), and user
// downloads are somewhere else entirely (OutputPaths) -- burying gigabytes in the
// program folder would make the app unmovable, which is the opposite of the goal.
[SupportedOSPlatform("windows")]
public static class AppPaths
{
    // Probed once -- neither answer can change mid-process and both touch disk.
    private static readonly Lazy<bool> AppFolderWritable =
        new(() => IsWritable(AppContext.BaseDirectory));

    private static readonly Lazy<string?> RepoRoot = new(FindRepoRoot);

    public static string DataRoot => AppLocalOrFallback("data");

    // Three homes, in order. Running out of a build output inside the repo puts
    // data/ and vendor/ at the repo root rather than four levels down in bin/,
    // where they are invisible and a clean deletes them. A published app has no
    // .sln above it, falls through, and keeps both beside the exe -- which is
    // what makes the folder copyable. LOCALAPPDATA is the last resort for an
    // install somewhere unwritable, so Program Files still works.
    public static string AppLocalOrFallback(string folderName)
    {
        if (RepoRoot.Value != null)
        {
            return Path.Combine(RepoRoot.Value, folderName);
        }

        return AppFolderWritable.Value
            ? Path.Combine(AppContext.BaseDirectory, folderName)
            : Path.Combine(LegacyRoot, folderName);
    }

    // The .sln is the marker: it sits at the repo root and never ships.
    private static string? FindRepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            if (dir.GetFiles("*.sln").Length != 0)
            {
                return dir.FullName;
            }
        }

        return null;
    }

    // Read-only: where everything written before the app went portable lives.
    public static string LegacyRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MediaDetector");

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
