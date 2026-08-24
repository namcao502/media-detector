using System.Text.RegularExpressions;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public static class FormatArgs
{
    // Always pick the source that needs the least conversion. YouTube's plain
    // `bestaudio` is opus-in-webm, so asking for m4a without a selector made
    // ffmpeg transcode every track: measured at 27s vs 0.4s for a 37-minute file,
    // with no output while it ran, which looked exactly like a hang.
    // The stereo clause matters too: plain bestaudio[ext=m4a] picks the 5.1
    // surround AAC track where one exists (format 258, 388kbps vs 140's 129kbps),
    // which is 3x the bytes for something headed to a phone.
    private const string M4aSource =
        "bestaudio[ext=m4a][audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best";

    // Containers yt-dlp can embed a cover-art thumbnail into. Notably NOT webm --
    // passing --embed-thumbnail for webm output makes yt-dlp error in postprocessing.
    private static readonly HashSet<string> ThumbnailExts =
        new(["mp3", "mkv", "mka", "ogg", "opus", "flac", "m4a", "mp4", "m4v", "mov"],
            StringComparer.OrdinalIgnoreCase);

    // Builds the yt-dlp format args for a playlist download plus the container ext
    // the output will have. ExpectedExt feeds Metadata so --embed-thumbnail is only
    // requested for containers that can hold it.
    public static (string[] Args, string ExpectedExt) ForPlaylist(
        PlaylistFormatSelection sel, bool hasFfmpeg)
    {
        if (sel.Mode == PlaylistMode.Video)
        {
            // Prefer mp4 (h264+aac) so every file is a consistent, embeddable .mp4.
            var cap = sel.VideoQuality switch
            {
                PlaylistVideoQuality.Q1080 => "[height<=1080]",
                PlaylistVideoQuality.Q720 => "[height<=720]",
                _ => "",
            };
            var selector = cap.Length == 0
                ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
                : $"bestvideo{cap}[ext=mp4]+bestaudio[ext=m4a]/best{cap}[ext=mp4]/best{cap}";
            return (["-f", selector, "--merge-output-format", "mp4"], "mp4");
        }

        return sel.AudioFormat switch
        {
            // mp3 is a re-encode whatever the source; starting from AAC is no
            // slower than from opus and avoids a needless second generation loss.
            PlaylistAudioFormat.Mp3 =>
                (["-f", M4aSource, "-x", "--audio-format", "mp3"], "mp3"),

            // Native audio, no conversion. Typically opus-in-webm -> report webm
            // so no thumbnail is requested (webm cannot embed one).
            PlaylistAudioFormat.Best =>
                (["-f", "bestaudio/best"], "webm"),

            // m4a: prefer an AAC source so --audio-format m4a is a lossless remux.
            _ when hasFfmpeg =>
                (["-f", M4aSource, "-x", "--audio-format", "m4a"], "m4a"),

            // Without ffmpeg there is no postprocessing at all.
            _ => (["-f", M4aSource], "m4a"),
        };
    }

    // yt-dlp postprocessors that embed metadata/cover art/chapters all require
    // ffmpeg. Returns [] when ffmpeg is absent so the download still succeeds
    // (just untagged). Text metadata + chapters embed into any container; the
    // thumbnail is gated on `ext` (pass null for "unknown container").
    public static string[] Metadata(bool hasFfmpeg, string? ext)
    {
        if (!hasFfmpeg) return [];
        var args = new List<string> { "--embed-metadata", "--embed-chapters" };
        if (ext == null || ThumbnailExts.Contains(ext)) args.Add("--embed-thumbnail");
        return [.. args];
    }

    private static readonly Regex IllegalFolderChars =
        new(@"[\\/:*?""<>|\x00-\x1f]", RegexOptions.CultureInvariant);

    // Single-video downloads do not populate %(playlist_title)s, so the folder
    // name is injected into the path literally and must be sanitised here.
    public static string SanitizeFolderName(string name)
    {
        var cleaned = IllegalFolderChars.Replace(name, "_").Trim();
        cleaned = Regex.Replace(cleaned, @"[. ]+$", "");
        return cleaned.Length != 0 ? cleaned : "Playlist";
    }
}
