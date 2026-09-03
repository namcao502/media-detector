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

// A windowed app has no console, so the real error text on a failed download had
// nowhere to go. Two sinks: a ring buffer the UI binds to, and a rolling file so
// yesterday's failure is still diagnosable.
public static class AppLog
{
    // Bounded: a 120-track playlist emits ~10 lines/second.
    private const int MaxEntries = 2000;

    private static readonly ConcurrentQueue<LogEntry> Buffer = new();
    private static readonly Lock FileGate = new();
    private static readonly System.Text.UTF8Encoding Utf8Bom = new(encoderShouldEmitUTF8Identifier: true);
    private static string? _filePath;
    private static bool _fileFailed;

    // Raised for every entry. The UI subscribes and marshals to its own thread;
    // Core never touches a Dispatcher.
    public static event Action<LogEntry>? Entry;

    // Beside the exe when that is writable; AppPaths owns the fallback. Old logs
    // are deliberately NOT migrated -- they are disposable by design (last 10
    // runs) and copying them would only confuse the next reader.
    public static string LogDirectory => Path.Combine(Storage.AppPaths.DataRoot, "logs");

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

                // WITH a BOM: without one, Notepad and PowerShell 5.1 fall back to
                // ANSI and render every Vietnamese title as mojibake.
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
