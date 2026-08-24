using System.Windows;
using MediaDetector.App.Themes;
using MediaDetector.App.Views;
using MediaDetector.Core.Storage;

namespace MediaDetector.App;

public partial class App : Application
{
    public static AppSettings Settings { get; private set; } = new();

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Settings = AppSettings.Load();
        // Before any window is shown -- no flash of the wrong theme.
        ThemeManager.Apply(Settings.Theme);
        new MainWindow().Show();
    }
}
