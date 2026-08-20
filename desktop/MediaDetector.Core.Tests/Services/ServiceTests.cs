using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Services;
using MediaDetector.Core.Storage;

namespace MediaDetector.Core.Tests.Services;

public class StatusServiceTests
{
    private static StatusResult Sample => new(
        new DependencyState(true, "3.12.2"),
        new YtdlpState(true, "2026.08.01", UpdateStatus.UpToDate),
        new DependencyState(true, "22.11.0"),
        new DependencyState(true, "8.1.2"));

    [Fact]
    public async Task GetAsync_CachesAfterFirstCall()
    {
        var calls = 0;
        var svc = new StatusService(_ => { calls++; return Task.FromResult(Sample); });
        await svc.GetAsync();
        await svc.GetAsync();
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task GetAsync_RefreshBustsTheCache()
    {
        var calls = 0;
        var svc = new StatusService(_ => { calls++; return Task.FromResult(Sample); });
        await svc.GetAsync();
        await svc.GetAsync(refresh: true);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task Reset_ForcesTheNextCallToProbeAgain()
    {
        var calls = 0;
        var svc = new StatusService(_ => { calls++; return Task.FromResult(Sample); });
        await svc.GetAsync();
        svc.Reset();
        await svc.GetAsync();
        Assert.Equal(2, calls);
    }

    // yt-dlp is only probed and updated when Python is present.
    [Fact]
    public async Task Probe_SkipsYtdlpUpdateWhenPythonMissing()
    {
        var result = await DependencyChecker.BuildAsync(
            () => Task.FromResult((false, (string?)null, "python")),
            _ => throw new InvalidOperationException("must not be called"),
            _ => throw new InvalidOperationException("must not be called"),
            () => Task.FromResult(new DependencyState(true, "22.11.0")),
            () => Task.FromResult(new DependencyState(true, "8.1.2")));

        Assert.False(result.Python.Found);
        Assert.Equal(UpdateStatus.Skipped, result.Ytdlp.UpdateStatus);
        // ffmpeg and Node are independent of Python -- still probed.
        Assert.True(result.Ffmpeg.Found);
        Assert.True(result.Node.Found);
    }

    [Fact]
    public async Task Probe_RunsUpdateWhenYtdlpPresent()
    {
        var updated = false;
        var result = await DependencyChecker.BuildAsync(
            () => Task.FromResult((true, (string?)"3.12.2", "python")),
            _ => Task.FromResult((true, (string?)"2026.08.01")),
            _ => { updated = true; return Task.FromResult(UpdateStatus.Updated); },
            () => Task.FromResult(new DependencyState(true, "22.11.0")),
            () => Task.FromResult(new DependencyState(false, null)));

        Assert.True(updated);
        Assert.Equal(UpdateStatus.Updated, result.Ytdlp.UpdateStatus);
    }
}

public class DependencyRowTests
{
    private static StatusResult Status(
        bool py = true, bool yt = true, bool node = true, bool ff = true,
        UpdateStatus update = UpdateStatus.UpToDate) => new(
            new DependencyState(py, py ? "3.12.2" : null),
            new YtdlpState(yt, yt ? "2026.08.01" : null, update),
            new DependencyState(node, node ? "22.11.0" : null),
            new DependencyState(ff, ff ? "8.1.2" : null));

    [Fact]
    public void Build_ReturnsFourRows()
        => Assert.Equal(4, DependencyRows.Build(Status()).Count);

    [Fact]
    public void Build_AllHealthyMeansNoProblems()
        => Assert.DoesNotContain(DependencyRows.Build(Status()), r => r.State != RowState.Ok);

    // Python and yt-dlp are hard requirements -- error, not warn.
    [Fact]
    public void Build_MissingPythonIsAnError()
        => Assert.Equal(RowState.Error,
            DependencyRows.Build(Status(py: false)).First(r => r.Label == "Python").State);

    // Node is a hard requirement too: without a JS runtime every format URL 403s.
    [Fact]
    public void Build_MissingNodeIsAnError()
        => Assert.Equal(RowState.Error,
            DependencyRows.Build(Status(node: false)).First(r => r.Label == "Node.js").State);

    // ffmpeg is optional: downloads still work, just untagged.
    [Fact]
    public void Build_MissingFfmpegIsAWarning()
        => Assert.Equal(RowState.Warn,
            DependencyRows.Build(Status(ff: false)).First(r => r.Label == "ffmpeg").State);

    [Fact]
    public void Build_FailedYtdlpUpdateIsAWarningNotAnError()
        => Assert.Equal(RowState.Warn,
            DependencyRows.Build(Status(update: UpdateStatus.Failed))
                .First(r => r.Label == "yt-dlp").State);

    // The collapsed summary and the expanded rows come from the same data.
    [Fact]
    public void Build_SummaryLineMatchesTheRows()
        => Assert.Equal(
            "Python 3.12.2 . yt-dlp 2026.08.01 . Node 22.11.0 . ffmpeg 8.1.2",
            string.Join(" . ", DependencyRows.Build(Status()).Select(r => r.Summary)));

    // A satisfied dependency has nothing to install. The view binds the button to
    // HasAction; binding it to Action put an Install button on every green row,
    // because a boxed RowAction.None is not null.
    [Fact]
    public void Build_HealthyRowsOfferNoAction()
        => Assert.DoesNotContain(DependencyRows.Build(Status()), row => row.HasAction);

    [Fact]
    public void Build_MissingFfmpegOffersAnInstallAction()
    {
        var row = DependencyRows.Build(Status(ff: false)).First(r => r.Label == "ffmpeg");
        Assert.True(row.HasAction);
        Assert.Equal("Install", row.ActionLabel);
    }

    // A failed update is retried, not installed -- the package is already there.
    [Fact]
    public void Build_FailedYtdlpUpdateOffersRetryNotInstall()
    {
        var row = DependencyRows.Build(Status(update: UpdateStatus.Failed))
            .First(r => r.Label == "yt-dlp");
        Assert.True(row.HasAction);
        Assert.Equal("Retry", row.ActionLabel);
    }

    // ffmpeg reports a build tag longer than every other entry combined; the
    // glanceable summary line keeps only the version.
    [Theory]
    [InlineData("8.1.2-full_build-www.gyan.dev", "8.1.2")]
    [InlineData("2026.08.01", "2026.08.01")]
    [InlineData("v22.11.0", "22.11.0")]
    [InlineData("7.1", "7.1")]
    [InlineData("N-119346-g1a2b3c", "N-119346-g1a2b3c")]  // no leading number: untouched
    [InlineData("", "")]
    [InlineData(null, "")]
    public void ShortVersion_KeepsOnlyTheLeadingVersionNumber(string? input, string expected)
        => Assert.Equal(expected, DependencyRows.ShortVersion(input));

    // The long build tag must survive somewhere: the expanded row is where detail
    // belongs, so only the summary is shortened.
    [Fact]
    public void Build_ExpandedFfmpegRowKeepsTheFullBuildString()
    {
        var status = Status() with
        {
            Ffmpeg = new DependencyState(true, "8.1.2-full_build-www.gyan.dev"),
        };
        var row = DependencyRows.Build(status).First(r => r.Label == "ffmpeg");
        Assert.Contains("8.1.2-full_build-www.gyan.dev", row.Message);
        Assert.Equal("ffmpeg 8.1.2", row.Summary);
    }
}

public class InstallerTests
{
    // mutagen is installed alongside yt-dlp: yt-dlp needs it (or AtomicParsley)
    // to embed cover art into mp4/m4a.
    [Fact]
    public void YtdlpInstallArgs_IncludesMutagen()
    {
        var args = Installer.YtdlpInstallArgs("python");
        Assert.Contains("yt-dlp", args);
        Assert.Contains("mutagen", args);
    }

    [Fact]
    public void YtdlpUpdateArgs_UsesPipUpgradeNotSelfUpdater()
    {
        var args = Installer.YtdlpUpdateArgs("python");
        Assert.Contains("--upgrade", args);
        Assert.DoesNotContain("-U", args);
    }

    [Fact]
    public void FfmpegWingetArgs_IsNonInteractiveAndPinnedToGyan()
    {
        var args = Installer.WingetArgs("Gyan.FFmpeg");
        Assert.Contains("Gyan.FFmpeg", args);
        Assert.Contains("--disable-interactivity", args);
        Assert.Contains("--accept-package-agreements", args);
        Assert.Contains("--accept-source-agreements", args);
        Assert.Contains("-e", args);
    }

    [Fact]
    public void NodeWingetArgs_TargetsTheLtsPackage()
        => Assert.Contains("OpenJS.NodeJS.LTS", Installer.WingetArgs("OpenJS.NodeJS.LTS"));
}

public class OutputPathsTests
{
    [Fact]
    public void Default_IsDocumentsMediaDetector()
    {
        var dir = OutputPaths.Default();
        Assert.EndsWith(Path.Combine("Documents", "MediaDetector"), dir);
        Assert.True(Path.IsPathRooted(dir));
    }

    // The validation boundary: only a non-empty ABSOLUTE path is honoured.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(@"relative\path")]
    [InlineData("..")]
    public void Resolve_FallsBackToDefaultForUnusableInput(string? custom)
        => Assert.Equal(OutputPaths.Default(), OutputPaths.Resolve(custom));

    [Fact]
    public void Resolve_HonoursAnAbsolutePath()
    {
        var temp = Path.Combine(Path.GetTempPath(), "md-test-" + Guid.NewGuid().ToString("N"));
        Assert.Equal(temp, OutputPaths.Resolve(temp));
    }

    [Fact]
    public void EnsureCreated_CreatesTheDirectory()
    {
        var temp = Path.Combine(Path.GetTempPath(), "md-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            OutputPaths.EnsureCreated(temp);
            Assert.True(Directory.Exists(temp));
        }
        finally
        {
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
        }
    }

    [Fact]
    public void OpenInExplorer_ReportsAMissingFolderInsteadOfThrowing()
        => Assert.Contains("no longer exists",
            OutputPaths.OpenInExplorer(@"C:\definitely\not\a\real\folder\xyz") ?? "");
}

public class AppSettingsTests
{
    private static string TempFile() =>
        Path.Combine(Path.GetTempPath(), $"md-settings-{Guid.NewGuid():N}.json");

    [Fact]
    public void Load_ReturnsDefaultsWhenFileMissing()
    {
        var settings = AppSettings.Load(TempFile());
        Assert.Equal(AppThemeMode.System, settings.Theme);
        Assert.True(settings.CleanNames);
        Assert.Null(settings.OutputDir);
    }

    [Fact]
    public void SaveThenLoad_RoundTrips()
    {
        var path = TempFile();
        try
        {
            new AppSettings
            {
                Theme = AppThemeMode.Dark, CleanNames = false, OutputDir = @"C:\Music",
            }.Save(path);

            var loaded = AppSettings.Load(path);
            Assert.Equal(AppThemeMode.Dark, loaded.Theme);
            Assert.False(loaded.CleanNames);
            Assert.Equal(@"C:\Music", loaded.OutputDir);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    // A corrupt settings file must not stop the app launching.
    [Fact]
    public void Load_ReturnsDefaultsForCorruptJson()
    {
        var path = TempFile();
        try
        {
            File.WriteAllText(path, "{ not json");
            Assert.Equal(AppThemeMode.System, AppSettings.Load(path).Theme);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }
}

public class DetectServiceTests
{
    private const string Url = "https://www.youtube.com/watch?v=abc";

    private static DetectService WithOutput(string stdout, int code = 0, string stderr = "") =>
        new((_, _) => Task.FromResult(new ExecResult(stdout, stderr, code)),
            _ => Task.FromResult("python"), () => null);

    // IsYouTubeUrl must gate every call -- this is the injection boundary.
    [Fact]
    public async Task DetectVideo_RejectsNonYouTubeUrlWithoutSpawning()
    {
        var spawned = false;
        var svc = new DetectService(
            (_, _) => { spawned = true; return Task.FromResult(new ExecResult("", "", 0)); },
            _ => Task.FromResult("python"), () => null);

        var result = await svc.DetectVideoAsync("https://evil.com/watch?v=abc");
        Assert.False(result.Ok);
        Assert.False(spawned);
        Assert.Contains("YouTube", result.Error);
    }

    [Fact]
    public async Task DetectVideo_ParsesMediaInfo()
    {
        var svc = WithOutput("""{"title":"Song","uploader":"Chan","formats":[]}""");
        var result = await svc.DetectVideoAsync(Url);
        Assert.True(result.Ok);
        Assert.Equal("Song", result.Value!.Title);
    }

    // yt-dlp's own ERROR: prefix is stripped before the message reaches the UI.
    [Fact]
    public async Task DetectVideo_SurfacesYtdlpErrorWithoutPrefix()
    {
        var result = await WithOutput("", 1, "ERROR: Video unavailable").DetectVideoAsync(Url);
        Assert.False(result.Ok);
        Assert.Equal("Video unavailable", result.Error);
    }

    [Fact]
    public async Task DetectVideo_HandlesUnparseableJson()
        => Assert.False((await WithOutput("not json at all").DetectVideoAsync(Url)).Ok);

    [Fact]
    public async Task DetectPlaylist_ParsesTrackList()
    {
        var svc = WithOutput("""{"title":"L","entries":[{"title":"One"},{"title":"Two"}]}""");
        var result = await svc.DetectPlaylistAsync("https://www.youtube.com/playlist?list=PL1");
        Assert.True(result.Ok);
        Assert.Equal(2, result.Value!.Count);
    }
}

public class DownloadServiceTests
{
    private static readonly NameSource Source = new("Song", Artist: "Artist");

    private static string[] Build(DownloadRequest req, bool hasFfmpeg = true) =>
        DownloadService.BuildArgs(req, "python", null, hasFfmpeg, @"C:\out", []);

    private static DownloadRequest Req(
        string? custom = null, bool clean = true, NameSource? source = null) =>
        new("https://www.youtube.com/watch?v=a", "140", source ?? Source, "m4a",
            @"C:\out", clean, custom);

    [Fact]
    public void BuildArgs_UsesLiteralOutputPathWithOnlyExtTemplated()
        => Assert.Equal(@"C:\out\Song - Artist.%(ext)s",
            Build(Req())[Array.IndexOf(Build(Req()), "-o") + 1]);

    // A typed name wins over the rules...
    [Fact]
    public void BuildArgs_CustomNameOverridesGeneratedName()
    {
        var args = Build(Req("My Name"));
        Assert.Equal(@"C:\out\My Name.%(ext)s", args[Array.IndexOf(args, "-o") + 1]);
    }

    // ...but it is untrusted input pasted into an absolute path, so it is
    // sanitised first. Both separators map to full-width lookalikes, making the
    // result a single path component by construction.
    [Fact]
    public void BuildArgs_CustomNameCannotEscapeTheOutputFolder()
    {
        var args = Build(Req("../../Windows/System32/evil"));
        var output = args[Array.IndexOf(args, "-o") + 1];
        Assert.StartsWith(@"C:\out\", output);
        // No further separator after the folder -- it is one component.
        Assert.DoesNotContain('\\', output[7..]);
        Assert.DoesNotContain('/', output[7..]);
    }

    [Fact]
    public void BuildArgs_BlankCustomNameFallsBackToRules()
    {
        var args = Build(Req("   "));
        Assert.Equal(@"C:\out\Song - Artist.%(ext)s", args[Array.IndexOf(args, "-o") + 1]);
    }

    [Fact]
    public void BuildArgs_CleanNamesOffUsesRawStem()
    {
        var args = Build(Req(clean: false, source: new NameSource("Song (Official Video)")));
        Assert.Equal(@"C:\out\Song (Official Video).%(ext)s", args[Array.IndexOf(args, "-o") + 1]);
    }

    [Fact]
    public void BuildArgs_IncludesFormatProgressTemplateAndNoPlaylist()
    {
        var args = Build(Req());
        Assert.Equal("140", args[Array.IndexOf(args, "-f") + 1]);
        Assert.Contains("--no-playlist", args);
        Assert.Contains("--newline", args);
        Assert.Contains("--embed-thumbnail", args);
    }

    // Without ffmpeg the download must still succeed, just untagged.
    [Fact]
    public void BuildArgs_OmitsMetadataWithoutFfmpeg()
    {
        var args = Build(Req(), hasFfmpeg: false);
        Assert.DoesNotContain("--embed-metadata", args);
        Assert.DoesNotContain("--embed-thumbnail", args);
    }

    // The preview and the real filename must come from one function.
    [Fact]
    public void StemFor_MatchesWhatBuildArgsUses()
    {
        var req = Req();
        var args = Build(req);
        Assert.Contains(DownloadService.StemFor(req), args[Array.IndexOf(args, "-o") + 1]);
    }
}
