using System.IO;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MediaDetector.Core.Dependencies;
using MediaDetector.Core.Ytdlp;
using Microsoft.Win32;

namespace MediaDetector.App.ViewModels;

// Fixes the embedded title/artist tag on a file that is already on disk --
// covers the gap MetadataOverrideFor leaves on purpose: a raw-mode download
// (CleanNames off, no custom name) never gets the automatic tag correction,
// because its filename already matches yt-dlp's default embed. This reads the
// file's CURRENT tag to prefill an edit box rather than requiring the original
// YouTube URL again.
public sealed partial class MetadataFixViewModel : ObservableObject
{
    [ObservableProperty] private string? _filePath;
    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _artist = "";
    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private string? _status;
    [ObservableProperty] private bool _statusIsError;
    [ObservableProperty] private string? _folderStatus;
    [ObservableProperty] private bool _folderStatusIsError;

    public string? FileName => FilePath == null ? null : Path.GetFileName(FilePath);
    public bool HasFile => FilePath != null;
    public bool CanSave => HasFile && Title.Trim().Length != 0 && !IsBusy;
    public bool CanFixFolder => !IsBusy;

    partial void OnFilePathChanged(string? value)
    {
        OnPropertyChanged(nameof(FileName));
        OnPropertyChanged(nameof(HasFile));
        OnPropertyChanged(nameof(CanSave));
    }

    partial void OnTitleChanged(string value) => OnPropertyChanged(nameof(CanSave));
    partial void OnIsBusyChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSave));
        OnPropertyChanged(nameof(CanFixFolder));
    }

    [RelayCommand]
    private async Task Browse()
    {
        var dialog = new OpenFileDialog
        {
            Filter = "Audio/Video files|*.mp3;*.m4a;*.mp4;*.opus;*.ogg;*.flac;*.webm;*.wav|All files|*.*",
        };
        if (dialog.ShowDialog() != true)
        {
            return;
        }

        FilePath = dialog.FileName;
        Status = null;
        IsBusy = true;
        try
        {
            var python = await DependencyChecker.ResolvePythonAsync();
            var tags = await MetadataTagger.ReadTagsAsync(python, FilePath);
            Title = tags?.Title ?? "";
            Artist = tags?.Artist ?? "";
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task Save()
    {
        if (FilePath == null || Title.Trim().Length == 0)
        {
            return;
        }

        IsBusy = true;
        try
        {
            var python = await DependencyChecker.ResolvePythonAsync();
            var ok = await MetadataTagger.TryWriteTagsAsync(
                python, FilePath, Title.Trim(), Artist.Trim(), CancellationToken.None);
            Status = ok ? "Saved." : "Could not write metadata for this file.";
            StatusIsError = !ok;
        }
        finally
        {
            IsBusy = false;
        }
    }

    // Bulk repair for downloads made before the PYTHONIOENCODING fix, whose tag
    // write silently failed on any non-ASCII path. Deliberately NOT recursive:
    // pointed at a music library root this would run CleanTitle over unrelated
    // files, so it stays scoped to the one folder the user picks.
    [RelayCommand]
    private async Task FixFolder()
    {
        var dialog = new OpenFolderDialog { Title = "Choose the folder to repair" };
        if (dialog.ShowDialog() != true)
        {
            return;
        }

        var paths = MetadataBackfill.FindCandidates(dialog.FolderName, recursive: false);
        if (paths.Count == 0)
        {
            FolderStatus = "No taggable audio or video files in that folder.";
            FolderStatusIsError = true;
            return;
        }

        // Rewriting tags in bulk is not undoable, so the count and the folder are
        // confirmed before anything is written.
        var confirmed = MessageBox.Show(
            $"Rewrite the embedded title and artist on {paths.Count} file(s) in\n"
            + $"{dialog.FolderName}?\n\n"
            + "Files whose tag is already correct are left untouched.",
            "Fix metadata in folder",
            MessageBoxButton.OKCancel,
            MessageBoxImage.Question);
        if (confirmed != MessageBoxResult.OK)
        {
            return;
        }

        IsBusy = true;
        FolderStatusIsError = false;
        try
        {
            var python = await DependencyChecker.ResolvePythonAsync();
            var done = 0;
            var progress = new Progress<string>(_ =>
            {
                done++;
                FolderStatus = $"Repairing {done} of {paths.Count}...";
            });

            var report = await MetadataBackfill.RunAsync(python, paths, progress);
            FolderStatus =
                $"Updated {report.Updated}, already correct {report.AlreadyCorrect}"
                + (report.Failed != 0 ? $", failed {report.Failed}" : "")
                + $" of {report.Scanned}.";
            FolderStatusIsError = report.Failed != 0;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
