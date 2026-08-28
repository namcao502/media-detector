using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text;

namespace MediaDetector.Core.Processes;

public sealed record ExecResult(string Stdout, string Stderr, int ExitCode);

[SupportedOSPlatform("windows")]
public static class ProcessRunner
{
    // Safe for user-controlled arguments (URLs, file names): no shell is created,
    // so metacharacters reach the target process as literal text. This is the
    // only entry point user input may reach.
    //
    // CAVEAT, and it is load-bearing: this holds because args[0] is yt-dlp,
    // python, node or ffmpeg -- none of which parse a command line as script.
    // Passing "cmd.exe" or "powershell.exe" as args[0] re-enters a shell and
    // voids the guarantee entirely, because ArgumentList only quotes arguments
    // containing space, tab or quote. Never route user input through RunAsync
    // with a shell as the target.
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

        // We decode as UTF-8 above, but Python encodes a REDIRECTED stdout in the
        // ANSI codepage (cp1252 here), and yt-dlp's write_string drops whatever
        // will not fit with errors='ignore'. A Vietnamese folder name therefore
        // came back with one char replaced and another deleted, so savedPath named
        // a file that does not exist and every post-download tag write failed.
        // Forcing the child to UTF-8 is what makes the two ends agree. Harmless
        // for node/ffmpeg, which ignore it.
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
