using System.Text.RegularExpressions;
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
    string? HelpUrl = null)
{
    // The view binds the button to THIS, not to Action.
    //
    // It used to bind Visibility straight to Action through the null-check
    // converter, which made an Install button appear on every satisfied row:
    // RowAction.None is a boxed enum, so it is neither null nor an empty string
    // and the converter called it "set".
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

    // The collapsed line is meant to be glanceable -- "name version", nothing
    // else. ffmpeg is the one that breaks that on its own: it reports
    // "8.1.2-full_build-www.gyan.dev", whose build tag is longer than every other
    // entry combined. The expanded row still shows the full string, because
    // that is where the detail belongs.
    //
    // Anything that does not start with a number is passed through untouched
    // rather than mangled.
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
        var python = s.Python.Found
            ? new DependencyRow("Python", RowState.Ok,
                $"Version {s.Python.Version} detected",
                $"Python {ShortVersion(s.Python.Version)}", RowAction.None)
            : new DependencyRow("Python", RowState.Error,
                "Not found -- install Python 3.8+ to continue", "Python missing",
                RowAction.None, "https://python.org/downloads");

        DependencyRow ytdlp;
        if (!s.Ytdlp.Found)
        {
            ytdlp = new DependencyRow("yt-dlp", RowState.Error,
                "Not installed -- required to detect and download media", "yt-dlp missing",
                s.Python.Found ? RowAction.InstallYtdlp : RowAction.None);
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

        // Required: yt-dlp needs a JS runtime to solve YouTube's signature and "n"
        // challenges. Without one every format URL answers 403 and the only thing
        // a failed run leaves behind is a stray .webp.
        var node = s.Node.Found
            ? new DependencyRow("Node.js", RowState.Ok,
                $"Version {s.Node.Version} detected -- solves YouTube's JS challenges",
                $"Node {ShortVersion(s.Node.Version)}", RowAction.None)
            : new DependencyRow("Node.js", RowState.Error,
                "Not found -- yt-dlp needs a JavaScript runtime or downloads fail with HTTP 403",
                "Node missing", RowAction.InstallNode, "https://nodejs.org/en/download");

        // Optional: downloads work without it, but metadata/thumbnails need it.
        var ffmpeg = s.Ffmpeg.Found
            ? new DependencyRow("ffmpeg", RowState.Ok,
                $"Version {s.Ffmpeg.Version} detected -- metadata & thumbnails embedded",
                $"ffmpeg {ShortVersion(s.Ffmpeg.Version)}", RowAction.None)
            : new DependencyRow("ffmpeg", RowState.Warn,
                "Not found -- install ffmpeg to embed metadata & cover art", "ffmpeg missing",
                RowAction.InstallFfmpeg, "https://ffmpeg.org/download.html");

        return [python, ytdlp, node, ffmpeg];
    }
}
