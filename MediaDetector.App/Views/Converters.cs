using System.Globalization;
using System.Windows;
using System.Windows.Data;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Models;

namespace MediaDetector.App.Views;

// Small, boring converters. WPF ships BooleanToVisibilityConverter but nothing
// for the inverse or for null checks, which the views need constantly.
public sealed class BoolToVisibility : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        // Anything that is not a bool silently reads as false here, which is how
        // the playlist format picker ended up permanently stuck on Audio: it was
        // bound to a ListBox's int SelectedIndex, so the converter saw false for
        // every value and the video picker never appeared. WPF swallows binding
        // problems, so the mistake is invisible without saying something.
        //
        // Null and UnsetValue are normal during template setup and stay quiet.
        if (value != null && value != DependencyProperty.UnsetValue && value is not bool)
        {
            AppLog.Warn(
                "binding",
                $"BoolToVisibility got {value.GetType().Name}, not bool -- treated as false");
        }

        var flag = value is bool b && b;

        if (Invert)
        {
            flag = !flag;
        }

        return flag ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

public sealed class NotNullToVisibility : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        // A zero count counts as absent. Without this arm the installer-log panel,
        // bound to LogLines.Count, was permanently visible as an empty grey bar:
        // boxed 0 is not null, so the plain null check called it "set".
        var present = value != null
                      && !(value is string text && text.Length == 0)
                      && !(value is int count && count == 0);

        if (Invert)
        {
            present = !present;
        }

        return present ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// Visibility (or a plain bool) -> a GridLength for the row that holds it.
//
// A star-sized row keeps its share of the space even when its only child is
// Collapsed, so with the page laid out as a fixed frame the format list would
// leave a tall empty gap on a playlist-only URL. Handing back a zero length
// gives that space to whichever panel is actually on screen.
//
// Also accepts a bool (e.g. MainViewModel.HasResults) for the outer "Download"
// row, which has to go Star whenever EITHER the format list or the playlist
// card is showing -- a single ElementName binding to just one of them left the
// row Auto-sized whenever the other one was active, so its content (the
// playlist's now-star track list) had nothing bounding it and could not scroll.
public sealed class VisibilityToStarHeight : IValueConverter
{
    // What a hidden child yields. Zero collapses the row away entirely; Auto lets
    // the row size to whatever else it holds, which is what the outer content row
    // wants: only the format list needs to absorb slack (it scrolls), so on a
    // playlist-only URL the row should shrink to the card rather than stretch and
    // leave a dead gap above the log.
    public bool AutoWhenHidden { get; set; }

    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        var visible = value is Visibility state
            ? state == Visibility.Visible
            : value is bool flag && flag;
        if (visible)
        {
            return new GridLength(1, GridUnitType.Star);
        }

        return AutoWhenHidden ? GridLength.Auto : new GridLength(0);
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
    {
        throw new NotSupportedException();
    }
}

// Enum -> the label a person would expect. The pickers bind straight to the enum
// values, so without this the video menu literally read "Q1080" and "Q720".
// Applied as the ComboBox ItemTemplate, which covers both the open list and the
// closed box (SelectionBoxItemTemplate derives from it).
public sealed class FormatLabelConverter : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        return value switch
        {
            PlaylistAudioFormat.M4a => "M4A  (remux, no quality loss)",
            PlaylistAudioFormat.Mp3 => "MP3  (re-encoded, needs ffmpeg)",
            PlaylistAudioFormat.Best => "Best available  (no conversion)",
            PlaylistVideoQuality.Q1080 => "1080p",
            PlaylistVideoQuality.Q720 => "720p",
            PlaylistVideoQuality.Best => "Best available",
            _ => value?.ToString() ?? "",
        };
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
    {
        throw new NotSupportedException();
    }
}

// RowState -> the glyph the dependency row shows. Separate from the brush
// converter below because it returns a StatusIconKind, not a Brush.
public sealed class RowStateToIcon : IValueConverter
{
    public object Convert(object? value, Type t, object? p, CultureInfo c)
        => (value?.ToString() ?? "Ok") switch
        {
            "Error" => Controls.StatusIconKind.Error,
            "Warn" => Controls.StatusIconKind.Warn,
            _ => Controls.StatusIconKind.Check,
        };

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}

// Maps a RowState to the row's background/foreground token so the dependency
// rows keep the error/warn tinting the React version had.
public sealed class RowStateToBrushKey : IValueConverter
{
    // "Bg", "Title" or "Message" -- which of the three token families to pick.
    public string Kind { get; set; } = "Bg";

    public object Convert(object? value, Type t, object? p, CultureInfo c)
    {
        var state = value?.ToString() ?? "Ok";
        var key = (Kind, state) switch
        {
            ("Bg", "Error") => "BgStatusError",
            ("Bg", "Warn") => "BgStatusWarn",
            ("Bg", _) => "BgCard",
            ("Title", "Error") => "TextStatusErrorTitle",
            ("Title", "Warn") => "TextStatusWarnTitle",
            ("Title", _) => "TextPrimary",
            ("Message", "Error") => "TextStatusError",
            ("Message", "Warn") => "TextStatusWarn",
            _ => "TextSecondary",
        };
        return Application.Current.TryFindResource(key) ?? Application.Current.Resources["BgCard"];
    }

    public object ConvertBack(object? value, Type t, object? p, CultureInfo c)
        => throw new NotSupportedException();
}
