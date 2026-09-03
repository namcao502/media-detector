using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Threading.Channels;
using MediaDetector.Core.Diagnostics;

namespace MediaDetector.Core.Processes;

// One yt-dlp download, yielding merged stdout+stderr. ExitCode is valid only once
// enumeration completes, and is what tells success from failure.
[SupportedOSPlatform("windows")]
public sealed class TrackRunner
{
    // ffmpeg postprocessing is silent by design, so a deadline is the only way to
    // tell "still working" from "wedged".
    public static readonly TimeSpan DefaultIdleTimeout = TimeSpan.FromMinutes(5);

    // A hang is not a flaky network, so callers use this to stop retrying rather
    // than burn the deadline again.
    public const string HungMarker = "treating the download as hung";

    // Concurrent tracks interleave their output; without this there is no telling
    // which spawn a "finished" belongs to.
    public string Label { get; init; } = "";

    public int ExitCode { get; private set; } = 1;

    public async IAsyncEnumerable<string> RunAsync(
        IReadOnlyList<string> args,
        TimeSpan? idleTimeout = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var idle = idleTimeout ?? DefaultIdleTimeout;
        var watchdogEnabled = idle > TimeSpan.Zero;

        // NewPsi, not a hand-rolled copy: the UTF-8 pipe encoding and
        // PYTHONIOENCODING are one contract and this used to silently omit the
        // second half of it.
        var psi = ProcessRunner.NewPsi(args[0]);
        foreach (var arg in args.Skip(1)) psi.ArgumentList.Add(arg);

        var channel = Channel.CreateUnbounded<string>(
            new UnboundedChannelOptions { SingleReader = true });

        using var job = new JobObject();
        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };

        // Fires when the process has been silent for `idle`. Re-armed on every
        // line, so the deadline is on silence, not total runtime.
        using var idleCts = new CancellationTokenSource();
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, idleCts.Token);

        void Rearm()
        {
            if (!watchdogEnabled) return;
            try
            {
                idleCts.CancelAfter(idle);
            }
            catch (ObjectDisposedException)
            {
                // A line can arrive after the iterator tore down and disposed the
                // CTS. Unhandled, it crashes from a thread no caller can catch on.
            }
        }

        // Same EOF-sentinel rule as LineStream: Process.Exited can beat the
        // stdout/stderr drain, and the dropped tail is where savedPath lives.
        var streamsFinished = 0;

        void OnData(object _, DataReceivedEventArgs e)
        {
            if (e.Data == null)
            {
                if (Interlocked.Increment(ref streamsFinished) == 2) channel.Writer.TryComplete();
                return;
            }
            Rearm();
            if (!string.IsNullOrWhiteSpace(e.Data)) channel.Writer.TryWrite(e.Data);
        }

        proc.OutputDataReceived += OnData;
        proc.ErrorDataReceived += OnData;

        // Same CS1631 constraint as LineStream: no yield inside a catch.
        Exception? startError = null;
        try
        {
            proc.Start();
        }
        catch (Exception ex)
        {
            startError = ex;
        }

        if (startError != null)
        {
            ExitCode = 1;
            yield return $"ERROR: {startError.Message}";
            yield break;
        }

        // Pasteable into a terminal verbatim -- the most useful entry in the log
        // when a download misbehaves.
        AppLog.Info("spawn", Label + string.Join(" ", args.Select(Quote)));

        job.Assign(proc);
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        Rearm();

        var hung = false;
        try
        {
            while (true)
            {
                string line;
                try
                {
                    if (!await channel.Reader.WaitToReadAsync(linked.Token)) break;
                    if (!channel.Reader.TryRead(out line!)) continue;
                }
                catch (OperationCanceledException)
                {
                    // Distinguish the watchdog from a user cancellation: only the
                    // former is reported as a hang, because only it should stop
                    // the retry engine from trying again.
                    hung = idleCts.IsCancellationRequested && !ct.IsCancellationRequested;
                    break;
                }
                yield return line;
            }

            if (hung)
                yield return $"ERROR: no output for {(int)idle.TotalSeconds}s -- {HungMarker}";
        }
        finally
        {
            // Unsubscribe BEFORE the enclosing `using` disposes idleCts, or a
            // late line calls CancelAfter on a disposed CTS.
            proc.OutputDataReceived -= OnData;
            proc.ErrorDataReceived -= OnData;

            // Kill FIRST, observe second. Only terminating on hang/cancel meant an
            // abandoned enumerator fell through to WaitForExit(5000) on a
            // still-running process and blocked five seconds before killing it.
            if (!proc.HasExited) job.Terminate();

            try
            {
                proc.WaitForExit(5000);
                ExitCode = proc.HasExited ? proc.ExitCode : 1;
            }
            catch
            {
                ExitCode = 1;
            }

            // A killed process reports non-zero anyway, but be explicit: hang and
            // cancel are failures regardless of what Windows reported.
            if (hung || ct.IsCancellationRequested) ExitCode = 1;

            var outcome = hung ? "hung" : ct.IsCancellationRequested ? "cancelled" : $"exit {ExitCode}";
            AppLog.Write(
                ExitCode == 0 ? LogLevel.Info : LogLevel.Warn, "spawn", $"{Label}finished: {outcome}");

            job.Terminate();
        }
    }

    // Quote only what needs it, so the logged line stays readable and is still
    // valid to paste into a shell.
    private static string Quote(string arg) =>
        arg.Contains(' ') || arg.Contains('"') ? $"\"{arg.Replace("\"", "\\\"")}\"" : arg;
}
