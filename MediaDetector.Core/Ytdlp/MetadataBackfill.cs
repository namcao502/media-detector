using System.Runtime.Versioning;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Naming;

namespace MediaDetector.Core.Ytdlp;

public sealed record BackfillReport(int Scanned, int Updated, int AlreadyCorrect, int Failed);

// Repairs files downloaded before the PYTHONIOENCODING fix in ProcessRunner.
// Those runs corrupted savedPath for any non-ASCII path, so MetadataTagger was
// handed a filename that did not exist and the title/artist correction never
// landed -- the file kept whatever yt-dlp's --embed-metadata wrote, which is the
// raw YouTube title and the channel name.
//
// The correction is recomputed from the file's OWN current tag rather than by
// reverse-parsing its filename. --embed-metadata wrote exactly the raw title and
// uploader that DownloadService fed to FileNaming.SplitName, so replaying
// SplitName over them reproduces what the download should have written. Parsing
// the filename back would have to undo SanitizeFilename's full-width character
// substitutions, which are not reversible.
[SupportedOSPlatform("windows")]
public static class MetadataBackfill
{
    // Containers mutagen can tag. webm/opus are excluded on purpose: File(easy=True)
    // returns None for them, which is the same reason a "Best available" download
    // never gets a corrected tag in the first place.
    private static readonly string[] TaggableExtensions =
        [".m4a", ".mp4", ".m4v", ".mp3", ".flac", ".ogg", ".mka"];

    public static bool IsTaggable(string path) =>
        TaggableExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyList<string> FindCandidates(string directory, bool recursive) =>
        Directory.EnumerateFiles(
                directory, "*",
                recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly)
            .Where(IsTaggable)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();

    // Pure, so the rules are testable without touching a file. Returns null when
    // there is nothing worth writing: an untitled file, or one whose tag already
    // equals what SplitName would produce. That second case is what makes a repeat
    // run a no-op instead of re-writing all 141 files every time.
    public static (string Title, string Artist)? CorrectionFor(string currentTitle, string currentArtist)
    {
        if (string.IsNullOrWhiteSpace(currentTitle))
        {
            return null;
        }

        var (title, artist) = FileNaming.SplitName(
            new NameSource(currentTitle, Uploader: currentArtist));

        if (title == currentTitle && artist == currentArtist)
        {
            return null;
        }

        return (title, artist);
    }

    // Best-effort per file, exactly like MetadataTagger: one unreadable file must
    // not abandon the other 140. Progress is reported per file because a folder
    // this size takes two Python spawns each and the UI would otherwise sit silent.
    public static async Task<BackfillReport> RunAsync(
        string python,
        IReadOnlyList<string> paths,
        IProgress<string>? progress = null,
        CancellationToken ct = default)
    {
        var updated = 0;
        var alreadyCorrect = 0;
        var failed = 0;

        foreach (var path in paths)
        {
            ct.ThrowIfCancellationRequested();
            var name = Path.GetFileName(path);

            var tags = await MetadataTagger.ReadTagsAsync(python, path, ct);
            if (tags == null)
            {
                failed++;
                AppLog.Warn("backfill", $"could not read tags: {name}");
                progress?.Report($"Unreadable: {name}");
                continue;
            }

            var correction = CorrectionFor(tags.Value.Title, tags.Value.Artist);
            if (correction == null)
            {
                alreadyCorrect++;
                progress?.Report($"Already correct: {name}");
                continue;
            }

            var ok = await MetadataTagger.TryWriteTagsAsync(
                python, path, correction.Value.Title, correction.Value.Artist, ct);
            if (ok)
            {
                updated++;
                progress?.Report($"Fixed: {correction.Value.Title} - {correction.Value.Artist}");
            }
            else
            {
                failed++;
                progress?.Report($"Failed: {name}");
            }
        }

        AppLog.Info("backfill",
            $"scanned={paths.Count} updated={updated} alreadyCorrect={alreadyCorrect} failed={failed}");
        return new BackfillReport(paths.Count, updated, alreadyCorrect, failed);
    }
}
