using System.Runtime.CompilerServices;
using System.Threading.Channels;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Playlist;

// Lines and outcome travel separately: C# has no `yield*`-with-return-value.
public delegate Task<TrackOutcome> TrackDownloader(
    TrackJob track,
    int attempt,
    Func<DownloadLine, Task> sink,
    CancellationToken ct);

// No token here on purpose: a second copy alongside RunAsync's
// [EnumeratorCancellation] means every guard must check both, and one gets
// forgotten. Concurrency defaults to 1 to keep the engine's tests deterministic.
public sealed record OrchestrateOptions(
    int AttemptsPerPhase,
    string Folder,
    TimeSpan Backoff,
    Func<TimeSpan, Task> Sleep,
    int Concurrency = 1);

// Two-phase retry: phase 1 queues failures so the batch continues, phase 2
// re-sweeps. Workers share one merged channel, hence the TrackLine wrapping.
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

        // Breaking out of `await foreach` must stop the workers, or they keep
        // spawning yt-dlp for the rest of the playlist with nobody reading.
        var abandoned = CancellationTokenSource.CreateLinkedTokenSource(ct);

        // No `ct` on Task.Run: an already-cancelled token means the delegate never
        // runs, its finally never fires, and the drain below deadlocks.
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
            // Drained WITHOUT the token: it would throw the instant the token
            // trips, skipping BatchDoneLine, so a cancelled playlist reports
            // nothing. The driver's finally still completes the writer.
            while (await merged.Reader.WaitToReadAsync(CancellationToken.None))
            {
                while (merged.Reader.TryRead(out var line))
                {
                    yield return line;
                }
            }

            // A faulted driver would otherwise be dropped silently and the run
            // would look like it simply ended.
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

    // Phase 1 queues failures into `failures`; phase 2 reports them as final errors.
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

        // Shared cursor, not a fixed partition: one slow track then delays only
        // itself rather than its worker's whole share.
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
                    // CancellationToken.None: an unbounded channel never blocks a
                    // writer, so a token buys nothing and risks throwing mid-write.
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
