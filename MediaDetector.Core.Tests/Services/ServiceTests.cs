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
        new YtdlpState(true, "2026.08.01", UpdateStatus.UpToDate),
        new DependencyState(true, "22.11.0"),
        new FfmpegState(true, "8.1.2", FfprobeFound: true));

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

    // There is nothing to self-update when the exe was never found, and running
    // `-U` against a missing file would only produce a confusing spawn error.
    [Fact]
    public async Task Probe_SkipsUpdateWhenYtdlpMissing()
    {
        var result = await DependencyChecker.BuildAsync(
            () => Task.FromResult((false, (string?)null, (string?)null)),
            () => throw new InvalidOperationException("must not be called"),
            () => Task.FromResult(new DependencyState(true, "22.11.0")),
            () => Task.FromResult(new FfmpegState(true, "8.1.2", FfprobeFound: true)));

        Assert.False(result.Ytdlp.Found);
        Assert.Equal(UpdateStatus.Skipped, result.Ytdlp.UpdateStatus);
        // Node and ffmpeg are independent of yt-dlp -- still probed.
        Assert.True(result.Ffmpeg.Found);
        Assert.True(result.Node.Found);
    }

    [Fact]
    public async Task Probe_RunsUpdateWhenYtdlpPresent()
    {
        var updated = false;
        var result = await DependencyChecker.BuildAsync(
            () => Task.FromResult((true, (string?)"2026.08.01", (string?)@"C:\app\bin\yt-dlp.exe")),
            () => { updated = true; return Task.FromResult(UpdateStatus.Updated); },
            () => Task.FromResult(new DependencyState(true, "22.11.0")),
            () => Task.FromResult(new FfmpegState(false, null, false)));

        Assert.True(updated);
        Assert.Equal(UpdateStatus.Updated, result.Ytdlp.UpdateStatus);
    }
}

public class DependencyRowTests
{
    private static StatusResult Status(
        bool yt = true, bool node = true, bool ff = true,
        bool ffprobe = true,
        UpdateStatus update = UpdateStatus.UpToDate) => new(
            new YtdlpState(yt, yt ? "2026.08.01" : null, update),
            new DependencyState(node, node ? "22.11.0" : null),
            new FfmpegState(ff, ff ? "8.1.2" : null, ff && ffprobe));

    [Fact]
    public void Build_ReturnsThreeRows()
        => Assert.Equal(3, DependencyRows.Build(Status()).Count);

    [Fact]
    public void Build_AllHealthyMeansNoProblems()
        => Assert.DoesNotContain(DependencyRows.Build(Status()), r => r.State != RowState.Ok);

    // yt-dlp is a hard requirement -- error, not warn.
    [Fact]
    public void Build_MissingYtdlpIsAnError()
        => Assert.Equal(RowState.Error,
            DependencyRows.Build(Status(yt: false)).First(r => r.Label == "yt-dlp").State);

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
            "yt-dlp 2026.08.01 . Node 22.11.0 . ffmpeg 8.1.2",
            string.Join(" . ", DependencyRows.Build(Status()).Select(r => r.Summary)));

    // A satisfied dependency has nothing to install. The view binds the button to
    // HasAction; binding it to Action put an Install button on every green row,
    // because a boxed RowAction.None is not null.
    [Fact]
    public void Build_HealthyRowsOfferNoAction()
        => Assert.DoesNotContain(DependencyRows.Build(Status()), row => row.HasAction);

    // Both an Install button and a link: the download can fail behind a proxy or
    // offline, and vendoring by hand has to stay possible.
    [Fact]
    public void Build_MissingFfmpegOffersBothAnInstallAndALink()
    {
        var row = DependencyRows.Build(Status(ff: false)).First(r => r.Label == "ffmpeg");
        Assert.True(row.HasAction);
        Assert.Equal("Install", row.ActionLabel);
        Assert.NotNull(row.HelpUrl);
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
            Ffmpeg = new FfmpegState(true, "8.1.2-full_build-www.gyan.dev", FfprobeFound: true),
        };
        var row = DependencyRows.Build(status).First(r => r.Label == "ffmpeg");
        Assert.Contains("8.1.2-full_build-www.gyan.dev", row.Message);
        Assert.Equal("ffmpeg 8.1.2", row.Summary);
    }

    // A half-populated ffmpeg dir used to render a green row while cover art
    // silently vanished, because only ffmpeg.exe was ever looked for.
    [Fact]
    public void Build_FfmpegWithoutFfprobeIsAWarningNotOk()
    {
        var row = DependencyRows.Build(Status(ffprobe: false)).First(r => r.Label == "ffmpeg");
        Assert.Equal(RowState.Warn, row.State);
        Assert.Contains("ffprobe", row.Message);
        Assert.NotNull(row.HelpUrl);
    }

    // Still a real ffmpeg, so the version stays visible rather than reading as a
    // total miss -- that is what tells a half-install from no install.
    [Fact]
    public void Build_FfmpegWithoutFfprobeStillReportsTheVersion()
    {
        var row = DependencyRows.Build(Status(ffprobe: false)).First(r => r.Label == "ffmpeg");
        Assert.Contains("8.1.2", row.Message);
        Assert.Equal("ffmpeg 8.1.2 (no ffprobe)", row.Summary);
    }

    // Two green rows are otherwise indistinguishable: a pip yt-dlp shim is a real
    // executable reporting the same --version as the standalone build.
    [Fact]
    public void Build_ReportsWhereEachToolWasResolvedFrom()
    {
        var status = new StatusResult(
            new YtdlpState(true, "2026.08.01", UpdateStatus.UpToDate, @"C:\app\bin\yt-dlp.exe"),
            new DependencyState(true, "22.11.0", @"C:\Program Files\nodejs\node.exe"),
            new FfmpegState(true, "8.1.2", true, @"C:\app\bin"));
        var rows = DependencyRows.Build(status);

        Assert.Equal(@"C:\app\bin\yt-dlp.exe", rows.First(r => r.Label == "yt-dlp").ResolvedFrom);
        Assert.Equal(@"C:\Program Files\nodejs\node.exe",
            rows.First(r => r.Label == "Node.js").ResolvedFrom);
        Assert.Equal(@"C:\app\bin", rows.First(r => r.Label == "ffmpeg").ResolvedFrom);
    }

    [Fact]
    public void Build_LeavesResolvedFromNullWhenNothingWasFound()
        => Assert.Null(DependencyRows.Build(Status(ff: false))
            .First(r => r.Label == "ffmpeg").ResolvedFrom);

    // Missing yt-dlp always offers the Install button now. It used to be
    // conditional on Python being present, because installing meant pip.
    [Fact]
    public void Build_MissingYtdlpOffersAnInstallAction()
    {
        var row = DependencyRows.Build(Status(yt: false)).First(r => r.Label == "yt-dlp");
        Assert.True(row.HasAction);
        Assert.Equal("Install", row.ActionLabel);
    }
}

public class InstallerTests
{
    // The standalone exe is fetched straight from the GitHub release, since
    // there is no longer a Python to pip with.
    [Fact]
    public void YtdlpReleaseUrl_PointsAtTheLatestStandaloneExe()
    {
        Assert.StartsWith("https://", Installer.YtdlpReleaseUrl);
        Assert.EndsWith("/yt-dlp.exe", Installer.YtdlpReleaseUrl);
        Assert.Contains("/releases/latest/", Installer.YtdlpReleaseUrl);
    }

    [Fact]
    public void FfmpegReleaseUrl_IsTheStableGyanZip()
    {
        Assert.StartsWith("https://", Installer.FfmpegReleaseUrl);
        Assert.EndsWith(".zip", Installer.FfmpegReleaseUrl);
    }

    // nodejs.org has no "latest LTS" URL, so the version is read from the release
    // index. Entries are newest-first and a non-LTS line carries `lts: false`.
    [Fact]
    public void LatestLtsVersion_SkipsNonLtsReleases()
    {
        const string json = """
            [
              {"version":"v25.0.0","lts":false},
              {"version":"v24.9.0","lts":"Jod"},
              {"version":"v22.11.0","lts":"Iron"}
            ]
            """;
        Assert.Equal("v24.9.0", Installer.LatestLtsVersion(json));
    }

    [Fact]
    public void LatestLtsVersion_ReturnsNullWhenNothingIsLts()
        => Assert.Null(Installer.LatestLtsVersion("""[{"version":"v25.0.0","lts":false}]"""));

    [Fact]
    public void NodeZipUrlFor_BuildsTheWindowsX64Archive()
        => Assert.Equal(
            "https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip",
            Installer.NodeZipUrlFor("v22.11.0"));

    // A silent 80 MB download is indistinguishable from a hang.
    [Fact]
    public void ProgressLine_ShowsTheTotalWhenTheServerSentOne()
    {
        Assert.Equal("ffmpeg: 4.0 / 80.0 MB",
            Installer.ProgressLine("ffmpeg", 4L * 1024 * 1024, 80L * 1024 * 1024));
        Assert.Equal("ffmpeg: 4.0 MB",
            Installer.ProgressLine("ffmpeg", 4L * 1024 * 1024, null));
    }
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
            () => "yt-dlp.exe", () => null);

    // IsYouTubeUrl must gate every call -- this is the injection boundary.
    [Fact]
    public async Task DetectVideo_RejectsNonYouTubeUrlWithoutSpawning()
    {
        var spawned = false;
        var svc = new DetectService(
            (_, _) => { spawned = true; return Task.FromResult(new ExecResult("", "", 0)); },
            () => "yt-dlp.exe", () => null);

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
        DownloadService.BuildArgs(req, "yt-dlp.exe", null, hasFfmpeg, @"C:\out", []);

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
        Assert.Contains("--write-thumbnail", args);
    }

    // Without ffmpeg the download must still succeed, just untagged.
    [Fact]
    public void BuildArgs_OmitsMetadataWithoutFfmpeg()
    {
        var args = Build(Req(), hasFfmpeg: false);
        Assert.DoesNotContain("--embed-metadata", args);
        Assert.DoesNotContain("--write-thumbnail", args);
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
