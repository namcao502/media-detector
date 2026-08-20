using System.Collections.Specialized;
using System.Windows;
using MediaDetector.App.ViewModels;

namespace MediaDetector.App.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _vm = new();

    public MainWindow()
    {
        InitializeComponent();
        DataContext = _vm;
        // Probe dependencies once the window is up, so the first paint is not
        // blocked on spawning python/node/ffmpeg.
        Loaded += async (_, _) => await _vm.InitAsync();

        // Keep the newest line in view. Only five lines are visible at a time, so
        // without this the panel would sit frozen on the first five entries of the
        // session and look broken while work was clearly happening.
        _vm.Log.Entries.CollectionChanged += OnLogEntriesChanged;
    }

    private void OnLogEntriesChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (e.Action != NotifyCollectionChangedAction.Add)
        {
            return;
        }

        LogScroll.ScrollToEnd();
    }
}
