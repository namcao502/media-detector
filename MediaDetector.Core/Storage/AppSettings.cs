using System.Text.Json;
using System.Text.Json.Serialization;

namespace MediaDetector.Core.Storage;

// NOT `ThemeMode`: .NET 10 WPF added System.Windows.ThemeMode for Fluent
// theming, and any file with `using System.Windows;` plus this namespace would
// get CS0104 ambiguity. A using-alias would have to be repeated in every such
// file and would not help XAML {x:Static} references at all.
public enum AppThemeMode { System, Light, Dark }

// Replaces the three localStorage hooks (theme-mode, clean-names, output dir).
// A plain JSON file rather than ApplicationData.Current, which requires package
// identity that an unpackaged app does not have.
public sealed class AppSettings
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AppThemeMode Theme { get; set; } = AppThemeMode.System;

    public bool CleanNames { get; set; } = true;

    public string? OutputDir { get; set; }

    // How many playlist tracks download at once. 1 restores the strictly
    // sequential behaviour.
    //
    // 3 by default rather than "as many as possible": YouTube throttles per
    // connection, so the first few slots are close to free, but past that the
    // gain flattens while the costs do not -- each track's ffmpeg postprocess is
    // CPU-bound, and more parallel requests raise the transient-failure rate the
    // retry engine then has to absorb.
    public int PlaylistConcurrency { get; set; } = DefaultConcurrency;

    public const int MinConcurrency = 1;
    public const int MaxConcurrency = 8;
    public const int DefaultConcurrency = 3;

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MediaDetector", "settings.json");

    public static AppSettings Load(string? path = null)
    {
        var file = path ?? DefaultPath;
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
