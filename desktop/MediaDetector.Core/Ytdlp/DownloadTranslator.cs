using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public sealed record DownloadRunResult(
    int Code,
    string? SavedPath = null,
    string? ErrorMessage = null,
    // Cover art yt-dlp wrote alongside the media; only still on disk if the run
    // did not reach the embed step. See RemoveStrayThumbnail.
    string? ThumbnailPath = null);

// Translates raw yt-dlp output into UI lines: a progress update per template
// line, a phase line whenever the stage changes (never repeated), and the final
// path / exit code / error text in Result. The source sequence is injected, so
// this is fully unit-testable without spawning anything.
public sealed class DownloadTranslator
{
    private static readonly Regex ErrorPrefix =
        new(@"^ERROR:\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Prefixed to this run's yt-dlp log lines, for the same reason as
    // TrackRunner.Label: concurrent tracks interleave their output.
    public string Label { get; init; } = "";

    public DownloadRunResult Result { get; private set; } = new(1);

    public async IAsyncEnumerable<DownloadLine> TranslateAsync(
        IAsyncEnumerable<string> source,
        Func<int> exitCode,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        string? savedPath = null;
        string? thumbnailPath = null;
        DownloadPhase? lastPhase = null;
        var errors = new List<string>();

        await foreach (var line in source.WithCancellation(ct))
        {
            var progress = OutputParser.ParseProgress(line);

            // Log everything EXCEPT the progress spam: a 20-minute download emits
            // hundreds of @PROG lines and they would bury the useful output. The
            // rest -- warnings, extractor notes, and the actual error text on a
            // failure -- is exactly what has nowhere else to go in a windowed app.
            if (progress == null)
            {
                var level = ErrorPrefix.IsMatch(line) ? LogLevel.Error : LogLevel.Debug;
                AppLog.Write(level, "yt-dlp", Label + line);
            }

            if (progress != null) yield return progress;

            var phase = OutputParser.ParsePhase(line);
            if (phase != null && phase.Phase != lastPhase)
            {
                lastPhase = phase.Phase;
                yield return phase;
            }

            var dest = OutputParser.ParseDestination(line);
            if (dest != null) savedPath = dest;

            var thumb = OutputParser.ParseThumbnailPath(line);
            if (thumb != null) thumbnailPath = thumb;

            if (ErrorPrefix.IsMatch(line))
                errors.Add(ErrorPrefix.Replace(line, "").Trim());
        }

        Result = new DownloadRunResult(
            exitCode(),
            savedPath,
            errors.Count != 0 ? string.Join(" ", errors) : null,
            thumbnailPath);
    }

    // Best-effort: a thumbnail we could not delete is untidy, never fatal.
    // Only ever the exact path yt-dlp reported -- never a glob. The resumable
    // .part file is deliberately left alone.
    public static void RemoveStrayThumbnail(string? thumbnailPath)
    {
        if (string.IsNullOrEmpty(thumbnailPath)) return;
        try
        {
            File.Delete(thumbnailPath);
        }
        catch
        {
            // Already gone, or locked by another process.
        }
    }
}
