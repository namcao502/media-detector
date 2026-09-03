using System.Text.RegularExpressions;
using MediaDetector.Core.Models;

namespace MediaDetector.Core.Dependencies;

public enum RowState { Ok, Error, Warn }

// Every install downloads into a folder the app owns. The winget/Chocolatey
// versions were removed: they install system-wide, where the resolver no longer
// looks, so the button reported success onto a row that stayed red.
public enum RowAction { None, InstallYtdlp, RetryYtdlpUpdate, InstallNode, InstallFfmpeg }

public sealed record DependencyRow(
    string Label,
    RowState State,
    string Message,
    // Compact form for the collapsed summary line, e.g. "yt-dlp 2026.08.01".
    string Summary,
    RowAction Action,
    string? HelpUrl = null,
    // Which folder the tool actually came from. Not named Source: WPF's Binding
    // has one, and `{Binding Source}` beside it is a trap.
    string? ResolvedFrom = null)
{

    // The view binds to THIS, not to Action: a boxed RowAction.None is neither
    // null nor empty, so the null-check converter put a button on every row.
    public bool HasAction
    {
        get
        {
            return Action != RowAction.None;
        }
    }

    // A failed yt-dlp update offers a retry, not an install.
    public string ActionLabel
    {
        get
        {
            return Action switch
            {
                RowAction.RetryYtdlpUpdate => "Retry",
                RowAction.None => "",
                _ => "Install",
            };
        }
    }
}

// Pure, so the collapsed summary line and the expanded rows are derived from
// exactly the same data and cannot disagree. Lives in Core so it is testable
// without a UI.
public static class DependencyRows
{
    // Leading dotted-numeric run of a version string.
    private static readonly Regex LeadingVersion =
        new(@"^v?(\d+(?:\.\d+)*)", RegexOptions.CultureInvariant);

    // ffmpeg reports "8.1.2-full_build-www.gyan.dev", whose build tag is longer
    // than every other entry combined; the expanded row keeps the full string.
    // Anything not starting with a number passes through untouched.
    public static string ShortVersion(string? version)
    {
        if (string.IsNullOrWhiteSpace(version))
        {
            return "";
        }

        var match = LeadingVersion.Match(version.Trim());
        if (!match.Success)
        {
            return version.Trim();
        }

        return match.Groups[1].Value;
    }

    public static IReadOnlyList<DependencyRow> Build(StatusResult s)
    {
        DependencyRow ytdlp;
        if (!s.Ytdlp.Found)
        {
            ytdlp = new DependencyRow("yt-dlp", RowState.Error,
                "Not found -- required to detect and download media", "yt-dlp missing",
                RowAction.InstallYtdlp, "https://github.com/yt-dlp/yt-dlp/releases/latest");
        }
        else if (s.Ytdlp.UpdateStatus == UpdateStatus.Failed)
        {
            ytdlp = new DependencyRow("yt-dlp", RowState.Warn,
                "Update failed -- click Retry to try again",
                $"yt-dlp {ShortVersion(s.Ytdlp.Version)} (update failed)",
                RowAction.RetryYtdlpUpdate);
        }
        else
        {
            var suffix = s.Ytdlp.UpdateStatus switch
            {
                UpdateStatus.Updated => " -- updated",
                UpdateStatus.UpToDate => " -- up to date",
                _ => "",
            };
            ytdlp = new DependencyRow("yt-dlp", RowState.Ok,
                $"Version {s.Ytdlp.Version}{suffix}",
                $"yt-dlp {ShortVersion(s.Ytdlp.Version)}", RowAction.None);
        }

        // Required: without a JS runtime every format URL answers HTTP 403.
        var node = s.Node.Found
            ? new DependencyRow("Node.js", RowState.Ok,
                $"Version {s.Node.Version} detected -- solves YouTube's JS challenges",
                $"Node {ShortVersion(s.Node.Version)}", RowAction.None)
            : new DependencyRow("Node.js", RowState.Error,
                "Not found -- yt-dlp needs a JavaScript runtime or downloads fail with HTTP 403",
                "Node missing", RowAction.InstallNode, "https://nodejs.org/en/download");

        // Optional: downloads work without it, but metadata and cover art need it.
        DependencyRow ffmpeg;
        if (!s.Ffmpeg.Found)
        {
            ffmpeg = new DependencyRow("ffmpeg", RowState.Warn,
                "Not found -- needed to embed metadata & cover art",
                "ffmpeg missing", RowAction.InstallFfmpeg, "https://www.gyan.dev/ffmpeg/builds/");
        }
        else if (!s.Ffmpeg.FfprobeFound)
        {
            // A dir with ffmpeg.exe but no working ffprobe stayed green once and
            // the cover art silently vanished.
            ffmpeg = new DependencyRow("ffmpeg", RowState.Warn,
                $"Version {s.Ffmpeg.Version} detected, but ffprobe is missing -- cover art cannot be embedded",
                $"ffmpeg {ShortVersion(s.Ffmpeg.Version)} (no ffprobe)",
                RowAction.InstallFfmpeg, "https://www.gyan.dev/ffmpeg/builds/");
        }
        else
        {
            ffmpeg = new DependencyRow("ffmpeg", RowState.Ok,
                $"Version {s.Ffmpeg.Version} detected -- metadata & thumbnails embedded",
                $"ffmpeg {ShortVersion(s.Ffmpeg.Version)}", RowAction.None);
        }

        return
        [
            ytdlp with { ResolvedFrom = s.Ytdlp.Path },
            node with { ResolvedFrom = s.Node.Path },
            ffmpeg with { ResolvedFrom = s.Ffmpeg.Dir },
        ];
    }
}
