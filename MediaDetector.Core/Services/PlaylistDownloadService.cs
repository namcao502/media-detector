using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Playlist;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Storage;
using MediaDetector.Core.Validation;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Services;

public sealed record PlaylistDownloadRequest(
    string Url,
    PlaylistFormatSelection Selection,
    string? OutputDir,
    bool CleanNames,
    // Tracks downloaded at once. Clamped by the service, so a hand-edited
    // settings.json cannot ask for 500 concurrent yt-dlp processes.
    int Concurrency = AppSettings.DefaultConcurrency);

// Replaces app/api/playlist/download/route.ts: flat-dump the playlist, then run
// one yt-dlp process per track so failures can be retried and skipped
// individually.
[SupportedOSPlatform("windows")]
public sealed class PlaylistDownloadService(DetectService detect)
{
    private const int AttemptsPerPhase = 5;
    private static readonly TimeSpan RetryBackoff = TimeSpan.FromSeconds(1);

    public async IAsyncEnumerable<DownloadLine> RunAsync(
        PlaylistDownloadRequest req,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (!YouTubeUrl.IsYouTubeUrl(req.Url))
        {
            yield return new ErrorLine("Invalid YouTube URL");
            yield break;
        }

        var outputDir = OutputPaths.EnsureCreated(req.OutputDir);
        var hasFfmpeg = (await DependencyChecker.ProbeFfmpegAsync()).Found;
        var (formatArgs, expectedExt) = FormatArgs.ForPlaylist(req.Selection, hasFfmpeg);

        var meta = new List<string>();
        meta.AddRange(ToolResolver.FfmpegLocationArgs());
        meta.AddRange(FormatArgs.Metadata(hasFfmpeg, expectedExt));

        // Fetch the track list first so each video can be downloaded (and retried)
        // as its own process.
        var dump = await detect.DumpEntriesAsync(req.Url, ct);
        if (!dump.Ok)
        {
            yield return new ErrorLine(dump.Error!);
            yield break;
        }

        var entries = dump.Value!.Entries;
        if (entries.Count == 0)
        {
            yield return new ErrorLine("Playlist has no downloadable tracks");
            yield break;
        }

        // Built literally, because per-track downloads do not populate
        // %(playlist_title)s.
        var folder = Path.Combine(outputDir, FormatArgs.SanitizeFolderName(dump.Value.Title));
        var concurrency = Math.Clamp(
            req.Concurrency, AppSettings.MinConcurrency, AppSettings.MaxConcurrency);
        AppLog.Info(
            "playlist",
            $"{entries.Count} tracks, {req.Selection.Mode}, {concurrency} at once -> {folder}");

        var ytdlpExe = ToolResolver.YtdlpExeOrDefault();
        var nodeExe = ToolResolver.ResolveNodeExe();

        async Task<TrackOutcome> Download(
            TrackJob track, int attempt, Func<DownloadLine, Task> sink, CancellationToken innerCt)
        {
            var videoUrl = $"https://www.youtube.com/watch?v={track.Id}";
            // Named per track from the flat-dump metadata, so the name is fixed
            // before yt-dlp runs and stays identical on a re-run (which is what
            // lets yt-dlp skip tracks it already has).
            var source = new NameSource(track.Title, Uploader: track.Author);

            var stem = req.CleanNames
                ? FileNaming.DownloadStem(source)
                : FileNaming.RawStem(source);

            var args = YtdlpArgs.Ytdlp(ytdlpExe, nodeExe,
            [
                .. formatArgs, "--no-playlist", videoUrl,
                "-o", FileNaming.OutputTemplateFor(Path.Combine(folder, stem)),
                .. YtdlpArgs.ProgressTemplate(),
                .. meta,
            ]);

            // Labelled so concurrent tracks stay tellable apart in the log.
            var label = $"track {track.Index}: ";
            var runner = new TrackRunner { Label = label };
            var translator = new DownloadTranslator { Label = label };

            await foreach (var line in translator.TranslateAsync(
                runner.RunAsync(args, ct: innerCt), () => runner.ExitCode, innerCt))
            {
                await sink(line);
            }

            var result = translator.Result;
            // A failed or cancelled attempt leaves the cover art it never got to
            // embed next to the media; each retry would add another one.
            if (result.Code != 0)
                DownloadTranslator.RemoveStrayThumbnail(result.ThumbnailPath);

            if (result.Code == 0)
            {
                // Unconditional, same as DownloadService: the cover art has no
                // other writer now, and the fetched .jpg must not be left behind.
                var coverPath = DownloadTranslator.CoverPathFor(result.SavedPath);
                var tags = FileNaming.MetadataOverrideFor(source, req.CleanNames, customTitle: null);
                await MetadataTagger.TryWriteTagsAsync(result.SavedPath, tags, coverPath);
                DownloadTranslator.DeleteThumbnail(coverPath);
            }

            return new TrackOutcome(
                result.Code == 0,
                result.SavedPath,
                result.ErrorMessage?.Contains(TrackRunner.HungMarker) == true);
        }

        var tracks = entries
            .Select((e, i) => new TrackJob(e.Id, e.Title, i + 1, e.Author))
            .ToArray();

        // The token is passed to RunAsync, not carried in options.
        var opts = new OrchestrateOptions(
            AttemptsPerPhase, folder, RetryBackoff, Task.Delay, concurrency);

        await foreach (var line in PlaylistOrchestrator.RunAsync(tracks, Download, opts, ct))
            yield return line;
    }
}
