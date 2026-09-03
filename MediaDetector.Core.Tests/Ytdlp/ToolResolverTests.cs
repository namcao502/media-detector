using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

// FirstDirWith only ever calls File.Exists, so these fixtures are empty files
// with the right names -- nothing is executed.
public class ToolResolverTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), $"md-toolresolver-{Guid.NewGuid():N}");

    private string MakeDir(string name, params string[] exeNames)
    {
        var dir = Path.Combine(_root, name);
        Directory.CreateDirectory(dir);
        foreach (var exe in exeNames) File.WriteAllText(Path.Combine(dir, exe), "");
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
    public void FfmpegDirCandidates_PrefersTheAppLocalBinFolder()
        => Assert.Equal(
            Path.Combine(AppContext.BaseDirectory, "bin"),
            ToolResolver.FfmpegDirCandidates().First());

    // yt-dlp needs an ABSOLUTE path for --js-runtimes, so a bare "node" is not
    // enough; PATH is walked to turn it into one.
    [Fact]
    public void NodeDirCandidates_StartsWithThePathEntries()
    {
        var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        var firstPathEntry = pathVar
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();
        if (firstPathEntry == null) return;
        Assert.Equal(firstPathEntry, ToolResolver.NodeDirCandidates().First());
    }
}
