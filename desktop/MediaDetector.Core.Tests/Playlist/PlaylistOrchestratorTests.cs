using System.Collections.Concurrent;
using MediaDetector.Core.Models;
using MediaDetector.Core.Playlist;

namespace MediaDetector.Core.Tests.Playlist;

public class PlaylistOrchestratorTests
{
    private static TrackJob[] Tracks(int count) =>
        [.. Enumerable.Range(1, count).Select(i => new TrackJob($"id{i}", $"Track {i}", i))];

    // Concurrency defaults to 1 so the retry/ordering tests below stay deterministic.
    private static OrchestrateOptions Options(int attempts = 5, int concurrency = 1) =>
        new(attempts, @"C:\out\List", TimeSpan.Zero, _ => Task.CompletedTask, concurrency);

    private static async Task<List<DownloadLine>> Drain(
        TrackJob[] tracks, TrackDownloader downloader, OrchestrateOptions opts,
        CancellationToken ct = default)
    {
        var lines = new List<DownloadLine>();
        await foreach (var line in PlaylistOrchestrator.RunAsync(tracks, downloader, opts, ct))
            lines.Add(line);
        return lines;
    }

    [Fact]
    public async Task AllSucceed_EmitsItemAndTrackDonePerTrackThenSummary()
    {
        var downloader = new TrackDownloader((_, _, _, _) =>
            Task.FromResult(new TrackOutcome(true, @"C:\out\a.m4a")));

        var lines = await Drain(Tracks(3), downloader, Options());

        Assert.Equal(3, lines.OfType<ItemLine>().Count());
        Assert.Equal(3, lines.OfType<TrackDoneLine>().Count());
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.Equal(3, done.Downloaded);
        Assert.Equal(0, done.Failed);
        Assert.False(done.Cancelled);
    }

    // Phase 1 retries up to attemptsPerPhase, emitting track-retry BETWEEN
    // attempts (so 5 attempts produce 4 retry lines), then skips and continues.
    [Fact]
    public async Task PhaseOneFailure_RetriesThenSkipsAndContinues()
    {
        var downloader = new TrackDownloader((t, _, _, _) =>
            Task.FromResult(new TrackOutcome(t.Index != 1)));

        var lines = await Drain(Tracks(2), downloader, Options());

        Assert.Equal(4, lines.OfType<TrackRetryLine>().Count(r => r.Index == 1 && r.Phase == 1));
        Assert.Contains(lines.OfType<TrackSkippedLine>(), s => s.Index == 1);
        // Track 2 still ran despite track 1 failing.
        Assert.Contains(lines.OfType<TrackDoneLine>(), d => d.Index == 2);
    }

    // Phase 2 re-sweeps the skipped tracks; recovery there counts as downloaded.
    [Fact]
    public async Task PhaseTwoRecovery_EmitsTrackDone()
    {
        var calls = 0;
        var downloader = new TrackDownloader((_, _, _, _) =>
            Task.FromResult(new TrackOutcome(++calls > 5)));

        var lines = await Drain(Tracks(1), downloader, Options());

        Assert.Contains(lines.OfType<TrackSkippedLine>(), s => s.Index == 1);
        Assert.Contains(lines.OfType<TrackDoneLine>(), d => d.Index == 1);
        Assert.Equal(1, Assert.Single(lines.OfType<BatchDoneLine>()).Downloaded);
    }

    // A permanently failing track is attempted 5 + 5 = 10 times, then track-error.
    [Fact]
    public async Task PermanentFailure_IsAttemptedTenTimesThenErrors()
    {
        var attempts = 0;
        var downloader = new TrackDownloader((_, _, _, _) =>
        {
            attempts++;
            return Task.FromResult(new TrackOutcome(false));
        });

        var lines = await Drain(Tracks(1), downloader, Options());

        Assert.Equal(10, attempts);
        Assert.Contains(lines.OfType<TrackErrorLine>(), e => e.Index == 1);
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.Equal(0, done.Downloaded);
        Assert.Equal(1, done.Failed);
    }

    // A hang is not a flaky network: retrying costs another full 5-minute
    // deadline, so the engine gives up on that track immediately.
    [Fact]
    public async Task HungTrack_IsNotRetried()
    {
        var attempts = 0;
        var downloader = new TrackDownloader((_, _, _, _) =>
        {
            attempts++;
            return Task.FromResult(new TrackOutcome(false, Hung: true));
        });

        await Drain(Tracks(1), downloader, Options());

        // One attempt per phase instead of five.
        Assert.Equal(2, attempts);
    }

    // Cancellation stops before the next track, skips the phase-2 sweep, and
    // STILL emits the summary -- draining the channel with the token would throw
    // OperationCanceledException out of RunAsync and emit nothing at all.
    [Fact]
    public async Task Cancellation_StopsImmediatelyAndFlagsTheSummary()
    {
        using var cts = new CancellationTokenSource();
        var attempts = 0;
        var downloader = new TrackDownloader(async (_, _, sink, _) =>
        {
            attempts++;
            await sink(new ProgressLine(50));
            cts.Cancel();
            return new TrackOutcome(false);
        });

        var lines = await Drain(Tracks(5), downloader, Options(), cts.Token);

        Assert.Equal(1, attempts);
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.True(done.Cancelled);
        Assert.Empty(lines.OfType<TrackErrorLine>());
    }

    // Ordering, not contents: a buffering implementation produces the exact same
    // final list, so only the sequence in which lines ARRIVE proves the progress
    // reached the UI while the track was still running.
    [Fact]
    public async Task LiveProgress_IsObservedBeforeTrackCompletes()
    {
        var gate = new TaskCompletionSource();
        var sawProgress = false;
        var progressWasLive = false;

        var downloader = new TrackDownloader(async (_, _, sink, _) =>
        {
            await sink(new ProgressLine(50));
            // Only completes once the consumer has actually seen the line above.
            // A buffering implementation never releases this and the test times out.
            await gate.Task.WaitAsync(TimeSpan.FromSeconds(5));
            return new TrackOutcome(true, @"C:\out\a.m4a");
        });

        await foreach (var line in PlaylistOrchestrator.RunAsync(
            Tracks(1), downloader, Options()))
        {
            // Wrapped now: with concurrency the orchestrator tags every line a
            // downloader emits with the track that produced it.
            if (line is TrackLine wrapped && wrapped.Inner is ProgressLine)
            {
                sawProgress = true;
                progressWasLive = !gate.Task.IsCompleted;
                gate.SetResult();
            }
        }

        Assert.True(sawProgress, "no ProgressLine was emitted at all");
        Assert.True(progressWasLive, "progress arrived only after the track finished");
    }

    [Fact]
    public async Task Summary_CarriesTheDestinationFolder()
    {
        var downloader = new TrackDownloader((_, _, _, _) =>
            Task.FromResult(new TrackOutcome(true)));
        var lines = await Drain(Tracks(1), downloader, Options());
        Assert.Equal(@"C:\out\List", Assert.Single(lines.OfType<BatchDoneLine>()).Folder);
    }

    // The load-bearing test for concurrency. No sleeps: every attempt blocks until
    // the full width is actually in flight, so a sequential engine can never
    // release them and the test fails on the wait rather than passing by luck.
    [Fact]
    public async Task Concurrency_RunsThatManyTracksAtOnce()
    {
        const int concurrency = 3;
        var reachedFullWidth = new TaskCompletionSource();
        var inFlight = 0;
        var peak = 0;
        var peakGate = new Lock();

        var downloader = new TrackDownloader(async (_, _, _, _) =>
        {
            var current = Interlocked.Increment(ref inFlight);
            lock (peakGate)
            {
                if (current > peak)
                {
                    peak = current;
                }
            }

            if (current >= concurrency)
            {
                reachedFullWidth.TrySetResult();
            }

            await reachedFullWidth.Task.WaitAsync(TimeSpan.FromSeconds(10));
            Interlocked.Decrement(ref inFlight);
            return new TrackOutcome(true, @"C:\out\a.m4a");
        });

        var lines = await Drain(Tracks(6), downloader, Options(concurrency: concurrency));

        Assert.Equal(concurrency, peak);
        Assert.Equal(6, lines.OfType<TrackDoneLine>().Count());
        Assert.Equal(6, Assert.Single(lines.OfType<BatchDoneLine>()).Downloaded);
    }

    // Never wider than asked for, even with far more tracks than slots.
    [Fact]
    public async Task Concurrency_IsNeverExceeded()
    {
        var inFlight = 0;
        var breached = false;

        var downloader = new TrackDownloader(async (_, _, _, _) =>
        {
            if (Interlocked.Increment(ref inFlight) > 2)
            {
                breached = true;
            }

            await Task.Yield();
            Interlocked.Decrement(ref inFlight);
            return new TrackOutcome(true, @"C:\out\a.m4a");
        });

        await Drain(Tracks(30), downloader, Options(concurrency: 2));

        Assert.False(breached, "more tracks ran at once than the configured limit");
    }

    // With several downloads in flight their output interleaves in arrival order,
    // so a line that is not tagged with its producer lands on the wrong row.
    [Fact]
    public async Task ConcurrentLines_AreAttributedToTheTrackThatProducedThem()
    {
        var downloader = new TrackDownloader(async (track, _, sink, _) =>
        {
            // The percentage identifies the producer, so a mis-tagged line is
            // caught even though the arrival order is arbitrary.
            await sink(new ProgressLine(track.Index * 10));
            return new TrackOutcome(true, @"C:\out\a.m4a");
        });

        var lines = await Drain(Tracks(4), downloader, Options(concurrency: 4));

        var progress = lines
            .OfType<TrackLine>()
            .Where(line => line.Inner is ProgressLine)
            .ToList();

        Assert.Equal(4, progress.Count);
        foreach (var line in progress)
        {
            Assert.Equal(line.Index * 10, ((ProgressLine)line.Inner).Percent);
        }
    }

    // The 5-per-phase budget is per track, so widening the engine must not let a
    // track be swept twice or leave one under-attempted.
    [Fact]
    public async Task PermanentFailure_UnderConcurrency_StillCapsAtTenAttemptsPerTrack()
    {
        var attempts = new ConcurrentDictionary<int, int>();

        var downloader = new TrackDownloader((track, _, _, _) =>
        {
            attempts.AddOrUpdate(track.Index, 1, (_, count) => count + 1);
            return Task.FromResult(new TrackOutcome(false));
        });

        var lines = await Drain(Tracks(4), downloader, Options(concurrency: 3));

        Assert.Equal(4, attempts.Count);
        Assert.All(attempts.Values, count => Assert.Equal(10, count));
        Assert.Equal(4, lines.OfType<TrackErrorLine>().Count());
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.Equal(0, done.Downloaded);
        Assert.Equal(4, done.Failed);
    }

    // Several workers race to finish, but exactly one summary must come out.
    [Fact]
    public async Task Cancellation_UnderConcurrency_EmitsOneCancelledSummary()
    {
        using var cts = new CancellationTokenSource();

        var downloader = new TrackDownloader(async (_, _, sink, _) =>
        {
            await sink(new ProgressLine(10));
            await cts.CancelAsync();
            return new TrackOutcome(false);
        });

        var lines = await Drain(Tracks(20), downloader, Options(concurrency: 4), cts.Token);

        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.True(done.Cancelled);
        Assert.Empty(lines.OfType<TrackErrorLine>());
    }

    // Walking away from the enumerator must stop the workers. Without it they keep
    // pulling tracks off the cursor and spawning yt-dlp with nobody reading the
    // output -- one leaked process when the engine was sequential, N now.
    [Fact]
    public async Task AbandoningTheEnumerator_StopsTheRemainingWorkers()
    {
        var started = 0;

        var downloader = new TrackDownloader(async (_, _, sink, innerCt) =>
        {
            Interlocked.Increment(ref started);
            await sink(new ProgressLine(1));
            // Never completes on its own: only cancellation can end this attempt,
            // so a leaked worker would keep the count climbing.
            await Task.Delay(Timeout.Infinite, innerCt);
            return new TrackOutcome(true);
        });

        await foreach (var line in PlaylistOrchestrator.RunAsync(
            Tracks(20), downloader, Options(concurrency: 2)))
        {
            if (line is TrackLine)
            {
                break;
            }
        }

        Assert.True(started <= 2, $"{started} tracks started after the consumer left");
    }
}
