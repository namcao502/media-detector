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
        // A non-bool reads as false, which once left the playlist picker stuck on
        // Audio for good. WPF swallows binding errors, so say something.
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
        // A zero count is absent: boxed 0 is not null, so a plain null check left
        // the log panel showing as an empty grey bar forever.
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

// A star row keeps its share even when its only child is Collapsed, leaving a
// tall gap. Also accepts a bool, for the outer row that must go Star when either
// panel is showing.
public sealed class VisibilityToStarHeight : IValueConverter
{
    // Zero collapses the row away; Auto lets it size to whatever else it holds,
    // which is what the outer content row wants.
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

// The pickers bind straight to enum values, so without this the video menu read
// "Q1080". Applied as the ComboBox ItemTemplate, which covers the closed box too.
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
