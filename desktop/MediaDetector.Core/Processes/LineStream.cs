using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Channels;

namespace MediaDetector.Core.Processes;

[SupportedOSPlatform("windows")]
public static class LineStream
{
    // Yields stdout and stderr merged into one sequence, in arrival order.
    // Merging is not a convenience: reading one pipe to completion before the
    // other deadlocks once the unread pipe fills its ~64KB buffer.
    public static async IAsyncEnumerable<string> StreamAsync(
        IReadOnlyList<string> args,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
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

        // Unbounded: yt-dlp bursts output, and a bounded writer would block the
        // reader thread, recreating the deadlock this design exists to avoid.
        var channel = Channel.CreateUnbounded<string>(
            new UnboundedChannelOptions { SingleReader = true });

        using var job = new JobObject();
        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };

        // Process.Exited can fire BEFORE the async stdout/stderr callbacks have
        // drained, which silently drops the last lines -- exactly the ones that
        // matter (the final `[Merger] Merging formats into "..."` that becomes
        // savedPath, and trailing ERROR: text). Node's 'close' event gave that
        // guarantee for free; .NET does not. Each stream signals EOF with a null
        // Data, so complete only once BOTH have.
        var streamsFinished = 0;

        void OnData(object _, DataReceivedEventArgs e)
        {
            if (e.Data == null)
            {
                if (Interlocked.Increment(ref streamsFinished) == 2) channel.Writer.TryComplete();
                return;
            }
            if (!string.IsNullOrWhiteSpace(e.Data)) channel.Writer.TryWrite(e.Data);
        }

        proc.OutputDataReceived += OnData;
        proc.ErrorDataReceived += OnData;

        // `yield return` is illegal inside a catch clause (CS1631), so capture
        // the failure and surface it after the try block.
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
            yield return $"ERROR: {startError.Message}";
            yield break;
        }

        job.Assign(proc);
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        try
        {
            await foreach (var line in channel.Reader.ReadAllAsync(ct))
                yield return line;
        }
        finally
        {
            proc.OutputDataReceived -= OnData;
            proc.ErrorDataReceived -= OnData;
            // Covers the abandoned-enumerator case: if the caller stops pulling,
            // this still tears the process tree down.
            job.Terminate();
        }
    }
}
