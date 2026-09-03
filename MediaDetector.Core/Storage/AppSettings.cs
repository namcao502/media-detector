using System.Text.Json;
using System.Text.Json.Serialization;

namespace MediaDetector.Core.Storage;

// NOT `ThemeMode`: .NET 10 WPF added System.Windows.ThemeMode, so that name
// collides (CS0104) in any file that also has `using System.Windows;`.
public enum AppThemeMode { System, Light, Dark }

// Plain JSON, not ApplicationData.Current -- that needs package identity an
// unpackaged app does not have.
public sealed class AppSettings
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AppThemeMode Theme { get; set; } = AppThemeMode.System;

    public bool CleanNames { get; set; } = true;

    public string? OutputDir { get; set; }

    // YouTube throttles per connection, so the first few slots are near-free and
    // the gain flattens well before the ceiling, while ffmpeg's CPU cost and the
    // transient-failure rate keep climbing. The high end is there to be chosen,
    // not to be a good idea.
    public int PlaylistConcurrency { get; set; } = DefaultConcurrency;

    public const int MinConcurrency = 1;
    public const int MaxConcurrency = 15;
    public const int DefaultConcurrency = 5;

    // Written next to the exe when that folder is writable, so a copied app
    // folder keeps its settings. AppPaths owns the fallback.
    public static string DefaultPath => Path.Combine(AppPaths.DataRoot, FileName);

    private const string FileName = "settings.json";

    public static AppSettings Load(string? path = null)
    {
        // Reads the legacy %LOCALAPPDATA% copy when the app-local one does not
        // exist yet, so moving the data root does not read as a factory reset.
        // Save always writes DefaultPath, so the first save completes the move.
        var file = path ?? AppPaths.ExistingOrDefault(FileName);
        try
        {
            if (!File.Exists(file)) return new AppSettings();
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(file))
                   ?? new AppSettings();
        }
        catch
        {
            // A corrupt or unreadable settings file must never stop the app launching.
            return new AppSettings();
        }
    }

    public void Save(string? path = null)
    {
        var file = path ?? DefaultPath;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllText(file,
                JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Losing a preference is not worth crashing over.
        }
    }
}
