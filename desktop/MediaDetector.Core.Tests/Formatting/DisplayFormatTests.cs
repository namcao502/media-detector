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
    // Midpoint: JS toFixed rounds half away from zero, .NET defaults to banker's.
    // Pins the divergence that would otherwise ship silently.
    [InlineData(1_250_000, "1.3 MB")]
    [InlineData(1_000_000_000, "1.0 GB")]
    public void FormatBytes_UsesDecimalUnits(double bytes, string expected)
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
