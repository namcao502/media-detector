using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text;

namespace MediaDetector.Core.Processes;

public sealed record ExecResult(string Stdout, string Stderr, int ExitCode);

[SupportedOSPlatform("windows")]
public static class ProcessRunner
{
    // The only entry point user input may reach: no shell, so metacharacters stay
    // literal. That holds ONLY because args[0] is yt-dlp/node/ffmpeg -- passing a
    // shell as args[0] re-enters one and voids the guarantee entirely.
    public static Task<ExecResult> RunAsync(
        IReadOnlyList<string> args, CancellationToken ct = default)
    {
        var psi = NewPsi(args[0]);
        foreach (var arg in args.Skip(1)) psi.ArgumentList.Add(arg);
        return RunCoreAsync(psi, ct);
    }

    // Fixed internal commands only (e.g. "ffmpeg -version"). NEVER pass user
    // input here -- it goes through cmd.exe and is therefore shell-interpreted.
    public static Task<ExecResult> RunShellAsync(string command, CancellationToken ct = default)
    {
        var psi = NewPsi("cmd.exe");
        psi.ArgumentList.Add("/c");
        psi.ArgumentList.Add(command);
        return RunCoreAsync(psi, ct);
    }

    // Shared with LineStream so the encoding contract below is established in one
    // place: both sides of every pipe this app opens must agree on UTF-8.
    internal static ProcessStartInfo NewPsi(string fileName)
    {
        var psi = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        // Python encodes a REDIRECTED stdout in the ANSI codepage and drops what
        // will not fit. Does NOT reach yt-dlp.exe, which ignores it -- see
        // YtdlpArgs.Ytdlp's --encoding utf-8.
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        return psi;
    }

    private static async Task<ExecResult> RunCoreAsync(ProcessStartInfo psi, CancellationToken ct)
    {
        using var job = new JobObject();
        using var proc = new Process { StartInfo = psi };

        try
        {
            if (!proc.Start()) return new ExecResult("", "failed to start process", 1);
        }
        catch (Exception ex)
        {
            // A missing executable is a result, not an exception -- callers branch
            // on the exit code and surface stderr.
            return new ExecResult("", ex.Message, 1);
        }

        job.Assign(proc);

        var stdout = proc.StandardOutput.ReadToEndAsync(ct);
        var stderr = proc.StandardError.ReadToEndAsync(ct);

        try
        {
            await proc.WaitForExitAsync(ct);
            return new ExecResult((await stdout).Trim(), (await stderr).Trim(), proc.ExitCode);
        }
        catch (OperationCanceledException)
        {
            job.Terminate();
            // Observe both reads before returning, or they fault unobserved.
            try
            {
                await Task.WhenAll(stdout, stderr);
            }
            catch
            {
                // Expected once the process is killed.
            }
            return new ExecResult("", "cancelled", 1);
        }
    }
}
