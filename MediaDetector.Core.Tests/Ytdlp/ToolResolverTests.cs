using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

// Byte stubs, not empty files: FirstDirWith validates the PE signature, so an
// empty file is now precisely what it is supposed to reject. Nothing is executed.
public class ToolResolverTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), $"md-toolresolver-{Guid.NewGuid():N}");

    // "MZ" plus enough bytes to clear the size floor.
    private static byte[] ExeStub()
    {
        var bytes = new byte[2048];
        bytes[0] = (byte)'M';
        bytes[1] = (byte)'Z';
        return bytes;
    }

    private string MakeDir(string name, params string[] exeNames)
    {
        var dir = Path.Combine(_root, name);
        Directory.CreateDirectory(dir);
        foreach (var exe in exeNames) File.WriteAllBytes(Path.Combine(dir, exe), ExeStub());
        return dir;
    }

    private string WriteFile(string dirName, string fileName, byte[] content)
    {
        var dir = Path.Combine(_root, dirName);
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, fileName), content);
        return dir;
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void FirstDirWith_ReturnsTheFirstDirHoldingTheExe()
    {
        var empty = MakeDir("empty");
        var hasNode = MakeDir("node", "node.exe");
        Assert.Equal(hasNode, ToolResolver.FirstDirWith([empty, hasNode], "node.exe"));
    }

    [Fact]
    public void FirstDirWith_ReturnsNullWhenNoDirHasIt()
        => Assert.Null(ToolResolver.FirstDirWith([MakeDir("empty")], "node.exe"));

    // A 5-byte text file named yt-dlp.exe is not hypothetical -- it is what a
    // half-finished download or a renamed placeholder looks like.
    [Fact]
    public void FirstDirWith_RejectsAFileThatIsNotAnExecutable()
    {
        var junk = WriteFile("junk", "yt-dlp.exe", "dummy"u8.ToArray());
        var real = MakeDir("real", "yt-dlp.exe");
        Assert.Equal(real, ToolResolver.FirstDirWith([junk, real], "yt-dlp.exe"));
    }

    // Right signature, wrong size: an interrupted download of the real thing.
    [Fact]
    public void FirstDirWith_RejectsATruncatedExecutable()
    {
        var truncated = WriteFile("truncated", "node.exe", [(byte)'M', (byte)'Z', 0, 0]);
        Assert.Null(ToolResolver.FirstDirWith([truncated], "node.exe"));
    }

    // Better to fall through to PATH than to hand yt-dlp a broken tool. Rejecting
    // must mean "not a candidate", not "a candidate that fails later".
    [Fact]
    public void FirstDirWith_ReturnsNullWhenEveryCandidateIsInvalid()
    {
        var junk = WriteFile("junk2", "ffmpeg.exe", "not an exe"u8.ToArray());
        File.WriteAllBytes(Path.Combine(junk, "ffprobe.exe"), "not an exe"u8.ToArray());
        Assert.Null(ToolResolver.FirstDirWith([junk], "ffmpeg.exe", "ffprobe.exe"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void IsExecutable_RejectsMissingAndEmptyFiles(bool create)
    {
        var path = Path.Combine(_root, "probe.exe");
        Directory.CreateDirectory(_root);
        if (create) File.WriteAllBytes(path, []);
        Assert.False(ToolResolver.IsExecutable(path));
    }

    // The ffprobe half of the pair is what embeds cover art. A dir holding only
    // ffmpeg.exe used to win and then silently drop the image, so it must lose
    // to a complete install further down the candidate list.
    [Fact]
    public void FirstDirWith_SkipsADirMissingOneOfSeveralExes()
    {
        var half = MakeDir("half", "ffmpeg.exe");
        var complete = MakeDir("complete", "ffmpeg.exe", "ffprobe.exe");
        Assert.Equal(complete,
            ToolResolver.FirstDirWith([half, complete], "ffmpeg.exe", "ffprobe.exe"));
    }

    // Better to fall through to PATH than to point --ffmpeg-location at a dir
    // that cannot embed cover art.
    [Fact]
    public void FirstDirWith_ReturnsNullWhenOnlyHalfThePairIsAnywhere()
    {
        var half = MakeDir("half", "ffmpeg.exe");
        Assert.Null(ToolResolver.FirstDirWith([half], "ffmpeg.exe", "ffprobe.exe"));
    }

    [Fact]
    public void FfmpegDirCandidates_PrefersTheAppLocalVendorFolder()
        => Assert.Equal(
            Path.Combine(AppContext.BaseDirectory, "vendor"),
            ToolResolver.FfmpegDirCandidates().First());

    // The vendored copy has to win, or dropping node.exe into vendor/ does
    // nothing -- which is exactly how it behaved before: this list started at
    // PATH and never looked at bin/ at all.
    [Fact]
    public void NodeDirCandidates_PrefersTheAppLocalBinFolder()
        => Assert.Equal(
            Path.Combine(AppContext.BaseDirectory, "vendor"),
            ToolResolver.NodeDirCandidates().First());

    // Vendored and downloaded tools share one folder. Keeping them apart was
    // justified by a clobber that does not happen: PreserveNewest compares
    // timestamps, so a fresh download outlives a build.
    [Fact]
    public void EveryResolverLooksInTheSameVendorDir()
    {
        Assert.Contains(ToolResolver.VendorDir, ToolResolver.YtdlpDirCandidates());
        Assert.Contains(ToolResolver.VendorDir, ToolResolver.NodeDirCandidates());
        Assert.Contains(ToolResolver.VendorDir, ToolResolver.FfmpegDirCandidates());
    }

    // On a writable app folder that is the only candidate; a read-only one adds
    // the LOCALAPPDATA download target beside the shipped copy.
    [Fact]
    public void VendorDirCandidates_AreAppLocalAndNotDuplicated()
    {
        var candidates = ToolResolver.YtdlpDirCandidates().ToArray();
        Assert.NotEmpty(candidates);
        Assert.Equal(candidates.Length, candidates.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(candidates, c => Assert.EndsWith("vendor", c, StringComparison.OrdinalIgnoreCase));
    }

    // The whole point of the vendor-only model: a tool installed on this machine
    // must not make a row green, because it does not travel with the app. With
    // PATH in the list an empty vendor/ still went green off a system install.
    [Theory]
    [InlineData("ytdlp")]
    [InlineData("node")]
    [InlineData("ffmpeg")]
    public void DirCandidates_NeverIncludeASystemLocation(string tool)
    {
        var candidates = tool switch
        {
            "ytdlp" => ToolResolver.YtdlpDirCandidates(),
            "node" => ToolResolver.NodeDirCandidates(),
            _ => ToolResolver.FfmpegDirCandidates(),
        };

        var pathEntries = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);

        foreach (var candidate in candidates)
        {
            Assert.DoesNotContain(candidate, pathEntries, StringComparer.OrdinalIgnoreCase);
            Assert.DoesNotContain(@"chocolatey", candidate, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(@"WinGet", candidate, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(@"Program Files", candidate, StringComparison.OrdinalIgnoreCase);
        }
    }

    // Asserted as an invariant, NOT as `ResolveYtdlpExe() ?? "yt-dlp.exe"` --
    // that restates the implementation and would pass whatever the method did.
    [Fact]
    public void YtdlpExeOrDefault_IsAlwaysASpawnableCommand()
    {
        var exe = ToolResolver.YtdlpExeOrDefault();
        Assert.False(string.IsNullOrWhiteSpace(exe));
        Assert.EndsWith("yt-dlp.exe", exe, StringComparison.OrdinalIgnoreCase);
    }

}
