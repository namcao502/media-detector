using System.Diagnostics;
using System.Runtime.Versioning;

namespace MediaDetector.Core.Storage;

[SupportedOSPlatform("windows")]
public static class OutputPaths
{
    public static string Default() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MediaDetector");

    // Uses `custom` only when it is a non-empty ABSOLUTE path -- the validation
    // boundary for the user-supplied folder. Everything else falls back.
    public static string Resolve(string? custom) =>
        !string.IsNullOrWhiteSpace(custom) && Path.IsPathFullyQualified(custom)
            ? custom
            : Default();

    public static string EnsureCreated(string? custom)
    {
        var dir = Resolve(custom);
        Directory.CreateDirectory(dir);
        return dir;
    }

    // NOT through ProcessRunner: its Job Object would kill the Explorer window on
    // return. explorer.exe also returns exit code 1 on success, so no caller may
    // branch on it. Returns an error message, or null -- surface it, don't discard.
    public static string? OpenInExplorer(string folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath)) return "No folder to open";
        if (!Directory.Exists(folderPath)) return $"Folder no longer exists: {folderPath}";

        try
        {
            using var proc = Process.Start(new ProcessStartInfo(folderPath)
            {
                UseShellExecute = true,
            });
            return null;
        }
        catch (Exception ex)
        {
            return $"Could not open the folder: {ex.Message}";
        }
    }
}
