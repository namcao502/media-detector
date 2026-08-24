using System.Globalization;
using System.Text.RegularExpressions;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public static class OutputParser
{
    // Marker distinguishing our --progress-template line from yt-dlp's other output.
    public const string ProgressPrefix = "@PROG";

    // Fields requested from --progress-template, in emission order. Raw numbers
    // rather than yt-dlp's human-readable "1.23MiB/s", so the UI formats them
    // itself and never parses units or locale text.
    public static readonly string[] ProgressFields =
    [
        "downloaded_bytes", "total_bytes", "total_bytes_estimate",
        "speed", "eta", "fragment_index", "fragment_count",
    ];

    // yt-dlp renders an unset field as the literal "NA".
    private static double? ParseNumberField(string? raw)
    {
        if (string.IsNullOrEmpty(raw) || raw == "NA") return null;
        if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
            return null;
        return double.IsFinite(v) ? v : null;
    }

    private static readonly Regex HumanProgress =
        new(@"\[download\]\s+([\d.]+)%", RegexOptions.CultureInvariant);

    // Parses one progress update. Handles our --progress-template line first, and
    // falls back to yt-dlp's default human-readable line so a percentage still
    // shows if the template is ever dropped from the args.
    public static ProgressLine? ParseProgress(string line)
    {
        if (line.StartsWith(ProgressPrefix, StringComparison.Ordinal))
        {
            var parts = line[ProgressPrefix.Length..]
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            string? At(int i) => i < parts.Length ? parts[i] : null;

            var downloaded = ParseNumberField(At(0));
            // Fragmented (DASH/HLS) downloads only know an estimate.
            var total = ParseNumberField(At(1)) ?? ParseNumberField(At(2));

            var percent = downloaded != null && total != null && total.Value > 0
                ? Math.Min(100, Math.Round(downloaded.Value / total.Value * 1000) / 10)
                : 0;

            return new ProgressLine(
                percent,
                (long?)downloaded,
                (long?)total,
                ParseNumberField(At(3)),
                ParseNumberField(At(4)),
                (int?)ParseNumberField(At(5)),
                (int?)ParseNumberField(At(6)));
        }

        var match = HumanProgress.Match(line);
        return match.Success
            ? new ProgressLine(double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture))
            : null;
    }

    // Which yt-dlp stage a line came from. The ffmpeg-backed postprocessors print
    // one line when they start and nothing until they finish, so this label is the
    // only signal that a stalled-looking bar is actually still working.
    private static readonly (Regex Pattern, DownloadPhase Phase, string Label)[] PhaseRules =
    [
        (new(@"^\[download\] Destination:"), DownloadPhase.Downloading, "Downloading"),
        (new(@"^\[Merger\]"), DownloadPhase.Merging, "Merging video and audio"),
        (new(@"^\[(ExtractAudio|VideoConvertor|VideoRemuxer)\]"), DownloadPhase.Converting,
            "Converting with ffmpeg"),
        // yt-dlp's FixupM4a/FixupStretched/... postprocessors, also ffmpeg-backed.
        (new(@"^\[Fixup\w*\]"), DownloadPhase.Converting, "Repairing container"),
        (new(@"^\[(Metadata|EmbedThumbnail|ThumbnailsConvertor|EmbedSubtitle)\]"),
            DownloadPhase.Embedding, "Embedding metadata and cover art"),
        (new(@"^\[MoveFiles\]|^Deleting original file"), DownloadPhase.Finishing, "Finishing up"),
        (new(@"^\[(info|generic|youtube(:\w+)?)\]"), DownloadPhase.Extracting, "Reading video page"),
    ];

    public static PhaseLine? ParsePhase(string line)
    {
        foreach (var (pattern, phase, label) in PhaseRules)
            if (pattern.IsMatch(line))
                return new PhaseLine(phase, label);
        return null;
    }

    private static readonly Regex DownloadDest =
        new(@"\[download\] Destination: (.+)$", RegexOptions.CultureInvariant);

    private static readonly Regex MergerDest =
        new(@"\[Merger\] Merging formats into ""(.+)""$", RegexOptions.CultureInvariant);

    public static string? ParseDestination(string line)
    {
        var download = DownloadDest.Match(line);
        if (download.Success) return download.Groups[1].Value.Trim();
        var merger = MergerDest.Match(line);
        return merger.Success ? merger.Groups[1].Value.Trim() : null;
    }

    private static readonly Regex ThumbnailWrite =
        new(@"^\[info\]\s+Writing\s+\w+\s+thumbnail(?:\s+\S+)?\s+to:\s*(.+)$",
            RegexOptions.CultureInvariant);

    // yt-dlp downloads cover art to a sibling file and deletes it once the embed
    // postprocessor runs. A failed or cancelled download never reaches that step,
    // orphaning the image next to the media. Neither --paths nor `-o thumbnail:`
    // redirects it (both verified), so the path is scraped from this line.
    public static string? ParseThumbnailPath(string line)
    {
        var match = ThumbnailWrite.Match(line);
        return match.Success ? match.Groups[1].Value.Trim() : null;
    }
}
