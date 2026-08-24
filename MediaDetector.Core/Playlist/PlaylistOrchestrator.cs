using System.Runtime.CompilerServices;
using System.Threading.Channels;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Playlist;

// Downloads one track (attempt is 1-based), forwarding progress/phase lines to
// `sink` and returning the outcome. C# cannot express the TypeScript
// `yield*`-with-return-value pattern, so the lines and the outcome travel
// separately.
public delegate Task<TrackOutcome> TrackDownloader(
    TrackJob track,
    int attempt,
    Func<DownloadLine, Task> sink,
    CancellationToken ct);

// No CancellationToken here: RunAsync takes one [EnumeratorCancellation]
// parameter, which is the idiomatic C# spelling and what `await foreach` wires
// up. Carrying a second copy meant every guard had to check both, and one of
// them would eventually be forgotten.
//
// Concurrency defaults to 1 so the engine's own tests stay deterministic; the
// service passes the user's setting.
public sealed record OrchestrateOptions(
    int AttemptsPerPhase,
    string Folder,
    TimeSpan Backoff,
    Func<TimeSpan, Task> Sleep,
    int Concurrency = 1);

// Two-phase per-track retry engine. Phase 1 tries each track up to
// AttemptsPerPhase, queueing failures so the batch continues. Phase 2 re-sweeps
// the queued tracks up to AttemptsPerPhase more; any still failing become
// TrackErrorLine. The downloader and sleep are injected, so this is
// unit-testable without spawning yt-dlp.
//
// Up to Concurrency tracks run at once. Every worker writes into one merged
// channel that the returned enumerator drains, which is what lets a track's
// progress reach the UI while it is still running -- and is why the per-track
// lines are wrapped in TrackLine on the way out.
public static class PlaylistOrchestrator
{
    public static async IAsyncEnumerable<DownloadLine> RunAsync(
        IReadOnlyList<TrackJob> tracks,
        TrackDownloader download,
        OrchestrateOptions opts,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        // SingleWriter: false -- with Concurrency > 1 several workers write at once.
        var merged = Channel.CreateUnbounded<DownloadLine>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        // Abandoning the enumerator (a `break` out of `await foreach`) has to stop
        // the workers too. Without this they would carry on spawning yt-dlp for
        // the rest of the playlist with nobody reading the output.
        var abandoned = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // No `ct` on Task.Run: if the token is already cancelled the delegate never
        // runs, its finally never fires, the channel is never completed and the
        // drain below deadlocks.
        var driver = Task.Run(
            async () =>
            {
                try
                {
                    await DriveAsync(tracks, download, opts, merged.Writer, abandoned.Token);
                }
                finally
                {
                    merged.Writer.TryComplete();
                }
            },
            CancellationToken.None);

        try
        {
            // Drained WITHOUT the token. ReadAllAsync(ct) throws
            // OperationCanceledException the instant the token trips, which escapes
            // RunAsync and skips the final BatchDoneLine entirely -- so a cancelled
            // playlist would report nothing at all. The driver's finally always
            // completes the writer, so this loop still terminates promptly.
            while (await merged.Reader.WaitToReadAsync(CancellationToken.None))
            {
                while (merged.Reader.TryRead(out var line))
                {
                    yield return line;
                }
            }

            // Surfaces anything the driver threw. A faulted task would otherwise be
            // dropped silently and the run would look like it simply ended.
            await driver;
        }
        finally
        {
            abandoned.Cancel();
            await WaitQuietlyAsync(driver);
            abandoned.Dispose();
        }
    }

    private static async Task DriveAsync(
        IReadOnlyList<TrackJob> tracks,
        TrackDownloader download,
        OrchestrateOptions opts,
        ChannelWriter<DownloadLine> output,
        CancellationToken ct)
    {
        var total = tracks.Count;
        var skipped = new List<TrackJob>();

        var downloaded = await RunPhaseAsync(tracks, 1, total, download, opts, output, skipped, ct);

        // Re-swept in playlist order, not in the order the failures happened to
        // finish in -- which with concurrent workers is arbitrary.
        var resweep = skipped.OrderBy(track => track.Index).ToArray();
        downloaded += await RunPhaseAsync(resweep, 2, total, download, opts, output, skipped, ct);

        await output.WriteAsync(
            new BatchDoneLine(
                opts.Folder, downloaded, total, total - downloaded, ct.IsCancellationRequested),
            CancellationToken.None);
    }

    // Runs one phase over `tracks` with up to opts.Concurrency workers, returning
    // how many succeeded. Phase 1 queues failures into `failures`; phase 2 reports
    // them as final errors.
    private static async Task<int> RunPhaseAsync(
        IReadOnlyList<TrackJob> tracks,
        int phase,
        int total,
        TrackDownloader download,
        OrchestrateOptions opts,
        ChannelWriter<DownloadLine> output,
        List<TrackJob> failures,
        CancellationToken ct)
    {
        if (tracks.Count == 0)
        {
            return 0;
        }

        // A shared cursor rather than a fixed partition per worker: one slow track
        // then delays only itself, instead of leaving its worker's whole share
        // waiting behind it.
        var cursor = -1;
        var downloaded = 0;
        var workerCount = Math.Min(Math.Max(opts.Concurrency, 1), tracks.Count);
        var workers = new Task[workerCount];

        for (var slot = 0; slot < workerCount; slot++)
        {
            workers[slot] = Task.Run(
                async () =>
                {
                    while (!ct.IsCancellationRequested)
                    {
                        var next = Interlocked.Increment(ref cursor);
                        if (next >= tracks.Count)
                        {
                            break;
                        }

                        var track = tracks[next];
                        await output.WriteAsync(
                            new ItemLine(track.Index, total), CancellationToken.None);

                        var outcome = await AttemptAsync(track, phase, download, opts, output, ct);

                        if (outcome.Ok)
                        {
                            Interlocked.Increment(ref downloaded);
                            await output.WriteAsync(
                                new TrackDoneLine(track.Index, outcome.SavedPath ?? ""),
                                CancellationToken.None);
                        }
                        else if (!ct.IsCancellationRequested && phase == 1)
                        {
                            lock (failures)
                            {
                                failures.Add(track);
                            }

                            await output.WriteAsync(
                                new TrackSkippedLine(track.Index), CancellationToken.None);
                        }
                        else if (!ct.IsCancellationRequested)
                        {
                            await output.WriteAsync(
                                new TrackErrorLine(track.Index, track.Title), CancellationToken.None);
                        }
                    }
                },
                CancellationToken.None);
        }

        await Task.WhenAll(workers);
        return downloaded;
    }

    private static async Task<TrackOutcome> AttemptAsync(
        TrackJob track,
        int phase,
        TrackDownloader download,
        OrchestrateOptions opts,
        ChannelWriter<DownloadLine> output,
        CancellationToken ct)
    {
        var outcome = new TrackOutcome(false);

        for (var attempt = 1; attempt <= opts.AttemptsPerPhase; attempt++)
        {
            try
            {
                outcome = await download(
                    track,
                    attempt,
                    // Written straight into the merged channel, which the enumerator
                    // drains concurrently, so progress reaches the UI while the track
                    // is still running rather than in one burst at the end.
                    // CancellationToken.None: an unbounded channel never blocks a
                    // writer, so a token here buys nothing and only risks throwing
                    // mid-write.
                    line => output
                        .WriteAsync(new TrackLine(track.Index, line), CancellationToken.None)
                        .AsTask(),
                    ct);
            }
            catch (OperationCanceledException)
            {
                outcome = new TrackOutcome(false);
            }

            if (outcome.Ok)
            {
                return outcome;
            }

            // A cancelled track exits non-zero exactly like a failed one; without
            // this the engine would keep retrying work the user just stopped.
            if (ct.IsCancellationRequested)
            {
                return outcome;
            }

            // Likewise a hang: 5 more attempts would cost 5 more full deadlines.
            if (outcome.Hung)
            {
                return outcome;
            }

            if (attempt < opts.AttemptsPerPhase)
            {
                await output.WriteAsync(
                    new TrackRetryLine(track.Index, attempt, phase), CancellationToken.None);
                await opts.Sleep(opts.Backoff);
            }
        }

        return outcome;
    }

    // The enumerator is already unwinding by the time this runs, so there is
    // nowhere to rethrow to.
    private static async Task WaitQuietlyAsync(Task driver)
    {
        try
        {
            await driver;
        }
        catch (OperationCanceledException)
        {
            // Expected: this is the abandoned-enumerator path.
        }
        catch (Exception ex)
        {
            AppLog.Warn("playlist", $"worker faulted during shutdown: {ex.Message}");
        }
    }
}
