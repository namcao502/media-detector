using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Channels;
using MediaDetector.Core.Diagnostics;

namespace MediaDetector.Core.Processes;

// Runs one yt-dlp download, yielding merged stdout+stderr lines. ExitCode is
// valid once enumeration completes and is what tells success from failure --
// the equivalent of the async generator's RETURN value at lib/ytdlp.ts:529.
[SupportedOSPlatform("windows")]
public sealed class TrackRunner
{
    // How long a run may produce no output at all before it is treated as hung.
    // ffmpeg postprocessing is silent by design -- yt-dlp swallows its output --
    // so a deadline is the only way to tell "still working" from "stuck".
    // Generous enough for a slow postprocess on a long track, but bounded:
    // without it one wedged track stalls a whole playlist indefinitely.
    public static readonly TimeSpan DefaultIdleTimeout = TimeSpan.FromMinutes(5);

    // Marks the error line a timeout produces. A hang is not a flaky network, so
    // callers use this to stop retrying instead of burning the deadline again.
    public const string HungMarker = "treating the download as hung";

    // Prefixed to this run's log lines. With several tracks downloading at once
    // their output interleaves, so without it there is no way to tell which spawn
    // a "finished" belongs to. Empty for a single download, where it is obvious.
    public string Label { get; init; } = "";

    public int ExitCode { get; private set; } = 1;

    public async IAsyncEnumerable<string> RunAsync(
        IReadOnlyList<string> args,
        TimeSpan? idleTimeout = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var idle = idleTimeout ?? DefaultIdleTimeout;
        var watchdogEnabled = idle > TimeSpan.Zero;

        var psi = new ProcessStartInfo(args[0])
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
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
                // A line can arrive on the Process event thread after the iterator
                // has torn down and disposed the CTS. Unhandled, this crashes the
                // process from a thread no caller can catch on.
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

        // The exact command line. This is the single most useful log entry when a
        // download misbehaves -- it can be pasted into a terminal verbatim to
        // reproduce, and it shows whether --js-runtimes actually got a Node path.
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
