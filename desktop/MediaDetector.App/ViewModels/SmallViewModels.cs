using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.App.Controls;
using MediaDetector.App.Themes;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Models;
using MediaDetector.Core.Naming;
using MediaDetector.Core.Storage;
using Microsoft.Win32;

namespace MediaDetector.App.ViewModels;

// Replaces hooks/useTheme.ts + components/ThemeButton.tsx. Without this nothing
// ever writes AppSettings.Theme, so "toggle persists across restarts" is unmet
// even though the field exists.
public sealed partial class ThemeViewModel : ObservableObject
{
    [ObservableProperty] private AppThemeMode _mode = App.Settings.Theme;

    public bool IsDark => ThemeManager.IsDark(Mode);
    // Sun when dark (click for light), moon when light.
    public string Glyph => IsDark ? "☀" : "☽";

    [RelayCommand]
    private void Toggle()
    {
        Mode = IsDark ? AppThemeMode.Light : AppThemeMode.Dark;
        ThemeManager.Apply(Mode);
        App.Settings.Theme = Mode;
        App.Settings.Save();
        OnPropertyChanged(nameof(IsDark));
        OnPropertyChanged(nameof(Glyph));
    }
}

// Replaces hooks/useOutputDir.ts + components/OutputDirRow.tsx. The browser could
// not resolve ~/Documents, which is why the web version needed an endpoint; here
// the default is available directly.
public sealed partial class OutputDirViewModel : ObservableObject
{
    [ObservableProperty] private string _dir = OutputPaths.Resolve(App.Settings.OutputDir);
    [ObservableProperty] private string? _openError;

    partial void OnDirChanged(string value)
    {
        App.Settings.OutputDir = value == OutputPaths.Default() ? null : value;
        App.Settings.Save();
    }

    // A native folder picker replaces the free-text field the web app had to use.
    [RelayCommand]
    private void Browse()
    {
        var dialog = new OpenFolderDialog { InitialDirectory = Dir, Multiselect = false };
        if (dialog.ShowDialog() == true) Dir = dialog.FolderName;
    }

    [RelayCommand] private void Reset() => Dir = OutputPaths.Default();

    // Sync, and the error string is surfaced rather than discarded.
    [RelayCommand] private void Open() => OpenError = OutputPaths.OpenInExplorer(Dir);
}

// Replaces components/FileNameRow.tsx. Shows what the download will be called
// before it starts and lets the user switch cleanup off or type a name outright.
// The extension is omitted because it is not settled until a format is chosen.
public sealed partial class FileNameViewModel : ObservableObject
{
    [ObservableProperty] private NameSource _source = new("");
    // Bound to MainViewModel.CleanNames, which owns persistence -- this view
    // model must not write AppSettings itself or the two flows can diverge.
    [ObservableProperty] private bool _clean = true;
    [ObservableProperty] private string? _customName;
    [ObservableProperty] private bool _isEditing;
    [ObservableProperty] private string _draft = "";
    [ObservableProperty] private bool _showOriginal;

    public string Original => FileNaming.RawStem(Source);
    public string Cleaned => FileNaming.DownloadStem(Source);
    public string Generated => Clean ? Cleaned : Original;
    public string Result => CustomName ?? Generated;
    // Only worth offering the comparison when the two actually differ.
    public bool Changed => Cleaned != Original;
    // A typed name wins over everything, so the Cleaned/Original switch no longer
    // applies.
    public bool CanToggleClean => CustomName == null;
    public string CleanLabel => Clean ? "Cleaned" : "Original";

    partial void OnSourceChanged(NameSource value) => RefreshDerived();
    partial void OnCleanChanged(bool value) { IsEditing = false; RefreshDerived(); }
    partial void OnCustomNameChanged(string? value) => RefreshDerived();

    private void RefreshDerived()
    {
        OnPropertyChanged(nameof(Original));
        OnPropertyChanged(nameof(Cleaned));
        OnPropertyChanged(nameof(Generated));
        OnPropertyChanged(nameof(Result));
        OnPropertyChanged(nameof(Changed));
        OnPropertyChanged(nameof(CanToggleClean));
        OnPropertyChanged(nameof(CleanLabel));
    }

    [RelayCommand]
    private void StartEditing()
    {
        Draft = Result;
        IsEditing = true;
    }

    [RelayCommand]
    private void Commit()
    {
        var trimmed = Draft.Trim();
        CustomName = trimmed.Length == 0 || trimmed == Generated ? null : trimmed;
        IsEditing = false;
    }

    [RelayCommand] private void CancelEditing() => IsEditing = false;
    [RelayCommand] private void ResetToAutomatic() => CustomName = null;
    [RelayCommand] private void ToggleClean() { if (CanToggleClean) Clean = !Clean; }
    [RelayCommand] private void ToggleShowOriginal() => ShowOriginal = !ShowOriginal;
}

// Replaces components/StatusBar.tsx + LogPanel.tsx, plus the new Node row.
public sealed partial class StatusBarViewModel(StatusService service) : ObservableObject
{
    [ObservableProperty] private bool _isExpanded;
    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private bool _isLoaded;

    public ObservableCollection<DependencyRow> Rows { get; } = [];
    public ObservableCollection<string> LogLines { get; } = [];

    public StatusResult? Current => service.Current;

    public string Headline { get; private set; } = "Checking dependencies...";
    public string Subline { get; private set; } = "";
    public StatusIconKind Icon { get; private set; } = StatusIconKind.Idle;
    // Problems always stay open -- there is an action to take, so hiding it would
    // be the one case where collapsing costs the user something.
    public bool IsOpen => !Healthy || IsExpanded;
    public bool Healthy { get; private set; }
    public bool DepsReady =>
        Current?.Python.Found == true && Current?.Ytdlp.Found == true && Current?.Node.Found == true;

    partial void OnIsExpandedChanged(bool value) => OnPropertyChanged(nameof(IsOpen));

    public async Task LoadAsync(bool refresh = false)
    {
        if (refresh) DependencyChecker.ResetPythonCache();
        IsBusy = true;
        try
        {
            var status = await service.GetAsync(refresh);
            Rows.Clear();
            foreach (var row in DependencyRows.Build(status)) Rows.Add(row);

            Healthy = Rows.All(r => r.State == RowState.Ok);
            var problems = Rows.Count(r => r.State != RowState.Ok);
            Headline = Healthy ? "Ready" : $"{problems} {(problems == 1 ? "problem" : "problems")}";
            Subline = string.Join(" . ", Rows.Select(r => r.Summary));
            Icon = Healthy
                ? StatusIconKind.Check
                : Rows.Any(r => r.State == RowState.Error) ? StatusIconKind.Error : StatusIconKind.Warn;
            IsLoaded = true;

            OnPropertyChanged(nameof(Headline));
            OnPropertyChanged(nameof(Subline));
            OnPropertyChanged(nameof(Icon));
            OnPropertyChanged(nameof(Healthy));
            OnPropertyChanged(nameof(IsOpen));
            OnPropertyChanged(nameof(Current));
            OnPropertyChanged(nameof(DepsReady));
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand] private Task Recheck() => LoadAsync(refresh: true);

    [RelayCommand] private void ToggleExpanded() => IsExpanded = !IsExpanded;

    [RelayCommand]
    private async Task RunActionAsync(DependencyRow row)
    {
        IsBusy = true;
        LogLines.Clear();
        try
        {
            var python = await DependencyChecker.ResolvePythonAsync();
            var stream = row.Action switch
            {
                RowAction.InstallYtdlp => Installer.InstallYtdlpAsync(python),
                RowAction.RetryYtdlpUpdate => Installer.UpdateYtdlpAsync(python),
                RowAction.InstallNode => Installer.InstallNodeAsync(),
                RowAction.InstallFfmpeg => Installer.InstallFfmpegAsync(),
                _ => null,
            };
            if (stream == null) return;

            await foreach (var line in stream) LogLines.Add(line);
            await LoadAsync(refresh: true);
        }
        catch (Exception ex)
        {
            LogLines.Add($"Error: {ex.Message}");
        }
        finally
        {
            IsBusy = false;
        }
    }
}
