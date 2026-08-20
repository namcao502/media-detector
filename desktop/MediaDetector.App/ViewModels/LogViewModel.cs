using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Diagnostics;
using MediaDetector.Core.Storage;

namespace MediaDetector.App.ViewModels;

public sealed partial class LogViewModel : ObservableObject
{
    // Bounded independently of AppLog's ring buffer: an ObservableCollection this
    // large is a UI cost, not just memory, because every Add raises a change
    // notification the ItemsControl acts on.
    private const int MaxDisplayed = 500;

    public ObservableCollection<LogEntry> Entries { get; } = [];

    // No collapse state: the log panel is always open. It is bounded to a few
    // lines, so it costs little, and a diagnostic you have to go and switch on is
    // one you will not have switched on when the thing you needed it for happened.
    [ObservableProperty] private bool _errorsOnly;

    public bool HasEntries => Entries.Count != 0;

    public LogViewModel()
    {
        foreach (var e in AppLog.Snapshot()) Append(e);

        // AppLog fires from whatever thread produced the line -- usually a
        // Process event thread -- so every append is marshalled.
        AppLog.Entry += entry =>
        {
            var app = Application.Current;
            if (app == null) return;
            app.Dispatcher.InvokeAsync(() => Append(entry));
        };
    }

    private void Append(LogEntry entry)
    {
        if (ErrorsOnly && entry.Level < LogLevel.Warn) return;
        Entries.Add(entry);
        while (Entries.Count > MaxDisplayed) Entries.RemoveAt(0);
        OnPropertyChanged(nameof(HasEntries));
    }

    partial void OnErrorsOnlyChanged(bool value)
    {
        // Rebuild from the authoritative buffer rather than trying to un-filter
        // what was already dropped.
        Entries.Clear();
        foreach (var e in AppLog.Snapshot())
        {
            if (value && e.Level < LogLevel.Warn) continue;
            Entries.Add(e);
        }
        OnPropertyChanged(nameof(HasEntries));
    }

    [RelayCommand] private void ToggleErrorsOnly() => ErrorsOnly = !ErrorsOnly;

    [RelayCommand]
    private void Copy()
    {
        try
        {
            Clipboard.SetText(AppLog.DumpText());
        }
        catch
        {
            // The clipboard can be locked by another process; not worth crashing.
        }
    }

    [RelayCommand]
    private void Clear()
    {
        AppLog.Clear();
        Entries.Clear();
        OnPropertyChanged(nameof(HasEntries));
    }

    // The in-app buffer holds this session; the folder holds the last 10 runs,
    // which is what a "it broke yesterday" report needs.
    [RelayCommand]
    private void OpenFolder() => OutputPaths.OpenInExplorer(AppLog.LogDirectory);
}
