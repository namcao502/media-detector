using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Text.Json;
using System.Threading.Channels;
using MediaDetector.Core.Processes;
using MediaDetector.Core.Ytdlp;

namespace MediaDetector.Core.Dependencies;

// Fetches the runtime tools into a folder the app owns, streaming progress as
// plain text lines the UI shows in its log panel. Nothing installs system-wide:
// the resolver would not look there anyway.
[SupportedOSPlatform("windows")]
public static class Installer
{
    public const string YtdlpReleaseUrl =
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

    // Stable by design -- gyan republishes this same URL for each release, so
    // there is no version to resolve.
    public const string FfmpegReleaseUrl =
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

    public const string NodeIndexUrl = "https://nodejs.org/dist/index.json";

    private static string TargetDir => ToolResolver.VendorDir;

    public static IAsyncEnumerable<string> InstallYtdlpAsync(CancellationToken ct = default) =>
        StreamAsync((log, token) => FetchExeAsync(YtdlpReleaseUrl, "yt-dlp.exe", log, token), ct);

    public static IAsyncEnumerable<string> InstallFfmpegAsync(CancellationToken ct = default) =>
        StreamAsync(
            (log, token) => FetchZipAsync(
                FfmpegReleaseUrl, "ffmpeg", ["ffmpeg.exe", "ffprobe.exe"], log, token),
            ct);

    public static IAsyncEnumerable<string> InstallNodeAsync(CancellationToken ct = default) =>
        StreamAsync(
            async (log, token) =>
            {
                var url = await ResolveNodeZipUrlAsync(token);
                await FetchZipAsync(url, "Node.js", ["node.exe"], log, token);
            },
            ct);

    // `-U` rather than a re-download: the standalone build updates in place.
    // Falls back to installing when there is no exe to update yet.
    public static IAsyncEnumerable<string> UpdateYtdlpAsync(CancellationToken ct = default)
    {
        var exe = ToolResolver.ResolveYtdlpExe();
        return exe == null
            ? InstallYtdlpAsync(ct)
            : LineStream.StreamAsync([exe, "-U"], ct);
    }

    // A Channel, because yield return cannot sit inside the try/catch that the
    // download needs. Drained with CancellationToken.None so a cancelled install
    // still reports why it stopped instead of vanishing.
    private static async IAsyncEnumerable<string> StreamAsync(
        Func<ChannelWriter<string>, CancellationToken, Task> work,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var channel = Channel.CreateUnbounded<string>();

        var worker = Task.Run(async () =>
        {
            try
            {
                await work(channel.Writer, ct);
                channel.Writer.TryWrite("Done. Click Recheck to pick it up.");
            }
            catch (OperationCanceledException)
            {
                channel.Writer.TryWrite("Cancelled.");
            }
            catch (Exception ex)
            {
                channel.Writer.TryWrite($"Failed: {ex.Message}");
                channel.Writer.TryWrite($"Download it by hand and put it in {TargetDir}.");
            }
            finally
            {
                channel.Writer.TryComplete();
            }
        });

        await foreach (var line in channel.Reader.ReadAllAsync(CancellationToken.None))
        {
            yield return line;
        }

        await worker;
    }

    private static async Task FetchExeAsync(
        string url, string exeName, ChannelWriter<string> log, CancellationToken ct)
    {
        Directory.CreateDirectory(TargetDir);
        log.TryWrite($"Downloading {exeName} to {TargetDir}...");
        await DownloadAsync(url, Path.Combine(TargetDir, exeName), exeName, log, ct);
    }

    private static async Task FetchZipAsync(
        string url, string label, string[] exeNames, ChannelWriter<string> log, CancellationToken ct)
    {
        Directory.CreateDirectory(TargetDir);
        var zipPath = Path.Combine(TargetDir, $".{label}-download.zip");
        log.TryWrite($"Downloading {label} from {url}...");

        try
        {
            await DownloadAsync(url, zipPath, label, log, ct);
            log.TryWrite($"Extracting {string.Join(", ", exeNames)}...");
            ExtractExes(zipPath, exeNames, log);
        }
        finally
        {
            try
            {
                File.Delete(zipPath);
            }
            catch
            {
                // Leaving the archive behind is untidy, never fatal.
            }
        }
    }

    // Matched on file name, since both zips nest under a versioned root. The
    // destination comes from OUR constant, so a crafted archive cannot escape.
    private static void ExtractExes(string zipPath, string[] exeNames, ChannelWriter<string> log)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        foreach (var exeName in exeNames)
        {
            var entry = archive.Entries.FirstOrDefault(e =>
                string.Equals(e.Name, exeName, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"{exeName} was not in the archive");

            entry.ExtractToFile(Path.Combine(TargetDir, exeName), overwrite: true);
            log.TryWrite($"Extracted {exeName}");
        }
    }

    // Reported every 4 MB: an 80 MB download with no output is indistinguishable
    // from a hang, which is the same trap the TrackRunner watchdog exists for.
    private const long ProgressStepBytes = 4L * 1024 * 1024;

    private static async Task DownloadAsync(
        string url, string destination, string label, ChannelWriter<string> log, CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        var total = response.Content.Headers.ContentLength;
        // Staged: an interrupted download must not leave a truncated file that
        // the resolver would then pick up.
        var partial = destination + ".part";

        await using (var source = await response.Content.ReadAsStreamAsync(ct))
        await using (var file = File.Create(partial))
        {
            var buffer = new byte[81920];
            long received = 0;
            long reported = 0;
            int read;

            while ((read = await source.ReadAsync(buffer, ct)) > 0)
            {
                await file.WriteAsync(buffer.AsMemory(0, read), ct);
                received += read;
                if (received - reported < ProgressStepBytes) continue;

                reported = received;
                log.TryWrite(ProgressLine(label, received, total));
            }
        }

        File.Move(partial, destination, overwrite: true);
    }

    public static string ProgressLine(string label, long received, long? total)
    {
        var mb = received / 1024d / 1024d;
        return total == null
            ? $"{label}: {mb:F1} MB"
            : $"{label}: {mb:F1} / {total.Value / 1024d / 1024d:F1} MB";
    }

    // nodejs.org publishes no "latest LTS" zip URL, so the version has to come
    // from the release index. Entries are newest-first and `lts` is false for
    // non-LTS lines, so the first non-false one is the current LTS.
    public static string NodeZipUrlFor(string version) =>
        $"https://nodejs.org/dist/{version}/node-{version}-win-x64.zip";

    public static string? LatestLtsVersion(string indexJson)
    {
        using var doc = JsonDocument.Parse(indexJson);
        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (!release.TryGetProperty("lts", out var lts)
                || lts.ValueKind == JsonValueKind.False)
            {
                continue;
            }

            return release.TryGetProperty("version", out var version)
                ? version.GetString()
                : null;
        }

        return null;
    }

    private static async Task<string> ResolveNodeZipUrlAsync(CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        var version = LatestLtsVersion(await http.GetStringAsync(NodeIndexUrl, ct))
            ?? throw new InvalidOperationException("No LTS release listed at " + NodeIndexUrl);
        return NodeZipUrlFor(version);
    }
}
