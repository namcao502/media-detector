using System.Collections.Concurrent;
using System.Globalization;

namespace MediaDetector.Core.Diagnostics;

public enum LogLevel { Debug, Info, Warn, Error }

public sealed record LogEntry(DateTime TimestampUtc, LogLevel Level, string Category, string Message)
{
    public string Format() =>
        $"{TimestampUtc.ToLocalTime().ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture)} "
        + $"{Level.ToString().ToUpperInvariant(),-5} [{Category}] {Message}";
}

// The diagnostic log the desktop app needs and the web app got for free from the
// dev-server terminal. Without it, everything yt-dlp prints that the progress
// parser does not recognise -- which includes the real error text on a failed
// download -- vanishes into a process with no console.
//
// Two sinks, deliberately:
//   - an in-memory ring buffer the UI binds to, so the user can see what just
//     happened without leaving the app;
//   - a rolling file, so a failure that happened yesterday is still diagnosable.
public static class AppLog
{
    // Bounded so a 120-track playlist at ~10 lines/second cannot grow without
    // limit over a long session.
    private const int MaxEntries = 2000;

    private static readonly ConcurrentQueue<LogEntry> Buffer = new();
    private static readonly Lock FileGate = new();
    private static readonly System.Text.UTF8Encoding Utf8Bom = new(encoderShouldEmitUTF8Identifier: true);
    private static string? _filePath;
    private static bool _fileFailed;

    // Raised for every entry. The UI subscribes and marshals to its own thread;
    // Core never touches a Dispatcher.
    public static event Action<LogEntry>? Entry;

    public static string LogDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MediaDetector", "logs");

    public static string? CurrentFile => _filePath;

    public static IReadOnlyList<LogEntry> Snapshot() => [.. Buffer];

    public static void Debug(string category, string message) => Write(LogLevel.Debug, category, message);
    public static void Info(string category, string message) => Write(LogLevel.Info, category, message);
    public static void Warn(string category, string message) => Write(LogLevel.Warn, category, message);
    public static void Error(string category, string message) => Write(LogLevel.Error, category, message);

    public static void Write(LogLevel level, string category, string message)
    {
        var entry = new LogEntry(DateTime.UtcNow, level, category, message);

        Buffer.Enqueue(entry);
        while (Buffer.Count > MaxEntries) Buffer.TryDequeue(out _);

        Entry?.Invoke(entry);
        AppendToFile(entry);
    }

    // Logging must never be the reason something fails, so every file error is
    // swallowed once and then the file sink is switched off for the session.
    private static void AppendToFile(LogEntry entry)
    {
        if (_fileFailed) return;
        try
        {
            lock (FileGate)
            {
                if (_fileFailed) return;
                if (_filePath == null)
                {
                    Directory.CreateDirectory(LogDirectory);
                    var stamp = DateTime.Now.ToString("yyyy-MM-dd_HHmmss", CultureInfo.InvariantCulture);
                    _filePath = Path.Combine(LogDirectory, $"media-detector_{stamp}.log");
                    PruneOldLogs();
                }

                // UTF-8 WITH a BOM. The content is valid UTF-8 either way, but
                // without the BOM Notepad and PowerShell 5.1's Get-Content both
                // fall back to the ANSI codepage and render every Vietnamese
                // title as mojibake -- which is exactly what these logs are for.
                File.AppendAllText(_filePath, entry.Format() + Environment.NewLine, Utf8Bom);
            }
        }
        catch
        {
            _fileFailed = true;
        }
    }

    // Keep the last 10 runs. Without this the folder grows one file per launch
    // forever.
    private static void PruneOldLogs()
    {
        try
        {
            var old = Directory.GetFiles(LogDirectory, "media-detector_*.log")
                .OrderByDescending(f => f)
                .Skip(10);
            foreach (var f in old) File.Delete(f);
        }
        catch
        {
            // A locked or vanished file is not worth failing over.
        }
    }

    public static void Clear()
    {
        while (Buffer.TryDequeue(out _)) { }
    }

    // Everything currently in the buffer, ready for the clipboard or a bug report.
    public static string DumpText() =>
        string.Join(Environment.NewLine, Buffer.Select(e => e.Format()));
}
