using System.Windows;
using MediaDetector.Core.Storage;
using Microsoft.Win32;

namespace MediaDetector.App.Themes;

public static class ThemeManager
{
    private static ResourceDictionary? _current;

    // Resolves AppThemeMode.System against the OS setting, matching what
    // prefers-color-scheme did in the browser.
    public static bool IsDark(AppThemeMode mode) => mode switch
    {
        AppThemeMode.Light => false,
        AppThemeMode.Dark => true,
        _ => IsSystemDark(),
    };

    private static bool IsSystemDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            // AppsUseLightTheme: 0 = dark, 1 = light. Absent on older builds.
            return key?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch
        {
            return false;
        }
    }

    // Must be called before the main window is shown, or the first paint uses the
    // wrong palette. This is WPF's equivalent of the pre-paint script in
    // app/layout.tsx -- and it needs no script because startup is synchronous.
    public static void Apply(AppThemeMode mode)
    {
        var uri = new Uri(
            IsDark(mode) ? "Themes/Dark.xaml" : "Themes/Light.xaml", UriKind.Relative);
        var dict = (ResourceDictionary)Application.LoadComponent(uri);

        var merged = Application.Current.Resources.MergedDictionaries;
        if (_current != null) merged.Remove(_current);
        // Insert at 0 so the control styles (merged after) can reference tokens.
        merged.Insert(0, dict);
        _current = dict;

        // StatusIcon draws itself in OnRender and resolves brushes by key, so a
        // DynamicResource swap does not reach it. Repaint every live instance.
        foreach (Window window in Application.Current.Windows)
            Controls.StatusIcon.InvalidateAll(window);
    }
}
