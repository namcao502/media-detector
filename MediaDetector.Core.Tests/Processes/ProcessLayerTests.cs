using System.Diagnostics;
using MediaDetector.Core.Processes;

namespace MediaDetector.Core.Tests.Processes;

public class JobObjectTests
{
    [Fact]
    public void DisposingTheJob_KillsTheWholeTree()
    {
        var job = new JobObject();
        var psi = new ProcessStartInfo("cmd.exe", "/c ping -n 30 127.0.0.1 > nul")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        // Snapshot first: GetProcessesByName is machine-wide, so an unrelated
        // ping running on this box would otherwise be asserted on (and waited
        // for). Only processes this test created are in scope.
        var before = Process.GetProcessesByName("PING").Select(p => p.Id).ToHashSet();

        using var proc = Process.Start(psi)!;
        Assert.True(job.Assign(proc));

        Thread.Sleep(500);
        var grandchildren = Process.GetProcessesByName("PING")
            .Where(p => !before.Contains(p.Id))
            .ToArray();
        Assert.NotEmpty(grandchildren);

        job.Dispose();

        Assert.True(proc.WaitForExit(5000));
        foreach (var p in grandchildren)
        {
            Assert.True(p.WaitForExit(5000), "grandchild ping survived the job kill");
            p.Dispose();
        }
    }

    [Fact]
    public void Assign_ReportsSuccess()
    {
        using var job = new JobObject();
        using var proc = Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 10 127.0.0.1 > nul")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        })!;
        // The return value is the orphan-kill guarantee; ignoring it would make a
        // failed assignment indistinguishable from success.
        Assert.True(job.Assign(proc));
    }

    [Fact]
    public void Assign_OnAlreadyExitedProcess_DoesNotThrow()
    {
        using var job = new JobObject();
        using var proc = Process.Start(new ProcessStartInfo("cmd.exe", "/c exit 0")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        })!;
        proc.WaitForExit();
        Assert.Null(Record.Exception(() => job.Assign(proc)));
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        var job = new JobObject();
        job.Dispose();
        Assert.Null(Record.Exception(job.Dispose));
    }
}

public class ProcessRunnerTests
{
    [Fact]
    public async Task RunAsync_CapturesStdoutAndZeroExit()
    {
        var result = await ProcessRunner.RunAsync(["cmd.exe", "/c", "echo hello"]);
        Assert.Equal(0, result.ExitCode);
        Assert.Equal("hello", result.Stdout);
    }

    [Fact]
    public async Task RunAsync_CapturesNonZeroExit()
        => Assert.Equal(3, (await ProcessRunner.RunAsync(["cmd.exe", "/c", "exit 3"])).ExitCode);

    // A missing executable must be a result, not an exception.
    [Fact]
    public async Task RunAsync_MissingExecutableReturnsFailureNotThrow()
    {
        var result = await ProcessRunner.RunAsync(["definitely-not-a-real-exe-xyz"]);
        Assert.NotEqual(0, result.ExitCode);
        Assert.NotEmpty(result.Stderr);
    }

    // Arguments reach the target process verbatim because no shell parses them.
    // This must NOT be tested through cmd.exe: ArgumentList only quotes arguments
    // containing space, tab or quote, so ["cmd.exe","/c","echo","a&whoami"]
    // produces the literal command line `cmd.exe /c echo a&whoami` and cmd itself
    // executes whoami. The real invariant is "RunAsync introduces no shell", so
    // prove it against a process that is not one.
    [Fact]
    public async Task RunAsync_PassesArgumentsVerbatimToANonShellProcess()
    {
        var node = new[]
        {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
        }.FirstOrDefault(File.Exists);

        // Fail loudly rather than skip: this is the ONLY proof that RunAsync
        // introduces no shell, and Node is a declared dependency of the app.
        Assert.False(node == null,
            "Node not found -- this test proves the no-shell guarantee and must not pass vacuously");

        var result = await ProcessRunner.RunAsync(
            [node!, "-e", "console.log(process.argv[1])", "a&whoami"]);
        Assert.Equal(0, result.ExitCode);
        Assert.Equal("a&whoami", result.Stdout);
    }

    [Fact]
    public async Task RunAsync_HonoursCancellation()
    {
        using var cts = new CancellationTokenSource(200);
        var result = await ProcessRunner.RunAsync(
            ["cmd.exe", "/c", "ping -n 30 127.0.0.1 > nul"], cts.Token);
        Assert.NotEqual(0, result.ExitCode);
    }
}

public class LineStreamTests
{
    private static async Task<List<string>> Collect(
        IAsyncEnumerable<string> source, CancellationToken ct = default)
    {
        var lines = new List<string>();
        await foreach (var line in source.WithCancellation(ct)) lines.Add(line);
        return lines;
    }

    [Fact]
    public async Task StreamAsync_YieldsStdoutLines()
        => Assert.Equal(["one", "two"],
            await Collect(LineStream.StreamAsync(["cmd.exe", "/c", "echo one& echo two"])));

    // Merged, not sequential: stderr must not be able to deadlock behind stdout.
    //
    // The assertion trims because cmd is awkward here and LineStream is not:
    // `echo err 1>&2` emits "err " with a trailing space, and `echo err1>&2`
    // makes cmd read "err1" as the text. LineStream deliberately does NOT trim
    // (neither does streamCommand at lib/ytdlp.ts:112 -- yt-dlp progress parsing
    // depends on the raw text), so the test absorbs cmd's quirk instead.
    [Fact]
    public async Task StreamAsync_MergesStderrIntoTheSameStream()
    {
        var lines = await Collect(LineStream.StreamAsync(["cmd.exe", "/c", "echo err 1>&2"]));
        Assert.Contains(lines, l => l.Trim() == "err");
    }

    // The real deadlock scenario: a lot of stderr while stdout is still open.
    [Fact]
    public async Task StreamAsync_DoesNotDeadlockOnLargeStderr()
    {
        var lines = await Collect(LineStream.StreamAsync(
            ["cmd.exe", "/c", "for /L %i in (1,1,4000) do @echo padding-line-%i 1>&2"]));
        Assert.Equal(4000, lines.Count);
    }

    [Fact]
    public async Task StreamAsync_SkipsBlankLines()
        => Assert.Equal(["a", "b"],
            await Collect(LineStream.StreamAsync(["cmd.exe", "/c", "echo a& echo.& echo b"])));

    [Fact]
    public async Task StreamAsync_MissingExecutableYieldsErrorLine()
    {
        var lines = await Collect(LineStream.StreamAsync(["definitely-not-a-real-exe-xyz"]));
        Assert.Single(lines);
        Assert.StartsWith("ERROR:", lines[0]);
    }

    // Regression: completing the channel on Process.Exited dropped trailing
    // output -- which is where savedPath lives.
    [Fact]
    public async Task StreamAsync_DoesNotDropTheFinalLine()
    {
        for (var i = 0; i < 20; i++)
        {
            var lines = await Collect(LineStream.StreamAsync(
                ["cmd.exe", "/c", "echo first& echo LAST-LINE-SENTINEL"]));
            Assert.Equal("LAST-LINE-SENTINEL", lines[^1]);
        }
    }
}

public class TrackRunnerTests
{
    private static async Task<List<string>> Drain(
        TrackRunner runner, IReadOnlyList<string> args,
        TimeSpan? idle = null, CancellationToken ct = default)
    {
        var lines = new List<string>();
        await foreach (var line in runner.RunAsync(args, idle, ct)) lines.Add(line);
        return lines;
    }

    [Fact]
    public async Task RunAsync_ExposesZeroExitCodeAfterEnumeration()
    {
        var runner = new TrackRunner();
        await Drain(runner, ["cmd.exe", "/c", "echo done"]);
        Assert.Equal(0, runner.ExitCode);
    }

    [Fact]
    public async Task RunAsync_ExposesNonZeroExitCode()
    {
        var runner = new TrackRunner();
        await Drain(runner, ["cmd.exe", "/c", "exit 7"]);
        Assert.Equal(7, runner.ExitCode);
    }

    // The watchdog fires on SILENCE, not total runtime: a long but chatty run
    // must survive.
    [Fact]
    public async Task RunAsync_DoesNotFireWhileOutputKeepsArriving()
    {
        var runner = new TrackRunner();
        var lines = await Drain(
            runner,
            ["cmd.exe", "/c", "for /L %i in (1,1,6) do @(echo tick%i& ping -n 2 127.0.0.1 > nul)"],
            TimeSpan.FromSeconds(3));
        Assert.Equal(6, lines.Count(l => l.StartsWith("tick")));
        Assert.Equal(0, runner.ExitCode);
    }

    [Fact]
    public async Task RunAsync_EmitsHungMarkerAndKillsAfterIdleDeadline()
    {
        var runner = new TrackRunner();
        var lines = await Drain(
            runner, ["cmd.exe", "/c", "ping -n 30 127.0.0.1 > nul"],
            TimeSpan.FromMilliseconds(700));
        Assert.Contains(lines, l => l.Contains(TrackRunner.HungMarker));
        Assert.NotEqual(0, runner.ExitCode);
    }

    [Fact]
    public async Task RunAsync_ZeroIdleTimeoutDisablesTheWatchdog()
    {
        var runner = new TrackRunner();
        var lines = await Drain(
            runner, ["cmd.exe", "/c", "ping -n 3 127.0.0.1 > nul"], TimeSpan.Zero);
        Assert.DoesNotContain(lines, l => l.Contains(TrackRunner.HungMarker));
        Assert.Equal(0, runner.ExitCode);
    }

    [Fact]
    public async Task RunAsync_CancellationKillsTheProcessTree()
    {
        var runner = new TrackRunner();
        using var cts = new CancellationTokenSource(300);
        await Drain(runner, ["cmd.exe", "/c", "ping -n 30 127.0.0.1 > nul"], null, cts.Token);
        Assert.NotEqual(0, runner.ExitCode);
    }

    // Abandoning the enumerator must not leak a process, and must not block.
    [Fact]
    public async Task RunAsync_AbandonedEnumeratorStillKillsTheProcess()
    {
        var runner = new TrackRunner();
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await using (var e = runner.RunAsync(
            ["cmd.exe", "/c", "for /L %i in (1,1,999) do @(echo x& ping -n 2 127.0.0.1 > nul)"])
            .GetAsyncEnumerator())
        {
            await e.MoveNextAsync();
        }
        sw.Stop();
        Assert.NotEqual(0, runner.ExitCode);
        // Kill-first-observe-second: teardown must not wait out WaitForExit(5000).
        Assert.True(sw.ElapsedMilliseconds < 4000, $"teardown took {sw.ElapsedMilliseconds}ms");
    }
}
