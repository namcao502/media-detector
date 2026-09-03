using System.Globalization;

namespace MediaDetector.Core.Formatting;

// Human-readable formatters for download progress. Pure -- shared by the
// single-download and playlist UIs. Everything unknown renders as '--' so a
// missing field never shows as "undefined" or "NaN".
public static class DisplayFormat
{
    private static readonly string[] SizeUnits = ["B", "KB", "MB", "GB", "TB"];
    private const string Placeholder = "--";

    private static bool IsUsable(double? value) =>
        value != null && double.IsFinite(value.Value) && value.Value >= 0;

    // Decimal units (KB = 1000 B) to match the sizes YouTube and file managers show.
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
        // AwayFromZero is REQUIRED: (1.25).ToString("F1") is "1.2" on .NET
        // (banker's rounding), and Math.Round's default ToEven agrees with it.
        var rounded = Math.Round(value, digits, MidpointRounding.AwayFromZero);
        return $"{rounded.ToString($"F{digits}", CultureInfo.InvariantCulture)} {SizeUnits[unit]}";
    }

    public static string FormatSpeed(double? bytesPerSec) =>
        !IsUsable(bytesPerSec) || bytesPerSec == 0
            ? Placeholder
            : $"{FormatBytes(bytesPerSec)}/s";

    // m:ss, or h:mm:ss past an hour.
    public static string FormatDuration(double? seconds)
    {
        if (!IsUsable(seconds)) return Placeholder;
        var total = (long)Math.Round(seconds!.Value);
        var hours = total / 3600;
        var minutes = total % 3600 / 60;
        var secs = total % 60;
        return hours != 0 ? $"{hours}:{minutes:D2}:{secs:D2}" : $"{minutes}:{secs:D2}";
    }

    // Keeps the input's separator style so the path goes straight back to the OS.
    // NOT Path.GetDirectoryName, which normalises and breaks that round-trip.
    public static string ParentDir(string filePath)
    {
        var index = Math.Max(filePath.LastIndexOf('\\'), filePath.LastIndexOf('/'));
        if (index < 0) return "";
        if (index == 0) return filePath[..1];
        return filePath[..index];
    }
}
