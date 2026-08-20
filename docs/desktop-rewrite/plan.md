# WPF Desktop Rewrite Implementation Plan

> **For agentic workers:** Use s3-implement to execute this plan task-by-task.

**Ticket:** side project, manual git (work directly on `master`, no feature branch)

**Frontend repo:** none -- this plan replaces the frontend

**Goal:** Replace the Next.js 16 web app with a native WPF desktop application at full feature parity, living in `desktop/` alongside the existing app until the user has tested it.

**Why WPF and not WinUI 3:** WinUI 3 was validated first and does build here, but Mica requires Windows 11 build 22000+ and the dev machine is Windows 10 19045, which removes its main visual advantage. WPF is the same declarative XAML model (so the theming, styles and data binding this design system needs all work identically), ships with the .NET Desktop Runtime already installed, needs no Windows App SDK or packaging properties, and publishes framework-dependent at roughly 2 MB against WinUI 3's measured 78 MB. WinForms was considered and rejected: every rounded card, capsule button, segmented control and themed token would become manual owner-draw painting.

**Expected outcome (acceptance criteria):**
- [ ] `desktop/MediaDetector.sln` builds with `dotnet build` and `dotnet test` passes with zero failures
- [ ] The Next.js app still builds (`npm run build`) and `npm test` reports 0 failures across all suites, untouched (27 suites / 290 tests at time of writing -- `test.each` expands past the 279 `it(` count)
- [ ] Dependency bar shows four rows (Python, yt-dlp, Node, ffmpeg) with working Install buttons and a Recheck that busts the cache
- [ ] Pasting a video URL lists video and audio formats, with one row badged "Best" matching `recommendedVideoId`/`recommendedAudioId`
- [ ] Downloading a format shows phase label, percent, byte counters, speed and ETA, then a check row naming the real folder with a working Open Folder button
- [ ] Cancel kills the yt-dlp process tree (verified: no orphan `ffmpeg.exe` in Task Manager) and shows "Cancelled -- a partial file may remain"
- [ ] A playlist URL shows the track list with a format picker; Download All runs one process per track with per-track OK/ERR/retry status and a two-phase retry
- [ ] A track that goes silent for 5 minutes is killed, marked hung, and NOT retried 5 more times
- [ ] File names match the Next.js app exactly for the same input, including the Vietnamese show-title cases and the full-width character substitutions
- [ ] A typed file name containing `../../etc/passwd` produces a literal file inside the download folder, never outside it
- [ ] Light/dark toggle persists across restarts; no flash of the wrong theme on launch
- [ ] `dotnet publish` produces a framework-dependent build that launches on this machine

**Architecture:** Four projects, all on `net10.0-windows`. `MediaDetector.Core` holds every ported module -- naming, parsers, process spawning, the retry engine, dependency probes -- and carries **no UI reference**: it is `UseWPF` that pulls in the UI framework, not the `-windows` TFM, so Core stays UI-free while still being allowed to call `[SupportedOSPlatform("windows")]` APIs. `MediaDetector.App` (`UseWPF`) holds views and view models only, consuming Core through `IAsyncEnumerable<DownloadLine>` and marshalling to the UI thread with `Dispatcher`. `MediaDetector.Core.Tests` runs without a UI host; `MediaDetector.App.Tests` covers the view-model reducers that cannot live in Core. The NDJSON streaming layer is deleted outright -- there is no wire between UI and logic any more.

**Tech Stack:** .NET 10, C# 14, WPF, CommunityToolkit.Mvvm 8.x, xUnit, System.Threading.Channels, Win32 Job Objects via P/Invoke.

---

## Environment facts established before planning

Recorded here so implementation does not rediscover them:

| Fact | Value |
|---|---|
| .NET available | SDK 9.0.306 and 10.0.301; `Microsoft.WindowsDesktop.App` runtimes 8/9/10 all present, so WPF needs no install |
| App csproj | `UseWPF=true`, `TargetFramework=net10.0-windows`, `OutputType=WinExe`. No Windows App SDK, no packaging properties, no PRI/MRT targets |
| Publish mode | **Framework-dependent** (~2 MB). Self-contained is available later if a portable build is ever wanted |
| Theming | Two `ResourceDictionary` files (light/dark) swapped at runtime in `Application.Current.Resources.MergedDictionaries`, carrying the ~30 tokens from `app/globals.css` |
| Settings storage | JSON file under `%LOCALAPPDATA%\MediaDetector\settings.json`. Replaces the three `localStorage` hooks (`theme-mode`, `clean-names`, output dir) |
| App base path | `AppContext.BaseDirectory`, never `Environment.CurrentDirectory` (the TS code used `process.cwd()` at `lib/ytdlp.ts:346`, which is wrong once published) |
| JS runtime | Node becomes a fourth dependency row, installed via winget `OpenJS.NodeJS.LTS`, resolved to an absolute `node.exe` path for `--js-runtimes` |

## What has already been compiled and run

The code in this plan is not sketch code. These pieces were built and executed in a scratch solution on this machine before the plan was finalised, so an implementer hitting a compile error should suspect their transcription first:

| Verified | Result |
|---|---|
| `dotnet new` scaffolding | `-f` accepts only `net10.0`/`net9.0`; `net10.0-windows` fails with templating exit 127. There is **no** `GlobalUsings.cs` -- the template uses `<Using Include="Xunit" />` |
| `JobObject` + `[LibraryImport]` | Compiles and returns a live handle **only** with `AllowUnsafeBlocks=true` (SYSLIB1062 + 4x CS0227 without it) |
| `LineStream` / `TrackRunner` start-failure path | The hoisted `startError` form compiles; `yield return` inside a `catch` is CS1631 |
| `PlaylistOrchestrator` cancellation | Draining the channel with `CancellationToken.None` emits `BatchDoneLine(cancelled: true)`; draining with the token throws OCE and emits nothing |
| Live playlist progress | `LiveProgress_IsObservedBeforeTrackCompletes` passes with the channel form, deadlocks with a buffering form |
| Retry engine arithmetic | 10 attempts for a permanent failure, 2 for a hung track |
| `DisplayFormat.FormatBytes` | `MidpointRounding.AwayFromZero` gives `1.3 MB` for 1_250_000; `ToString("F1")` alone gives `1.2 MB` |
| **The whole `FileNaming` port** | 48 tests green, including every Vietnamese show-title shape, the diacritic anchors, `BRAND_SEGMENTS` as whole pipe segments, the series-label case, promo-copy rejection, full-width substitutions, path traversal, C1 control characters, and the non-breaking-space word split |
| `dotnet new sln` format | Defaults to **`.slnx`**; `--format sln` is required for the `MediaDetector.sln` paths this plan uses |
| `JobObject` name collision | The const and the nested struct cannot share `JobObjectExtendedLimitInformation` (CS0102) -- hence `JobObjectInfoClassExtendedLimit` |
| **Phase 4/5 WPF layer** | Builds clean and runs. Measured: `ThinBar`'s `PART_Indicator` is **84 px of a 200 px track at 42 %** (the bar genuinely moves), `ThemeManager.Apply(AppThemeMode.Dark)` swaps live, `StatusIcon` renders all five kinds at 16x16 with glyphs, `SegmentedControl` picks up its implicit style, and `MainViewModel` + `FormatTabsViewModel.From` + `PlaylistPanelViewModel` construct with their `required` init members |
| `AppThemeMode` naming | .NET 10 WPF ships `System.Windows.ThemeMode`; a Core enum called `ThemeMode` is CS0104 in any file that also has `using System.Windows;` |
| `MediaDetector.App` namespace + `App` class | Fine -- verified. (A project whose *root namespace* is bare `App` with a class `App` fails with CS0426; the plan's fully-qualified naming avoids it.) |

**Rejected, with evidence, so it is not revisited:** WinUI 3 builds fine here (validated: `dotnet build` plus launch, using Windows App SDK **2.4.0** with `UseWinUI`/`WindowsPackageType=None`/`AppxPackage=false`; version 1.7 fails on the .NET 10 SDK because `MrtCore.PriGen.targets` cannot load `Microsoft.Build.Packaging.Pri.Tasks.dll`). It was dropped only because Mica needs Windows 11 and this machine is Windows 10 19045, while costing 78 MB framework-dependent against WPF's ~2 MB.

---

## Phase 0: Scaffold

### Task 1: Create the solution and four projects

**Files:**
- Create: `desktop/MediaDetector.sln`
- Create: `desktop/MediaDetector.Core/MediaDetector.Core.csproj`
- Create: `desktop/MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj`
- Create: `desktop/MediaDetector.App.Tests/MediaDetector.App.Tests.csproj`
- Create: `desktop/MediaDetector.App/MediaDetector.App.csproj`
- Create: `desktop/.gitignore`
- Create: `desktop/Directory.Build.props`

- [ ] **Step 1: Create the solution and project files**

Run these exactly. **`-f` does not accept `net10.0-windows`** -- it fails with templating exit code 127 (verified). Scaffold on `net10.0` and let the replacement csproj files below set the real TFM.

```bash
# --format sln is REQUIRED: this SDK defaults to the new .slnx format, and every
# `dotnet sln`/`dotnet build` command in this plan targets MediaDetector.sln.
# Without it: "Could not find solution or directory" / MSBUILD error MSB1009.
dotnet new sln -o desktop -n MediaDetector --format sln
dotnet new classlib -o desktop/MediaDetector.Core       -n MediaDetector.Core       -f net10.0
dotnet new xunit    -o desktop/MediaDetector.Core.Tests -n MediaDetector.Core.Tests -f net10.0
dotnet new xunit    -o desktop/MediaDetector.App.Tests  -n MediaDetector.App.Tests  -f net10.0
dotnet new wpf      -o desktop/MediaDetector.App        -n MediaDetector.App        -f net10.0
dotnet sln desktop/MediaDetector.sln add \
  desktop/MediaDetector.Core desktop/MediaDetector.Core.Tests \
  desktop/MediaDetector.App desktop/MediaDetector.App.Tests
```

Then delete the generated `Class1.cs` and both `UnitTest1.cs`, and replace the csproj files with the ones below.

> **There is no `GlobalUsings.cs`.** The .NET 10 `xunit` template supplies `Xunit` through `<ItemGroup><Using Include="Xunit" /></ItemGroup>` in the csproj instead (verified against the generated template). No test file in this plan writes `using Xunit;`, so **that ItemGroup must be carried into the replacement csproj** or every `[Fact]`/`[Theory]`/`[InlineData]` fails with CS0246.

`MediaDetector.App.Tests` exists because `PlaylistPanelViewModel.Apply` is a reducer worth testing (Task 27 Step 2c) and it lives on a WPF view model, so it cannot go in `Core.Tests`.

`desktop/Directory.Build.props` -- shared settings so the three csproj files stay short. `WarningsNotAsErrors` covers NuGet audit advisories, which would otherwise turn a new CVE disclosure in a transitive package into a build failure on an unrelated day:

```xml
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <!-- NU19xx: a new CVE disclosure in a transitive package must not fail an
         unrelated build. MVVMTK0042: the toolkit suggests converting
         [ObservableProperty] fields to partial properties; we deliberately use
         the field form (see MainViewModel) because only it allows initializers. -->
    <WarningsNotAsErrors>NU1901;NU1902;NU1903;NU1904;MVVMTK0042</WarningsNotAsErrors>
    <!-- REQUIRED by [LibraryImport] (Task 9). Without it the source generator
         emits SYSLIB1062 "LibraryImportAttribute requires unsafe code" plus five
         CS0227, and Core does not build. Verified both ways. -->
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
</Project>
```

`desktop/MediaDetector.Core/MediaDetector.Core.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0-windows</TargetFramework>
  </PropertyGroup>
</Project>
```

> **Why `net10.0-windows` and not plain `net10.0`.** An earlier draft used plain `net10.0` on the theory that it kept the test project free of a UI host. That is wrong: the UI framework is pulled in by `UseWPF`, not by the `-windows` TFM, so a `-windows` class library has no WPF dependency at all. Worse, plain `net10.0` combined with `TreatWarningsAsErrors` makes every call into a `[SupportedOSPlatform("windows")]` type a hard `CA1416` build error, which breaks the test projects in Tasks 9, 10, 11, 12, 16, 18, 19 and 20. The `-windows` TFM is required, costs nothing, and is what lets `[SupportedOSPlatform]` annotations mean anything.

`desktop/MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0-windows</TargetFramework>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>
  <!-- Replaces the GlobalUsings.cs other templates generate. Drop this and every
       [Fact] in the suite fails with CS0246. -->
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\MediaDetector.Core\MediaDetector.Core.csproj" />
  </ItemGroup>
</Project>
```

`desktop/MediaDetector.App.Tests/MediaDetector.App.Tests.csproj` is identical except it references the App project and enables WPF:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0-windows</TargetFramework>
    <UseWPF>true</UseWPF>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\MediaDetector.App\MediaDetector.App.csproj" />
  </ItemGroup>
</Project>
```

Versions are pinned to what the .NET 10 template actually generates, rather than floating: a wildcard plus `TreatWarningsAsErrors` lets an unrelated package release break the build on a day nothing changed.

`desktop/MediaDetector.App/MediaDetector.App.csproj` -- note how much shorter this is than the WinUI 3 equivalent; no SDK reference, no packaging switches:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows</TargetFramework>
    <RootNamespace>MediaDetector.App</RootNamespace>
    <UseWPF>true</UseWPF>
    <!-- No <ApplicationIcon> until Phase 6 creates one. Pointing it at a file
         that does not exist fails the build outright with CS7064. -->
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="CommunityToolkit.Mvvm" Version="8.4.2" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\MediaDetector.Core\MediaDetector.Core.csproj" />
  </ItemGroup>
  <!-- Makes the documented vendoring path real: ToolResolver probes
       AppContext.BaseDirectory\bin, which is the OUTPUT dir, not the repo root.
       Without this copy a ffmpeg.exe dropped in the repo's bin/ is never found. -->
  <ItemGroup Condition="Exists('$(MSBuildProjectDirectory)\..\..\bin')">
    <None Include="..\..\bin\*.exe" LinkBase="bin" CopyToOutputDirectory="PreserveNewest" />
  </ItemGroup>
</Project>
```

`desktop/.gitignore`:

```
bin/
obj/
*.user
publish/
```

- [ ] **Step 2: Add a smoke test so the test project is proven wired**

`desktop/MediaDetector.Core.Tests/SmokeTests.cs`:

```csharp
namespace MediaDetector.Core.Tests;

public class SmokeTests
{
    [Fact]
    public void TestProjectRuns() => Assert.True(true);
}
```

- [ ] **Step 3: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests/MediaDetector.Core.Tests.csproj`
Expected: PASS (1 test)

- [ ] **Step 4: Verify the app builds, launches, and the Next.js app is untouched**
Run: `dotnet build desktop/MediaDetector.sln`
Expected: Build succeeded, 0 errors
Run: `dotnet run --project desktop/MediaDetector.App`
Expected: an empty window appears; close it
Run: `npx tsc --noEmit`
Expected: no errors (the Next.js app must remain buildable throughout)

---

## Phase 1: Core models and pure logic (tests first)

Every task in this phase follows RED then GREEN, per the TDD rule in CLAUDE.md. The existing Jest tests are the source of the expectations; each C# test below is a direct translation.

### Task 2: Domain models

**Files:**
- Create: `desktop/MediaDetector.Core/Models/MediaModels.cs`
- Create: `desktop/MediaDetector.Core/Models/DownloadLine.cs`
- Create: `desktop/MediaDetector.Core/Models/PlaylistModels.cs`
- Create: `desktop/MediaDetector.Core/Models/StatusModels.cs`

- [ ] **Step 1: Write the models**

Records, not classes -- these are immutable value carriers, matching the immutability rule in the coding-style rules.

`Models/MediaModels.cs`:

```csharp
namespace MediaDetector.Core.Models;

// VideoFormat and AudioFormat are otherwise unrelated records, so anything that
// must treat them uniformly -- the FormatTabs row factory in Task 23 Step 3b --
// needs this shared surface. Without it that callback is not expressible.
public interface IMediaFormat
{
    string FormatId { get; }
    string Ext { get; }
    long? Filesize { get; }
}

public sealed record VideoFormat(
    string FormatId,
    string Ext,
    int Width,
    int Height,
    double? Fps,
    string Vcodec,
    long? Filesize) : IMediaFormat;

public sealed record AudioFormat(
    string FormatId,
    string Ext,
    double? Abr,
    string Acodec,
    long? Filesize) : IMediaFormat;

public sealed record MediaInfo(
    string Title,
    string Channel,
    double Duration,
    string Thumbnail,
    long? ViewCount,
    string? Artist,
    string? Track,
    IReadOnlyList<VideoFormat> VideoFormats,
    IReadOnlyList<AudioFormat> AudioFormats);
```

`Models/DownloadLine.cs` -- the discriminated union the TS code expressed as a string-tagged type. C# gets an abstract record hierarchy, which pattern-matches with `switch`:

```csharp
namespace MediaDetector.Core.Models;

public enum DownloadPhase
{
    Extracting,
    Downloading,
    Merging,
    Converting,
    Embedding,
    Finishing,
}

public abstract record DownloadLine;

// types/media.ts keeps DownloadStreamLine and PlaylistDownloadLine as separate
// unions, and an earlier draft mirrored that with abstract SingleDownloadLine /
// PlaylistLine bases. That was type noise with no teeth: ProgressLine,
// PhaseLine and ErrorLine are valid in BOTH protocols, so they have to sit on
// the shared base, which makes IAsyncEnumerable<SingleDownloadLine> impossible
// to express and leaves the split enforcing nothing.
//
// So there is one base, and the enforcement is a runtime `default: throw new
// UnreachableException(...)` arm in each consumer's switch. That is honest
// about what is actually checked and when.
public sealed record ProgressLine(
    double Percent,
    long? DownloadedBytes = null,
    long? TotalBytes = null,
    double? SpeedBytesPerSec = null,
    double? EtaSeconds = null,
    int? FragmentIndex = null,
    int? FragmentCount = null) : DownloadLine;

public sealed record PhaseLine(DownloadPhase Phase, string Label) : DownloadLine;

public sealed record ErrorLine(string Message) : DownloadLine;

public sealed record DoneLine(string SavedPath) : DownloadLine;

// Explicit rather than inferred. Without it a cancelled run ends the sequence
// with no line at all: TrackRunner swallows the OperationCanceledException,
// DownloadService sees a non-zero exit and yield-breaks silently, and the view
// model's `catch (OperationCanceledException)` never fires -- so the row falls
// back to idle instead of saying anything. yt-dlp leaves a resumable .part file,
// which is what the message tells the user.
public sealed record CancelledLine(string Message = "Cancelled -- a partial file may remain")
    : DownloadLine;
```

`Models/PlaylistModels.cs`:

```csharp
namespace MediaDetector.Core.Models;

public enum PlaylistMode { Audio, Video }
public enum PlaylistAudioFormat { M4a, Mp3, Best }
public enum PlaylistVideoQuality { Q1080, Q720, Best }

public sealed record PlaylistFormatSelection(
    PlaylistMode Mode,
    PlaylistAudioFormat AudioFormat = PlaylistAudioFormat.M4a,
    PlaylistVideoQuality VideoQuality = PlaylistVideoQuality.Q1080);

public sealed record PlaylistTrack(int Index, string Title, string? Author);

public sealed record PlaylistInfo(string Title, int Count, IReadOnlyList<PlaylistTrack> Tracks);

public sealed record PlaylistEntry(string Id, string Title, string? Author);

public sealed record TrackJob(string Id, string Title, int Index, string? Author = null);

public sealed record TrackOutcome(bool Ok, string? SavedPath = null, bool Hung = false);

// Playlist-only lines; the shared ones (ProgressLine, PhaseLine, ErrorLine) sit
// on the common DownloadLine base and are valid in both protocols.
public sealed record ItemLine(int Index, int Total) : DownloadLine;
public sealed record TrackDoneLine(int Index, string SavedPath) : DownloadLine;
public sealed record TrackRetryLine(int Index, int Attempt, int Phase) : DownloadLine;
public sealed record TrackSkippedLine(int Index) : DownloadLine;
public sealed record TrackErrorLine(int Index, string Title) : DownloadLine;
public sealed record BatchDoneLine(
    string Folder, int Downloaded, int Total, int Failed, bool Cancelled) : DownloadLine;
```

`Models/StatusModels.cs` -- note the fourth dependency:

```csharp
namespace MediaDetector.Core.Models;

public enum UpdateStatus { Updated, UpToDate, Failed, Skipped }

public sealed record DependencyState(bool Found, string? Version);

public sealed record YtdlpState(bool Found, string? Version, UpdateStatus UpdateStatus);

public sealed record StatusResult(
    DependencyState Python,
    YtdlpState Ytdlp,
    // New fourth row: yt-dlp needs a JS runtime for YouTube's signature challenges,
    // which the Node-hosted web app used to supply for free via process.execPath.
    DependencyState Node,
    DependencyState Ffmpeg);
```

- [ ] **Step 2: Run -- expect PASS (compile only)**
Run: `dotnet build desktop/MediaDetector.Core/MediaDetector.Core.csproj`
Expected: Build succeeded

### Task 3: File naming (port of `lib/filename.ts`, 46 test cases)

The single highest-risk port: pure regex logic where a subtly wrong translation fails silently on one title in a hundred. Ported first because it needs no process spawning and gives a fully green vertical slice on day one.

**Files:**
- Create: `desktop/MediaDetector.Core/Naming/FileNaming.cs`
- Test: `desktop/MediaDetector.Core.Tests/Naming/FileNamingTests.cs`

- [ ] **Step 1: Write the failing tests**

**Translate all 46 `it()` blocks from `lib/__tests__/filename.test.ts`, not a selection.** The excerpt below shows the ones that pin real traps and the exact form the translation takes; the remainder are mechanical but must still be written, because this module is the single highest-risk port in the plan and its rules fail silently on one title in a hundred. Where a Jest block contains several `expect`s, either keep them in one `[Fact]` or split into a `[Theory]` -- the count that matters is coverage of all 46 blocks, not the C# method count.

```csharp
using MediaDetector.Core.Naming;

namespace MediaDetector.Core.Tests.Naming;

public class FileNamingTests
{
    [Fact]
    public void DownloadStem_PutsArtistAfterTitle()
    {
        var source = new NameSource("Instant Crush", Artist: "Daft Punk");
        Assert.Equal("Instant Crush - Daft Punk", FileNaming.DownloadStem(source));
    }

    [Fact]
    public void DownloadStem_DropsDuplicatedAuthorPrefix()
    {
        var source = new NameSource("Daft Punk - Instant Crush", Uploader: "Daft Punk");
        Assert.Equal("Instant Crush - Daft Punk", FileNaming.DownloadStem(source));
    }

    [Fact]
    public void StripTopicSuffix_RemovesYouTubeMusicTopicChannel()
        => Assert.Equal("Son Tung M-TP", FileNaming.StripTopicSuffix("Son Tung M-TP - Topic"));

    // The headline show-title case from CLAUDE.md.
    [Fact]
    public void ParseShowTitle_QuotedNameWithCastEitherSide()
    {
        var parts = FileNaming.ParseShowTitle(
            "PBN 66 | Hài kịch \"Trần Trừng Trị\" - Kiều Linh, Chí Tài");
        Assert.NotNull(parts);
        Assert.Equal("Trần Trừng Trị", parts!.Track);
        Assert.Equal("Kiều Linh, Chí Tài", parts.Cast);
    }

    [Fact]
    public void ParseShowTitle_GenreThenLeadingCastThenName()
    {
        var parts = FileNaming.ParseShowTitle("Hài Hoài Linh, Chí Tài - Con Sáo Sang Sông");
        Assert.NotNull(parts);
        Assert.Equal("Con Sáo Sang Sông", parts!.Track);
        Assert.Equal("Hoài Linh, Chí Tài", parts.Cast);
    }

    // The diacritic anchors keep the blast radius tiny. An ASCII lookalike must not match.
    [Fact]
    public void ParseShowTitle_DoesNotMatchAsciiLookalike()
        => Assert.Null(FileNaming.ParseShowTitle("Hai Phong, Ha Noi - Trip"));

    // The REAL case from filename.test.ts:217, not an invented one. "Thúy Nga"
    // is both the channel and a performer, and only the standalone PIPE SEGMENT
    // is the brand. An input with no '|' makes dropBrandSegments return early,
    // so it exercises nothing -- and BRAND_SEGMENTS is one of the two rules
    // CLAUDE.md names as must-preserve.
    [Fact]
    public void ParseShowTitle_DropsBrandSegmentsButKeepsTheSameNameInACastList()
    {
        var parts = FileNaming.ParseShowTitle(
            "Hài Chí Tài, Thúy Nga - Áo Em | Thúy Nga | Paris By Night");
        Assert.NotNull(parts);
        Assert.Equal("Áo Em", parts!.Track);
        Assert.Equal("Chí Tài, Thúy Nga", parts.Cast);
    }

    // The series label sits in its own pipe segment; flattening the pipes used
    // to glue it onto the last performer's name (filename.test.ts:243).
    [Fact]
    public void ParseShowTitle_KeepsASeriesLabelOutOfTheCast()
    {
        var parts = FileNaming.ParseShowTitle(
            "Hài Kịch \"Tệ Hơn Vợ Thằng Đậu\" | Phi Nhung, Bảo Chung | Về Quê Em 1");
        Assert.NotNull(parts);
        Assert.Equal("Tệ Hơn Vợ Thằng Đậu", parts!.Track);
        Assert.Equal("Phi Nhung, Bảo Chung", parts.Cast);
    }

    // "Hài Kịch Mới" must not be cut down to "Mới" -- in a pipe-structured title
    // the genre word is part of a longer phrase.
    [Fact]
    public void ParseShowTitle_KeepsAGenreWordThatIsPartOfALongerPhrase()
    {
        var parts = FileNaming.ParseShowTitle(
            "Hài Kịch Mới || Cổ Tích Một Tình Yêu || Hoài Linh, Chí Tài");
        Assert.NotNull(parts);
        Assert.Equal("Hài Kịch Mới || Cổ Tích Một Tình Yêu", parts!.Track);
    }

    // Regression: "contains a comma" alone matched descriptive text, which
    // inverted the title and the blurb.
    [Fact]
    public void ParseShowTitle_DoesNotInvertATitleWhoseTailIsABlurb()
    {
        Assert.Null(FileNaming.ParseShowTitle(
            "Hài Hoài Linh, Chí Tài Xem Đi Xem lại 10000 Lần Không Chán - Hài Kịch Không Xem Tiếc Cả Đời"));
        Assert.Null(FileNaming.ParseShowTitle(
            "HÀI TẾT MỚI NHẤT -BÍ MẬT CỦA MẸ - Vở hài kịch lấy nhiều nước mắt khán giả của Xuân Bắc, Tự Long"));
    }

    // Promo copy has commas too; treating it as cast is how a title ends up inverted.
    [Fact]
    public void LooksLikeCast_RejectsPromoCopy()
        => Assert.False(FileNaming.LooksLikeCast(
            "Vở hài kịch lấy nhiều nước mắt khán giả của Xuân Bắc, Tự Long"));

    // The leading \s+ in the ft|feat rule: without it the "ft" inside "Daft Punk"
    // eats the title down to "Da".
    [Fact]
    public void CleanTitle_DoesNotEatDaftPunk()
        => Assert.Equal("Daft Punk", FileNaming.CleanTitle("Daft Punk"));

    [Fact]
    public void CleanTitle_StripsTrailingFeat()
        => Assert.Equal("Song", FileNaming.CleanTitle("Song ft. Someone Else"));

    // The quality rule needs a digit/unit/acronym on every alternative so bare
    // years survive.
    [Fact]
    public void CleanTitle_KeepsBareYear()
        => Assert.Equal("Blade Runner 2049", FileNaming.CleanTitle("Blade Runner 2049"));

    [Fact]
    public void CleanTitle_StripsQualityMarkers()
        => Assert.Equal("Song", FileNaming.CleanTitle("Song 1080p 60fps 4K"));

    [Fact]
    public void CleanTitle_StripsBracketedPromoTags()
        => Assert.Equal("Song", FileNaming.CleanTitle("Song (Official Music Video)"));

    // Mirrors yt_dlp.utils.sanitize_filename: substitute full-width lookalikes,
    // never strip.
    [Theory]
    [InlineData("a/b", "a\u29F8b")]
    [InlineData("a\\b", "a\u29F9b")]
    [InlineData("a:b", "a\uFF1Ab")]
    [InlineData("a?b", "a\uFF1Fb")]
    [InlineData("a\"b", "a\uFF02b")]
    [InlineData("a<b", "a\uFF1Cb")]
    [InlineData("a>b", "a\uFF1Eb")]
    [InlineData("a|b", "a\uFF5Cb")]
    [InlineData("a*b", "a\uFF0Ab")]
    public void SanitizeFilename_SubstitutesFullWidthLookalikes(string input, string expected)
        => Assert.Equal(expected, FileNaming.SanitizeFilename(input));

    [Fact]
    public void SanitizeFilename_FallsBackWhenNothingLeft()
        => Assert.Equal("Untitled", FileNaming.SanitizeFilename("   "));

    // Path traversal: both separators map to full-width lookalikes, which makes
    // the result a single path component by construction.
    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("..\\..\\Windows\\System32")]
    public void SanitizeUserStem_CannotEscapeTheFolder(string evil)
    {
        var safe = FileNaming.SanitizeUserStem(evil);
        Assert.NotNull(safe);
        Assert.DoesNotContain('/', safe!);
        Assert.DoesNotContain('\\', safe);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(".")]
    [InlineData("..")]
    [InlineData("...")]
    public void SanitizeUserStem_RejectsUnusableNames(string input)
        => Assert.Null(FileNaming.SanitizeUserStem(input));

    // yt-dlp emits "artist": "" and "track": "" for non-music videos. The TS used
    // `||`, which falls through on empty string; a naive `??` port would not.
    [Fact]
    public void DownloadStem_EmptyArtistFallsThroughToUploader()
    {
        var source = new NameSource("Song", Artist: "", Uploader: "Some Channel");
        Assert.Equal("Song - Some Channel", FileNaming.DownloadStem(source));
    }

    [Fact]
    public void DownloadStem_EmptyTrackFallsThroughToTitle()
    {
        var source = new NameSource("Real Title", Track: "", Artist: "A");
        Assert.Equal("Real Title - A", FileNaming.DownloadStem(source));
    }

    [Fact]
    public void EffectiveAuthor_AllCreditsEmptyGivesUnknown()
        => Assert.Equal("Unknown",
            FileNaming.EffectiveAuthor(new NameSource("T", Artist: "", Uploader: "", Channel: "")));

    // Any '%' must be doubled or yt-dlp reads it as a field placeholder.
    [Fact]
    public void OutputTemplateFor_DoublesPercentAndTemplatesOnlyExt()
        => Assert.Equal(
            @"C:\out\100%% Song.%(ext)s",
            FileNaming.OutputTemplateFor(@"C:\out\100% Song"));
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~FileNamingTests"`
Expected: FAIL (FileNaming does not exist)

- [ ] **Step 3: Write the implementation**

`desktop/MediaDetector.Core/Naming/FileNaming.cs`. The .NET regex engine differs from JS in two ways that matter here, both handled explicitly: `RegexOptions.CultureInvariant` keeps the Vietnamese diacritic anchors from being case-folded oddly under any locale, and .NET's `Regex.Replace` with a `MatchEvaluator` replaces the JS callback form.

```csharp
using System.Text.RegularExpressions;

namespace MediaDetector.Core.Naming;

public sealed record NameSource(
    string Title,
    string? Track = null,
    string? Artist = null,
    string? Uploader = null,
    string? Channel = null);

public sealed record ShowParts(string Track, string? Cast);

public static partial class FileNaming
{
    private const RegexOptions Opts = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

    // Straight and curly double quotes, used interchangeably in show titles.
    private const string Quote = "\"\u201C\u201D";

    // Vietnamese variety-show genre words. Deliberately the diacritic forms:
    // they anchor the show rules so those cannot fire on other content.
    private const string Genre = @"(?:hài\s+kịch|tấu\s+hài|hài|kịch)";

    // Only ever matched as a WHOLE pipe segment -- "Thúy Nga" is also a performer.
    private static readonly string[] BrandSegments =
        ["thúy nga", "thuy nga", "paris by night", "pbn tiếu vương hội", "pbn"];

    private const int MaxWordsPerName = 4;
    private const int MaxCastLength = 120;

    private static readonly Regex QuotedSpan =
        new($"^([^{Quote}]*)[{Quote}]([^{Quote}]+)[{Quote}](.*)$", RegexOptions.CultureInvariant);

    private static readonly Regex TopicSuffix =
        new(@"\s*-\s*topic\s*$", Opts);

    public static string StripTopicSuffix(string name) => TopicSuffix.Replace(name, "");

    private static string Tidy(string value) =>
        Regex.Replace(
            Regex.Replace(value, @"\s{2,}", " "),
            @"^[\s\-\u2013\u2014|,:]+|[\s\-\u2013\u2014|,:]+$", "").Trim();

    private static string DropBrandSegments(string title)
    {
        if (!title.Contains('|')) return title;
        var kept = title.Split('|')
            .Where(seg => !BrandSegments.Contains(seg.Trim().ToLowerInvariant()));
        return string.Join("|", kept);
    }

    private static string StripShowFurniture(string segment)
    {
        var s = Regex.Replace(segment, @"\bPBN\s*\d*", "", Opts);
        s = Regex.Replace(s, $@"^\s*{Genre}\b", "", Opts);
        s = Regex.Replace(s, $@"[\-\u2013\u2014]\s*{Genre}\b", " ", Opts);
        s = Regex.Replace(s, @"[\-\u2013\u2014]", " ");
        return Tidy(s);
    }

    // A performer list is a few short names. Promo copy also contains commas, so
    // every comma/ampersand-separated part has to be name-shaped.
    public static bool LooksLikeCast(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length == 0 || trimmed.Length > MaxCastLength) return false;

        var parts = trimmed.Split([',', '&'])
            .Select(p => p.Trim())
            .Where(p => p.Length != 0)
            .ToArray();
        if (parts.Length == 0) return false;
        // Split on ANY whitespace, not just ' ': the TS uses /\s+/, so a title
        // with a tab or a non-breaking space would otherwise get a different
        // word count and flip the <=4-words-per-name verdict.
        if (parts.Any(p => WordCount(p) > MaxWordsPerName)) return false;

        // A lone one-word fragment is a leftover adjective ("Hot"), not a person.
        return parts.Length > 1 || WordCount(parts[0]) > 1;
    }

    private static int WordCount(string value) =>
        value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;

    // The remainder is split on '|' first: a series label sits in its own segment,
    // so flattening the pipes would glue it onto the last performer's name.
    private static string CastFromRemainder(string remainder)
    {
        var candidates = remainder.Split('|')
            .Select(StripShowFurniture)
            .Where(s => s.Length != 0 && LooksLikeCast(s))
            .ToArray();
        if (candidates.Length == 0) return "";

        // The real cast is the comma-rich segment; a series label has none.
        return candidates
            .OrderByDescending(v => v.Count(c => c == ','))
            .ThenByDescending(v => v.Length)
            .First();
    }

    // Recognises the three shapes this catalogue uses, in order of confidence.
    // Returns null for anything not show-shaped, which is most content.
    public static ShowParts? ParseShowTitle(string rawTitle)
    {
        var title = DropBrandSegments(rawTitle);

        // 1. The real name is quoted; everything around it is series/genre/cast.
        var quoted = QuotedSpan.Match(title);
        if (quoted.Success)
        {
            var cast = CastFromRemainder($"{quoted.Groups[1].Value} | {quoted.Groups[3].Value}");
            return new ShowParts(Tidy(quoted.Groups[2].Value), LooksLikeCast(cast) ? cast : null);
        }

        // 2. Genre word, then cast, then a separator, then the name.
        var lead = Regex.Match(
            title, $@"^\s*{Genre}\s+([^|\-\u2013\u2014]*,[^|\-\u2013\u2014]*?)\s*[|\-\u2013\u2014]\s*(.+)$", Opts);
        if (lead.Success)
        {
            var cast = CastFromRemainder(lead.Groups[1].Value);
            var track = Tidy(Regex.Replace(
                lead.Groups[2].Value, @"\s*[|\-\u2013\u2014]?\s*\bPBN\s*\d*", "", Opts));
            if (track.Length != 0 && LooksLikeCast(cast)) return new ShowParts(track, cast);
        }

        // 3. Name first, then a trailing cast list of at least two names.
        var trail = Regex.Match(
            title,
            $@"^\s*({Genre}\s+.+?)\s*[|\-\u2013\u2014]\s*([^|\-\u2013\u2014]+,[^|\-\u2013\u2014]+)$",
            Opts);
        if (trail.Success)
        {
            var cast = CastFromRemainder(trail.Groups[2].Value);
            var withoutEpisode = Regex.Replace(
                trail.Groups[1].Value, @"\s*[|\-\u2013\u2014]?\s*\bPBN\s*\d*", "", Opts);
            // Only drop a bare genre prefix from the plain "Genre Name - Cast" form.
            // In a pipe-structured title the genre word is part of a longer phrase
            // ("Hài Kịch Mới || ..."), and cutting it leaves a meaningless "Mới".
            var track = Tidy(withoutEpisode.Contains('|')
                ? withoutEpisode
                : Regex.Replace(withoutEpisode, $@"^\s*{Genre}\s+(?=\S)", "", Opts));
            if (track.Length != 0 && LooksLikeCast(cast)) return new ShowParts(track, cast);
        }

        return null;
    }

    private sealed record CleanRule(Regex Pattern, string Replacement);

    private static readonly CleanRule[] NoiseRules =
    [
        new(new Regex(
            @"\s*[(\[][^)\]]*(?:official|lyric|audio|video|visuali[sz]er|remaster(?:ed)?|explicit|hd|hq|4k|8k|m/?v)[^)\]]*[)\]]",
            Opts), ""),
        // The leading \s+ matters: without it the "ft" inside "Daft Punk" matches
        // and eats the rest of the title.
        new(new Regex(@"\s+[(\[]?\s*(?:ft|feat)\.?\s+[^)\]]*[)\]]?\s*$", Opts), ""),
        new(new Regex(@"\s*[|\-\u2013\u2014]\s*(?:official|lyrics?|audio|visuali[sz]er|m/?v)\b.*$", Opts), ""),
        new(new Regex(@"\s+(?:m/?v|official\s+(?:music\s+)?video|lyrics?\s+video|visuali[sz]er)\s*$", Opts), ""),
        // Each alternative needs a digit, unit or acronym so bare years survive.
        new(new Regex(@"\s+(?:\d{3,4}p(?:\d{2,3})?|[248]k|uhd|fhd|hdr|\d{2,3}\s*fps|full\s+hd|hd|hq)\b", Opts), ""),
    ];

    public static string CleanTitle(string title)
    {
        var cleaned = NoiseRules.Aggregate(
            title, (current, rule) => rule.Pattern.Replace(current, rule.Replacement));
        return Tidy(cleaned);
    }

    // yt-dlp does not strip filesystem-illegal characters, it swaps in full-width
    // lookalikes. Mirrored exactly (verified against yt_dlp.utils.sanitize_filename).
    private static readonly Dictionary<char, char> CharSubstitutions = new()
    {
        ['/'] = '\u29F8',   // big solidus
        ['\\'] = '\u29F9',  // big reverse solidus
        [':'] = '\uFF1A',
        ['?'] = '\uFF1F',
        ['"'] = '\uFF02',
        ['<'] = '\uFF1C',
        ['>'] = '\uFF1E',
        ['|'] = '\uFF5C',
        ['*'] = '\uFF0A',
    };

    public static string SanitizeFilename(string name)
    {
        var chars = name
            // Explicit range, NOT char.IsControl: that also returns true for
            // U+0080-U+009F (verified: char.IsControl('\u0085') is true),
            // which the TS class [\x00-\x1f\x7f] deliberately keeps.
            // Stripping those would silently rename any title containing one.
            .Where(c => c > '\u001F' && c != '\u007F')
            .Select(c => CharSubstitutions.TryGetValue(c, out var sub) ? sub : c);
        var cleaned = new string(chars.ToArray()).Trim();
        return cleaned.Length != 0 ? cleaned : "Untitled";
    }

    private static string StripAuthorPrefix(string title, string author)
    {
        if (author.Length == 0) return title;
        var escaped = Regex.Escape(author);
        return Regex.Replace(title, $@"^\s*{escaped}\s*[-\u2013\u2014]\s*", "", Opts);
    }

    // The credit after the title: show performers when the title names them, else
    // the music artist, else the channel.
    // JS `a || b` falls through on ANY falsy value, including "". C# `a ?? b`
    // only falls through on null, and yt-dlp really does emit "artist": "" and
    // "track": "". Using ?? here would credit an empty artist and produce names
    // that diverge from the web app, so this helper restores the JS semantics.
    private static string? NonEmpty(string? value) =>
        string.IsNullOrEmpty(value) ? null : value;

    public static string EffectiveAuthor(NameSource source)
    {
        var show = ParseShowTitle(source.Title);
        // Explicit null + empty check rather than a property pattern, per
        // rules/common/coding-style.md.
        if (show != null && !string.IsNullOrEmpty(show.Cast)) return show.Cast;

        var fallback = NonEmpty(source.Artist)
                       ?? NonEmpty(source.Uploader)
                       ?? NonEmpty(source.Channel)
                       ?? "";
        var stripped = StripTopicSuffix(fallback).Trim();
        return stripped.Length != 0 ? stripped : "Unknown";
    }

    public static string DownloadStem(NameSource source)
    {
        var show = ParseShowTitle(source.Title);
        var author = EffectiveAuthor(source);

        // NonEmpty, not ??: lib/filename.ts:239 is `source.track || source.title`,
        // so an empty track string must fall through to the title.
        var baseName = show != null
            ? show.Track
            : CleanTitle(StripAuthorPrefix(NonEmpty(source.Track) ?? source.Title, author));

        var stem = author.Length != 0 && author != baseName ? $"{baseName} - {author}" : baseName;
        return SanitizeFilename(stem);
    }

    public static string RawStem(NameSource source) => SanitizeFilename(source.Title);

    // A stem typed by the user. Untrusted: it is pasted into an absolute output
    // path. SanitizeFilename maps both separators to full-width lookalikes, so no
    // input can climb out of the download folder.
    public static string? SanitizeUserStem(string? input)
    {
        if (input == null) return null;
        var trimmed = input.Trim();
        if (trimmed.Length == 0) return null;

        var safe = SanitizeFilename(trimmed);
        // Reject names made only of dots -- '.' and '..' are directory entries.
        if (safe.All(c => c == '.')) return null;
        return safe;
    }

    // Only %(ext)s stays a template -- the extension is unknown until yt-dlp has
    // picked (and possibly converted) the format.
    public static string OutputTemplateFor(string literalPathWithoutExt) =>
        $"{literalPathWithoutExt.Replace("%", "%%")}.%(ext)s";
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~FileNamingTests"`
Expected: PASS, and the run covers all 46 `it()` blocks from `lib/__tests__/filename.test.ts`. Cross-check the count before moving on:
Run: `grep -c "  it(" lib/__tests__/filename.test.ts`
Expected: `46` -- every one of them accounted for in `FileNamingTests`.

**Cross-check against the real corpus before moving on.** The 123 files already in `%USERPROFILE%\Documents\MediaDetector` are the *output of the current TypeScript rules*, which makes them a free oracle for the port.

Enumerate them **recursively** -- the top-level folder holds 0 files; everything sits one level down in `hài kịch\` and `Hài Kịch Tổng Hợp - Thúy Nga Paris By Night (Comedies)\`, so a non-recursive scan silently diffs an empty set and reports success:

```powershell
Get-ChildItem "$env:USERPROFILE\Documents\MediaDetector" -Recurse -File -Include *.m4a,*.mp4
```

For each file, read the embedded `title` and `artist` tags (`ffprobe -show_entries format_tags`), rebuild the stem with `FileNaming.DownloadStem`, and diff against the actual filename. Delete the harness once the diff is empty.

### Task 4: URL validation (port of `lib/validate.ts`, 14 test cases)

**Files:**
- Create: `desktop/MediaDetector.Core/Validation/YouTubeUrl.cs`
- Test: `desktop/MediaDetector.Core.Tests/Validation/YouTubeUrlTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Validation;

namespace MediaDetector.Core.Tests.Validation;

public class YouTubeUrlTests
{
    [Theory]
    [InlineData("https://www.youtube.com/watch?v=abc123")]
    [InlineData("https://youtube.com/watch?v=abc123")]
    [InlineData("https://music.youtube.com/watch?v=abc123")]
    [InlineData("https://youtu.be/abc123")]
    public void IsYouTubeUrl_AcceptsAllowedHosts(string url)
        => Assert.True(YouTubeUrl.IsYouTubeUrl(url));

    [Theory]
    [InlineData("")]
    [InlineData("not a url")]
    [InlineData("https://vimeo.com/12345")]
    [InlineData("https://evil.com/watch?v=abc")]
    // A lookalike host must not pass on a suffix match.
    [InlineData("https://notyoutube.com/watch?v=abc")]
    public void IsYouTubeUrl_RejectsEverythingElse(string url)
        => Assert.False(YouTubeUrl.IsYouTubeUrl(url));

    [Fact]
    public void GetKind_WatchUrlIsVideoOnly()
    {
        var kind = YouTubeUrl.GetKind("https://www.youtube.com/watch?v=abc123");
        Assert.True(kind.HasVideo);
        Assert.False(kind.HasPlaylist);
    }

    [Fact]
    public void GetKind_WatchPlusListIsBoth()
    {
        var kind = YouTubeUrl.GetKind("https://www.youtube.com/watch?v=abc&list=PL123");
        Assert.True(kind.HasVideo);
        Assert.True(kind.HasPlaylist);
    }

    // RD* is an auto-generated radio/mix -- effectively endless, not a real playlist.
    [Fact]
    public void GetKind_ExcludesRadioMixPlaylists()
    {
        var kind = YouTubeUrl.GetKind("https://www.youtube.com/watch?v=abc&list=RDabc");
        Assert.True(kind.HasVideo);
        Assert.False(kind.HasPlaylist);
    }

    [Fact]
    public void GetKind_ShortLinkIsVideo()
        => Assert.True(YouTubeUrl.GetKind("https://youtu.be/abc123").HasVideo);

    [Fact]
    public void GetKind_BareShortLinkHostIsNotVideo()
        => Assert.False(YouTubeUrl.GetKind("https://youtu.be/").HasVideo);

    [Fact]
    public void GetKind_NonYouTubeIsNeither()
    {
        var kind = YouTubeUrl.GetKind("https://vimeo.com/1");
        Assert.False(kind.HasVideo);
        Assert.False(kind.HasPlaylist);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~YouTubeUrlTests"`
Expected: FAIL (YouTubeUrl does not exist)

- [ ] **Step 3: Write the implementation**

`Uri.TryCreate` replaces JS's throwing `new URL()`. Note `UriKind.Absolute`: without it a relative string parses successfully and the host check would throw.

```csharp
using System.Web;

namespace MediaDetector.Core.Validation;

public readonly record struct YouTubeUrlKind(bool HasVideo, bool HasPlaylist);

public static class YouTubeUrl
{
    private static readonly string[] AllowedHosts =
        ["www.youtube.com", "youtube.com", "music.youtube.com", "youtu.be"];

    private static bool TryParse(string input, out Uri uri)
    {
        uri = null!;
        if (string.IsNullOrWhiteSpace(input)) return false;
        if (!Uri.TryCreate(input.Trim(), UriKind.Absolute, out var parsed)) return false;
        uri = parsed;
        // Exact host match, never a suffix -- "notyoutube.com" must not pass.
        return AllowedHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase);
    }

    public static bool IsYouTubeUrl(string input) => TryParse(input, out _);

    public static YouTubeUrlKind GetKind(string input)
    {
        if (!TryParse(input, out var uri)) return new YouTubeUrlKind(false, false);

        var query = HttpUtility.ParseQueryString(uri.Query);
        var list = query["list"];
        // Exclude RD* (auto-generated radio/mix) -- endless, not a real playlist.
        var hasPlaylist = !string.IsNullOrEmpty(list)
            && !list.StartsWith("RD", StringComparison.Ordinal);

        var isShortLink = uri.Host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.Length > 1;
        var hasVideo = !string.IsNullOrEmpty(query["v"]) || isShortLink;

        return new YouTubeUrlKind(hasVideo, hasPlaylist);
    }
}
```

`System.Web.HttpUtility` lives in `System.Web.HttpUtility.dll`, referenced by the shared framework; no package needed.

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~YouTubeUrlTests"`
Expected: 0 failed

### Task 5: Display formatting (port of `lib/format.ts`, 12 test cases)

**Files:**
- Create: `desktop/MediaDetector.Core/Formatting/DisplayFormat.cs`
- Test: `desktop/MediaDetector.Core.Tests/Formatting/DisplayFormatTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Formatting;

namespace MediaDetector.Core.Tests.Formatting;

public class DisplayFormatTests
{
    // Decimal units (KB = 1000 B) to match what YouTube and file managers show.
    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(999, "999 B")]
    [InlineData(1000, "1.0 KB")]
    [InlineData(1_500_000, "1.5 MB")]
    [InlineData(1_000_000_000, "1.0 GB")]
    // Midpoint: JS toFixed rounds half away from zero, .NET Math.Round defaults
    // to banker's rounding. Pins the divergence that would otherwise ship silently.
    [InlineData(1_250_000, "1.3 MB")]
    public void FormatBytes_UsesDecimalUnits(long bytes, string expected)
        => Assert.Equal(expected, DisplayFormat.FormatBytes(bytes));

    [Fact]
    public void FormatBytes_UnknownRendersPlaceholder()
        => Assert.Equal("--", DisplayFormat.FormatBytes(null));

    [Fact]
    public void FormatBytes_NegativeRendersPlaceholder()
        => Assert.Equal("--", DisplayFormat.FormatBytes(-1));

    [Fact]
    public void FormatSpeed_AppendsPerSecond()
        => Assert.Equal("1.5 MB/s", DisplayFormat.FormatSpeed(1_500_000));

    // Zero speed is "not moving", not "0 B/s".
    [Fact]
    public void FormatSpeed_ZeroRendersPlaceholder()
        => Assert.Equal("--", DisplayFormat.FormatSpeed(0));

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(65, "1:05")]
    [InlineData(3661, "1:01:01")]
    public void FormatDuration_SwitchesToHoursPastAnHour(double seconds, string expected)
        => Assert.Equal(expected, DisplayFormat.FormatDuration(seconds));

    [Fact]
    public void FormatDuration_UnknownRendersPlaceholder()
        => Assert.Equal("--", DisplayFormat.FormatDuration(null));

    // Keeps the separator style of the input so the path round-trips to Explorer.
    [Theory]
    [InlineData(@"C:\Users\Me\Music\song.m4a", @"C:\Users\Me\Music")]
    [InlineData("/home/me/music/song.m4a", "/home/me/music")]
    [InlineData("song.m4a", "")]
    public void ParentDir_PreservesSeparatorStyle(string path, string expected)
        => Assert.Equal(expected, DisplayFormat.ParentDir(path));
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DisplayFormatTests"`
Expected: FAIL (DisplayFormat does not exist)

- [ ] **Step 3: Write the implementation**

Deliberately **not** `Path.GetDirectoryName`: that normalises separators, which would break the round-trip back to Explorer for a POSIX-style path and is exactly what the TS comment warns about.

```csharp
using System.Globalization;

namespace MediaDetector.Core.Formatting;

public static class DisplayFormat
{
    private static readonly string[] SizeUnits = ["B", "KB", "MB", "GB", "TB"];
    private const string Placeholder = "--";

    private static bool IsUsable(double? value) =>
        value != null && double.IsFinite(value.Value) && value.Value >= 0;

    public static string FormatBytes(double? bytes)
    {
        if (!IsUsable(bytes)) return Placeholder;
        var value = bytes!.Value;
        var unit = 0;
        while (value >= 1000 && unit < SizeUnits.Length - 1)
        {
            value /= 1000;
            unit++;
        }
        var digits = unit != 0 && value < 100 ? 1 : 0;
        // MidpointRounding.AwayFromZero is REQUIRED, and ToString alone is NOT
        // toFixed-compatible: verified on .NET 10, (1.25).ToString("F1") is
        // "1.2" (IEEE/banker's on exact midpoints) where JS (1.25).toFixed(1)
        // is "1.3". Math.Round's default ToEven has the same problem.
        var rounded = Math.Round(value, digits, MidpointRounding.AwayFromZero);
        return $"{rounded.ToString($"F{digits}", CultureInfo.InvariantCulture)} {SizeUnits[unit]}";
    }

    public static string FormatSpeed(double? bytesPerSec) =>
        !IsUsable(bytesPerSec) || bytesPerSec == 0
            ? Placeholder
            : $"{FormatBytes(bytesPerSec)}/s";

    public static string FormatDuration(double? seconds)
    {
        if (!IsUsable(seconds)) return Placeholder;
        var total = (long)Math.Round(seconds!.Value);
        var hours = total / 3600;
        var minutes = total % 3600 / 60;
        var secs = total % 60;
        return hours != 0 ? $"{hours}:{minutes:D2}:{secs:D2}" : $"{minutes}:{secs:D2}";
    }

    // Containing folder, keeping the input's separator style so the path can be
    // handed straight back to the OS file manager.
    public static string ParentDir(string filePath)
    {
        var index = Math.Max(filePath.LastIndexOf('\\'), filePath.LastIndexOf('/'));
        if (index < 0) return "";
        if (index == 0) return filePath[..1];
        return filePath[..index];
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DisplayFormatTests"`
Expected: 0 failed

### Task 6: Apple compatibility and format recommendation (ports of `lib/audioCompat.ts` + `lib/recommend.ts`, 13 test cases)

**Files:**
- Create: `desktop/MediaDetector.Core/Formats/AudioCompat.cs`
- Create: `desktop/MediaDetector.Core/Formats/Recommend.cs`
- Test: `desktop/MediaDetector.Core.Tests/Formats/FormatSelectionTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Formats;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Tests.Formats;

public class FormatSelectionTests
{
    private static VideoFormat V(string id, int h, string ext = "mp4", double? fps = null) =>
        new(id, ext, h * 16 / 9, h, fps, "avc1", null);

    private static AudioFormat A(string id, double? abr, string ext = "m4a") =>
        new(id, ext, abr, "mp4a", null);

    [Theory]
    [InlineData("m4a", true)]
    [InlineData("mp3", true)]
    [InlineData("aac", true)]
    [InlineData("mp4", true)]
    [InlineData("webm", false)]
    [InlineData("opus", false)]
    public void IsApplePlayable_MatchesIosNativeContainers(string ext, bool expected)
        => Assert.Equal(expected, AudioCompat.IsApplePlayable(ext));

    [Fact]
    public void SortAudioForApple_FloatsPlayableToTopPreservingOrder()
    {
        var input = new[] { A("1", 160, "webm"), A("2", 128), A("3", 70, "opus"), A("4", 48) };
        var sorted = AudioCompat.SortAudioForApple(input);
        Assert.Equal(["2", "4", "1", "3"], sorted.Select(f => f.FormatId));
    }

    [Fact]
    public void SortAudioForApple_DoesNotMutateInput()
    {
        var input = new[] { A("1", 160, "webm"), A("2", 128) };
        AudioCompat.SortAudioForApple(input);
        Assert.Equal("1", input[0].FormatId);
    }

    [Fact]
    public void RecommendedVideo_PicksHighestResolution()
        => Assert.Equal("hi", Recommend.VideoId([V("lo", 720), V("hi", 1080)]));

    [Fact]
    public void RecommendedVideo_BreaksResolutionTieTowardMp4()
        => Assert.Equal("mp4one", Recommend.VideoId([V("webmone", 1080, "webm"), V("mp4one", 1080)]));

    [Fact]
    public void RecommendedVideo_BreaksContainerTieTowardHigherFps()
        => Assert.Equal("sixty", Recommend.VideoId([V("thirty", 1080, "mp4", 30), V("sixty", 1080, "mp4", 60)]));

    [Fact]
    public void RecommendedVideo_NullWhenEmpty()
        => Assert.Null(Recommend.VideoId([]));

    [Fact]
    public void RecommendedAudio_PrefersHighestBitrateAmongApplePlayable()
        => Assert.Equal("m4ahigh", Recommend.AudioId([A("opushigh", 160, "opus"), A("m4ahigh", 128), A("m4alow", 48)]));

    // Only falls back to the overall best when nothing Apple-playable is offered.
    [Fact]
    public void RecommendedAudio_FallsBackWhenNothingPlayable()
        => Assert.Equal("opushigh", Recommend.AudioId([A("opuslow", 70, "opus"), A("opushigh", 160, "webm")]));

    [Fact]
    public void RecommendedAudio_NullWhenEmpty()
        => Assert.Null(Recommend.AudioId([]));
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~FormatSelectionTests"`
Expected: FAIL (AudioCompat and Recommend do not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Formats;

public static class AudioCompat
{
    // Containers iOS plays natively (Apple Music app, Files, library sync, AirPods,
    // CarPlay). YouTube's highest-bitrate audio is Opus-in-webm, which iOS does NOT
    // play in its stock apps -- so single downloads are steered toward these.
    private static readonly HashSet<string> AppleNativeExts =
        new(["m4a", "mp3", "aac", "mp4"], StringComparer.OrdinalIgnoreCase);

    public static bool IsApplePlayable(string ext) => AppleNativeExts.Contains(ext);

    // Floats iPhone-playable formats to the top while preserving the incoming
    // bitrate order within each group. Returns a new list (no mutation).
    public static IReadOnlyList<AudioFormat> SortAudioForApple(IReadOnlyList<AudioFormat> formats) =>
    [
        .. formats.Where(f => IsApplePlayable(f.Ext)),
        .. formats.Where(f => !IsApplePlayable(f.Ext)),
    ];
}
```

```csharp
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Formats;

// Picks the format most people want, so one row in a long list can be badged
// "Best" instead of leaving the user to compare codecs.
public static class Recommend
{
    // Highest resolution, breaking ties toward mp4 (plays everywhere) then fps.
    public static string? VideoId(IReadOnlyList<VideoFormat> formats)
    {
        if (formats.Count == 0) return null;

        var best = formats.Aggregate((winner, candidate) =>
        {
            if (candidate.Height != winner.Height)
                return candidate.Height > winner.Height ? candidate : winner;

            var candidateIsMp4 = candidate.Ext.Equals("mp4", StringComparison.OrdinalIgnoreCase);
            var winnerIsMp4 = winner.Ext.Equals("mp4", StringComparison.OrdinalIgnoreCase);
            if (candidateIsMp4 != winnerIsMp4) return candidateIsMp4 ? candidate : winner;

            return (candidate.Fps ?? 0) > (winner.Fps ?? 0) ? candidate : winner;
        });

        return best.FormatId;
    }

    // Highest bitrate among containers an iPhone plays natively; falls back to the
    // overall highest only when nothing Apple-playable is on offer.
    public static string? AudioId(IReadOnlyList<AudioFormat> formats)
    {
        if (formats.Count == 0) return null;

        var playable = formats.Where(f => AudioCompat.IsApplePlayable(f.Ext)).ToArray();
        var pool = playable.Length != 0 ? playable : formats;
        var best = pool.Aggregate((winner, candidate) =>
            (candidate.Abr ?? 0) > (winner.Abr ?? 0) ? candidate : winner);

        return best.FormatId;
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~FormatSelectionTests"`
Expected: 0 failed

### Task 7: yt-dlp output line parsers (part of `lib/ytdlp.ts`, ~20 test cases)

Pure string parsing, no spawning. Splitting these out of the process layer is what makes the whole download pipeline testable without yt-dlp installed.

**Files:**
- Create: `desktop/MediaDetector.Core/Ytdlp/OutputParser.cs`
- Test: `desktop/MediaDetector.Core.Tests/Ytdlp/OutputParserTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Models;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class OutputParserTests
{
    // Field order: downloaded total estimate speed eta fragIndex fragCount
    [Fact]
    public void ParseProgress_ReadsTemplateLine()
    {
        var line = OutputParser.ParseProgress("@PROG 500 1000 NA 250.5 2 NA NA");
        Assert.NotNull(line);
        Assert.Equal(50, line!.Percent);
        Assert.Equal(500, line.DownloadedBytes);
        Assert.Equal(1000, line.TotalBytes);
        Assert.Equal(250.5, line.SpeedBytesPerSec);
        Assert.Equal(2, line.EtaSeconds);
    }

    // yt-dlp renders an unset field as the literal "NA"; those become null.
    [Fact]
    public void ParseProgress_OmitsNaFields()
    {
        var line = OutputParser.ParseProgress("@PROG 500 NA NA NA NA NA NA");
        Assert.NotNull(line);
        Assert.Null(line!.TotalBytes);
        Assert.Null(line.SpeedBytesPerSec);
        Assert.Equal(0, line.Percent);
    }

    // Fragmented (DASH/HLS) downloads only know an estimate.
    [Fact]
    public void ParseProgress_FallsBackToEstimateForTotal()
    {
        var line = OutputParser.ParseProgress("@PROG 250 NA 1000 NA NA 3 10");
        Assert.Equal(1000, line!.TotalBytes);
        Assert.Equal(25, line.Percent);
        Assert.Equal(3, line.FragmentIndex);
        Assert.Equal(10, line.FragmentCount);
    }

    [Fact]
    public void ParseProgress_ClampsAtOneHundred()
        => Assert.Equal(100, OutputParser.ParseProgress("@PROG 2000 1000 NA NA NA NA NA")!.Percent);

    // Fallback for yt-dlp's default human-readable line, kept so a percentage
    // still shows if the template is ever dropped from the args.
    [Fact]
    public void ParseProgress_FallsBackToHumanReadableLine()
        => Assert.Equal(42.3, OutputParser.ParseProgress("[download]  42.3% of 3.29MiB at 1.23MiB/s")!.Percent);

    [Fact]
    public void ParseProgress_ReturnsNullForUnrelatedLine()
        => Assert.Null(OutputParser.ParseProgress("[youtube] Extracting URL"));

    [Theory]
    [InlineData("[download] Destination: C:\\out\\a.m4a", DownloadPhase.Downloading, "Downloading")]
    [InlineData("[Merger] Merging formats into \"C:\\out\\a.mp4\"", DownloadPhase.Merging, "Merging video and audio")]
    [InlineData("[ExtractAudio] Destination: a.m4a", DownloadPhase.Converting, "Converting with ffmpeg")]
    [InlineData("[FixupM4a] Correcting container", DownloadPhase.Converting, "Repairing container")]
    [InlineData("[EmbedThumbnail] mp4", DownloadPhase.Embedding, "Embedding metadata and cover art")]
    [InlineData("[MoveFiles] Moving file", DownloadPhase.Finishing, "Finishing up")]
    [InlineData("[youtube] abc: Downloading webpage", DownloadPhase.Extracting, "Reading video page")]
    public void ParsePhase_MapsStagePrefixes(string line, DownloadPhase phase, string label)
    {
        var parsed = OutputParser.ParsePhase(line);
        Assert.NotNull(parsed);
        Assert.Equal(phase, parsed!.Phase);
        Assert.Equal(label, parsed.Label);
    }

    [Fact]
    public void ParsePhase_ReturnsNullForUnknownLine()
        => Assert.Null(OutputParser.ParsePhase("something else"));

    [Fact]
    public void ParseDestination_ReadsDownloadLine()
        => Assert.Equal(@"C:\out\a.m4a",
            OutputParser.ParseDestination(@"[download] Destination: C:\out\a.m4a"));

    [Fact]
    public void ParseDestination_ReadsMergerLine()
        => Assert.Equal(@"C:\out\a.mp4",
            OutputParser.ParseDestination(@"[Merger] Merging formats into ""C:\out\a.mp4"""));

    // Scraped so a failed run's orphaned cover art can be deleted; neither
    // --paths thumbnail: nor -o thumbnail: redirects it (both verified ignored).
    [Fact]
    public void ParseThumbnailPath_ReadsWritingThumbnailLine()
        => Assert.Equal(@"C:\out\a.webp",
            OutputParser.ParseThumbnailPath(@"[info] Writing video thumbnail 1 to: C:\out\a.webp"));

    [Fact]
    public void ParseThumbnailPath_HandlesMissingIndex()
        => Assert.Equal(@"C:\out\a.webp",
            OutputParser.ParseThumbnailPath(@"[info] Writing video thumbnail to: C:\out\a.webp"));

    [Fact]
    public void ParseThumbnailPath_ReturnsNullForUnrelatedLine()
        => Assert.Null(OutputParser.ParseThumbnailPath("[info] Downloading 1 format(s)"));
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~OutputParserTests"`
Expected: FAIL (OutputParser does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Globalization;
using System.Text.RegularExpressions;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public static class OutputParser
{
    // Marker distinguishing our --progress-template line from yt-dlp's other output.
    public const string ProgressPrefix = "@PROG";

    // Fields requested from --progress-template, in emission order. Raw numbers
    // rather than yt-dlp's human-readable "1.23MiB/s", so the UI formats them
    // itself and never parses units or locale text.
    public static readonly string[] ProgressFields =
    [
        "downloaded_bytes", "total_bytes", "total_bytes_estimate",
        "speed", "eta", "fragment_index", "fragment_count",
    ];

    // yt-dlp renders an unset field as the literal "NA".
    private static double? ParseNumberField(string? raw) =>
        string.IsNullOrEmpty(raw) || raw == "NA"
            ? null
            : double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
              && double.IsFinite(v)
                ? v
                : null;

    private static readonly Regex HumanProgress =
        new(@"\[download\]\s+([\d.]+)%", RegexOptions.CultureInvariant);

    public static ProgressLine? ParseProgress(string line)
    {
        if (line.StartsWith(ProgressPrefix, StringComparison.Ordinal))
        {
            var parts = line[ProgressPrefix.Length..]
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            string? At(int i) => i < parts.Length ? parts[i] : null;

            var downloaded = ParseNumberField(At(0));
            // Fragmented (DASH/HLS) downloads only know an estimate.
            var total = ParseNumberField(At(1)) ?? ParseNumberField(At(2));

            var percent = downloaded != null && total != null && total.Value > 0
                ? Math.Min(100, Math.Round(downloaded.Value / total.Value * 1000) / 10)
                : 0;

            return new ProgressLine(
                percent,
                (long?)downloaded,
                (long?)total,
                ParseNumberField(At(3)),
                ParseNumberField(At(4)),
                (int?)ParseNumberField(At(5)),
                (int?)ParseNumberField(At(6)));
        }

        var match = HumanProgress.Match(line);
        return match.Success
            ? new ProgressLine(double.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture))
            : null;
    }

    // Which yt-dlp stage a line came from. The ffmpeg-backed postprocessors print
    // one line when they start and nothing until they finish, so this label is the
    // only signal that a stalled-looking bar is actually still working.
    private static readonly (Regex Pattern, DownloadPhase Phase, string Label)[] PhaseRules =
    [
        (new(@"^\[download\] Destination:"), DownloadPhase.Downloading, "Downloading"),
        (new(@"^\[Merger\]"), DownloadPhase.Merging, "Merging video and audio"),
        (new(@"^\[(ExtractAudio|VideoConvertor|VideoRemuxer)\]"), DownloadPhase.Converting, "Converting with ffmpeg"),
        // yt-dlp's FixupM4a/FixupStretched/... postprocessors, also ffmpeg-backed.
        (new(@"^\[Fixup\w*\]"), DownloadPhase.Converting, "Repairing container"),
        (new(@"^\[(Metadata|EmbedThumbnail|ThumbnailsConvertor|EmbedSubtitle)\]"), DownloadPhase.Embedding, "Embedding metadata and cover art"),
        (new(@"^\[MoveFiles\]|^Deleting original file"), DownloadPhase.Finishing, "Finishing up"),
        (new(@"^\[(info|generic|youtube(:\w+)?)\]"), DownloadPhase.Extracting, "Reading video page"),
    ];

    public static PhaseLine? ParsePhase(string line)
    {
        foreach (var (pattern, phase, label) in PhaseRules)
            if (pattern.IsMatch(line))
                return new PhaseLine(phase, label);
        return null;
    }

    private static readonly Regex DownloadDest =
        new(@"\[download\] Destination: (.+)$", RegexOptions.CultureInvariant);

    private static readonly Regex MergerDest =
        new(@"\[Merger\] Merging formats into ""(.+)""$", RegexOptions.CultureInvariant);

    public static string? ParseDestination(string line)
    {
        var download = DownloadDest.Match(line);
        if (download.Success) return download.Groups[1].Value.Trim();
        var merger = MergerDest.Match(line);
        return merger.Success ? merger.Groups[1].Value.Trim() : null;
    }

    private static readonly Regex ThumbnailWrite =
        new(@"^\[info\]\s+Writing\s+\w+\s+thumbnail(?:\s+\S+)?\s+to:\s*(.+)$", RegexOptions.CultureInvariant);

    // yt-dlp downloads cover art to a sibling file and deletes it once the embed
    // postprocessor runs. A failed or cancelled download never reaches that step,
    // orphaning the image next to the media.
    public static string? ParseThumbnailPath(string line)
    {
        var match = ThumbnailWrite.Match(line);
        return match.Success ? match.Groups[1].Value.Trim() : null;
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~OutputParserTests"`
Expected: 0 failed

### Task 8: yt-dlp JSON parsing and argument building (part of `lib/ytdlp.ts`, ~18 test cases)

**Files:**
- Create: `desktop/MediaDetector.Core/Ytdlp/JsonParser.cs`
- Create: `desktop/MediaDetector.Core/Ytdlp/FormatArgs.cs`
- Test: `desktop/MediaDetector.Core.Tests/Ytdlp/JsonParserTests.cs`
- Test: `desktop/MediaDetector.Core.Tests/Ytdlp/FormatArgsTests.cs`

- [ ] **Step 1: Write the failing tests**

`FormatArgsTests.cs` -- the load-bearing selector logic. Getting `M4A_SOURCE` wrong costs 27 seconds of silent transcoding per track:

```csharp
using MediaDetector.Core.Models;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class FormatArgsTests
{
    private static string Selector(string[] args) => args[Array.IndexOf(args, "-f") + 1];

    // YouTube's plain bestaudio is opus-in-webm, so -x --audio-format m4a without
    // a selector transcodes every track. Asking for an AAC source makes it a
    // lossless remux instead.
    [Fact]
    public void Audio_M4a_AsksForAacSourceSoExtractionIsARemux()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.M4a), hasFfmpeg: true);
        Assert.StartsWith("bestaudio[ext=m4a]", Selector(args));
        Assert.Contains("-x", args);
        Assert.Equal("m4a", ext);
    }

    // Bare bestaudio[ext=m4a] selects the 5.1 surround track where one exists
    // (format 258 at 388kbps vs 140's 129kbps), tripling the bytes.
    [Fact]
    public void Audio_M4a_ConstrainsToStereo()
    {
        var (args, _) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.M4a), hasFfmpeg: true);
        Assert.Contains("[audio_channels<=2]", Selector(args));
    }

    // Without ffmpeg there is no postprocessing at all.
    [Fact]
    public void Audio_M4a_WithoutFfmpeg_DoesNotRequestExtraction()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.M4a), hasFfmpeg: false);
        Assert.DoesNotContain("-x", args);
        Assert.Equal("m4a", ext);
    }

    // mp3 re-encodes whatever it starts from; starting from AAC avoids a needless
    // extra generation loss.
    [Fact]
    public void Audio_Mp3_StartsFromTheAacSource()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.Mp3), hasFfmpeg: true);
        Assert.StartsWith("bestaudio[ext=m4a]", Selector(args));
        Assert.Equal("mp3", ext);
    }

    // Native audio, no conversion. Typically opus-in-webm -> report webm so no
    // thumbnail is requested (webm cannot embed one -> no stray .webp).
    [Fact]
    public void Audio_Best_ReportsWebmSoNoThumbnailIsRequested()
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Audio, PlaylistAudioFormat.Best), hasFfmpeg: true);
        Assert.Equal("bestaudio/best", Selector(args));
        Assert.Equal("webm", ext);
        Assert.DoesNotContain("--embed-thumbnail", FormatArgs.Metadata(hasFfmpeg: true, ext));
    }

    [Theory]
    [InlineData(PlaylistVideoQuality.Q1080, "[height<=1080]")]
    [InlineData(PlaylistVideoQuality.Q720, "[height<=720]")]
    public void Video_CapsHeight(PlaylistVideoQuality quality, string cap)
    {
        var (args, ext) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Video, VideoQuality: quality), hasFfmpeg: true);
        Assert.Contains(cap, Selector(args));
        Assert.Contains("--merge-output-format", args);
        Assert.Equal("mp4", ext);
    }

    [Fact]
    public void Video_Best_HasNoHeightCap()
    {
        var (args, _) = FormatArgs.ForPlaylist(
            new PlaylistFormatSelection(PlaylistMode.Video, VideoQuality: PlaylistVideoQuality.Best), hasFfmpeg: true);
        Assert.DoesNotContain("height<=", Selector(args));
    }

    // Metadata/cover art/chapters all require ffmpeg; without it the download must
    // still succeed, just untagged.
    [Fact]
    public void Metadata_EmptyWithoutFfmpeg()
        => Assert.Empty(FormatArgs.Metadata(hasFfmpeg: false, "m4a"));

    [Fact]
    public void Metadata_EmbedsTextAndChaptersForAnyContainer()
    {
        var args = FormatArgs.Metadata(hasFfmpeg: true, "webm");
        Assert.Contains("--embed-metadata", args);
        Assert.Contains("--embed-chapters", args);
        // webm cannot hold a thumbnail -- passing it makes yt-dlp error in postprocessing.
        Assert.DoesNotContain("--embed-thumbnail", args);
    }

    [Theory]
    [InlineData("m4a")]
    [InlineData("mp4")]
    [InlineData("mp3")]
    public void Metadata_EmbedsThumbnailForCapableContainers(string ext)
        => Assert.Contains("--embed-thumbnail", FormatArgs.Metadata(hasFfmpeg: true, ext));

    // Omitting ext means "unknown container" -> request the thumbnail.
    [Fact]
    public void Metadata_EmbedsThumbnailWhenExtUnknown()
        => Assert.Contains("--embed-thumbnail", FormatArgs.Metadata(hasFfmpeg: true, null));

    [Theory]
    [InlineData("Normal Name", "Normal Name")]
    [InlineData("a/b:c*d?e", "a_b_c_d_e")]
    [InlineData("trailing dots...", "trailing dots")]
    [InlineData("   ", "Playlist")]
    public void SanitizeFolderName_StripsIllegalCharacters(string input, string expected)
        => Assert.Equal(expected, FormatArgs.SanitizeFolderName(input));
}
```

`JsonParserTests.cs`:

```csharp
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class JsonParserTests
{
    [Fact]
    public void ParseMediaInfo_SplitsVideoAndAudioFormats()
    {
        const string json = """
        {
          "title": "Song", "uploader": "Chan", "duration": 200, "thumbnail": "t.jpg",
          "view_count": 10, "artist": "A", "track": "T",
          "formats": [
            {"format_id":"137","ext":"mp4","width":1920,"height":1080,"fps":30,"vcodec":"avc1","acodec":"none","filesize":100},
            {"format_id":"140","ext":"m4a","width":null,"height":null,"fps":null,"vcodec":"none","acodec":"mp4a","abr":129,"filesize":50}
          ]
        }
        """;
        var info = JsonParser.ParseMediaInfo(json);
        Assert.Equal("Song", info.Title);
        Assert.Equal("Chan", info.Channel);
        Assert.Equal("137", Assert.Single(info.VideoFormats).FormatId);
        Assert.Equal("140", Assert.Single(info.AudioFormats).FormatId);
    }

    [Fact]
    public void ParseMediaInfo_SortsVideoByHeightDescendingAndAudioByBitrate()
    {
        const string json = """
        {"title":"x","formats":[
          {"format_id":"lo","ext":"mp4","width":1280,"height":720,"vcodec":"avc1","acodec":"none"},
          {"format_id":"hi","ext":"mp4","width":1920,"height":1080,"vcodec":"avc1","acodec":"none"},
          {"format_id":"a48","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":48},
          {"format_id":"a129","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":129}
        ]}
        """;
        var info = JsonParser.ParseMediaInfo(json);
        Assert.Equal(["hi", "lo"], info.VideoFormats.Select(f => f.FormatId));
        Assert.Equal(["a129", "a48"], info.AudioFormats.Select(f => f.FormatId));
    }

    [Fact]
    public void ParseMediaInfo_DefaultsMissingFields()
    {
        var info = JsonParser.ParseMediaInfo("""{"formats":[]}""");
        Assert.Equal("Unknown", info.Title);
        Assert.Equal("Unknown", info.Channel);
        Assert.Null(info.Artist);
    }

    [Fact]
    public void ParsePlaylistEntries_KeepsIdsAndDropsNullEntries()
    {
        const string json = """
        {"title":"My List","entries":[
          {"id":"a","title":"One","uploader":"Chan"},
          null,
          {"id":"b","title":"Two"}
        ]}
        """;
        var (title, entries) = JsonParser.ParsePlaylistEntries(json);
        Assert.Equal("My List", title);
        Assert.Equal(["a", "b"], entries.Select(e => e.Id));
        Assert.Equal("Chan", entries[0].Author);
        Assert.Null(entries[1].Author);
    }

    [Fact]
    public void ParsePlaylistInfo_NumbersTracksFromOne()
    {
        const string json = """{"title":"L","entries":[{"title":"One"},{"title":"Two"}]}""";
        var info = JsonParser.ParsePlaylistInfo(json);
        Assert.Equal(2, info.Count);
        Assert.Equal([1, 2], info.Tracks.Select(t => t.Index));
    }

    [Fact]
    public void ParsePlaylistInfo_FallsBackToPlaceholderTitles()
    {
        var info = JsonParser.ParsePlaylistInfo("""{"entries":[{}]}""");
        Assert.Equal("Playlist", info.Title);
        Assert.Equal("Track 1", info.Tracks[0].Title);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~Ytdlp"`
Expected: FAIL (JsonParser and FormatArgs do not exist)

- [ ] **Step 3: Write the implementation**

`Ytdlp/FormatArgs.cs`:

```csharp
using System.Text.RegularExpressions;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public static class FormatArgs
{
    // Always pick the source that needs the least conversion. YouTube's plain
    // `bestaudio` is opus-in-webm, so asking for m4a without a selector made
    // ffmpeg transcode every track: measured at 27s vs 0.4s for a 37-minute file,
    // with no output while it ran, which looked exactly like a hang.
    // The stereo clause matters too: plain bestaudio[ext=m4a] picks the 5.1
    // surround AAC track where one exists (format 258, 388kbps vs 140's 129kbps).
    private const string M4aSource =
        "bestaudio[ext=m4a][audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best";

    // Containers yt-dlp can embed a cover-art thumbnail into. Notably NOT webm --
    // passing --embed-thumbnail for webm output makes yt-dlp error in postprocessing.
    private static readonly HashSet<string> ThumbnailExts =
        new(["mp3", "mkv", "mka", "ogg", "opus", "flac", "m4a", "mp4", "m4v", "mov"],
            StringComparer.OrdinalIgnoreCase);

    public static (string[] Args, string ExpectedExt) ForPlaylist(
        PlaylistFormatSelection sel, bool hasFfmpeg)
    {
        if (sel.Mode == PlaylistMode.Video)
        {
            // Prefer mp4 (h264+aac) so every file is a consistent, embeddable .mp4.
            var cap = sel.VideoQuality switch
            {
                PlaylistVideoQuality.Q1080 => "[height<=1080]",
                PlaylistVideoQuality.Q720 => "[height<=720]",
                _ => "",
            };
            var selector = cap.Length == 0
                ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
                : $"bestvideo{cap}[ext=mp4]+bestaudio[ext=m4a]/best{cap}[ext=mp4]/best{cap}";
            return (["-f", selector, "--merge-output-format", "mp4"], "mp4");
        }

        return sel.AudioFormat switch
        {
            // mp3 is a re-encode whatever the source; starting from AAC is no slower
            // than from opus and avoids a needless second generation loss.
            PlaylistAudioFormat.Mp3 =>
                (["-f", M4aSource, "-x", "--audio-format", "mp3"], "mp3"),

            // Native audio, no conversion. Typically opus-in-webm -> report webm so
            // no thumbnail is requested.
            PlaylistAudioFormat.Best =>
                (["-f", "bestaudio/best"], "webm"),

            // m4a: prefer an AAC source so --audio-format m4a is a lossless remux.
            _ when hasFfmpeg =>
                (["-f", M4aSource, "-x", "--audio-format", "m4a"], "m4a"),

            _ => (["-f", M4aSource], "m4a"),
        };
    }

    // yt-dlp postprocessors that embed metadata/cover art/chapters all require
    // ffmpeg. Returns [] when ffmpeg is absent so the download still succeeds.
    // Text metadata + chapters embed into any container; the thumbnail is gated on
    // `ext` (pass null for "unknown container").
    public static string[] Metadata(bool hasFfmpeg, string? ext)
    {
        if (!hasFfmpeg) return [];
        var args = new List<string> { "--embed-metadata", "--embed-chapters" };
        if (ext == null || ThumbnailExts.Contains(ext)) args.Add("--embed-thumbnail");
        return [.. args];
    }

    private static readonly Regex IllegalFolderChars =
        new(@"[\\/:*?""<>|\x00-\x1f]", RegexOptions.CultureInvariant);

    // Single-video downloads do not populate %(playlist_title)s, so the folder name
    // is injected into the path literally and must be sanitised here.
    public static string SanitizeFolderName(string name)
    {
        var cleaned = IllegalFolderChars.Replace(name, "_").Trim();
        cleaned = Regex.Replace(cleaned, @"[. ]+$", "");
        return cleaned.Length != 0 ? cleaned : "Playlist";
    }
}
```

`Ytdlp/JsonParser.cs` uses `System.Text.Json` with `JsonElement` rather than typed deserialisation, because yt-dlp's format objects are heterogeneous and half the fields are absent or null per entry:

```csharp
using System.Text.Json;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public static class JsonParser
{
    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    public static MediaInfo ParseMediaInfo(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var formats = root.TryGetProperty("formats", out var f) && f.ValueKind == JsonValueKind.Array
            ? f.EnumerateArray().ToArray()
            : [];

        // Explicit comparisons rather than relational/property patterns, per
        // rules/common/coding-style.md.
        static bool HasSize(JsonElement x, string name)
        {
            var value = Num(x, name);
            return value != null && value.Value > 0;
        }

        var video = formats
            .Where(x => HasSize(x, "width") && HasSize(x, "height")
                        && !string.IsNullOrEmpty(Str(x, "vcodec"))
                        && Str(x, "vcodec") != "none")
            .Select(x => new VideoFormat(
                Str(x, "format_id") ?? "",
                Str(x, "ext") ?? "",
                (int)Num(x, "width")!.Value,
                (int)Num(x, "height")!.Value,
                Num(x, "fps"),
                Str(x, "vcodec")!,
                (long?)Num(x, "filesize")))
            .OrderByDescending(x => x.Height)
            .ToArray();

        var audio = formats
            // OR, not AND. lib/ytdlp.ts:273 is `(!f.width || !f.height) && ...`,
            // so a format reporting one dimension but not the other still counts
            // as audio. An AND here would classify it as neither.
            .Where(x => (!HasSize(x, "width") || !HasSize(x, "height"))
                        && !string.IsNullOrEmpty(Str(x, "acodec"))
                        && Str(x, "acodec") != "none"
                        && Str(x, "vcodec") == "none")
            .Select(x => new AudioFormat(
                Str(x, "format_id") ?? "",
                Str(x, "ext") ?? "",
                Num(x, "abr"),
                Str(x, "acodec")!,
                (long?)Num(x, "filesize")))
            .OrderByDescending(x => x.Abr ?? 0)
            .ToArray();

        return new MediaInfo(
            Str(root, "title") ?? "Unknown",
            Str(root, "uploader") ?? Str(root, "channel") ?? "Unknown",
            Num(root, "duration") ?? 0,
            Str(root, "thumbnail") ?? "",
            (long?)Num(root, "view_count"),
            Str(root, "artist"),
            Str(root, "track"),
            video,
            audio);
    }

    private static JsonElement[] Entries(JsonElement root) =>
        root.TryGetProperty("entries", out var e) && e.ValueKind == JsonValueKind.Array
            ? e.EnumerateArray().ToArray()
            : [];

    public static PlaylistInfo ParsePlaylistInfo(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var tracks = Entries(root)
            .Select((e, i) => new PlaylistTrack(
                i + 1,
                e.ValueKind == JsonValueKind.Object ? Str(e, "title") ?? $"Track {i + 1}" : $"Track {i + 1}",
                e.ValueKind == JsonValueKind.Object ? Str(e, "uploader") ?? Str(e, "channel") : null))
            .ToArray();
        return new PlaylistInfo(Str(root, "title") ?? "Playlist", tracks.Length, tracks);
    }

    // Sibling of ParsePlaylistInfo; also keeps the id so tracks can be downloaded
    // one at a time (which is what makes per-track retry possible).
    public static (string Title, IReadOnlyList<PlaylistEntry> Entries) ParsePlaylistEntries(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var entries = Entries(root)
            .Where(e => e.ValueKind == JsonValueKind.Object && Str(e, "id") is not null)
            .Select((e, i) => new PlaylistEntry(
                Str(e, "id")!,
                Str(e, "title") ?? $"Track {i + 1}",
                Str(e, "uploader") ?? Str(e, "channel")))
            .ToArray();
        return (Str(root, "title") ?? "Playlist", entries);
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~Ytdlp"`
Expected: 0 failed

**Phase 1 gate** -- three checkable statements, not an approximate total:

1. `dotnet test desktop/MediaDetector.Core.Tests` reports **zero failures**.
2. `FileNamingTests` covers all 46 `it()` blocks from `lib/__tests__/filename.test.ts` (verify with `grep -c "  it(" lib/__tests__/filename.test.ts`).
3. No **Phase 1** test starts a process. Verify: `grep -rn "Process\|ProcessRunner\|LineStream" desktop/MediaDetector.Core.Tests/{Naming,Validation,Formatting,Formats,Ytdlp}` returns nothing. This applies to Phase 1's directories only -- Phase 2 adds `Processes/`, whose tests spawn deliberately, so do not re-run this grep tree-wide afterwards.

---

## Phase 2: Process layer

The subsystem where C# is materially better than the original. Three things the TypeScript worked around disappear here: `taskkill /T /F` becomes a Job Object, the dual-source `AbortController` becomes one `CancellationToken`, and the hand-rolled buffer-plus-notify generator becomes a `Channel<T>`.

### Task 9: Process tree termination via Job Objects

Replaces `killProcessTree` in `lib/ytdlp.ts:501`. The TS version shells out to `taskkill /pid N /T /F` because `proc.kill()` reaps only the direct child, orphaning the ffmpeg that yt-dlp spawned. A Job Object makes orphans structurally impossible instead: every process the child starts is inside the job, and closing the job handle kills the whole tree at the OS level.

**Files:**
- Create: `desktop/MediaDetector.Core/Processes/JobObject.cs`
- Test: `desktop/MediaDetector.Core.Tests/Processes/JobObjectTests.cs`

- [ ] **Step 1: Write the failing test**

This one genuinely spawns, because a fake cannot prove a grandchild died. It uses `cmd.exe` to start a nested `ping` so there is a real tree.

```csharp
using System.Diagnostics;
using MediaDetector.Core.Processes;

namespace MediaDetector.Core.Tests.Processes;

public class JobObjectTests
{
    [Fact]
    public void DisposingTheJob_KillsTheWholeTree()
    {
        var job = new JobObject();
        // cmd starts ping as a grandchild; proc.Kill() alone would orphan it.
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

        // Give cmd a moment to spawn its child.
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
        var psi = new ProcessStartInfo("cmd.exe", "/c ping -n 10 127.0.0.1 > nul")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi)!;
        // The return value is the orphan-kill guarantee; ignoring it would make a
        // failed assignment indistinguishable from success.
        Assert.True(job.Assign(proc));
    }

    [Fact]
    public void Assign_OnAlreadyExitedProcess_DoesNotThrow()
    {
        using var job = new JobObject();
        var psi = new ProcessStartInfo("cmd.exe", "/c exit 0")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi)!;
        proc.WaitForExit();
        var ex = Record.Exception(() => job.Assign(proc));
        Assert.Null(ex);
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        var job = new JobObject();
        job.Dispose();
        var ex = Record.Exception(job.Dispose);
        Assert.Null(ex);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~JobObjectTests"`
Expected: FAIL (JobObject does not exist)

- [ ] **Step 3: Write the implementation**

`LibraryImport` (source-generated P/Invoke) rather than `DllImport`, which is the current .NET guidance and avoids a marshalling stub at runtime. It **requires `<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`** (set in `Directory.Build.props`, Task 1); without it the generator emits `SYSLIB1062` plus five `CS0227` and Core does not build. `[SupportedOSPlatform("windows")]` marks the type Windows-only for the platform-compatibility analyser.

```csharp
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace MediaDetector.Core.Processes;

// Kills a spawned download and everything it started. yt-dlp runs ffmpeg as a
// child; Process.Kill() reaps only the direct child and would leave the encoder
// running and holding the output file open. Every process assigned to this job
// dies when the job handle closes, so an orphan is impossible by construction.
[SupportedOSPlatform("windows")]
public sealed partial class JobObject : IDisposable
{
    // Name differs from the struct below on purpose: sharing the identifier
    // between a const and a nested type is CS0102.
    private const int JobObjectInfoClassExtendedLimit = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;

    private nint _handle;
    private bool _disposed;

    public JobObject()
    {
        _handle = CreateJobObjectW(0, null);
        if (_handle == 0)
            throw new InvalidOperationException(
                $"CreateJobObject failed: {Marshal.GetLastPInvokeError()}");

        var info = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation
            {
                LimitFlags = JobObjectLimitKillOnJobClose,
            },
        };

        var size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        var ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(_handle, JobObjectInfoClassExtendedLimit, ptr, (uint)size))
                throw new InvalidOperationException(
                    $"SetInformationJobObject failed: {Marshal.GetLastPInvokeError()}");
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    // Set when AssignProcessToJobObject failed, so Terminate knows the tree is
    // NOT inside the job and must be killed the old way.
    private int _unassignedPid;

    // Assign immediately after Process.Start, before the child has time to spawn
    // its own children -- anything it starts afterwards inherits the job.
    //
    // Process.Start -> Assign is NOT atomic: a grandchild spawned inside that
    // window escapes the job. The window is microseconds and yt-dlp does not
    // spawn ffmpeg until well into the run, so this is accepted rather than
    // solved (solving it needs CreateProcess with CREATE_SUSPENDED, which
    // System.Diagnostics.Process does not expose).
    //
    // Returns false when the process could not be assigned. Callers must not
    // ignore this: an unassigned process survives Dispose, which is exactly the
    // orphaned-ffmpeg failure the Job Object exists to prevent, and it would
    // otherwise be indistinguishable from success.
    public bool Assign(Process process)
    {
        if (_disposed || _handle == 0) return false;
        try
        {
            if (process.HasExited) return true;
            if (AssignProcessToJobObject(_handle, process.Handle)) return true;
            _unassignedPid = process.Id;
            return false;
        }
        catch (InvalidOperationException)
        {
            // Process exited between the check and the call; nothing to assign.
            return true;
        }
    }

    // Kills every process in the job without waiting for the handle to close.
    public void Terminate()
    {
        if (_disposed || _handle == 0) return;
        TerminateJobObject(_handle, 1);

        // Fallback for a process the job never accepted: taskkill /T walks the
        // tree by parent pid, which is the mechanism lib/ytdlp.ts:505 uses today.
        if (_unassignedPid != 0)
        {
            try
            {
                using var killer = Process.Start(new ProcessStartInfo("taskkill")
                {
                    ArgumentList = { "/pid", _unassignedPid.ToString(), "/T", "/F" },
                    UseShellExecute = false,
                    CreateNoWindow = true,
                });
                killer?.WaitForExit(3000);
            }
            catch
            {
                // Nothing further we can do; the process may already be gone.
            }
            _unassignedPid = 0;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        // Anything the job never accepted would survive CloseHandle, so kill it
        // explicitly first.
        if (_unassignedPid != 0) Terminate();
        _disposed = true;
        if (_handle != 0)
        {
            // KILL_ON_JOB_CLOSE means closing the last handle kills the tree.
            CloseHandle(_handle);
            _handle = 0;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [LibraryImport("kernel32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint CreateJobObjectW(nint securityAttributes, string? name);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetInformationJobObject(
        nint job, int infoClass, nint info, uint infoLength);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AssignProcessToJobObject(nint job, nint process);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool TerminateJobObject(nint job, uint exitCode);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(nint handle);
}
```

Verified end to end: with `AllowUnsafeBlocks=true` this exact P/Invoke shape compiles and `CreateJobObjectW`/`SetInformationJobObject` return a live handle.

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~JobObjectTests"`
Expected: 0 failed. Verify manually in Task Manager that no stray `PING.EXE` remains.

### Task 10: One-shot process execution

Replaces `execArgs` and `execCommand` in `lib/ytdlp.ts:20-50`. The security distinction from CLAUDE.md is preserved and made structural: `RunAsync(string[] args)` never touches a shell, `RunShellAsync(string command)` is documented as internal-commands-only.

**Files:**
- Create: `desktop/MediaDetector.Core/Processes/ProcessRunner.cs`
- Test: `desktop/MediaDetector.Core.Tests/Processes/ProcessRunnerTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Processes;

namespace MediaDetector.Core.Tests.Processes;

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
    {
        var result = await ProcessRunner.RunAsync(["cmd.exe", "/c", "exit 3"]);
        Assert.Equal(3, result.ExitCode);
    }

    // A missing executable must be a result, not an exception -- the TS version
    // resolved with code 1 and the error text in stderr.
    [Fact]
    public async Task RunAsync_MissingExecutableReturnsFailureNotThrow()
    {
        var result = await ProcessRunner.RunAsync(["definitely-not-a-real-exe-xyz"]);
        Assert.NotEqual(0, result.ExitCode);
        Assert.NotEmpty(result.Stderr);
    }

    // Arguments reach the target process verbatim because no shell parses them.
    //
    // This must NOT be tested through cmd.exe. ArgumentList only quotes arguments
    // containing space, tab or quote, so ["cmd.exe","/c","echo","a&whoami"]
    // produces the literal command line `cmd.exe /c echo a&whoami` and cmd itself
    // executes whoami. An earlier draft of this test asserted the opposite of
    // what actually happens and passed no information at all.
    //
    // The real invariant is "RunAsync introduces no shell", so prove it against a
    // process that is not one.
    [Fact]
    public async Task RunAsync_PassesArgumentsVerbatimToANonShellProcess()
    {
        // Resolved inline rather than via ToolResolver, which Task 13 creates --
        // this test must not depend on a later task. Task 13 re-points it.
        // Assert.SkipWhen is xunit v3 only; on 2.9.3 an early return is the
        // available form, so the test is vacuous (not failing) without Node.
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
            [node, "-e", "console.log(process.argv[1])", "a&whoami"]);
        Assert.Equal(0, result.ExitCode);
        Assert.Equal("a&whoami", result.Stdout);
        Assert.DoesNotContain("\\", result.Stdout);
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
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~ProcessRunnerTests"`
Expected: FAIL (ProcessRunner does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
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
    public static async Task<ExecResult> RunAsync(
        IReadOnlyList<string> args, CancellationToken ct = default)
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

        return await RunCoreAsync(psi, ct);
    }

    // Fixed internal commands only (e.g. "ffmpeg -version"). NEVER pass user input
    // here -- it goes through cmd.exe and is therefore shell-interpreted.
    public static Task<ExecResult> RunShellAsync(string command, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo("cmd.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("/c");
        psi.ArgumentList.Add(command);
        return RunCoreAsync(psi, ct);
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
            return new ExecResult(
                (await stdout).Trim(), (await stderr).Trim(), proc.ExitCode);
        }
        catch (OperationCanceledException)
        {
            job.Terminate();
            // Observe both reads before returning, or they fault unobserved.
            try { await Task.WhenAll(stdout, stderr); }
            catch { /* expected once the process is killed */ }
            return new ExecResult("", "cancelled", 1);
        }
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~ProcessRunnerTests"`
Expected: 0 failed

### Task 11: Merged line streaming

Replaces `streamCommand` in `lib/ytdlp.ts:101`. The TS comment explains the hazard: reading stdout to completion before stderr can deadlock once stderr fills its ~64KB pipe buffer. `Process`'s event-based async reads solve this natively -- both handlers push into one `Channel<string>`, so neither pipe can block the other.

**Files:**
- Create: `desktop/MediaDetector.Core/Processes/LineStream.cs`
- Test: `desktop/MediaDetector.Core.Tests/Processes/LineStreamTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Processes;

namespace MediaDetector.Core.Tests.Processes;

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
    {
        var lines = await Collect(LineStream.StreamAsync(["cmd.exe", "/c", "echo one& echo two"]));
        Assert.Equal(["one", "two"], lines);
    }

    // Merged, not sequential: stderr must not be able to deadlock behind stdout.
    [Fact]
    public async Task StreamAsync_MergesStderrIntoTheSameStream()
    {
        // No space before the redirect: `echo err 1>&2` emits "err " WITH a
        // trailing space, and LineStream deliberately does not trim (neither
        // does streamCommand at lib/ytdlp.ts:112 -- yt-dlp progress parsing
        // depends on the raw text).
        var lines = await Collect(LineStream.StreamAsync(["cmd.exe", "/c", "echo err1>&2"]));
        Assert.Contains("err", lines);
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
    {
        var lines = await Collect(LineStream.StreamAsync(["cmd.exe", "/c", "echo a& echo.& echo b"]));
        Assert.Equal(["a", "b"], lines);
    }

    [Fact]
    public async Task StreamAsync_MissingExecutableYieldsErrorLine()
    {
        var lines = await Collect(LineStream.StreamAsync(["definitely-not-a-real-exe-xyz"]));
        Assert.Single(lines);
        Assert.StartsWith("ERROR:", lines[0]);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~LineStreamTests"`
Expected: FAIL (LineStream does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
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
        // Data, so complete only once BOTH have and the process has exited.
        var streamsFinished = 0;

        void OnData(object _, DataReceivedEventArgs e)
        {
            if (e.Data is null)
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
```

A `LineStreamTests` case pins the tail-line guarantee, since it is the one that fails silently:

```csharp
// Regression: completing the channel on Process.Exited dropped trailing output.
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
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~LineStreamTests"`
Expected: 0 failed

### Task 12: Track runner with hang watchdog

Replaces `runTrack` in `lib/ytdlp.ts:529`. Two things `LineStream` does not do: surface the exit code (the TS generator's *return* value, which is how success is told from failure), and enforce the idle deadline. ffmpeg postprocessing is silent by design -- yt-dlp swallows its output -- so a deadline is the only way to distinguish "still working" from "wedged".

**Files:**
- Create: `desktop/MediaDetector.Core/Processes/TrackRunner.cs`
- Test: `desktop/MediaDetector.Core.Tests/Processes/TrackRunnerTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Processes;

namespace MediaDetector.Core.Tests.Processes;

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
            runner,
            ["cmd.exe", "/c", "ping -n 30 127.0.0.1 > nul"],
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

    // Abandoning the enumerator must not leak a process.
    [Fact]
    public async Task RunAsync_AbandonedEnumeratorStillKillsTheProcess()
    {
        var runner = new TrackRunner();
        await using (var e = runner.RunAsync(
            ["cmd.exe", "/c", "for /L %i in (1,1,999) do @(echo x& ping -n 2 127.0.0.1 > nul)"])
            .GetAsyncEnumerator())
        {
            await e.MoveNextAsync();
        }
        // Disposal terminated the job; the runner reports failure, not success.
        Assert.NotEqual(0, runner.ExitCode);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~TrackRunnerTests"`
Expected: FAIL (TrackRunner does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Text;
using System.Threading.Channels;

namespace MediaDetector.Core.Processes;

// Runs one yt-dlp download, yielding merged stdout+stderr lines. ExitCode is
// valid once enumeration completes and is what tells success from failure.
[SupportedOSPlatform("windows")]
public sealed class TrackRunner
{
    // How long a run may produce no output at all before it is treated as hung.
    // Generous enough for a slow postprocess on a long track, but bounded:
    // without it one wedged track stalls a whole playlist indefinitely.
    public static readonly TimeSpan DefaultIdleTimeout = TimeSpan.FromMinutes(5);

    // Marks the error line a timeout produces. A hang is not a flaky network, so
    // callers use this to stop retrying instead of burning the deadline again.
    public const string HungMarker = "treating the download as hung";

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

        // Fires when the process has been silent for `idle`. Re-armed per line, so
        // the deadline is on silence rather than total runtime.
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
            if (e.Data is null)
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
            {
                yield return
                    $"ERROR: no output for {(int)idle.TotalSeconds}s -- {HungMarker}";
            }
        }
        finally
        {
            // Unsubscribe BEFORE the enclosing `using` disposes idleCts, or a
            // late line calls CancelAfter on a disposed CTS.
            proc.OutputDataReceived -= OnData;
            proc.ErrorDataReceived -= OnData;

            // Kill FIRST, observe second. An earlier draft only terminated on
            // hang/cancel, so an abandoned enumerator fell through to
            // WaitForExit(5000) on a still-running process and blocked five
            // seconds before killing anything.
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

            // A killed process reports a non-zero code anyway, but be explicit:
            // hang and cancel are failures regardless of what Windows reported.
            if (hung || ct.IsCancellationRequested) ExitCode = 1;

            job.Terminate();
        }
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~TrackRunnerTests"`
Expected: 0 failed

### Task 13: yt-dlp argument construction and the Node runtime

Replaces `youtubeAccessArgs`, `ytdlpArgs`, `pipArgs`, `resolvePython`, `progressTemplateArgs` in `lib/ytdlp.ts`. The one real behavioural change in the whole port lives here.

**The change:** `lib/ytdlp.ts:85` passes `node:${process.execPath}`, which worked only because the app was itself a Node process. A C# app has none, so `NodeResolver` finds an installed `node.exe` and the status bar gains a fourth dependency row. Everything CLAUDE.md says about why these flags are load-bearing still applies: without a working JS runtime, every format URL returns 403 and the only artefact left on disk is a stray `.webp`.

**Files:**
- Create: `desktop/MediaDetector.Core/Ytdlp/ToolResolver.cs`
- Create: `desktop/MediaDetector.Core/Ytdlp/YtdlpArgs.cs`
- Test: `desktop/MediaDetector.Core.Tests/Ytdlp/YtdlpArgsTests.cs`

- [ ] **Step 1: Write the failing tests**

`ToolResolver` takes its probe function by injection so the argument tests never touch the real filesystem.

```csharp
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class YtdlpArgsTests
{
    private const string Node = @"C:\Program Files\nodejs\node.exe";

    private static string[] Access() => YtdlpArgs.YouTubeAccess(Node);

    // A JS runtime is mandatory: YouTube gates format URLs behind signature and
    // "n" challenges that yt-dlp can only answer with one.
    [Fact]
    public void YouTubeAccess_PassesTheResolvedNodePath()
    {
        var args = Access();
        Assert.Equal($"node:{Node}", args[Array.IndexOf(args, "--js-runtimes") + 1]);
    }

    // A runtime alone is not enough -- the EJS solver script is a separate
    // download. Without this yt-dlp warns "challenge solver script was skipped"
    // and the URLs 403 anyway.
    [Fact]
    public void YouTubeAccess_RequestsTheRemoteEjsSolver()
        => Assert.Equal("ejs:github", Access()[Array.IndexOf(Access(), "--remote-components") + 1]);

    // yt-dlp's default client (android_vr) currently 403s on every video
    // (yt-dlp#17456); web_embedded needs no PO token and serves the same formats.
    [Fact]
    public void YouTubeAccess_PrefersWebEmbeddedClient()
    {
        var args = Access();
        var extractor = args[Array.IndexOf(args, "--extractor-args") + 1];
        Assert.Equal("youtube:player_client=web_embedded,default", extractor);
    }

    // No JS runtime found: omit the flag rather than pass a broken path, so the
    // failure surfaces as yt-dlp's own error instead of a confusing spawn error.
    [Fact]
    public void YouTubeAccess_OmitsRuntimeFlagWhenNodeIsMissing()
        => Assert.DoesNotContain("--js-runtimes", YtdlpArgs.YouTubeAccess(null));

    // Run as a module: the yt-dlp shim lands in Python's Scripts dir, which a
    // fresh python.org install does not put on PATH.
    [Fact]
    public void Ytdlp_InvokesTheModuleNotTheShim()
    {
        var args = YtdlpArgs.Ytdlp("python", Node, ["--version"]);
        Assert.Equal(["python", "-m", "yt_dlp"], args.Take(3));
        Assert.Equal("--version", args[^1]);
    }

    [Fact]
    public void Ytdlp_PrependsAccessArgsBeforeCallerArgs()
    {
        var args = YtdlpArgs.Ytdlp("python", Node, ["--dump-json", "URL"]);
        Assert.True(Array.IndexOf(args, "--js-runtimes") < Array.IndexOf(args, "--dump-json"));
    }

    // Same reason as yt-dlp: bare `pip` is often not on PATH.
    [Fact]
    public void Pip_InvokesTheModule()
        => Assert.Equal(
            ["python", "-m", "pip", "install", "--upgrade", "yt-dlp", "mutagen"],
            YtdlpArgs.Pip("python", ["install", "--upgrade", "yt-dlp", "mutagen"]));

    // --newline keeps each update on its own line instead of overwriting with \r,
    // which the line reader cannot split.
    [Fact]
    public void ProgressTemplate_RequestsNewlineAndRawNumbers()
    {
        var args = YtdlpArgs.ProgressTemplate();
        Assert.Contains("--newline", args);
        var template = args[Array.IndexOf(args, "--progress-template") + 1];
        Assert.StartsWith("download:@PROG ", template);
        Assert.Contains("%(progress.downloaded_bytes)s", template);
        Assert.Contains("%(progress.fragment_count)s", template);
    }

    // The template must round-trip through the parser written in Task 7.
    [Fact]
    public void ProgressTemplate_FieldOrderMatchesTheParser()
    {
        var template = YtdlpArgs.ProgressTemplate()[^1];
        var expected = string.Join(" ", OutputParser.ProgressFields.Select(f => $"%(progress.{f})s"));
        Assert.Equal($"download:@PROG {expected}", template);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~YtdlpArgsTests"`
Expected: FAIL (YtdlpArgs does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
namespace MediaDetector.Core.Ytdlp;

public static class YtdlpArgs
{
    // Args every YouTube call needs to get a format URL that is not HTTP 403.
    //
    // 1. JS challenges. YouTube's player gates its format URLs behind signature
    //    and "n" challenges that yt-dlp can only answer with an external
    //    JavaScript runtime PLUS the EJS solver script. Miss either and the
    //    download dies with "unable to download video data: HTTP Error 403", and
    //    because --embed-thumbnail writes the cover art first, the only thing a
    //    failed run leaves on disk is a stray .webp.
    //    The Next.js app got the runtime free by handing yt-dlp its own Node
    //    binary (process.execPath). A .NET app has no Node, so the path comes
    //    from NodeResolver and Node is a declared dependency.
    // 2. Player client. yt-dlp's default (android_vr) needs no PO token but its
    //    URLs currently 403 on every video (yt-dlp#17456). web_embedded needs no
    //    token either and serves the same audio-only + DASH formats, so it goes
    //    first; `default` stays behind it for videos that disable embedding.
    public static string[] YouTubeAccess(string? nodeExePath)
    {
        var args = new List<string>();
        if (!string.IsNullOrEmpty(nodeExePath))
        {
            args.Add("--js-runtimes");
            args.Add($"node:{nodeExePath}");
        }
        args.Add("--remote-components");
        args.Add("ejs:github");
        args.Add("--extractor-args");
        args.Add("youtube:player_client=web_embedded,default");
        return [.. args];
    }

    // yt-dlp installs a `yt-dlp` shim into Python's Scripts dir, which a fresh
    // python.org install does not add to PATH. Run it as a module instead.
    public static string[] Ytdlp(string python, string? nodeExePath, IReadOnlyList<string> args) =>
        [python, "-m", "yt_dlp", .. YouTubeAccess(nodeExePath), .. args];

    // A fresh python.org install has `python` on PATH but often no bare `pip`.
    public static string[] Pip(string python, IReadOnlyList<string> args) =>
        [python, "-m", "pip", .. args];

    // --progress-template replaces yt-dlp's "[download] 42.3% of 3.29MiB at
    // 1.23MiB/s" with raw numbers, so nothing has to parse units or locale text.
    public static string[] ProgressTemplate()
    {
        var template = string.Join(" ",
            OutputParser.ProgressFields.Select(f => $"%(progress.{f})s"));
        return ["--newline", "--progress-template",
                $"download:{OutputParser.ProgressPrefix} {template}"];
    }
}
```

`Ytdlp/ToolResolver.cs` -- the ffmpeg probe ports from `lib/ytdlp.ts:313-364`, with `process.cwd()` corrected to `AppContext.BaseDirectory`; the Node probe is new:

```csharp
using System.Runtime.Versioning;

namespace MediaDetector.Core.Ytdlp;

[SupportedOSPlatform("windows")]
public static class ToolResolver
{
    // Pure and testable: which of these dirs holds the executable.
    public static string? FirstDirWith(IEnumerable<string> dirs, string exeName) =>
        dirs.FirstOrDefault(d => File.Exists(Path.Combine(d, exeName)));

    // winget installs the Gyan.FFmpeg archive package under
    // Packages/<pkg>/<ffmpeg-ver>/bin/ (nested, versioned) with no Links shim or
    // PATH entry, so that bin dir has to be discovered.
    private static IEnumerable<string> WingetFfmpegBinDirs()
    {
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (string.IsNullOrEmpty(local)) yield break;
        var root = Path.Combine(local, "Microsoft", "WinGet", "Packages");
        if (!Directory.Exists(root)) yield break;

        foreach (var pkg in Directory.EnumerateDirectories(root))
        {
            if (!Path.GetFileName(pkg).Contains("ffmpeg", StringComparison.OrdinalIgnoreCase))
                continue;
            foreach (var sub in Directory.EnumerateDirectories(pkg))
                yield return Path.Combine(sub, "bin");
        }
    }

    // Priority order: app-local bin/, winget's shim dir, Chocolatey's shim dir,
    // then winget's extracted package dirs. Checking these lets a fresh install be
    // picked up without restarting the app, whose PATH snapshot is already stale.
    // NOTE: AppContext.BaseDirectory, not the working directory -- the TypeScript
    // used process.cwd(), which breaks once the app is published.
    public static IEnumerable<string> FfmpegDirCandidates()
    {
        yield return Path.Combine(AppContext.BaseDirectory, "bin");

        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(local))
            yield return Path.Combine(local, "Microsoft", "WinGet", "Links");

        yield return @"C:\ProgramData\chocolatey\bin";

        foreach (var dir in WingetFfmpegBinDirs()) yield return dir;
    }

    public static string? ResolveFfmpegDir() => FirstDirWith(FfmpegDirCandidates(), "ffmpeg.exe");

    // Point yt-dlp at the resolved dir when found; [] otherwise (falls back to PATH).
    public static string[] FfmpegLocationArgs()
    {
        var dir = ResolveFfmpegDir();
        return dir == null ? [] : ["--ffmpeg-location", dir];
    }

    // yt-dlp needs an absolute path for --js-runtimes, so PATH lookup is not
    // enough. winget installs Node to Program Files\nodejs.
    public static IEnumerable<string> NodeDirCandidates()
    {
        var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in pathVar.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            yield return dir;

        yield return @"C:\Program Files\nodejs";
        yield return @"C:\Program Files (x86)\nodejs";

        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(local))
            yield return Path.Combine(local, "Programs", "nodejs");
    }

    public static string? ResolveNodeExe()
    {
        var dir = FirstDirWith(NodeDirCandidates(), "node.exe");
        return dir == null ? null : Path.Combine(dir, "node.exe");
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~YtdlpArgsTests"`
Expected: 0 failed

Add a `ToolResolverTests` covering `FirstDirWith` against a temp directory (found / not found / empty list), which is the only part worth unit-testing; the candidate lists are environment-dependent and are covered by the Task 16 integration check instead.

### Task 14: Download line translation

Replaces `translateDownloadLines` in `lib/ytdlp.ts:609`. Same design point as the original: the source sequence is injected, so this is fully unit-testable without spawning anything.

**Files:**
- Create: `desktop/MediaDetector.Core/Ytdlp/DownloadTranslator.cs`
- Test: `desktop/MediaDetector.Core.Tests/Ytdlp/DownloadTranslatorTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Models;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Tests.Ytdlp;

public class DownloadTranslatorTests
{
    private static async IAsyncEnumerable<string> Lines(params string[] lines)
    {
        foreach (var line in lines) { await Task.Yield(); yield return line; }
    }

    private static async Task<(List<DownloadLine> Out, DownloadRunResult Result)> Run(
        int exitCode, params string[] lines)
    {
        var translator = new DownloadTranslator();
        var emitted = new List<DownloadLine>();
        await foreach (var line in translator.TranslateAsync(Lines(lines), () => exitCode))
            emitted.Add(line);
        return (emitted, translator.Result);
    }

    [Fact]
    public async Task Translate_EmitsProgressPerTemplateLine()
    {
        var (emitted, _) = await Run(0, "@PROG 500 1000 NA NA NA NA NA", "@PROG 750 1000 NA NA NA NA NA");
        Assert.Equal(2, emitted.OfType<ProgressLine>().Count());
    }

    // A phase line is emitted only when the stage CHANGES, never repeated.
    [Fact]
    public async Task Translate_EmitsPhaseOnlyOnChange()
    {
        var (emitted, _) = await Run(0,
            "[download] Destination: a.m4a",
            "@PROG 1 2 NA NA NA NA NA",
            "[download] Destination: a.m4a",
            "[EmbedThumbnail] mp4");
        var phases = emitted.OfType<PhaseLine>().Select(p => p.Phase).ToArray();
        Assert.Equal([DownloadPhase.Downloading, DownloadPhase.Embedding], phases);
    }

    [Fact]
    public async Task Translate_CapturesSavedPathFromDestination()
    {
        var (_, result) = await Run(0, @"[download] Destination: C:\out\a.m4a");
        Assert.Equal(@"C:\out\a.m4a", result.SavedPath);
    }

    // The Merger line wins, because merging is what produces the final file.
    [Fact]
    public async Task Translate_LaterDestinationOverridesEarlier()
    {
        var (_, result) = await Run(0,
            @"[download] Destination: C:\out\a.f137.mp4",
            @"[Merger] Merging formats into ""C:\out\a.mp4""");
        Assert.Equal(@"C:\out\a.mp4", result.SavedPath);
    }

    [Fact]
    public async Task Translate_CollectsErrorText()
    {
        var (_, result) = await Run(1, "ERROR: unable to download video data: HTTP Error 403");
        Assert.Contains("403", result.ErrorMessage);
        Assert.DoesNotContain("ERROR:", result.ErrorMessage);
    }

    [Fact]
    public async Task Translate_JoinsMultipleErrors()
    {
        var (_, result) = await Run(1, "ERROR: first", "ERROR: second");
        Assert.Equal("first second", result.ErrorMessage);
    }

    [Fact]
    public async Task Translate_NoErrorMessageOnCleanRun()
    {
        var (_, result) = await Run(0, "[download] Destination: a.m4a");
        Assert.Null(result.ErrorMessage);
    }

    // Scraped so a failed run's orphaned cover art can be removed.
    [Fact]
    public async Task Translate_CapturesThumbnailPath()
    {
        var (_, result) = await Run(1, @"[info] Writing video thumbnail 1 to: C:\out\a.webp");
        Assert.Equal(@"C:\out\a.webp", result.ThumbnailPath);
    }

    [Fact]
    public async Task Translate_ReportsExitCode()
    {
        var (_, result) = await Run(2, "anything");
        Assert.Equal(2, result.Code);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DownloadTranslatorTests"`
Expected: FAIL (DownloadTranslator does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Ytdlp;

public sealed record DownloadRunResult(
    int Code,
    string? SavedPath = null,
    string? ErrorMessage = null,
    // Cover art yt-dlp wrote alongside the media; only still on disk if the run
    // did not reach the embed step.
    string? ThumbnailPath = null);

// Translates raw yt-dlp output into UI lines: a progress update per template
// line, a phase line whenever the stage changes (never repeated), and the final
// path / exit code / error text in Result.
public sealed class DownloadTranslator
{
    private static readonly Regex ErrorPrefix =
        new(@"^ERROR:\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public DownloadRunResult Result { get; private set; } = new(1);

    public async IAsyncEnumerable<DownloadLine> TranslateAsync(
        IAsyncEnumerable<string> source,
        Func<int> exitCode,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        string? savedPath = null;
        string? thumbnailPath = null;
        DownloadPhase? lastPhase = null;
        var errors = new List<string>();

        await foreach (var line in source.WithCancellation(ct))
        {
            var progress = OutputParser.ParseProgress(line);
            if (progress != null) yield return progress;

            var phase = OutputParser.ParsePhase(line);
            if (phase != null && phase.Phase != lastPhase)
            {
                lastPhase = phase.Phase;
                yield return phase;
            }

            var dest = OutputParser.ParseDestination(line);
            if (dest != null) savedPath = dest;

            var thumb = OutputParser.ParseThumbnailPath(line);
            if (thumb != null) thumbnailPath = thumb;

            if (ErrorPrefix.IsMatch(line))
                errors.Add(ErrorPrefix.Replace(line, "").Trim());
        }

        Result = new DownloadRunResult(
            exitCode(),
            savedPath,
            errors.Count != 0 ? string.Join(" ", errors) : null,
            thumbnailPath);
    }

    // Best-effort: a thumbnail we could not delete is untidy, never fatal.
    // Only ever the exact path yt-dlp reported -- never a glob. The resumable
    // .part file is deliberately left alone.
    public static void RemoveStrayThumbnail(string? thumbnailPath)
    {
        if (string.IsNullOrEmpty(thumbnailPath)) return;
        try
        {
            File.Delete(thumbnailPath);
        }
        catch
        {
            // Already gone, or locked by another process.
        }
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DownloadTranslatorTests"`
Expected: 0 failed

### Task 15: Two-phase playlist retry engine

Replaces `orchestratePlaylist` in `lib/ytdlp.ts:694`. The downloader and the sleep are injected exactly as in the original, so all of it is testable without spawning yt-dlp. This is the largest single piece of behaviour in the app and the one most worth pinning with tests.

**Files:**
- Create: `desktop/MediaDetector.Core/Playlist/PlaylistOrchestrator.cs`
- Test: `desktop/MediaDetector.Core.Tests/Playlist/PlaylistOrchestratorTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Models;
using MediaDetector.Core.Playlist;

namespace MediaDetector.Core.Tests.Playlist;

public class PlaylistOrchestratorTests
{
    private static TrackJob[] Tracks(int count) =>
        [.. Enumerable.Range(1, count).Select(i => new TrackJob($"id{i}", $"Track {i}", i))];

    private static OrchestrateOptions Options(int attempts = 5) =>
        new(attempts, @"C:\out\List", TimeSpan.Zero, _ => Task.CompletedTask);

    // Records every attempt so tests can assert on retry counts.
    private sealed class FakeDownloader
    {
        private readonly Func<TrackJob, int, TrackOutcome> _behaviour;
        public List<(int Index, int Attempt)> Attempts { get; } = [];

        public FakeDownloader(Func<TrackJob, int, TrackOutcome> behaviour) => _behaviour = behaviour;

        public async IAsyncEnumerable<DownloadLine> Download(TrackJob track, int attempt)
        {
            Attempts.Add((track.Index, attempt));
            await Task.Yield();
            yield return new ProgressLine(50);
            Result = _behaviour(track, attempt);
        }

        public TrackOutcome Result { get; private set; } = new(false);
    }

    private static async Task<List<DownloadLine>> Drain(
        TrackJob[] tracks, FakeDownloader fake, OrchestrateOptions opts,
        CancellationToken ct = default)
    {
        var lines = new List<DownloadLine>();
        var downloader = new TrackDownloader(async (t, a, sink, innerCt) =>
        {
            await foreach (var l in fake.Download(t, a).WithCancellation(innerCt)) await sink(l);
            return fake.Result;
        });
        await foreach (var line in PlaylistOrchestrator.RunAsync(tracks, downloader, opts, ct))
            lines.Add(line);
        return lines;
    }

    [Fact]
    public async Task AllSucceed_EmitsItemAndTrackDonePerTrackThenSummary()
    {
        var fake = new FakeDownloader((_, _) => new TrackOutcome(true, @"C:\out\a.m4a"));
        var lines = await Drain(Tracks(3), fake, Options());

        Assert.Equal(3, lines.OfType<ItemLine>().Count());
        Assert.Equal(3, lines.OfType<TrackDoneLine>().Count());
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.Equal(3, done.Downloaded);
        Assert.Equal(0, done.Failed);
        Assert.False(done.Cancelled);
    }

    // Phase 1 retries up to attemptsPerPhase, emitting track-retry BETWEEN
    // attempts (so 5 attempts produce 4 retry lines), then skips and continues.
    [Fact]
    public async Task PhaseOneFailure_RetriesThenSkipsAndContinues()
    {
        var fake = new FakeDownloader((t, _) => new TrackOutcome(t.Index != 1));
        var lines = await Drain(Tracks(2), fake, Options());

        Assert.Equal(4, lines.OfType<TrackRetryLine>().Count(r => r.Index == 1 && r.Phase == 1));
        Assert.Contains(lines.OfType<TrackSkippedLine>(), s => s.Index == 1);
        // Track 2 still ran despite track 1 failing.
        Assert.Contains(lines.OfType<TrackDoneLine>(), d => d.Index == 2);
    }

    // Phase 2 re-sweeps the skipped tracks; recovery there counts as downloaded.
    [Fact]
    public async Task PhaseTwoRecovery_EmitsTrackDone()
    {
        var calls = 0;
        var fake = new FakeDownloader((_, _) => new TrackOutcome(++calls > 5));
        var lines = await Drain(Tracks(1), fake, Options());

        Assert.Contains(lines.OfType<TrackSkippedLine>(), s => s.Index == 1);
        Assert.Contains(lines.OfType<TrackDoneLine>(), d => d.Index == 1);
        Assert.Equal(1, Assert.Single(lines.OfType<BatchDoneLine>()).Downloaded);
    }

    // A permanently failing track is attempted 5 + 5 = 10 times, then track-error.
    [Fact]
    public async Task PermanentFailure_IsAttemptedTenTimesThenErrors()
    {
        var fake = new FakeDownloader((_, _) => new TrackOutcome(false));
        var lines = await Drain(Tracks(1), fake, Options());

        Assert.Equal(10, fake.Attempts.Count);
        Assert.Contains(lines.OfType<TrackErrorLine>(), e => e.Index == 1);
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.Equal(0, done.Downloaded);
        Assert.Equal(1, done.Failed);
    }

    // A hang is not a flaky network: retrying costs another full 5-minute
    // deadline, so the engine gives up on that track immediately.
    [Fact]
    public async Task HungTrack_IsNotRetried()
    {
        var fake = new FakeDownloader((_, _) => new TrackOutcome(false, Hung: true));
        await Drain(Tracks(1), fake, Options());

        // One attempt per phase instead of five.
        Assert.Equal(2, fake.Attempts.Count);
    }

    // Cancellation stops before the next track, skips the phase-2 sweep, and
    // reports cancelled -- without this a cancelled track looks like a failure
    // and gets retried up to 10 more times.
    [Fact]
    public async Task Cancellation_StopsImmediatelyAndFlagsTheSummary()
    {
        using var cts = new CancellationTokenSource();
        var fake = new FakeDownloader((_, _) => { cts.Cancel(); return new TrackOutcome(false); });
        var lines = await Drain(Tracks(5), fake, Options(), cts.Token);

        Assert.Single(fake.Attempts);
        var done = Assert.Single(lines.OfType<BatchDoneLine>());
        Assert.True(done.Cancelled);
        Assert.Empty(lines.OfType<TrackErrorLine>());
    }

    // Ordering, not contents: a buffering implementation produces the exact same
    // final list, so only the sequence in which lines ARRIVE proves the progress
    // reached the UI while the track was still running.
    [Fact]
    public async Task LiveProgress_IsObservedBeforeTrackCompletes()
    {
        var gate = new TaskCompletionSource();
        var sawProgress = false;
        var progressWasLive = false;

        var downloader = new TrackDownloader(async (_, _, sink, _) =>
        {
            await sink(new ProgressLine(50));
            // Only completes once the consumer has actually seen the line above.
            // A buffering implementation never releases this and the test times out.
            await gate.Task.WaitAsync(TimeSpan.FromSeconds(5));
            return new TrackOutcome(true, @"C:\out\a.m4a");
        });

        await foreach (var line in PlaylistOrchestrator.RunAsync(
            Tracks(1), downloader, Options()))
        {
            if (line is ProgressLine)
            {
                sawProgress = true;
                progressWasLive = !gate.Task.IsCompleted;
                gate.SetResult();
            }
        }

        Assert.True(sawProgress, "no ProgressLine was emitted at all");
        Assert.True(progressWasLive, "progress arrived only after the track finished");
    }

    [Fact]
    public async Task Summary_CarriesTheDestinationFolder()
    {
        var fake = new FakeDownloader((_, _) => new TrackOutcome(true));
        var lines = await Drain(Tracks(1), fake, Options());
        Assert.Equal(@"C:\out\List", Assert.Single(lines.OfType<BatchDoneLine>()).Folder);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~PlaylistOrchestratorTests"`
Expected: FAIL (PlaylistOrchestrator does not exist)

- [ ] **Step 3: Write the implementation**

C# cannot express the TS `yield*`-with-return-value pattern, so the per-track downloader takes a `sink` callback for the lines it wants forwarded and returns the outcome directly. That keeps the orchestrator itself a plain `IAsyncEnumerable`.

```csharp
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Playlist;

// Downloads one track (attempt is 1-based), forwarding progress/phase lines to
// `sink` and returning the outcome.
public delegate Task<TrackOutcome> TrackDownloader(
    TrackJob track,
    int attempt,
    Func<DownloadLine, Task> sink,
    CancellationToken ct);

// No CancellationToken here: RunAsync takes one [EnumeratorCancellation]
// parameter, which is the idiomatic C# spelling and what `await foreach` wires
// up. Carrying a second copy in the options meant every guard had to check both,
// and one of them would eventually be forgotten.
public sealed record OrchestrateOptions(
    int AttemptsPerPhase,
    string Folder,
    TimeSpan Backoff,
    Func<TimeSpan, Task> Sleep);

// Carries a per-track outcome out of AttemptAsync, which can only yield lines.
// Always allocated per track by the caller. It must NOT be a static of any kind,
// including [ThreadStatic]: AttemptAsync awaits, so continuations resume on
// arbitrary pool threads where a thread-static field is still null.
internal sealed class Holder<T>
{
    public T? Value { get; set; }
}

// Two-phase per-track retry engine. Phase 1 tries each track up to
// AttemptsPerPhase, queueing failures so the batch continues. Phase 2 re-sweeps
// the queued tracks up to AttemptsPerPhase more; any still failing become
// TrackErrorLine. The downloader and sleep are injected, so this is unit-testable
// without spawning yt-dlp.
public static class PlaylistOrchestrator
{
    public static async IAsyncEnumerable<DownloadLine> RunAsync(
        IReadOnlyList<TrackJob> tracks,
        TrackDownloader download,
        OrchestrateOptions opts,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var total = tracks.Count;
        var downloaded = 0;
        var skipped = new List<TrackJob>();

        // Phase 1.
        foreach (var track in tracks)
        {
            if (ct.IsCancellationRequested) break;
            yield return new ItemLine(track.Index, total);

            var outcome = new Holder<TrackOutcome>();
            await foreach (var line in AttemptAsync(track, 1, download, opts, outcome, ct))
                yield return line;

            if (outcome.Value?.Ok == true)
            {
                downloaded++;
                yield return new TrackDoneLine(track.Index, outcome.Value.SavedPath ?? "");
            }
            else if (!ct.IsCancellationRequested)
            {
                yield return new TrackSkippedLine(track.Index);
                skipped.Add(track);
            }
        }

        // Phase 2: re-sweep whatever phase 1 gave up on.
        foreach (var track in skipped)
        {
            if (ct.IsCancellationRequested) break;
            yield return new ItemLine(track.Index, total);

            var outcome = new Holder<TrackOutcome>();
            await foreach (var line in AttemptAsync(track, 2, download, opts, outcome, ct))
                yield return line;

            if (outcome.Value?.Ok == true)
            {
                downloaded++;
                yield return new TrackDoneLine(track.Index, outcome.Value.SavedPath ?? "");
            }
            else if (!ct.IsCancellationRequested)
            {
                yield return new TrackErrorLine(track.Index, track.Title);
            }
        }

        yield return new BatchDoneLine(
            opts.Folder, downloaded, total, total - downloaded, ct.IsCancellationRequested);
    }

    private static async IAsyncEnumerable<DownloadLine> AttemptAsync(
        TrackJob track,
        int phase,
        TrackDownloader download,
        OrchestrateOptions opts,
        Holder<TrackOutcome> outcome,
        [EnumeratorCancellation] CancellationToken ct)
    {
        outcome.Value = new TrackOutcome(false);

        for (var attempt = 1; attempt <= opts.AttemptsPerPhase; attempt++)
        {
            // Lines must reach the UI WHILE the attempt runs, not after it
            // returns. Collecting them into a list first and replaying at the end
            // makes a track's progress bar jump 0 -> 100 the instant it finishes,
            // which is what the TypeScript avoided by yielding inside its pump
            // (lib/ytdlp.ts:710-713).
            var channel = Channel.CreateUnbounded<DownloadLine>(
                new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

            // No `ct` on Task.Run: if the token is already cancelled the delegate
            // never runs, its finally never fires, the channel is never completed
            // and the drain below deadlocks.
            var pump = Task.Run(async () =>
            {
                try
                {
                    return await download(
                        track, attempt,
                        // CancellationToken.None: an unbounded channel never
                        // blocks a writer, so a token here buys nothing and only
                        // risks throwing mid-write.
                        line => channel.Writer.WriteAsync(line, CancellationToken.None).AsTask(),
                        ct);
                }
                finally
                {
                    channel.Writer.TryComplete();
                }
            });

            // Drain WITHOUT the token. ReadAllAsync(ct) throws
            // OperationCanceledException the instant the token trips, which
            // escapes RunAsync and skips the final BatchDoneLine entirely -- so a
            // cancelled playlist would report nothing at all, breaking both the
            // "sets cancelled: true on the done line" contract and parity with
            // lib/ytdlp.ts:755. The pump's finally always completes the writer,
            // so this loop still terminates promptly on cancellation.
            while (await channel.Reader.WaitToReadAsync(CancellationToken.None))
            {
                while (channel.Reader.TryRead(out var line))
                    yield return line;
            }

            // Not inside a try/catch wrapping a yield -- C# forbids that -- but
            // this sits after every yield, so it can be guarded normally.
            TrackOutcome result;
            try
            {
                result = await pump;
            }
            catch (OperationCanceledException)
            {
                result = new TrackOutcome(false);
            }
            outcome.Value = result;

            if (result.Ok) yield break;

            // A cancelled track exits non-zero exactly like a failed one; without
            // this the engine would keep retrying work the user just stopped.
            if (ct.IsCancellationRequested) yield break;

            // Likewise a hang: 5 more attempts would cost 5 more full deadlines.
            if (result.Hung) yield break;

            if (attempt < opts.AttemptsPerPhase)
            {
                yield return new TrackRetryLine(track.Index, attempt, phase);
                await opts.Sleep(opts.Backoff);
            }
        }
    }
}
```

Two things here are not stylistic and must not be "simplified" back:

| Constraint | Why |
|---|---|
| `Holder<TrackOutcome>` is allocated per track by the caller | An earlier draft used a `[ThreadStatic]` static. That is a first-run `NullReferenceException`, not merely a concurrency hazard: a thread-static field's initializer runs only on the thread that first touches it, and every `await` inside `download(...)` can resume on a different pool thread where the field is still `null`. |
| `AttemptAsync` streams through a `Channel`, never a `List` | Buffering makes each track's bar jump 0 -> 100 at the end. The plan's original tests could not detect this because they only inspect the final collected list, which is why `LiveProgress_IsObservedBeforeTrackCompletes` below asserts on *ordering* rather than contents. |

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~PlaylistOrchestratorTests"`
Expected: 0 failed

**Phase 2 gate:** `dotnet test desktop/MediaDetector.Core.Tests` passes. Manually verify with Task Manager that a cancelled `TrackRunner` test leaves no orphaned `ffmpeg.exe` or `PING.EXE`.

---

## Phase 3: Core services

Replaces the ten API routes. Each becomes a plain service class -- no HTTP, no JSON envelope, no streaming protocol. The `outputDir` validation boundary and the `sanitizeUserStem` boundary both survive verbatim, because they guard against the same things whether the input arrives over HTTP or from a text box.

### Task 16: Dependency probes and status

Replaces `app/api/status/route.ts` plus `checkFfmpeg`. Gains the fourth row.

**Files:**
- Create: `desktop/MediaDetector.Core/Dependencies/DependencyChecker.cs`
- Create: `desktop/MediaDetector.Core/Dependencies/StatusService.cs`
- Test: `desktop/MediaDetector.Core.Tests/Dependencies/StatusServiceTests.cs`

- [ ] **Step 1: Write the failing tests**

The probes are injected so the cache logic is testable without Python installed.

```csharp
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Tests.Dependencies;

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

    // yt-dlp is only probed and updated when Python is present; without it the
    // update status is 'skipped' rather than 'failed'.
    [Fact]
    public async Task Probe_SkipsYtdlpUpdateWhenPythonMissing()
    {
        var result = await DependencyChecker.BuildAsync(
            probePython: () => Task.FromResult((false, (string?)null, "python")),
            probeYtdlp: _ => throw new InvalidOperationException("must not be called"),
            updateYtdlp: _ => throw new InvalidOperationException("must not be called"),
            probeNode: () => Task.FromResult(new DependencyState(true, "22.11.0")),
            probeFfmpeg: () => Task.FromResult(new DependencyState(true, "8.1.2")));

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
            probePython: () => Task.FromResult((true, (string?)"3.12.2", "python")),
            probeYtdlp: _ => Task.FromResult((true, (string?)"2026.08.01")),
            updateYtdlp: _ => { updated = true; return Task.FromResult(UpdateStatus.Updated); },
            probeNode: () => Task.FromResult(new DependencyState(true, "22.11.0")),
            probeFfmpeg: () => Task.FromResult(new DependencyState(false, null)));

        Assert.True(updated);
        Assert.Equal(UpdateStatus.Updated, result.Ytdlp.UpdateStatus);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~StatusServiceTests"`
Expected: FAIL (DependencyChecker and StatusService do not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using MediaDetector.Core.Models;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Dependencies;

[SupportedOSPlatform("windows")]
public static class DependencyChecker
{
    // Lazy and awaited, mirroring lib/ytdlp.ts:55's resolvePython(), which probes
    // on every ytdlpArgs() call. A plain static field set only by the status
    // check would hand back "python" on a machine where only python3 works, and
    // also whenever a detect is issued before StatusService.GetAsync() completes.
    private static readonly SemaphoreSlim _pythonGate = new(1, 1);
    private static string? _cachedPython;

    public static async Task<string> ResolvePythonAsync(CancellationToken ct = default)
    {
        if (_cachedPython != null) return _cachedPython;
        await _pythonGate.WaitAsync(ct);
        try
        {
            if (_cachedPython != null) return _cachedPython;
            var (found, _, cmd) = await ProbePythonAsync();
            // Cache ONLY on success. Pinning the "python" fallback would
            // survive a later install and make Recheck unable to recover.
            if (found) _cachedPython = cmd;
            return cmd;
        }
        finally
        {
            _pythonGate.Release();
        }
    }

    // Cleared by the Recheck path so a freshly installed Python is picked up.
    public static void ResetPythonCache() => _cachedPython = null;

    // A fresh python.org install has `python` on PATH but often not `python3`.
    public static async Task<(bool Found, string? Version, string Cmd)> ProbePythonAsync()
    {
        foreach (var cmd in new[] { "python", "python3" })
        {
            var result = await ProcessRunner.RunShellAsync($"{cmd} --version");
            if (result.ExitCode == 0)
            {
                // Caching happens in ResolvePythonAsync, under the gate.
                var match = Regex.Match(result.Stdout, @"Python ([\d.]+)");
                return (true, match.Success ? match.Groups[1].Value : result.Stdout, cmd);
            }
        }
        // Default so the pip/yt-dlp command surfaces the real error rather than
        // a confusing spawn failure. NOT cached -- a later probe may succeed.
        return (false, null, "python");
    }

    // The `yt-dlp` shim lands in Python's Scripts dir (often off PATH); run the module.
    public static async Task<(bool Found, string? Version)> ProbeYtdlpAsync(string python)
    {
        var result = await ProcessRunner.RunShellAsync($"{python} -m yt_dlp --version");
        return result.ExitCode == 0 ? (true, result.Stdout.Trim()) : (false, null);
    }

    // `yt-dlp -U` refuses for pip/PyPI installs, so update the way it was installed.
    // mutagen embeds cover art into mp4/m4a; without it yt-dlp's ffmpeg-only
    // fallback fails and the file ends up with no image data.
    public static async Task<UpdateStatus> UpdateYtdlpAsync(string python)
    {
        var result = await ProcessRunner.RunShellAsync(
            $"{python} -m pip install --upgrade yt-dlp mutagen");
        if (result.ExitCode != 0) return UpdateStatus.Failed;
        return result.Stdout.Contains("successfully installed", StringComparison.OrdinalIgnoreCase)
            ? UpdateStatus.Updated
            : UpdateStatus.UpToDate;
    }

    // NEW dependency. yt-dlp needs a JS runtime for YouTube's signature/n
    // challenges; the Node-hosted web app supplied one implicitly.
    public static async Task<DependencyState> ProbeNodeAsync()
    {
        var exe = ToolResolver.ResolveNodeExe();
        if (exe == null) return new DependencyState(false, null);
        var result = await ProcessRunner.RunAsync([exe, "--version"]);
        return result.ExitCode == 0
            ? new DependencyState(true, result.Stdout.TrimStart('v'))
            : new DependencyState(false, null);
    }

    public static async Task<DependencyState> ProbeFfmpegAsync()
    {
        var dir = ToolResolver.ResolveFfmpegDir();
        var exe = dir == null ? "ffmpeg" : Path.Combine(dir, "ffmpeg.exe");
        var result = await ProcessRunner.RunAsync([exe, "-version"]);
        if (result.ExitCode != 0) return new DependencyState(false, null);
        var match = Regex.Match(result.Stdout, @"ffmpeg version (\S+)");
        return new DependencyState(true, match.Success ? match.Groups[1].Value : null);
    }

    // Composed with injectable probes so the ordering rules are unit-testable.
    public static async Task<StatusResult> BuildAsync(
        Func<Task<(bool, string?, string)>> probePython,
        Func<string, Task<(bool, string?)>> probeYtdlp,
        Func<string, Task<UpdateStatus>> updateYtdlp,
        Func<Task<DependencyState>> probeNode,
        Func<Task<DependencyState>> probeFfmpeg)
    {
        var (pyFound, pyVersion, pyCmd) = await probePython();
        var ytdlp = new YtdlpState(false, null, UpdateStatus.Skipped);

        if (pyFound)
        {
            var (found, version) = await probeYtdlp(pyCmd);
            ytdlp = found
                ? new YtdlpState(true, version, await updateYtdlp(pyCmd))
                : new YtdlpState(false, null, UpdateStatus.Skipped);
        }

        // Node and ffmpeg are independent of Python -- probe regardless.
        return new StatusResult(
            new DependencyState(pyFound, pyVersion),
            ytdlp,
            await probeNode(),
            await probeFfmpeg());
    }

    public static Task<StatusResult> BuildDefaultAsync() => BuildAsync(
        ProbePythonAsync, ProbeYtdlpAsync, UpdateYtdlpAsync, ProbeNodeAsync, ProbeFfmpegAsync);
}
```

```csharp
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Dependencies;

// Replaces the module-level cachedStatus in app/api/status/route.ts.
public sealed class StatusService(Func<CancellationToken, Task<StatusResult>> probe)
{
    private StatusResult? _cached;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<StatusResult> GetAsync(bool refresh = false, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_cached != null && !refresh) return _cached;
            return _cached = await probe(ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Reset() => _cached = null;
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~StatusServiceTests"`
Expected: 0 failed

Then verify against the real machine once: a throwaway test calling `DependencyChecker.BuildDefaultAsync()` should report Python, yt-dlp, Node and ffmpeg all found (all four are installed here -- ffmpeg at the winget Gyan path, Node at `C:\Program Files\nodejs`). Delete the throwaway afterwards.

### Task 17: Installers

Replaces `app/api/ytdlp/install`, `app/api/ytdlp/update` and `app/api/ffmpeg/install`. Adds a Node installer. All four stream plain text lines, which the UI shows in the log panel.

**Files:**
- Create: `desktop/MediaDetector.Core/Dependencies/Installer.cs`
- Test: `desktop/MediaDetector.Core.Tests/Dependencies/InstallerTests.cs`

- [ ] **Step 1: Write the failing tests**

Only the argument construction is worth testing; the spawning is covered by `LineStream`.

```csharp
using MediaDetector.Core.Dependencies;

namespace MediaDetector.Core.Tests.Dependencies;

public class InstallerTests
{
    // mutagen is installed alongside yt-dlp: yt-dlp needs it (or AtomicParsley)
    // to embed cover art into mp4/m4a, and its ffmpeg-only fallback fails there.
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
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~InstallerTests"`
Expected: FAIL (Installer does not exist)

- [ ] **Step 3: Write the implementation**

The macOS Homebrew branch from `app/api/ffmpeg/install/route.ts` is deleted; Windows only.

```csharp
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Dependencies;

[SupportedOSPlatform("windows")]
public static class Installer
{
    public static string[] YtdlpInstallArgs(string python) =>
        YtdlpArgs.Pip(python, ["install", "yt-dlp", "mutagen"]);

    public static string[] YtdlpUpdateArgs(string python) =>
        YtdlpArgs.Pip(python, ["install", "--upgrade", "yt-dlp", "mutagen"]);

    public static string[] WingetArgs(string packageId) =>
    [
        "winget", "install", "--id", packageId, "-e",
        "--accept-package-agreements", "--accept-source-agreements",
        "--disable-interactivity",
    ];

    public static IAsyncEnumerable<string> InstallYtdlpAsync(
        string python, CancellationToken ct = default) =>
        LineStream.StreamAsync(YtdlpInstallArgs(python), ct);

    public static IAsyncEnumerable<string> UpdateYtdlpAsync(
        string python, CancellationToken ct = default) =>
        LineStream.StreamAsync(YtdlpUpdateArgs(python), ct);

    public static IAsyncEnumerable<string> InstallFfmpegAsync(CancellationToken ct = default) =>
        InstallViaPackageManagerAsync(
            "ffmpeg", "Gyan.FFmpeg", ["choco", "install", "ffmpeg", "-y"],
            "Install ffmpeg manually from https://www.gyan.dev/ffmpeg/builds/ "
            + "(or drop ffmpeg.exe + ffprobe.exe into the app's bin/ folder).", ct);

    public static IAsyncEnumerable<string> InstallNodeAsync(CancellationToken ct = default) =>
        InstallViaPackageManagerAsync(
            "Node.js", "OpenJS.NodeJS.LTS", ["choco", "install", "nodejs-lts", "-y"],
            "Install Node.js manually from https://nodejs.org/en/download", ct);

    private static async IAsyncEnumerable<string> InstallViaPackageManagerAsync(
        string label,
        string wingetId,
        string[] chocoArgs,
        string manualHint,
        [EnumeratorCancellation] CancellationToken ct)
    {
        string[]? args = null;

        if ((await ProcessRunner.RunShellAsync("winget --version", ct)).ExitCode == 0)
        {
            yield return $"Installing {label} via winget ({wingetId})...";
            args = WingetArgs(wingetId);
        }
        else if ((await ProcessRunner.RunShellAsync("choco --version", ct)).ExitCode == 0)
        {
            yield return $"Installing {label} via Chocolatey...";
            args = chocoArgs;
        }
        else
        {
            yield return "Neither winget nor Chocolatey was found.";
            yield return manualHint;
        }

        if (args is not null)
        {
            await foreach (var line in LineStream.StreamAsync(args, ct)) yield return line;
            yield return $"Done. If the {label} row stays red, click Recheck to pick it up.";
        }
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~InstallerTests"`
Expected: 0 failed

### Task 18: Output folder, settings, and Explorer integration

Replaces `app/api/output-dir`, `app/api/open-folder`, and the three `localStorage` hooks (`useTheme`, `useOutputDir`, `useCleanNames`).

**Files:**
- Create: `desktop/MediaDetector.Core/Storage/OutputPaths.cs`
- Create: `desktop/MediaDetector.Core/Storage/AppSettings.cs`
- Test: `desktop/MediaDetector.Core.Tests/Storage/OutputPathsTests.cs`
- Test: `desktop/MediaDetector.Core.Tests/Storage/AppSettingsTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
using MediaDetector.Core.Storage;

namespace MediaDetector.Core.Tests.Storage;

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
    [InlineData("relative\\path")]
    [InlineData("..")]
    public void Ensure_FallsBackToDefaultForUnusableInput(string? custom)
        => Assert.Equal(OutputPaths.Default(), OutputPaths.Resolve(custom));

    [Fact]
    public void Ensure_HonoursAnAbsolutePath()
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
            var saved = new AppSettings
            {
                Theme = AppThemeMode.Dark, CleanNames = false, OutputDir = @"C:\Music",
            };
            saved.Save(path);
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
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~Storage"`
Expected: FAIL (OutputPaths and AppSettings do not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Diagnostics;
using System.Runtime.Versioning;

namespace MediaDetector.Core.Storage;

[SupportedOSPlatform("windows")]
public static class OutputPaths
{
    public static string Default() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MediaDetector");

    // Uses `custom` only when it is a non-empty ABSOLUTE path -- the validation
    // boundary for the user-supplied folder. Everything else falls back.
    public static string Resolve(string? custom) =>
        !string.IsNullOrWhiteSpace(custom) && Path.IsPathFullyQualified(custom)
            ? custom
            : Default();

    public static string EnsureCreated(string? custom)
    {
        var dir = Resolve(custom);
        Directory.CreateDirectory(dir);
        return dir;
    }

    // Replaces app/api/open-folder. The macOS `open` branch is gone.
    //
    // Deliberately NOT routed through ProcessRunner: that creates a Job Object
    // with KILL_ON_JOB_CLOSE and disposes it on return, which would kill the
    // Explorer window we just opened. It is a launcher, not a run-and-wait.
    // Note also that explorer.exe returns exit code 1 even on success, so no
    // caller may branch on its exit code.
    //
    // Returns an error message, or null on success -- callers must surface it
    // rather than discarding it, per the explicit-error-handling rule.
    public static string? OpenInExplorer(string folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath)) return "No folder to open";
        if (!Directory.Exists(folderPath)) return $"Folder no longer exists: {folderPath}";

        try
        {
            using var proc = Process.Start(new ProcessStartInfo(folderPath)
            {
                UseShellExecute = true,
            });
            return null;
        }
        catch (Exception ex)
        {
            return $"Could not open the folder: {ex.Message}";
        }
    }
}
```

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MediaDetector.Core.Storage;

// NOT `ThemeMode`: .NET 10 WPF added System.Windows.ThemeMode for Fluent
// theming, and any file with `using System.Windows;` plus this namespace
// gets CS0104 ambiguity. A using-alias would have to be repeated in every
// such file and would not help XAML {x:Static} references at all.
public enum AppThemeMode { System, Light, Dark }

// Replaces the three localStorage hooks. ApplicationData.Current is unavailable
// to an app without package identity, so this is a plain JSON file.
public sealed class AppSettings
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AppThemeMode Theme { get; set; } = AppThemeMode.System;

    public bool CleanNames { get; set; } = true;

    public string? OutputDir { get; set; }

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MediaDetector", "settings.json");

    public static AppSettings Load(string? path = null)
    {
        var file = path ?? DefaultPath;
        try
        {
            if (!File.Exists(file)) return new AppSettings();
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(file))
                   ?? new AppSettings();
        }
        catch
        {
            // A corrupt or unreadable settings file must never stop the app launching.
            return new AppSettings();
        }
    }

    public void Save(string? path = null)
    {
        var file = path ?? DefaultPath;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            File.WriteAllText(file,
                JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Losing a preference is not worth crashing over.
        }
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~Storage"`
Expected: 0 failed

### Task 19: Detection service

Replaces `app/api/detect` and `app/api/playlist`. Both were thin: validate the URL, spawn yt-dlp with `execArgs`, parse the JSON.

**Files:**
- Create: `desktop/MediaDetector.Core/Services/DetectService.cs`
- Test: `desktop/MediaDetector.Core.Tests/Services/DetectServiceTests.cs`

- [ ] **Step 1: Write the failing tests**

The runner is injected, so no yt-dlp is needed.

```csharp
using MediaDetector.Core.Processes;
using MediaDetector.Core.Services;

namespace MediaDetector.Core.Tests.Services;

public class DetectServiceTests
{
    private const string Url = "https://www.youtube.com/watch?v=abc";

    private static DetectService WithOutput(string stdout, int code = 0, string stderr = "") =>
        new((_, _) => Task.FromResult(new ExecResult(stdout, stderr, code)),
            _ => Task.FromResult("python"), () => null);

    // isYouTubeUrl must gate every call -- this is the injection boundary.
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
        var svc = WithOutput("", 1, "ERROR: Video unavailable");
        var result = await svc.DetectVideoAsync(Url);
        Assert.False(result.Ok);
        Assert.Equal("Video unavailable", result.Error);
    }

    [Fact]
    public async Task DetectVideo_HandlesUnparseableJson()
    {
        var svc = WithOutput("not json at all");
        var result = await svc.DetectVideoAsync(Url);
        Assert.False(result.Ok);
    }

    [Fact]
    public async Task DetectPlaylist_ParsesTrackList()
    {
        var svc = WithOutput("""{"title":"L","entries":[{"title":"One"},{"title":"Two"}]}""");
        var result = await svc.DetectPlaylistAsync("https://www.youtube.com/playlist?list=PL1");
        Assert.True(result.Ok);
        Assert.Equal(2, result.Value!.Count);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DetectServiceTests"`
Expected: FAIL (DetectService does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using MediaDetector.Core.Models;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Validation;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Services;

public sealed record Result<T>(bool Ok, T? Value, string? Error)
{
    public static Result<T> Success(T value) => new(true, value, null);
    public static Result<T> Failure(string error) => new(false, default, error);
}

[SupportedOSPlatform("windows")]
public sealed class DetectService(
    Func<IReadOnlyList<string>, CancellationToken, Task<ExecResult>> run,
    Func<CancellationToken, Task<string>> python,
    Func<string?> nodeExe)
{
    public DetectService() : this(
        (args, ct) => ProcessRunner.RunAsync(args, ct),
        Dependencies.DependencyChecker.ResolvePythonAsync,
        ToolResolver.ResolveNodeExe)
    { }

    private static readonly Regex ErrorPrefix =
        new(@"^ERROR:\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private async Task<Result<string>> DumpAsync(
        string url, string[] ytdlpFlags, string fallbackError, CancellationToken ct)
    {
        // Every URL goes through this gate before it can reach yt-dlp.
        if (!YouTubeUrl.IsYouTubeUrl(url))
            return Result<string>.Failure("URL must be a YouTube or YouTube Music link");

        var args = YtdlpArgs.Ytdlp(await python(ct), nodeExe(), ytdlpFlags);
        var result = await run(args, ct);

        if (result.ExitCode != 0 || string.IsNullOrEmpty(result.Stdout))
        {
            var message = string.IsNullOrEmpty(result.Stderr)
                ? fallbackError
                : ErrorPrefix.Replace(result.Stderr, "").Trim();
            return Result<string>.Failure(message);
        }
        return Result<string>.Success(result.Stdout);
    }

    public async Task<Result<MediaInfo>> DetectVideoAsync(string url, CancellationToken ct = default)
    {
        var dump = await DumpAsync(
            url, ["--dump-json", url, "--no-playlist"], "Failed to fetch media info", ct);
        if (!dump.Ok) return Result<MediaInfo>.Failure(dump.Error!);

        try
        {
            return Result<MediaInfo>.Success(JsonParser.ParseMediaInfo(dump.Value!));
        }
        catch
        {
            return Result<MediaInfo>.Failure("Failed to parse media info");
        }
    }

    // --flat-playlist avoids probing every video's formats, which is what makes
    // detection fast on a 120-track list.
    public async Task<Result<PlaylistInfo>> DetectPlaylistAsync(string url, CancellationToken ct = default)
    {
        var dump = await DumpAsync(
            url, ["--flat-playlist", "--dump-single-json", "--yes-playlist", url],
            "Failed to fetch playlist", ct);
        if (!dump.Ok) return Result<PlaylistInfo>.Failure(dump.Error!);

        try
        {
            return Result<PlaylistInfo>.Success(JsonParser.ParsePlaylistInfo(dump.Value!));
        }
        catch
        {
            return Result<PlaylistInfo>.Failure("Failed to parse playlist");
        }
    }

    public async Task<Result<(string Title, IReadOnlyList<PlaylistEntry> Entries)>> DumpEntriesAsync(
        string url, CancellationToken ct = default)
    {
        var dump = await DumpAsync(
            url, ["--flat-playlist", "--dump-single-json", "--yes-playlist", url],
            "Failed to fetch playlist", ct);
        if (!dump.Ok)
            return Result<(string, IReadOnlyList<PlaylistEntry>)>.Failure(dump.Error!);

        try
        {
            return Result<(string, IReadOnlyList<PlaylistEntry>)>.Success(
                JsonParser.ParsePlaylistEntries(dump.Value!));
        }
        catch
        {
            return Result<(string, IReadOnlyList<PlaylistEntry>)>.Failure("Failed to parse playlist");
        }
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DetectServiceTests"`
Expected: 0 failed

### Task 20: Download services

Replaces `app/api/download/route.ts` and `app/api/playlist/download/route.ts`. Everything the routes did survives except the streaming protocol: no `ReadableStream`, no `TextEncoder`, no NDJSON, no dual-source `AbortController`. One `CancellationToken` covers what `req.signal` plus the stream `cancel()` callback covered together.

**Files:**
- Create: `desktop/MediaDetector.Core/Services/DownloadService.cs`
- Create: `desktop/MediaDetector.Core/Services/PlaylistDownloadService.cs`
- Test: `desktop/MediaDetector.Core.Tests/Services/DownloadServiceTests.cs`

- [ ] **Step 1: Write the failing tests**

Argument assembly is the testable part and where the security boundaries live.

```csharp
using MediaDetector.Core.Naming;
using MediaDetector.Core.Services;

namespace MediaDetector.Core.Tests.Services;

public class DownloadServiceTests
{
    private static readonly NameSource Source = new("Song", Artist: "Artist");

    [Fact]
    public void BuildArgs_UsesLiteralOutputPathWithOnlyExtTemplated()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140", Source, "m4a", @"C:\out", true, null),
            "python", null, hasFfmpeg: true, outputDir: @"C:\out", ffmpegLocationArgs: []);

        var output = args[Array.IndexOf(args, "-o") + 1];
        Assert.Equal(@"C:\out\Song - Artist.%(ext)s", output);
    }

    // A typed name wins over the rules...
    [Fact]
    public void BuildArgs_CustomNameOverridesGeneratedName()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140", Source, "m4a", @"C:\out", true, "My Name"),
            "python", null, hasFfmpeg: true, outputDir: @"C:\out", ffmpegLocationArgs: []);
        Assert.Equal(@"C:\out\My Name.%(ext)s", args[Array.IndexOf(args, "-o") + 1]);
    }

    // ...but it is untrusted input pasted into an absolute path, so it is
    // sanitised first. Both separators map to full-width lookalikes, making the
    // result a single path component by construction.
    [Fact]
    public void BuildArgs_CustomNameCannotEscapeTheOutputFolder()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140", Source, "m4a", @"C:\out", true,
            "../../Windows/System32/evil"),
            "python", null, hasFfmpeg: true, outputDir: @"C:\out", ffmpegLocationArgs: []);

        var output = args[Array.IndexOf(args, "-o") + 1];
        Assert.StartsWith(@"C:\out\", output);
        Assert.Equal(@"C:\out\", output[..7]);
        // No further separator after the folder -- it is one component.
        Assert.DoesNotContain('\\', output[7..]);
    }

    // A blank or dots-only name falls back to the generated one.
    [Fact]
    public void BuildArgs_BlankCustomNameFallsBackToRules()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140", Source, "m4a", @"C:\out", true, "   "),
            "python", null, hasFfmpeg: true, outputDir: @"C:\out", ffmpegLocationArgs: []);
        Assert.Equal(@"C:\out\Song - Artist.%(ext)s", args[Array.IndexOf(args, "-o") + 1]);
    }

    // cleanNames off uses the untouched title.
    [Fact]
    public void BuildArgs_CleanNamesOffUsesRawStem()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140",
            new NameSource("Song (Official Video)"), "m4a", @"C:\out", false, null),
            "python", null, hasFfmpeg: true, outputDir: @"C:\out", ffmpegLocationArgs: []);
        Assert.Equal(@"C:\out\Song (Official Video).%(ext)s", args[Array.IndexOf(args, "-o") + 1]);
    }

    [Fact]
    public void BuildArgs_IncludesFormatProgressTemplateAndNoPlaylist()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140", Source, "m4a", @"C:\out", true, null),
            "python", null, hasFfmpeg: true, outputDir: @"C:\out", ffmpegLocationArgs: []);
        Assert.Equal("140", args[Array.IndexOf(args, "-f") + 1]);
        Assert.Contains("--no-playlist", args);
        Assert.Contains("--newline", args);
        Assert.Contains("--embed-thumbnail", args);
    }

    // Without ffmpeg the download must still succeed, just untagged.
    [Fact]
    public void BuildArgs_OmitsMetadataWithoutFfmpeg()
    {
        var args = DownloadService.BuildArgs(new DownloadRequest(
            "https://www.youtube.com/watch?v=a", "140", Source, "m4a", @"C:\out", true, null),
            "python", null, hasFfmpeg: false, outputDir: @"C:\out", ffmpegLocationArgs: []);
        Assert.DoesNotContain("--embed-metadata", args);
        Assert.DoesNotContain("--embed-thumbnail", args);
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DownloadServiceTests"`
Expected: FAIL (DownloadService does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Storage;
using MediaDetector.Core.Validation;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Services;

public sealed record DownloadRequest(
    string Url,
    string FormatId,
    NameSource Source,
    string Ext,
    string? OutputDir,
    bool CleanNames,
    string? CustomName);

[SupportedOSPlatform("windows")]
public sealed class DownloadService
{
    // The name is decided HERE and handed to yt-dlp as a literal -o path, not as
    // a template. yt-dlp decides a file is "already downloaded" by comparing
    // against the name its -o produces, so a literal name is stable across runs
    // and a repeat download still skips what it has. The UI preview and the real
    // filename also come from one function, so they cannot drift.
    // The override/clean/raw precedence lives here ONLY. Computing it in two
    // places (arg building and the final DoneLine) is how the preview and the
    // real filename drift apart.
    public static string StemFor(DownloadRequest req) =>
        // A typed name wins over the rules, once sanitised -- it is untrusted
        // input being pasted into an absolute path.
        FileNaming.SanitizeUserStem(req.CustomName)
        ?? (req.CleanNames
            ? FileNaming.DownloadStem(req.Source)
            : FileNaming.RawStem(req.Source));

    // Every environment-dependent value is a parameter, so this is pure and its
    // tests do not read the real machine's winget dirs or ~/Documents.
    // `outputDir` must already be resolved by the caller.
    public static string[] BuildArgs(
        DownloadRequest req,
        string python,
        string? nodeExe,
        bool hasFfmpeg,
        string outputDir,
        string[] ffmpegLocationArgs)
    {
        var output = FileNaming.OutputTemplateFor(Path.Combine(outputDir, StemFor(req)));

        return YtdlpArgs.Ytdlp(python, nodeExe,
        [
            "-f", req.FormatId, req.Url, "-o", output, "--no-playlist",
            .. YtdlpArgs.ProgressTemplate(),
            .. ffmpegLocationArgs,
            .. FormatArgs.Metadata(hasFfmpeg, req.Ext),
        ]);
    }

    public async IAsyncEnumerable<DownloadLine> RunAsync(
        DownloadRequest req,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (!YouTubeUrl.IsYouTubeUrl(req.Url))
        {
            yield return new ErrorLine("Invalid YouTube URL");
            yield break;
        }

        var dir = OutputPaths.EnsureCreated(req.OutputDir);
        var hasFfmpeg = (await DependencyChecker.ProbeFfmpegAsync()).Found;
        var args = BuildArgs(
            req,
            await DependencyChecker.ResolvePythonAsync(ct),
            ToolResolver.ResolveNodeExe(),
            hasFfmpeg,
            dir,
            ToolResolver.FfmpegLocationArgs());

        var runner = new TrackRunner();
        var translator = new DownloadTranslator();

        await foreach (var line in translator.TranslateAsync(
            runner.RunAsync(args, ct: ct), () => runner.ExitCode, ct))
        {
            yield return line;
        }

        var result = translator.Result;

        // A non-zero exit means the file is missing or truncated -- reporting
        // `done` here would show "Saved to ..." for a download that failed.
        if (result.Code != 0)
        {
            // The embed step never ran, so the cover art it would have consumed is
            // still sitting next to the media file.
            DownloadTranslator.RemoveStrayThumbnail(result.ThumbnailPath);
            // Cancellation is a distinct outcome, not an error and not silence.
            // Emitting it explicitly is what lets the row say "Cancelled -- a
            // partial file may remain" instead of snapping back to idle.
            yield return ct.IsCancellationRequested
                ? new CancelledLine()
                : new ErrorLine(result.ErrorMessage ?? $"yt-dlp exited with code {result.Code}");
            yield break;
        }

        // Prefer the path yt-dlp reported; otherwise the name we gave it, which it
        // used verbatim. Same StemFor as BuildArgs -- one source of truth.
        yield return new DoneLine(
            result.SavedPath ?? Path.Combine(dir, $"{StemFor(req)}.{req.Ext}"));
    }
}
```

```csharp
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Playlist;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Storage;
using MediaDetector.Core.Validation;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Services;

public sealed record PlaylistDownloadRequest(
    string Url,
    PlaylistFormatSelection Selection,
    string? OutputDir,
    bool CleanNames,
    // Filenames typed per track in the preview, keyed by 1-based track index.
    IReadOnlyDictionary<int, string> CustomNames);

[SupportedOSPlatform("windows")]
public sealed class PlaylistDownloadService(DetectService detect)
{
    private const int AttemptsPerPhase = 5;
    private static readonly TimeSpan RetryBackoff = TimeSpan.FromSeconds(1);

    public async IAsyncEnumerable<DownloadLine> RunAsync(
        PlaylistDownloadRequest req,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (!YouTubeUrl.IsYouTubeUrl(req.Url))
        {
            yield return new ErrorLine("Invalid YouTube URL");
            yield break;
        }

        var outputDir = OutputPaths.EnsureCreated(req.OutputDir);
        var hasFfmpeg = (await DependencyChecker.ProbeFfmpegAsync()).Found;
        var (formatArgs, expectedExt) = FormatArgs.ForPlaylist(req.Selection, hasFfmpeg);
        var meta = new List<string>();
        meta.AddRange(ToolResolver.FfmpegLocationArgs());
        meta.AddRange(FormatArgs.Metadata(hasFfmpeg, expectedExt));

        // Fetch the track list first so each video can be downloaded (and retried)
        // as its own process.
        var dump = await detect.DumpEntriesAsync(req.Url, ct);
        if (!dump.Ok)
        {
            yield return new ErrorLine(dump.Error!);
            yield break;
        }

        var (title, entries) = dump.Value!;
        if (entries.Count == 0)
        {
            yield return new ErrorLine("Playlist has no downloadable tracks");
            yield break;
        }

        // Built literally, because per-track downloads do not populate
        // %(playlist_title)s.
        var folder = Path.Combine(outputDir, FormatArgs.SanitizeFolderName(title));
        var python = await DependencyChecker.ResolvePythonAsync(ct);
        var nodeExe = ToolResolver.ResolveNodeExe();

        async Task<TrackOutcome> Download(
            TrackJob track, int attempt, Func<DownloadLine, Task> sink, CancellationToken innerCt)
        {
            var videoUrl = $"https://www.youtube.com/watch?v={track.Id}";
            var source = new NameSource(track.Title, Uploader: track.Author);

            var stem = (req.CustomNames.TryGetValue(track.Index, out var custom)
                           ? FileNaming.SanitizeUserStem(custom)
                           : null)
                       ?? (req.CleanNames
                           ? FileNaming.DownloadStem(source)
                           : FileNaming.RawStem(source));

            var args = YtdlpArgs.Ytdlp(python, nodeExe,
            [
                .. formatArgs, "--no-playlist", videoUrl,
                "-o", FileNaming.OutputTemplateFor(Path.Combine(folder, stem)),
                .. YtdlpArgs.ProgressTemplate(),
                .. meta,
            ]);

            var runner = new TrackRunner();
            var translator = new DownloadTranslator();

            await foreach (var line in translator.TranslateAsync(
                runner.RunAsync(args, ct: innerCt), () => runner.ExitCode, innerCt))
            {
                await sink(line);
            }

            var result = translator.Result;
            // A failed or cancelled attempt leaves the cover art it never got to
            // embed next to the media; each retry would add another one.
            if (result.Code != 0)
                DownloadTranslator.RemoveStrayThumbnail(result.ThumbnailPath);

            return new TrackOutcome(
                result.Code == 0,
                result.SavedPath,
                result.ErrorMessage?.Contains(TrackRunner.HungMarker) == true);
        }

        var tracks = entries
            .Select((e, i) => new TrackJob(e.Id, e.Title, i + 1, e.Author))
            .ToArray();

        // Four members: the token is passed to RunAsync, not carried in options.
        var opts = new OrchestrateOptions(AttemptsPerPhase, folder, RetryBackoff, Task.Delay);

        await foreach (var line in PlaylistOrchestrator.RunAsync(tracks, Download, opts, ct))
            yield return line;
    }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DownloadServiceTests"`
Expected: 0 failed

**Phase 3 gate -- first real end-to-end proof.** Write a temporary console entry point in `MediaDetector.App` that downloads one short real video and prints each `DownloadLine`. Verify: the file lands in `~/Documents/MediaDetector`, cover art is embedded (`ffprobe` shows a video stream with `attached_pic=1`), no stray `.webp` remains, and Ctrl+C leaves no orphaned `ffmpeg.exe`. **If the download 403s, the Node runtime wiring is wrong** -- check `ToolResolver.ResolveNodeExe()` returned an absolute path and that `--js-runtimes` reached the command line. Remove the console entry point before Phase 4.

---

## Phase 4: WPF shell and design system

The design system is the bulk of the remaining work. `app/globals.css` defines ~30 tokens in two themes; WPF's equivalent is two `ResourceDictionary` files swapped at runtime, with every control styled against `DynamicResource` so a theme switch repaints live.

### Task 21: Theme dictionaries

**Files:**
- Create: `desktop/MediaDetector.App/Themes/Light.xaml`
- Create: `desktop/MediaDetector.App/Themes/Dark.xaml`
- Create: `desktop/MediaDetector.App/Themes/ThemeManager.cs`

- [ ] **Step 1: Write the light dictionary**

One `SolidColorBrush` per CSS custom property, same names in kebab-to-Pascal form so the mapping to `globals.css` stays obvious.

`Themes/Light.xaml` -- Apple system colors, grouped background plus elevated white cards:

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <SolidColorBrush x:Key="BgPage"     Color="#f2f2f7"/>
    <SolidColorBrush x:Key="BgCard"     Color="#ffffff"/>
    <SolidColorBrush x:Key="BgInput"    Color="#ffffff"/>
    <SolidColorBrush x:Key="BgFill"     Color="#e9e9eb"/>
    <SolidColorBrush x:Key="BgElevated" Color="#ffffff"/>
    <SolidColorBrush x:Key="Border"     Color="#d9d9de"/>

    <SolidColorBrush x:Key="TextPrimary"   Color="#1c1c1e"/>
    <SolidColorBrush x:Key="TextSecondary" Color="#6c6c70"/>
    <SolidColorBrush x:Key="TextMuted"     Color="#8e8e93"/>

    <SolidColorBrush x:Key="Accent"      Color="#007aff"/>
    <SolidColorBrush x:Key="AccentHover" Color="#0069d9"/>

    <SolidColorBrush x:Key="BgBadge"   Color="#e5f0ff"/>
    <SolidColorBrush x:Key="TextBadge" Color="#007aff"/>

    <SolidColorBrush x:Key="StatusOk"    Color="#34c759"/>
    <SolidColorBrush x:Key="StatusError" Color="#ff3b30"/>
    <SolidColorBrush x:Key="StatusWarn"  Color="#ff9500"/>

    <SolidColorBrush x:Key="BgStatusError"        Color="#fff0ef"/>
    <SolidColorBrush x:Key="BorderStatusError"    Color="#ffd3d0"/>
    <SolidColorBrush x:Key="TextStatusErrorTitle" Color="#b3261e"/>
    <SolidColorBrush x:Key="TextStatusError"      Color="#d70015"/>

    <SolidColorBrush x:Key="BgStatusWarn"        Color="#fff8ef"/>
    <SolidColorBrush x:Key="BorderStatusWarn"    Color="#ffe1b3"/>
    <SolidColorBrush x:Key="TextStatusWarnTitle" Color="#8a5300"/>
    <SolidColorBrush x:Key="TextStatusWarn"      Color="#b25e00"/>

    <SolidColorBrush x:Key="LogBg"   Color="#0a000000"/>
    <SolidColorBrush x:Key="LogText" Color="#248a3d"/>

    <CornerRadius x:Key="RadiusLg">16</CornerRadius>
    <CornerRadius x:Key="RadiusMd">12</CornerRadius>
    <CornerRadius x:Key="RadiusSm">8</CornerRadius>
    <!-- Capsule buttons; the React version used Tailwind's rounded-full. -->
    <CornerRadius x:Key="RadiusPill">999</CornerRadius>

    <DropShadowEffect x:Key="ShadowPill" BlurRadius="3" ShadowDepth="1"
                      Opacity="0.12" Color="#000000"/>
    <DropShadowEffect x:Key="ShadowPop" BlurRadius="30" ShadowDepth="8"
                      Opacity="0.12" Color="#000000"/>
</ResourceDictionary>
```

- [ ] **Step 2: Write the dark dictionary**

`Themes/Dark.xaml` -- identical keys, true-black system background with elevated neutral gray cards. Same `x:Key` set as Light so a swap cannot leave a dangling reference:

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <SolidColorBrush x:Key="BgPage"     Color="#000000"/>
    <SolidColorBrush x:Key="BgCard"     Color="#1c1c1e"/>
    <SolidColorBrush x:Key="BgInput"    Color="#2c2c2e"/>
    <SolidColorBrush x:Key="BgFill"     Color="#2c2c2e"/>
    <SolidColorBrush x:Key="BgElevated" Color="#48484a"/>
    <SolidColorBrush x:Key="Border"     Color="#38383a"/>

    <SolidColorBrush x:Key="TextPrimary"   Color="#ffffff"/>
    <SolidColorBrush x:Key="TextSecondary" Color="#98989f"/>
    <SolidColorBrush x:Key="TextMuted"     Color="#8e8e93"/>

    <SolidColorBrush x:Key="Accent"      Color="#007aff"/>
    <SolidColorBrush x:Key="AccentHover" Color="#0a84ff"/>

    <SolidColorBrush x:Key="BgBadge"   Color="#0a2540"/>
    <SolidColorBrush x:Key="TextBadge" Color="#64b5ff"/>

    <SolidColorBrush x:Key="StatusOk"    Color="#30d158"/>
    <SolidColorBrush x:Key="StatusError" Color="#ff453a"/>
    <SolidColorBrush x:Key="StatusWarn"  Color="#ff9f0a"/>

    <SolidColorBrush x:Key="BgStatusError"        Color="#2a1513"/>
    <SolidColorBrush x:Key="BorderStatusError"    Color="#5c1d18"/>
    <SolidColorBrush x:Key="TextStatusErrorTitle" Color="#ffb3ae"/>
    <SolidColorBrush x:Key="TextStatusError"      Color="#ff453a"/>

    <SolidColorBrush x:Key="BgStatusWarn"        Color="#2a1e0a"/>
    <SolidColorBrush x:Key="BorderStatusWarn"    Color="#5c3d0f"/>
    <SolidColorBrush x:Key="TextStatusWarnTitle" Color="#ffcf80"/>
    <SolidColorBrush x:Key="TextStatusWarn"      Color="#ff9f0a"/>

    <SolidColorBrush x:Key="LogBg"   Color="#0dffffff"/>
    <SolidColorBrush x:Key="LogText" Color="#30d158"/>

    <CornerRadius x:Key="RadiusLg">16</CornerRadius>
    <CornerRadius x:Key="RadiusMd">12</CornerRadius>
    <CornerRadius x:Key="RadiusSm">8</CornerRadius>
    <CornerRadius x:Key="RadiusPill">999</CornerRadius>

    <DropShadowEffect x:Key="ShadowPill" BlurRadius="3" ShadowDepth="1"
                      Opacity="0.40" Color="#000000"/>
    <DropShadowEffect x:Key="ShadowPop" BlurRadius="30" ShadowDepth="8"
                      Opacity="0.50" Color="#000000"/>
</ResourceDictionary>
```

Both dictionaries declare the **same 32 keys** -- 31 tokens from `app/globals.css` plus `RadiusPill`. A key present in one and missing from the other is a crash on theme switch, so keep them in lockstep.

- [ ] **Step 3: Write the theme manager**

The pre-paint script in `app/layout.tsx` existed to avoid a flash of the wrong theme. WPF has no equivalent problem as long as the dictionary is applied in `OnStartup` before the window is shown -- which this does.

```csharp
using System.Windows;
using MediaDetector.Core.Storage;
using Microsoft.Win32;

namespace MediaDetector.App.Themes;

public static class ThemeManager
{
    private static ResourceDictionary? _current;

    // Resolves AppThemeMode.System against the OS setting, matching what
    // prefers-color-scheme did in the browser.
    public static bool IsDark(AppThemeMode mode) => mode switch
    {
        AppThemeMode.Light => false,
        AppThemeMode.Dark => true,
        _ => IsSystemDark(),
    };

    private static bool IsSystemDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            // AppsUseLightTheme: 0 = dark, 1 = light. Absent on older builds.
            return key?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch
        {
            return false;
        }
    }

    // Must be called before the main window is shown, or the first paint uses
    // the wrong palette.
    public static void Apply(AppThemeMode mode)
    {
        var uri = new Uri(
            IsDark(mode) ? "Themes/Dark.xaml" : "Themes/Light.xaml", UriKind.Relative);
        var dict = (ResourceDictionary)Application.LoadComponent(uri);

        var merged = Application.Current.Resources.MergedDictionaries;
        if (_current is not null) merged.Remove(_current);
        // Insert at 0 so control styles (added later) can override tokens if needed.
        merged.Insert(0, dict);
        _current = dict;

        // StatusIcon draws itself in OnRender and resolves brushes by key, so a
        // DynamicResource swap does not reach it. Repaint every live instance.
        foreach (Window window in Application.Current.Windows)
            Controls.StatusIcon.InvalidateAll(window);
    }
}
```

- [ ] **Step 4: Verify**
Run: `dotnet build desktop/MediaDetector.sln`
Expected: Build succeeded. Temporarily set the window background to `{DynamicResource BgPage}` and confirm calling `ThemeManager.Apply(AppThemeMode.Dark)` at runtime repaints it black without a restart. Every consumer must use **`DynamicResource`**, not `StaticResource` -- `StaticResource` resolves once and a theme switch would not reach it.

### Task 22: Shared control styles

Replaces the Tailwind class strings the React components repeated. Five styles cover essentially the whole UI.

**Files:**
- Create: `desktop/MediaDetector.App/Themes/Controls.xaml`
- Create: `desktop/MediaDetector.App/Controls/StatusIcon.cs`
- Create: `desktop/MediaDetector.App/Controls/SegmentedControl.cs`

- [ ] **Step 1: Write the control styles**

`Themes/Controls.xaml` -- the card, the two pill buttons, the thin progress bar, and the focus ring. The focus ring reproduces the `:focus-visible` rule from `globals.css`; the CLAUDE.md warning applies equally here, so no control may set its own focus visual.

```xml
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
                    xmlns:ctrl="clr-namespace:MediaDetector.App.Controls">

    <!-- Cards: rounded-2xl in the React version. Radii come from the theme
         dictionary, never hardcoded, so a change lands in one place. -->
    <Style x:Key="Card" TargetType="Border">
        <Setter Property="Background" Value="{DynamicResource BgCard}"/>
        <Setter Property="BorderBrush" Value="{DynamicResource Border}"/>
        <Setter Property="BorderThickness" Value="1"/>
        <Setter Property="CornerRadius" Value="{DynamicResource RadiusLg}"/>
        <Setter Property="Padding" Value="16,12"/>
    </Style>

    <!-- Rows and inputs: rounded-xl. -->
    <Style x:Key="Row" TargetType="Border" BasedOn="{StaticResource Card}">
        <Setter Property="CornerRadius" Value="{DynamicResource RadiusMd}"/>
    </Style>

    <!-- Action buttons are full-radius capsules in the React version. -->
    <Style x:Key="PillPrimary" TargetType="Button">
        <Setter Property="Foreground" Value="White"/>
        <Setter Property="Background" Value="{DynamicResource Accent}"/>
        <Setter Property="Padding" Value="16,6"/>
        <Setter Property="FontSize" Value="12"/>
        <Setter Property="FontWeight" Value="SemiBold"/>
        <Setter Property="Cursor" Value="Hand"/>
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Bd" Background="{TemplateBinding Background}"
                            CornerRadius="{DynamicResource RadiusPill}"
                            Padding="{TemplateBinding Padding}">
                        <ContentPresenter HorizontalAlignment="Center"
                                          VerticalAlignment="Center"/>
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Bd" Property="Opacity" Value="0.9"/>
                        </Trigger>
                        <Trigger Property="IsPressed" Value="True">
                            <Setter TargetName="Bd" Property="Opacity" Value="0.7"/>
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Bd" Property="Opacity" Value="0.5"/>
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style x:Key="PillNeutral" TargetType="Button" BasedOn="{StaticResource PillPrimary}">
        <Setter Property="Foreground" Value="{DynamicResource TextSecondary}"/>
        <Setter Property="Background" Value="{DynamicResource BgFill}"/>
    </Style>

    <!-- Thin accent bar on a fill track; matches the h-1.5 rounded bar. -->
    <Style x:Key="ThinBar" TargetType="ProgressBar">
        <Setter Property="Height" Value="6"/>
        <Setter Property="Background" Value="{DynamicResource BgFill}"/>
        <Setter Property="Foreground" Value="{DynamicResource Accent}"/>
        <Setter Property="BorderThickness" Value="0"/>
        <Setter Property="Template">
            <Setter.Value>
                <!-- PART_Track is REQUIRED, not decorative. ProgressBar's
                     SetProgressBarIndicatorLength() is guarded by
                     `if (_track != null && _indicator != null)`, where _track is
                     GetTemplateChild("PART_Track"). Omit it and the indicator
                     width is never set: the bar renders but never moves, which
                     silently defeats every progress acceptance criterion. -->
                <ControlTemplate TargetType="ProgressBar">
                    <Border x:Name="PART_Track" Background="{TemplateBinding Background}"
                            CornerRadius="{DynamicResource RadiusPill}" ClipToBounds="True">
                        <Border x:Name="PART_Indicator" HorizontalAlignment="Left"
                                Background="{TemplateBinding Foreground}"
                                CornerRadius="{DynamicResource RadiusPill}"/>
                    </Border>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <!-- Keyboard focus ring in the accent colour. Controls must NOT set their own
         FocusVisualStyle -- doing so silently kills this, exactly as an inline
         `outline: none` did in the CSS version. -->
    <Style x:Key="AccentFocus">
        <Setter Property="Control.Template">
            <Setter.Value>
                <ControlTemplate>
                    <Rectangle Margin="-3" StrokeThickness="2" RadiusX="6" RadiusY="6"
                               Stroke="{DynamicResource Accent}" SnapsToDevicePixels="True"/>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <!-- WPF has no global :focus-visible, so the ring has to be applied rather
         than merely declared. These implicit styles do what the CSS rule did:
         without them every control keeps its default dotted rectangle and the
         accent ring above is dead code. Add one line per control type used. -->
    <Style TargetType="{x:Type Button}" BasedOn="{StaticResource {x:Type Button}}">
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocus}"/>
    </Style>
    <Style TargetType="{x:Type TextBox}" BasedOn="{StaticResource {x:Type TextBox}}">
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocus}"/>
    </Style>
    <Style TargetType="{x:Type ComboBox}" BasedOn="{StaticResource {x:Type ComboBox}}">
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocus}"/>
    </Style>
    <Style TargetType="{x:Type ToggleButton}" BasedOn="{StaticResource {x:Type ToggleButton}}">
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocus}"/>
    </Style>
    <Style TargetType="{x:Type ListBoxItem}" BasedOn="{StaticResource {x:Type ListBoxItem}}">
        <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocus}"/>
    </Style>

    <!-- StatusIcon renders itself and needs no template, only a default size. -->
    <Style TargetType="{x:Type ctrl:StatusIcon}">
        <Setter Property="Width" Value="10"/>
        <Setter Property="Height" Value="10"/>
        <Setter Property="Focusable" Value="False"/>
    </Style>
</ResourceDictionary>
```

The root element needs `xmlns:ctrl="clr-namespace:MediaDetector.App.Controls"` for that last style.

**Composite fields.** `UrlInputView` puts an input and buttons in one bordered box. As in `globals.css`'s `.field-shell` rule, the ring goes on the **box**, not the inner `TextBox`: give the outer `Border` a trigger on `FocusManager.IsFocusWithin` that sets `BorderBrush` to `Accent` and `BorderThickness` to 2, and set `FocusVisualStyle="{x:Null}"` on the inner `TextBox` only. Without this the ring draws around the bare input and reads as a blue rectangle floating inside the field.

- [ ] **Step 2: Write StatusIcon**

Replaces `components/StatusIcon.tsx`, the single source of status glyphs. Filled discs, five kinds, with an accessible name.

```csharp
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace MediaDetector.App.Controls;

public enum StatusIconKind { Check, Error, Warn, Active, Idle }

// One source of status glyphs, backing the dependency rows, the finished-download
// row and the playlist track list. Pass Label to expose it to assistive tech;
// omit it for decoration.
public sealed class StatusIcon : Control
{
    public static readonly DependencyProperty KindProperty =
        DependencyProperty.Register(nameof(Kind), typeof(StatusIconKind), typeof(StatusIcon),
            new PropertyMetadata(StatusIconKind.Idle, OnVisualChanged));

    public static readonly DependencyProperty LabelProperty =
        DependencyProperty.Register(nameof(Label), typeof(string), typeof(StatusIcon),
            new PropertyMetadata(null, OnLabelChanged));

    public StatusIconKind Kind
    {
        get => (StatusIconKind)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    public string? Label
    {
        get => (string?)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    // Deliberately NO DefaultStyleKeyProperty.OverrideMetadata here. That opts
    // the control into theme-dictionary lookup, which needs Themes/Generic.xaml
    // plus an [assembly: ThemeInfo]; without them the control gets no template,
    // measures 0x0, and OnRender draws a zero-radius circle -- every glyph
    // invisible. This control renders itself, so it only needs a default size.
    static StatusIcon()
    {
        WidthProperty.OverrideMetadata(
            typeof(StatusIcon), new FrameworkPropertyMetadata(10.0));
        HeightProperty.OverrideMetadata(
            typeof(StatusIcon), new FrameworkPropertyMetadata(10.0));
    }

    // Repaints every live icon after a theme swap; OnRender resolves brushes by
    // key, so without this they keep the old palette until something else
    // invalidates them.
    public static void InvalidateAll(DependencyObject root)
    {
        if (root is StatusIcon icon) icon.InvalidateVisual();
        var count = System.Windows.Media.VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < count; i++)
            InvalidateAll(System.Windows.Media.VisualTreeHelper.GetChild(root, i));
    }

    private static void OnVisualChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        => ((StatusIcon)d).InvalidateVisual();

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        // WPF has no AutomationProperties.SetAccessibilityView -- that is a
        // WinUI API and was residue from the rejected WinUI 3 draft. A
        // decorative icon is simply left unnamed; screen readers skip an
        // unnamed, non-focusable element.
        AutomationProperties.SetName(d, (string?)e.NewValue ?? "");
    }

    // Glyph paths in the source's 16x16 viewBox (StatusIcon.tsx:42-70), scaled to
    // the control's actual size. These are NOT decoration: without them `check`
    // and `error` differ only by colour, which is a parity loss and fails for
    // colour-blind users.
    private static readonly Geometry CheckMark =
        Geometry.Parse("M4.5,8.2 L6.8,10.5 L11.5,5.6");
    private static readonly Geometry CrossMark =
        Geometry.Parse("M5.4,5.4 L10.6,10.6 M10.6,5.4 L5.4,10.6");
    private static readonly Geometry BangMark =
        Geometry.Parse("M8,4.2 L8,8.6 M8,11.15 L8,11.25");

    protected override void OnRender(DrawingContext dc)
    {
        var size = Math.Min(ActualWidth, ActualHeight);
        if (size <= 0) return;

        var key = Kind switch
        {
            StatusIconKind.Check => "StatusOk",
            StatusIconKind.Error => "StatusError",
            StatusIconKind.Warn => "StatusWarn",
            StatusIconKind.Active => "Accent",
            _ => "Border",
        };
        // TryFindResource, not FindResource: the latter throws if the theme
        // dictionary is not merged yet (design-time, or a render before startup
        // completes), and an exception in OnRender takes the window down.
        var brush = TryFindResource(key) as Brush ?? Brushes.Gray;
        var centre = new Point(ActualWidth / 2, ActualHeight / 2);
        var scale = size / 16.0;

        if (Kind == StatusIconKind.Idle)
        {
            // Hairline ring, so a pending row occupies the same width as a
            // finished one.
            dc.DrawEllipse(null, new Pen(brush, 1.5 * scale), centre, 6.5 * scale, 6.5 * scale);
            return;
        }

        dc.DrawEllipse(brush, null, centre, size / 2, size / 2);

        if (Kind == StatusIconKind.Active)
        {
            dc.DrawEllipse(Brushes.White, null, centre, 3 * scale, 3 * scale);
            return;
        }

        var glyph = Kind switch
        {
            StatusIconKind.Check => CheckMark,
            StatusIconKind.Error => CrossMark,
            _ => BangMark,
        };
        var pen = new Pen(Brushes.White, 1.8 * scale)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round,
        };

        dc.PushTransform(new TranslateTransform(
            centre.X - size / 2, centre.Y - size / 2));
        dc.PushTransform(new ScaleTransform(scale, scale));
        dc.DrawGeometry(null, pen, glyph);
        dc.Pop();
        dc.Pop();
    }
}
```

- [ ] **Step 3: Write SegmentedControl**

Replaces the iOS segmented control used by `FormatTabs` and the playlist audio/video switch: a fill-coloured track with an elevated pill on the selected segment.

```csharp
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;

namespace MediaDetector.App.Controls;

// iOS-style segmented control. Built on ListBox so selection, keyboard
// navigation and binding all come for free; only the chrome is replaced.
//
// Deliberately NO DefaultStyleKeyProperty.OverrideMetadata -- same reason as
// StatusIcon. Overriding the default style key sends WPF looking in
// Themes/Generic.xaml, which this project does not have, and the control would
// end up with no template at all. Without the override it inherits ListBox's
// working default style, and the implicit style below replaces the chrome.
public sealed class SegmentedControl : ListBox
{
}
```

Its style is an **implicit** style in `Controls.xaml`, keyed by type so it applies without an `x:Key`:

```xml
<Style TargetType="{x:Type ctrl:SegmentedControl}"
       BasedOn="{StaticResource {x:Type ListBox}}">
    <Setter Property="Background" Value="{DynamicResource BgFill}"/>
    <Setter Property="BorderThickness" Value="0"/>
    <Setter Property="Padding" Value="3"/>
    <Setter Property="ItemsPanel">
        <Setter.Value>
            <ItemsPanelTemplate>
                <UniformGrid Rows="1"/>
            </ItemsPanelTemplate>
        </Setter.Value>
    </Setter>
    <Setter Property="Template">
        <Setter.Value>
            <ControlTemplate TargetType="{x:Type ctrl:SegmentedControl}">
                <Border Background="{TemplateBinding Background}"
                        CornerRadius="{DynamicResource RadiusMd}"
                        Padding="{TemplateBinding Padding}">
                    <ItemsPresenter/>
                </Border>
            </ControlTemplate>
        </Setter.Value>
    </Setter>
    <Setter Property="ItemContainerStyle">
        <Setter.Value>
            <Style TargetType="ListBoxItem">
                <Setter Property="HorizontalContentAlignment" Value="Center"/>
                <Setter Property="Padding" Value="0,6"/>
                <Setter Property="Foreground" Value="{DynamicResource TextSecondary}"/>
                <Setter Property="FocusVisualStyle" Value="{StaticResource AccentFocus}"/>
                <Setter Property="Template">
                    <Setter.Value>
                        <ControlTemplate TargetType="ListBoxItem">
                            <Border x:Name="Pill" Background="Transparent"
                                    CornerRadius="{DynamicResource RadiusSm}"
                                    Padding="{TemplateBinding Padding}">
                                <ContentPresenter HorizontalAlignment="Center"/>
                            </Border>
                            <ControlTemplate.Triggers>
                                <!-- The elevated pill on the selected segment is
                                     the whole point of the iOS control. -->
                                <Trigger Property="IsSelected" Value="True">
                                    <Setter TargetName="Pill" Property="Background"
                                            Value="{DynamicResource BgElevated}"/>
                                    <Setter TargetName="Pill" Property="Effect"
                                            Value="{DynamicResource ShadowPill}"/>
                                    <Setter Property="Foreground"
                                            Value="{DynamicResource TextPrimary}"/>
                                </Trigger>
                                <Trigger Property="IsEnabled" Value="False">
                                    <Setter Property="Opacity" Value="0.4"/>
                                </Trigger>
                            </ControlTemplate.Triggers>
                        </ControlTemplate>
                    </Setter.Value>
                </Setter>
            </Style>
        </Setter.Value>
    </Setter>
</Style>
```

- [ ] **Step 4: Verify**
Run: `dotnet build desktop/MediaDetector.sln`
Expected: Build succeeded. Drop all five styles plus a `StatusIcon` of each kind and a two-item `SegmentedControl` onto a scratch window; toggle the theme and confirm every element repaints and the selected segment keeps its elevated pill.

---

## Phase 5: Views and view models

Every view model consumes Core through `await foreach` and marshals to the UI thread. WPF's `Dispatcher` does what `DispatcherQueue` would have done in WinUI.

### Task 23: App shell and the marshalling pattern

**Files:**
- Create: `desktop/MediaDetector.App/App.xaml`, `App.xaml.cs`
- Create: `desktop/MediaDetector.App/Services.cs`
- Create: `desktop/MediaDetector.App/ViewModels/ObservableBase.cs`
- Create: `desktop/MediaDetector.App/MainWindow.xaml`, `MainWindow.xaml.cs`

- [ ] **Step 1: Write the app shell**

`App.xaml.cs` -- theme applied before the window is shown, which is why WPF needs no equivalent of the pre-paint script:

```csharp
using System.Windows;
using MediaDetector.App.Themes;
using MediaDetector.Core.Storage;

namespace MediaDetector.App;

public partial class App : Application
{
    public static AppSettings Settings { get; private set; } = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Settings = AppSettings.Load();
        // Before any window is shown -- no flash of the wrong theme.
        ThemeManager.Apply(Settings.Theme);
        new MainWindow().Show();
    }
}
```

`App.xaml` merges `Controls.xaml` (the theme dictionary is inserted at index 0 by `ThemeManager`) and sets the SF-then-Segoe font stack matching `globals.css`:

```xml
<Application x:Class="MediaDetector.App.App"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <Application.Resources>
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <ResourceDictionary Source="Themes/Controls.xaml"/>
            </ResourceDictionary.MergedDictionaries>
            <FontFamily x:Key="AppFont">Segoe UI Variable Text, Segoe UI, system-ui</FontFamily>
        </ResourceDictionary>
    </Application.Resources>
</Application>
```

- [ ] **Step 2: Write the marshalling base**

Every streaming view model uses this one method, so the `Dispatcher` detail appears once rather than in seven view models.

```csharp
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using MediaDetector.Core.Models;

namespace MediaDetector.App.ViewModels;

public abstract partial class StreamingViewModel : ObservableObject
{
    // Core yields on a background thread; every mutation of an observable
    // property must be marshalled or WPF throws on cross-thread access.
    protected static async Task ConsumeAsync(
        IAsyncEnumerable<DownloadLine> source,
        Action<DownloadLine> apply,
        CancellationToken ct)
    {
        await foreach (var line in source.WithCancellation(ct))
        {
            var captured = line;
            await Application.Current.Dispatcher.InvokeAsync(() => apply(captured));
        }
    }
}
```

- [ ] **Step 2b: Write the theme view model**

Replaces `hooks/useTheme.ts` and `components/ThemeButton.tsx`. Without this nothing ever writes `AppSettings.Theme`, so the header criterion "Light/dark toggle persists across restarts" is unmet even though `AppSettings` has the field.

```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.App.Themes;
using MediaDetector.Core.Storage;

namespace MediaDetector.App.ViewModels;

public sealed partial class ThemeViewModel : ObservableObject
{
    [ObservableProperty] private AppThemeMode _mode = App.Settings.Theme;

    public bool IsDark => ThemeManager.IsDark(Mode);
    // Sun when dark (click for light), moon when light.
    public string Glyph => IsDark ? "☀" : "☽";

    // Two-state toggle like ThemeButton.tsx: System resolves against the OS on
    // first launch, then the user's explicit choice sticks.
    [RelayCommand]
    private void Toggle()
    {
        Mode = IsDark ? AppThemeMode.Light : AppThemeMode.Dark;
        ThemeManager.Apply(Mode);
        App.Settings.Theme = Mode;
        App.Settings.Save();
        OnPropertyChanged(nameof(IsDark));
        OnPropertyChanged(nameof(Glyph));
    }
}
```

- [ ] **Step 3: Write the main window**

`MainWindow.xaml` is a `ScrollViewer` over a vertical `StackPanel`, mirroring `app/page.tsx`'s `max-w-2xl space-y-5` column: title row with the theme toggle on the right, then `StatusBarView`, `OutputDirRow`, `UrlInputView`, an error banner bound to `MainViewModel.Error`, then `MediaInfoView` + `FileNameRow` + `FormatTabsView` when a video is detected, and `PlaylistPanelView` when a playlist is. Window is 720x900, `MinWidth 560`, background `{DynamicResource BgPage}`.

`MainViewModel` mirrors `Home`:

```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Dependencies;   // DependencyChecker (Step 3b)
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;         // NameSource (Step 3b)
using MediaDetector.Core.Services;
using MediaDetector.Core.Validation;

namespace MediaDetector.App.ViewModels;

public sealed partial class MainViewModel : ObservableObject
{
    private readonly DetectService _detect = new();

    // Field form, not `public partial string Url { get; set; } = ""`. A defining
    // partial property declaration may not carry an initializer -- that is
    // CS8050 -- whereas a private field may, which keeps each default next to
    // its declaration instead of in a constructor. Both forms generate the same
    // public property; the field form also drops the LangVersion 13 requirement.
    [ObservableProperty] private string _url = "";
    [ObservableProperty] private bool _detecting;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private MediaInfo? _media;
    [ObservableProperty] private PlaylistInfo? _playlist;

    // Status is declared once, in Step 3b, with its StatusService injected.
    public OutputDirViewModel OutputDir { get; } = new();
    public ThemeViewModel Theme { get; } = new();

    // Hoisted here because app/page.tsx:30 reads useCleanNames() once and hands
    // the same value to BOTH the single-video and playlist flows. Owning a copy
    // per panel would let the two disagree.
    [ObservableProperty] private bool _cleanNames = App.Settings.CleanNames;

    partial void OnCleanNamesChanged(bool value)
    {
        App.Settings.CleanNames = value;
        App.Settings.Save();
    }

    [RelayCommand]
    private async Task DetectAsync(CancellationToken ct)
    {
        Error = null;
        Media = null;
        Playlist = null;
        Detecting = true;
        try
        {
            var kind = YouTubeUrl.GetKind(Url);
            if (!kind.HasVideo && !kind.HasPlaylist)
            {
                Error = "Enter a YouTube video or playlist link";
                return;
            }

            // Both flows run in parallel for a watch+list URL, as in page.tsx.
            var videoTask = kind.HasVideo ? _detect.DetectVideoAsync(Url, ct) : null;
            var listTask = kind.HasPlaylist ? _detect.DetectPlaylistAsync(Url, ct) : null;

            if (videoTask is not null)
            {
                var result = await videoTask;
                if (result.Ok) Media = result.Value;
                else Error = result.Error;
            }
            if (listTask is not null)
            {
                var result = await listTask;
                // Playlist failure is non-fatal -- the single-video flow may still work.
                if (result.Ok) Playlist = result.Value;
            }
        }
        finally
        {
            Detecting = false;
        }
    }
}
```

- [ ] **Step 3b: Wire the child view models explicitly**

This is the seam the whole "one source of truth" guarantee rests on: if `BuildRequest` reads a stale copy of `CleanNames` or `CustomName`, the previewed name and the file on disk diverge, which is exactly what `lib/filename.ts` was restructured to prevent. It is a closure over the live view models, never a snapshot.

```csharp
// MainViewModel, continued.

public StatusBarViewModel Status { get; } =
    new(new StatusService(_ => DependencyChecker.BuildDefaultAsync()));

[ObservableProperty] private FileNameViewModel? _fileName;
[ObservableProperty] private FormatTabsViewModel? _formats;
[ObservableProperty] private PlaylistPanelViewModel? _playlistPanel;

partial void OnMediaChanged(MediaInfo? value)
{
    if (value == null)
    {
        FileName = null;
        Formats = null;
        return;
    }

    var source = new NameSource(
        value.Title, value.Track, value.Artist, Uploader: value.Channel);

    FileName = new FileNameViewModel { Source = source, Clean = CleanNames };

    Formats = FormatTabsViewModel.From(value, formatId => new FormatRowViewModel
    {
        // Closure, not a captured value: every field is read at click time, so a
        // rename or a Cleaned/Original toggle after detection still applies.
        BuildRequest = () => new DownloadRequest(
            Url,
            formatId.FormatId,
            source,
            formatId.Ext,
            OutputDir.Dir,
            CleanNames,
            FileName?.CustomName),
    });
}

partial void OnPlaylistChanged(PlaylistInfo? value)
{
    if (value == null)
    {
        PlaylistPanel = null;
        return;
    }

    var panel = new PlaylistPanelViewModel
    {
        Url = Url,
        PlaylistTitle = value.Title,
        GetCleanNames = () => CleanNames,
        GetOutputDir = () => OutputDir.Dir,
        GetFfmpegReady = () => Status.Current?.Ffmpeg.Found == true,
    };
    foreach (var t in value.Tracks)
    {
        panel.Tracks.Add(new PlaylistTrackViewModel
        {
            Index = t.Index,
            OriginalTitle = t.Title,
            Author = t.Author,
            GetClean = () => CleanNames,
            GetShowOriginal = () => panel.ShowOriginalTitles,
        });
    }
    panel.Total = value.Count;
    PlaylistPanel = panel;
}

// CleanNames is hoisted here, so a toggle must refresh whichever panels exist.
partial void OnCleanNamesChanged(bool value)
{
    App.Settings.CleanNames = value;
    App.Settings.Save();
    if (FileName != null) FileName.Clean = value;
    PlaylistPanel?.RefreshNames();
}
```

Three contracts this code depends on, all declared in their own tasks:

| Member | Declared in | Shape |
|---|---|---|
| `FormatTabsViewModel.From` | Task 26 Step 2 | `static FormatTabsViewModel From(MediaInfo info, Func<IMediaFormat, FormatRowViewModel> makeRow)`. `VideoFormat` and `AudioFormat` are unrelated records, so a single lambda can only reach `.FormatId`/`.Ext` through the shared `IMediaFormat` interface added in Task 2. |
| `StatusBarViewModel.Current` | Task 24 | `StatusResult?` -- the last probe result, so `GetFfmpegReady` reads live rather than at construction time. |
| `PlaylistPanelViewModel.RefreshNames` | Task 27 Step 2 | Re-raises the display-name change for every track. |

Delete the duplicate `Status` property and `OnCleanNamesChanged` from Step 3 -- these are the complete versions.

- [ ] **Step 4: Run -- expect a working shell**
Run: `dotnet run --project desktop/MediaDetector.App`
Expected: window opens with the correct theme on first paint, title and empty sections visible, no binding errors in the Output window.

### Task 24: Status bar

Replaces `components/StatusBar.tsx` and `LogPanel.tsx`, plus the new Node row.

**Files:**
- Create: `desktop/MediaDetector.App/ViewModels/StatusBarViewModel.cs`
- Create: `desktop/MediaDetector.App/Views/StatusBarView.xaml`
- Test: `desktop/MediaDetector.Core.Tests/Dependencies/DependencyRowTests.cs`

- [ ] **Step 1: Write the failing test**

`buildRows` is pure and worth keeping that way, so it moves to Core where it is testable without a UI. It gains a fourth row.

```csharp
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Tests.Dependencies;

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
            DependencyRows.Build(Status(update: UpdateStatus.Failed)).First(r => r.Label == "yt-dlp").State);

    // The collapsed summary and the expanded rows come from the same data, so
    // they cannot disagree.
    [Fact]
    public void Build_SummaryLineMatchesTheRows()
    {
        var rows = DependencyRows.Build(Status());
        Assert.Equal(
            "Python 3.12.2 . yt-dlp 2026.08.01 . Node 22.11.0 . ffmpeg 8.1.2",
            string.Join(" . ", rows.Select(r => r.Summary)));
    }
}
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DependencyRowTests"`
Expected: FAIL (DependencyRow does not exist)

- [ ] **Step 3: Write the implementation**

```csharp
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Dependencies;

public enum RowState { Ok, Error, Warn }
public enum RowAction { None, InstallYtdlp, RetryYtdlpUpdate, InstallNode, InstallFfmpeg }

public sealed record DependencyRow(
    string Label,
    RowState State,
    string Message,
    // Compact form for the collapsed summary line, e.g. "Python 3.12.2".
    string Summary,
    RowAction Action,
    string? HelpUrl = null);

public static class DependencyRows
{
    public static IReadOnlyList<DependencyRow> Build(StatusResult s)
    {
        var python = s.Python.Found
            ? new DependencyRow("Python", RowState.Ok,
                $"Version {s.Python.Version} detected", $"Python {s.Python.Version}", RowAction.None)
            : new DependencyRow("Python", RowState.Error,
                "Not found -- install Python 3.8+ to continue", "Python missing",
                RowAction.None, "https://python.org/downloads");

        var ytdlp = !s.Ytdlp.Found
            ? new DependencyRow("yt-dlp", RowState.Error,
                "Not installed -- required to detect and download media", "yt-dlp missing",
                s.Python.Found ? RowAction.InstallYtdlp : RowAction.None)
            : s.Ytdlp.UpdateStatus == UpdateStatus.Failed
                ? new DependencyRow("yt-dlp", RowState.Warn,
                    "Update failed -- click Retry to try again",
                    $"yt-dlp {s.Ytdlp.Version} (update failed)", RowAction.RetryYtdlpUpdate)
                : new DependencyRow("yt-dlp", RowState.Ok,
                    $"Version {s.Ytdlp.Version}" + s.Ytdlp.UpdateStatus switch
                    {
                        UpdateStatus.Updated => " -- updated",
                        UpdateStatus.UpToDate => " -- up to date",
                        _ => "",
                    },
                    $"yt-dlp {s.Ytdlp.Version}", RowAction.None);

        // Required: yt-dlp needs a JS runtime to solve YouTube's signature and "n"
        // challenges. Without one every format URL answers 403 and the only thing
        // a failed run leaves behind is a stray .webp.
        var node = s.Node.Found
            ? new DependencyRow("Node.js", RowState.Ok,
                $"Version {s.Node.Version} detected -- solves YouTube's JS challenges",
                $"Node {s.Node.Version}", RowAction.None)
            : new DependencyRow("Node.js", RowState.Error,
                "Not found -- yt-dlp needs a JavaScript runtime or downloads fail with HTTP 403",
                "Node missing", RowAction.InstallNode, "https://nodejs.org/en/download");

        // Optional: downloads work without it, but metadata/thumbnails need it.
        var ffmpeg = s.Ffmpeg.Found
            ? new DependencyRow("ffmpeg", RowState.Ok,
                $"Version {s.Ffmpeg.Version} detected -- metadata & thumbnails embedded",
                $"ffmpeg {s.Ffmpeg.Version}", RowAction.None)
            : new DependencyRow("ffmpeg", RowState.Warn,
                "Not found -- install ffmpeg to embed metadata & cover art", "ffmpeg missing",
                RowAction.InstallFfmpeg, "https://ffmpeg.org/download.html");

        return [python, ytdlp, node, ffmpeg];
    }
}
```

`StatusBarViewModel` holds `Rows`, `Headline` ("Ready" or "N problems"), `Subline` (summaries joined with " . "), `IsExpanded`, `LogLines` and `IsBusy`. The collapse rule from CLAUDE.md is preserved: when any row is `Error`/`Warn` the panel is force-expanded and the chevron hidden, because there is an action to take.

`StatusBarView.xaml` is a `Card` with a header `Grid` (StatusIcon, headline+subline, Recheck pill, chevron `ToggleButton` visible only when healthy), an `ItemsControl` over `Rows` inside a collapsible panel, and a monospace `ScrollViewer` log bound to `LogLines` using `LogBg`/`LogText`.

- [ ] **Step 4: Run -- expect PASS**
Run: `dotnet test desktop/MediaDetector.Core.Tests --filter "FullyQualifiedName~DependencyRowTests"`
Expected: 0 failed
Run: `dotnet run --project desktop/MediaDetector.App`
Expected: four rows, all green on this machine; clicking Recheck re-probes.

### Task 25: URL input, output folder, media info, file name row

Four small views, grouped because none carries significant logic.

**Files:**
- Create: `desktop/MediaDetector.App/Views/UrlInputView.xaml`
- Create: `desktop/MediaDetector.App/Views/OutputDirRow.xaml`
- Create: `desktop/MediaDetector.App/Views/MediaInfoView.xaml`
- Create: `desktop/MediaDetector.App/Views/FileNameRow.xaml`
- Create: `desktop/MediaDetector.App/ViewModels/OutputDirViewModel.cs`
- Create: `desktop/MediaDetector.App/ViewModels/FileNameViewModel.cs`

- [ ] **Step 1: Write the view models**

```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Naming;

namespace MediaDetector.App.ViewModels;

// Replaces components/FileNameRow.tsx. Shows what the download will be called
// before it starts and lets the user switch cleanup off or type a name outright.
// The extension is omitted because it is not settled until a format is chosen.
public sealed partial class FileNameViewModel : ObservableObject
{
    [ObservableProperty] private NameSource _source = new("");
    // Bound to MainViewModel.CleanNames, which owns persistence -- this view
    // model must not write AppSettings itself or the two flows can diverge.
    [ObservableProperty] private bool _clean = true;
    [ObservableProperty] private string? _customName;
    [ObservableProperty] private bool _isEditing;
    [ObservableProperty] private string _draft = "";
    [ObservableProperty] private bool _showOriginal;

    public string Original => FileNaming.RawStem(Source);
    public string Cleaned => FileNaming.DownloadStem(Source);
    public string Generated => Clean ? Cleaned : Original;
    public string Result => CustomName ?? Generated;
    // Only worth offering the comparison when the two actually differ.
    public bool Changed => Cleaned != Original;
    // A typed name wins over everything, so the Cleaned/Original switch no longer applies.
    public bool CanToggleClean => CustomName is null;

    partial void OnSourceChanged(NameSource value) => RefreshDerived();
    partial void OnCleanChanged(bool value) { IsEditing = false; RefreshDerived(); }
    partial void OnCustomNameChanged(string? value) => RefreshDerived();

    private void RefreshDerived()
    {
        OnPropertyChanged(nameof(Original));
        OnPropertyChanged(nameof(Cleaned));
        OnPropertyChanged(nameof(Generated));
        OnPropertyChanged(nameof(Result));
        OnPropertyChanged(nameof(Changed));
        OnPropertyChanged(nameof(CanToggleClean));
    }

    [RelayCommand]
    private void StartEditing()
    {
        Draft = Result;
        IsEditing = true;
    }

    [RelayCommand]
    private void Commit()
    {
        var trimmed = Draft.Trim();
        CustomName = trimmed.Length == 0 || trimmed == Generated ? null : trimmed;
        IsEditing = false;
    }

    [RelayCommand] private void CancelEditing() => IsEditing = false;
    [RelayCommand] private void ResetToAutomatic() => CustomName = null;
    [RelayCommand] private void ToggleClean() { if (CanToggleClean) Clean = !Clean; }
}
```

```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Storage;
using Microsoft.Win32;

namespace MediaDetector.App.ViewModels;

// Replaces hooks/useOutputDir.ts + components/OutputDirRow.tsx. The browser
// could not resolve ~/Documents, which is why the web version needed an endpoint;
// here the default is available directly.
public sealed partial class OutputDirViewModel : ObservableObject
{
    [ObservableProperty] private string _dir = OutputPaths.Resolve(App.Settings.OutputDir);

    partial void OnDirChanged(string value)
    {
        App.Settings.OutputDir = value == OutputPaths.Default() ? null : value;
        App.Settings.Save();
    }

    // A native folder picker replaces the free-text field the web app had to use.
    [RelayCommand]
    private void Browse()
    {
        var dialog = new OpenFolderDialog { InitialDirectory = Dir, Multiselect = false };
        if (dialog.ShowDialog() == true) Dir = dialog.FolderName;
    }

    [RelayCommand] private void Reset() => Dir = OutputPaths.Default();

    // Sync, and the error string is surfaced rather than discarded.
    // OpenInExplorer is a ShellExecute launcher; there is nothing to await.
    [ObservableProperty] private string? _openError;

    [RelayCommand] private void Open() => OpenError = OutputPaths.OpenInExplorer(Dir);
}
```

- [ ] **Step 2: Write the views**

- `UrlInputView`: a `Border` styled `Row` containing a `TextBox` (placeholder via an overlaid `TextBlock` bound to `Text.IsEmpty`) and a primary pill bound to `DetectCommand`, disabled while `Detecting` or when dependencies are missing. Enter key triggers `DetectCommand`. **The composite-field focus rule applies**: the ring goes on the outer `Border` via a `FocusManager.IsFocusWithin` trigger, and the inner `TextBox` sets `FocusVisualStyle="{x:Null}"` -- otherwise the ring draws around the bare input and reads as a blue rectangle floating inside the field.
- `OutputDirRow`: label "Save to", a read-only path `TextBlock` with `TextTrimming="CharacterEllipsis"`, then Browse / Open / Reset pills.
- `MediaInfoView`: thumbnail `Image` (bound to `Thumbnail`, `CacheOption=OnLoad`), title, channel, `DisplayFormat.FormatDuration(Duration)`, view count.
- `FileNameRow`: matches the React version's two states -- display mode (label, result, Edit pill, Cleaned/Original toggle) and edit mode (accent-bordered card, `TextBox`, Save/Cancel, hint text "The extension is added automatically. Enter to save, Escape to cancel."), with `Show original name` disclosure when `Changed`.

- [ ] **Step 3: Verify**
Run: `dotnet run --project desktop/MediaDetector.App`
Expected: pasting a real video URL populates the media card and the file-name row previews the same name the Task 3 cross-check produced. Tab to the URL field and confirm the focus ring is on the field box, not the inner text box.

### Task 26: Format list and single download

Replaces `FormatTabs.tsx`, `FormatRow.tsx` and `DownloadProgress.tsx`.

**Files:**
- Create: `desktop/MediaDetector.App/ViewModels/FormatRowViewModel.cs`
- Create: `desktop/MediaDetector.App/ViewModels/FormatTabsViewModel.cs`
- Create: `desktop/MediaDetector.App/Views/FormatTabsView.xaml`
- Create: `desktop/MediaDetector.App/Views/FormatRowView.xaml`

- [ ] **Step 1: Write the row view model**

This is where the `IAsyncEnumerable` decision pays off: the whole NDJSON reader loop from `FormatRow.tsx` collapses to one `await foreach` with a `switch`.

```csharp
using System.Diagnostics;   // UnreachableException
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Formatting;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Services;

namespace MediaDetector.App.ViewModels;

public sealed partial class FormatRowViewModel : StreamingViewModel
{
    // yt-dlp emits a progress line roughly every 100ms while bytes are moving, so
    // a longer gap means the transfer (or a postprocessor) is not talking.
    private const int StallAfterSeconds = 5;

    private readonly DownloadService _service = new();
    private readonly DispatcherTimer _idleTimer;
    private CancellationTokenSource? _cts;
    private DateTime? _lastUpdateAt;

    [ObservableProperty] private double _percent;
    [ObservableProperty] private string? _savedPath;
    [ObservableProperty] private string? _phaseLabel;
    [ObservableProperty] private string? _detailText;
    [ObservableProperty] private string? _error;
    [ObservableProperty] private bool _cancelled;
    [ObservableProperty] private bool _isDownloading;
    [ObservableProperty] private int _idleSeconds;

    public required Func<DownloadRequest> BuildRequest { get; init; }

    // Display surface the row's view binds to. Without these declared here,
    // Task 26 Step 3's view is un-implementable.
    public required string Badge { get; init; }        // "1080p" or "129kbps"
    public required string Ext { get; init; }
    public required string Codec { get; init; }
    public string? FpsText { get; init; }              // "60fps", or null
    public required string SizeText { get; init; }     // formatted, or "unknown size"
    public bool IsApplePlayable { get; init; }
    public bool IsAudio { get; init; }                 // gates the iPhone tag
    [ObservableProperty] private bool _isRecommended;

    public bool IsStalled => IsDownloading && IdleSeconds >= StallAfterSeconds;
    public bool ShowProgress => IsDownloading || SavedPath != null
                                || Error != null || Cancelled;
    // Finished: the bar has nothing left to say, so it gives way to the verified row.
    public string? SavedFolder => SavedPath == null ? null : DisplayFormat.ParentDir(SavedPath);
    public string ButtonLabel => Error != null || Cancelled ? "Retry" : "Download";

    public FormatRowViewModel()
    {
        // Explicit dispatcher: the parameterless ctor binds to
        // Dispatcher.CurrentDispatcher, so a view model constructed off the UI
        // thread would get a timer that silently never ticks -- and the
        // "no update for Ns" warning would die with no error.
        _idleTimer = new DispatcherTimer(DispatcherPriority.Normal, Application.Current.Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(1),
        };
        _idleTimer.Tick += (_, _) =>
        {
            IdleSeconds = _lastUpdateAt == null
                ? 0
                : (int)(DateTime.UtcNow - _lastUpdateAt.Value).TotalSeconds;
            OnPropertyChanged(nameof(IsStalled));
        };
    }

    [RelayCommand]
    private async Task DownloadAsync()
    {
        _cts = new CancellationTokenSource();
        IsDownloading = true;
        Percent = 0;
        SavedPath = null;
        Error = null;
        Cancelled = false;
        PhaseLabel = null;
        DetailText = null;
        _lastUpdateAt = DateTime.UtcNow;
        _idleTimer.Start();

        try
        {
            await ConsumeAsync(_service.RunAsync(BuildRequest(), _cts.Token), Apply, _cts.Token);
        }
        catch (OperationCanceledException)
        {
            // Belt and braces. The service normally emits an explicit
            // CancelledLine, which Apply handles; this covers the case where the
            // token trips before the service produced anything at all.
        }
        finally
        {
            // Read the token, not the exception: the service completes the
            // sequence normally after a cancel, so no exception may ever reach here.
            if (_cts?.IsCancellationRequested == true && SavedPath is null) Cancelled = true;
            _idleTimer.Stop();
            IsDownloading = false;
            _cts?.Dispose();
            _cts = null;
            OnPropertyChanged(nameof(ShowProgress));
            OnPropertyChanged(nameof(ButtonLabel));
        }
    }

    private void Apply(DownloadLine line)
    {
        _lastUpdateAt = DateTime.UtcNow;
        IdleSeconds = 0;
        switch (line)
        {
            case ProgressLine p:
                Percent = p.Percent;
                DetailText = string.Join(" . ",
                    $"{DisplayFormat.FormatBytes(p.DownloadedBytes)} / {DisplayFormat.FormatBytes(p.TotalBytes)}",
                    DisplayFormat.FormatSpeed(p.SpeedBytesPerSec),
                    $"ETA {DisplayFormat.FormatDuration(p.EtaSeconds)}")
                    + (p.FragmentCount > 1 ? $" . frag {p.FragmentIndex ?? 0}/{p.FragmentCount}" : "");
                break;

            case PhaseLine ph:
                PhaseLabel = ph.Label;
                // Outside the download phase there are no byte counters to show, and
                // leaving the last ones up would suggest a transfer that has stopped.
                if (ph.Phase != DownloadPhase.Downloading) DetailText = null;
                break;

            case DoneLine d:
                SavedPath = d.SavedPath;
                Percent = 100;
                PhaseLabel = null;
                OnPropertyChanged(nameof(SavedFolder));
                break;

            case ErrorLine e:
                Error = e.Message;
                PhaseLabel = null;
                break;

            case CancelledLine:
                Cancelled = true;
                PhaseLabel = null;
                DetailText = null;
                break;

            default:
                throw new UnreachableException($"unexpected line {line.GetType().Name}");
        }
    }

    [RelayCommand] private void Cancel() => _cts?.Cancel();

    [ObservableProperty] private string? _openError;

    [RelayCommand]
    private void OpenFolder() =>
        OpenError = SavedFolder == null
            ? "No folder to open"
            : Core.Storage.OutputPaths.OpenInExplorer(SavedFolder);
}
```

- [ ] **Step 2: Write the tabs view model**

```csharp
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MediaDetector.Core.Formatting;
using MediaDetector.Core.Formats;
using MediaDetector.Core.Models;

namespace MediaDetector.App.ViewModels;

public sealed partial class FormatTabsViewModel : ObservableObject
{
    public ObservableCollection<FormatRowViewModel> VideoRows { get; } = [];
    public ObservableCollection<FormatRowViewModel> AudioRows { get; } = [];

    [ObservableProperty] private bool _audioTabActive;

    public int VideoCount => VideoRows.Count;
    public int AudioCount => AudioRows.Count;

    // The callback takes IMediaFormat because VideoFormat and AudioFormat share
    // no base -- see Task 2. MainViewModel supplies the BuildRequest closure.
    public static FormatTabsViewModel From(
        MediaInfo info, Func<IMediaFormat, FormatRowViewModel> makeRow)
    {
        var tabs = new FormatTabsViewModel();
        var bestVideo = Recommend.VideoId(info.VideoFormats);
        var bestAudio = Recommend.AudioId(info.AudioFormats);

        foreach (var f in info.VideoFormats)
        {
            var row = makeRow(f) with { };
            row.IsRecommended = f.FormatId == bestVideo;
            tabs.VideoRows.Add(row);
        }

        // Apple-playable containers float to the top, bitrate order preserved.
        foreach (var f in AudioCompat.SortAudioForApple(info.AudioFormats))
        {
            var row = makeRow(f);
            row.IsRecommended = f.FormatId == bestAudio;
            tabs.AudioRows.Add(row);
        }

        return tabs;
    }
}
```

> `FormatRowViewModel` is a class, not a record, so drop the `with { }` above -- `makeRow(f)` returns the finished row and `IsRecommended` is set on it directly. `makeRow` is responsible for populating `Badge`/`Ext`/`Codec`/`FpsText`/`SizeText`/`IsApplePlayable`/`IsAudio` from the format it is handed: `Badge` is `$"{v.Height}p"` for video and `$"{a.Abr ?? 0}kbps"` for audio, `SizeText` is `DisplayFormat.FormatBytes(f.Filesize)` or `"unknown size"` when null.

- [ ] **Step 3: Write the views**

`FormatTabsView` is a `SegmentedControl` over Video/Audio with counts, then an `ItemsControl` of `FormatRowView`. `FormatRowView` is a `Row`-styled `Border` whose `BorderBrush` binds to `IsRecommended` (accent when true), containing badges (resolution or bitrate, ext, codec, fps, "Best", and the iPhone / Not on iPhone tag from `AudioCompat.IsApplePlayable`), the file size, a Download/Cancel pill, and a progress area bound to `ShowProgress` reproducing the four states from `DownloadProgress.tsx`: active bar, verified check row with Open Folder, cancelled warn row, error row.

- [ ] **Step 4: Verify**
Run: `dotnet run --project desktop/MediaDetector.App`
Expected: a real download shows phase label, moving bar, byte counters, speed and ETA, then a check row with the real folder. Press Cancel mid-download and confirm in Task Manager that both yt-dlp and any ffmpeg child are gone.

### Task 27: Playlist panel

Replaces `components/PlaylistPanel.tsx` (614 lines, the largest component).

**Files:**
- Create: `desktop/MediaDetector.App/ViewModels/PlaylistPanelViewModel.cs`
- Create: `desktop/MediaDetector.App/ViewModels/PlaylistTrackViewModel.cs`
- Create: `desktop/MediaDetector.App/Views/PlaylistPanelView.xaml`

- [ ] **Step 1: Write the track view model**

```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using MediaDetector.App.Controls;
using MediaDetector.Core.Naming;

namespace MediaDetector.App.ViewModels;

public sealed partial class PlaylistTrackViewModel : ObservableObject
{
    public required int Index { get; init; }
    public required string OriginalTitle { get; init; }
    // Exists purely so the client previews the same name the service builds --
    // without it every row previewed as "... - Unknown".
    public required string? Author { get; init; }

    [ObservableProperty] private StatusIconKind _icon = StatusIconKind.Idle;
    [ObservableProperty] private string _iconLabel = "Pending";
    [ObservableProperty] private string _note = "";
    [ObservableProperty] private bool _isCurrent;
    [ObservableProperty] private double _percent;
    [ObservableProperty] private string? _customName;
    [ObservableProperty] private bool _isEditing;
    [ObservableProperty] private string _draft = "";

    // Called before each run. Deliberately does NOT clear CustomName -- that is a
    // user edit and must survive a re-run.
    public void Reset()
    {
        Icon = StatusIconKind.Idle;
        IconLabel = "Pending";
        Note = "";
        Percent = 0;
        IsCurrent = false;
    }

    // Set by the owning PlaylistPanelViewModel so the row can read the shared
    // CleanNames / ShowOriginalTitles state without holding a back-reference.
    public required Func<bool> GetClean { get; init; }
    public required Func<bool> GetShowOriginal { get; init; }

    public string GeneratedName(bool clean)
    {
        var source = new NameSource(OriginalTitle, Uploader: Author);
        return clean ? FileNaming.DownloadStem(source) : FileNaming.RawStem(source);
    }

    // A PROPERTY, not a method: XAML cannot bind to a method, so the earlier
    // DisplayName(bool, bool) form was unbindable.
    public string DisplayName =>
        CustomName ?? (GetShowOriginal() ? OriginalTitle : GeneratedName(GetClean()));

    public void RaiseDisplayNameChanged() => OnPropertyChanged(nameof(DisplayName));

    partial void OnCustomNameChanged(string? value) => RaiseDisplayNameChanged();
}
```

- [ ] **Step 2: Write the panel view model -- full surface, not a sketch**

This replaces a 581-line component, so every member it needs is declared here. Missing any of them is a compile error at best and a lost feature at worst -- the idle timer in particular, since `components/PlaylistPanel.tsx:256` uses `useIdleSeconds` and dropping it loses the "no update for Ns" warning on the playlist path.

```csharp
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.App.Controls;
using MediaDetector.Core.Formatting;
using MediaDetector.Core.Models;
using MediaDetector.Core.Services;
using MediaDetector.Core.Storage;

namespace MediaDetector.App.ViewModels;

public sealed partial class PlaylistPanelViewModel : StreamingViewModel
{
    private const int StallAfterSeconds = 5;

    private readonly PlaylistDownloadService _service = new(new DetectService());
    private readonly DispatcherTimer _idleTimer;
    private CancellationTokenSource? _cts;
    private DateTime? _lastUpdateAt;

    public ObservableCollection<PlaylistTrackViewModel> Tracks { get; } = [];

    // Set by the view's code-behind; scrolling is a view concern.
    public Action<PlaylistTrackViewModel?>? ScrollIntoView { get; set; }

    // Owned by MainViewModel so the single and playlist flows cannot disagree.
    public required Func<bool> GetCleanNames { get; init; }
    public required Func<string> GetOutputDir { get; init; }
    public required Func<bool> GetFfmpegReady { get; init; }
    public required string Url { get; init; }
    public required string PlaylistTitle { get; init; }

    [ObservableProperty] private PlaylistTrackViewModel? _current;
    [ObservableProperty] private int _total;
    [ObservableProperty] private int _completed;
    [ObservableProperty] private double _trackPercent;
    [ObservableProperty] private double _overallPercent;
    [ObservableProperty] private string? _phaseLabel;
    [ObservableProperty] private string? _detailText;
    [ObservableProperty] private string? _fatalError;
    [ObservableProperty] private string? _openError;
    [ObservableProperty] private BatchDoneLine? _summary;
    [ObservableProperty] private bool _isDownloading;
    [ObservableProperty] private int _idleSeconds;
    [ObservableProperty] private bool _showOriginalTitles;

    // Format picker state; mirrors the mode/audioFormat/videoQuality trio.
    [ObservableProperty] private PlaylistMode _mode = PlaylistMode.Audio;
    [ObservableProperty] private PlaylistAudioFormat _audioFormat = PlaylistAudioFormat.M4a;
    [ObservableProperty] private PlaylistVideoQuality _videoQuality = PlaylistVideoQuality.Q1080;

    // MP3 and every video preset need ffmpeg, so the UI disables them without it.
    public bool CanUseVideo => GetFfmpegReady();
    public bool CanUseMp3 => GetFfmpegReady();
    public bool IsStalled => IsDownloading && IdleSeconds >= StallAfterSeconds;
    // The setup block and the Download button only return once the summary clears.
    public bool SetupVisible => !IsDownloading && Summary is null;
    public string DownloadLabel =>
        Mode == PlaylistMode.Video ? "Download all video" : "Download all audio";
    public string SummaryLabel => Summary is null
        ? ""
        : $"Downloaded {Summary.Downloaded} of {Summary.Total}"
          + (Summary.Cancelled ? " -- stopped"
             : Summary.Failed > 0 ? $" ({Summary.Failed} failed)" : "");
    public int RenamedCount => Tracks.Count(t => t.CustomName != null);

    public PlaylistPanelViewModel()
    {
        // Explicit dispatcher: the parameterless ctor binds to
        // Dispatcher.CurrentDispatcher, so a view model constructed off the UI
        // thread would get a timer that silently never ticks -- and the
        // "no update for Ns" warning would die with no error.
        _idleTimer = new DispatcherTimer(DispatcherPriority.Normal, Application.Current.Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(1),
        };
        _idleTimer.Tick += (_, _) =>
        {
            IdleSeconds = _lastUpdateAt == null
                ? 0
                : (int)(DateTime.UtcNow - _lastUpdateAt.Value).TotalSeconds;
            OnPropertyChanged(nameof(IsStalled));
        };
    }

    [RelayCommand]
    private async Task DownloadAllAsync()
    {
        _cts = new CancellationTokenSource();
        IsDownloading = true;
        Summary = null;
        FatalError = null;
        OpenError = null;
        Completed = 0;
        TrackPercent = 0;
        OverallPercent = 0;
        DetailText = null;
        PhaseLabel = null;
        foreach (var t in Tracks) t.Reset();
        _lastUpdateAt = DateTime.UtcNow;
        _idleTimer.Start();

        var request = new PlaylistDownloadRequest(
            Url,
            new PlaylistFormatSelection(Mode, AudioFormat, VideoQuality),
            GetOutputDir(),
            GetCleanNames(),
            Tracks.Where(t => t.CustomName != null)
                  .ToDictionary(t => t.Index, t => t.CustomName!));

        try
        {
            await ConsumeAsync(_service.RunAsync(request, _cts.Token), Apply, _cts.Token);
        }
        catch (OperationCanceledException)
        {
            // Orchestrator sets Cancelled on the BatchDoneLine; this only covers a
            // token that trips before anything was produced.
        }
        finally
        {
            _idleTimer.Stop();
            IsDownloading = false;
            Summary ??= new BatchDoneLine(
                "", Completed, Total, Total - Completed,
                _cts?.IsCancellationRequested == true);
            _cts?.Dispose();
            _cts = null;
            OnPropertyChanged(nameof(SetupVisible));
            OnPropertyChanged(nameof(SummaryLabel));
        }
    }

    [RelayCommand] private void Cancel() => _cts?.Cancel();

    // Clearing the summary is what brings the format picker and Download button
    // back; without it the finished state is a dead end.
    [RelayCommand] private void StartAgain() => Summary = null;

    [RelayCommand]
    private void OpenFolder()
        => OpenError = Summary == null ? null : OutputPaths.OpenInExplorer(Summary.Folder);

    [RelayCommand]
    private void ResetRenames()
    {
        foreach (var t in Tracks) t.CustomName = null;
        RefreshNames();
    }

    // Called by MainViewModel when the shared CleanNames toggle flips, and after
    // a rename reset. DisplayName depends on state this view model owns, so the
    // tracks cannot notice the change on their own.
    public void RefreshNames()
    {
        foreach (var t in Tracks) t.RaiseDisplayNameChanged();
        OnPropertyChanged(nameof(RenamedCount));
    }
}
```

The line handler maps one-to-one onto the React reducer, with `TrackRetryLine` writing `retry N/5` into `Note` and `TrackSkippedLine` clearing it. `PlaylistTrackViewModel.Reset()` restores `Icon = Idle`, `IconLabel = "Pending"`, `Note = ""`, `Percent = 0`, `IsCurrent = false` (it does **not** clear `CustomName`, which is a user edit and must survive a re-run).

```csharp
private void Apply(DownloadLine line)
{
    switch (line)
    {
        case ItemLine item:
            Current = Tracks.FirstOrDefault(t => t.Index == item.Index);
            Total = item.Total;
            TrackPercent = 0;
            DetailText = null;
            foreach (var t in Tracks) t.IsCurrent = t.Index == item.Index;
            if (Current is not null)
            {
                Current.Icon = StatusIconKind.Active;
                Current.IconLabel = "Downloading";
            }
            // Keep the track being worked on visible inside the scrolling list.
            ScrollIntoView?.Invoke(Current);
            break;

        case ProgressLine p:
            TrackPercent = p.Percent;
            if (Current is not null) Current.Percent = p.Percent;
            DetailText = string.Join(" . ",
                $"{DisplayFormat.FormatBytes(p.DownloadedBytes)} / {DisplayFormat.FormatBytes(p.TotalBytes)}",
                DisplayFormat.FormatSpeed(p.SpeedBytesPerSec),
                $"ETA {DisplayFormat.FormatDuration(p.EtaSeconds)}");
            break;

        case PhaseLine ph:
            PhaseLabel = ph.Label;
            if (ph.Phase != DownloadPhase.Downloading) DetailText = null;
            break;

        // Explicit null checks rather than `when Find(x) is { } t` property
        // patterns, per rules/common/coding-style.md.
        case TrackRetryLine r:
        {
            var track = Find(r.Index);
            if (track != null)
            {
                track.Icon = StatusIconKind.Warn;
                track.IconLabel = "Retrying";
                track.Note = $"retry {r.Attempt}/5";
            }
            break;
        }

        case TrackSkippedLine s:
        {
            var track = Find(s.Index);
            if (track != null) track.Note = "";
            break;
        }

        case TrackDoneLine d:
        {
            var track = Find(d.Index);
            if (track != null)
            {
                track.Icon = StatusIconKind.Check;
                track.IconLabel = "Downloaded";
                track.Note = "";
            }
            // Counted even if the row is missing, so the summary stays truthful.
            Completed++;
            break;
        }

        case TrackErrorLine e:
        {
            var track = Find(e.Index);
            if (track != null)
            {
                track.Icon = StatusIconKind.Error;
                track.IconLabel = "Failed";
                track.Note = "failed";
            }
            break;
        }

        case BatchDoneLine b:
            Summary = b;
            break;

        case ErrorLine err:
            Summary ??= new BatchDoneLine("", Completed, Total, Total - Completed, false);
            FatalError = err.Message;
            break;

        // Single-download-only lines (DoneLine, CancelledLine) must never arrive
        // here. Silently ignoring them would hide a protocol bug; all lines share
        // one base, so this runtime arm is the only check there is.
        default:
            throw new UnreachableException($"unexpected line {line.GetType().Name}");
    }
    _lastUpdateAt = DateTime.UtcNow;
    IdleSeconds = 0;
    OverallPercent = Total > 0 ? Math.Round((double)Completed / Total * 100) : 0;
}

private PlaylistTrackViewModel? Find(int index) =>
    Tracks.FirstOrDefault(t => t.Index == index);
```

- [ ] **Step 2c: Test `Apply` without a UI**

`Apply` is pure over `DownloadLine`, so it is worth its own tests -- the reducer is where a playlist regression actually hides. Cover: `ItemLine` marks exactly one track current and clears the previous; `TrackRetryLine` writes `retry 3/5`; `TrackSkippedLine` clears the note without marking failure; `TrackDoneLine` increments `Completed` and recomputes `OverallPercent`; `BatchDoneLine` with `Cancelled: true` yields a "stopped" `SummaryLabel`. These run in the `App` project's own small test project, or move `Apply` behind an interface in Core if you prefer to keep all tests in one place.

- [ ] **Step 3: Write the view**

`PlaylistPanelView` is a `Card` with: header (title, track count, Download All / Cancel pill); a setup block visible only when idle (`SegmentedControl` for audio/video with video disabled when ffmpeg is absent, a `ComboBox` of format presets with MP3 disabled without ffmpeg, the Cleaned/Original toggle, and the "MP3 and video need ffmpeg" hint); an overall progress block; the rename controls row; a `ListBox` of tracks with **`MaxHeight="288"`** (the `18rem` cap from CLAUDE.md) and `ScrollViewer.VerticalScrollBarVisibility="Auto"`, each row showing StatusIcon, index, an editable name (click to edit, Enter commits, Escape cancels), an inline thin bar plus percent for the current track, or the note; and the summary block with Open Folder and Download again / Start again.

`ScrollIntoView` is wired in code-behind, since scrolling is a view concern:

```csharp
// PlaylistPanelView.xaml.cs
ViewModel.ScrollIntoView = track =>
{
    if (track is not null) TrackList.ScrollIntoView(track);
};
```

- [ ] **Step 4: Verify**
Run: `dotnet run --project desktop/MediaDetector.App`
Expected: run the 100-track Thuy Nga playlist. Track rows update live, the list scrolls to keep the active track visible without pushing the summary off-screen, retries show `retry N/5`, and Cancel stops within a second or two leaving no orphan processes.

---

## Phase 6: Ship

### Task 28: Publish and parity verification

**Files:**
- Create: `desktop/MediaDetector.App/Properties/PublishProfiles/win-x64.pubxml`
- Create: `docs/desktop-rewrite/impl-notes.md`

- [ ] **Step 1: Write the publish profile**

```xml
<Project>
  <PropertyGroup>
    <PublishProtocol>FileSystem</PublishProtocol>
    <Configuration>Release</Configuration>
    <Platform>Any CPU</Platform>
    <TargetFramework>net10.0-windows</TargetFramework>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>false</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <PublishReadyToRun>true</PublishReadyToRun>
    <!-- ..\publish, not ..\..\publish: the latter resolves to the REPO ROOT,
         which desktop/.gitignore cannot cover and the root .gitignore does not
         list, leaving the tree dirty on a repo worked directly on master. -->
    <PublishDir>..\publish\win-x64\</PublishDir>
  </PropertyGroup>
</Project>
```

- [ ] **Step 2: Publish and measure**
Run: `dotnet publish desktop/MediaDetector.App -p:PublishProfile=win-x64`
Expected: succeeds; record the actual output size in `impl-notes.md` (expected roughly 2-5 MB framework-dependent, versus the 78 MB WinUI 3 measurement and Electron's ~150 MB).

- [ ] **Step 3: Run the parity checklist**

Walk every acceptance criterion in this plan's header against the published exe, not a debug build. Additionally verify the three behaviours most likely to regress in a port:

1. **Names match.** Re-run the Task 3 cross-check against `C:\Users\NamNguyen\Documents\MediaDetector` -- every generated stem must equal the existing filename.
2. **Resume still works.** Re-download a playlist already on disk; yt-dlp must skip every track and leave mtimes untouched. If it re-downloads, the literal `-o` path drifted.
3. **No stray thumbnails.** Cancel a download mid-flight and confirm no orphan `.webp` remains beside the `.part`.

- [ ] **Step 4: Write the implementation notes**

Record in `docs/desktop-rewrite/impl-notes.md`: the measured publish size, any behaviour that deliberately differs from the Next.js app, and the Node prerequisite (so the eventual README says Python + yt-dlp + **Node** + optional ffmpeg).

### Task 29: Retire the Next.js app -- USER-GATED

**Do not run this task until the user has confirmed the WPF app works.** It is listed so the plan is complete, not so an agent performs it unprompted.

- [ ] **Step 1: Confirm with the user that the WPF build has been tested**

- [ ] **Step 1b: Make the deletion revertible before deleting anything**

This repo is worked directly on `master` with no feature branch, so an unstaged bulk delete has no recovery path. Commit the WPF app first, so the deletion lands as its own commit and a single `git revert` brings the web app back:

```bash
git add desktop docs/desktop-rewrite
git commit -m "feat: WPF desktop app at parity with the Next.js version"
git status   # must be clean before proceeding
```

- [ ] **Step 2: Delete the web app**
Remove `app/`, `components/`, `hooks/`, `lib/`, `types/`, `jest.config.ts`, `jest.setup.ts`, `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, and the Next/React/Tailwind/Jest entries from `package.json` (or delete `package.json` and `node_modules/` outright if nothing else needs npm).

**Must survive** -- these are not part of the Next.js app: `bin/`, `public/`, `README.md`, `playlist-names*.txt`, `.git/`, and `docs/`. Commit the deletion on its own, separately from any other change.

Note on `bin/`: `ToolResolver.FfmpegDirCandidates()` probes `AppContext.BaseDirectory\bin` -- the **build output** directory, never the repo root. The repo's `bin/` matters only because the App csproj (Task 1) copies `..\..\bin\*.exe` into the output; without that copy step a vendored `ffmpeg.exe` dropped there is silently never found.
- [ ] **Step 3: Rewrite `CLAUDE.md`**
Most of it survives as-is because it documents yt-dlp behaviour, not Next.js: the `youtubeAccessArgs` rationale, the M4A selector, the filename rules, the retry engine, the hang watchdog, the stray-thumbnail handling. What changes: the Commands table becomes `dotnet` commands, the runtime-dependency table gains Node, the Architecture section's file paths move to `desktop/`, and the streaming-response and theme sections are replaced by the `IAsyncEnumerable` + `Dispatcher` pattern and the two `ResourceDictionary` files.
- [ ] **Step 4: Verify**
Run: `dotnet build desktop/MediaDetector.sln && dotnet test desktop/MediaDetector.Core.Tests`
Expected: both succeed with the web app gone.
