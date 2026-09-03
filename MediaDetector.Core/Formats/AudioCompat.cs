using MediaDetector.Core.Models;

namespace MediaDetector.Core.Formats;

public static class AudioCompat
{
    // Containers iOS plays natively. YouTube's highest-bitrate audio is
    // Opus-in-webm, which its stock apps do NOT play.
    private static readonly HashSet<string> AppleNativeExts =
        new(["m4a", "mp3", "aac", "mp4"], StringComparer.OrdinalIgnoreCase);

    public static bool IsApplePlayable(string ext) => AppleNativeExts.Contains(ext);

    // Floats iPhone-playable formats to the top while preserving the incoming
    // bitrate order within each group. Returns a new list (no mutation).
    public static IReadOnlyList<AudioFormat> SortAudioForApple(IReadOnlyList<AudioFormat> formats) =>
    [
        .. formats.Where(f => IsApplePlayable(f.Ext)),
        .. formats.Where(f => !IsApplePlayable(f.Ext)),
    ];
}
