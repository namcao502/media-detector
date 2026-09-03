using System.Windows;

namespace MediaDetector.App.Controls;

// WPF has no TextBox watermark, so the global template draws this when empty.
// An attached property rather than Tag: Tag is a general-purpose slot, and the
// first other use of it would silently blank the placeholder.
public static class PlaceholderText
{
    public static readonly DependencyProperty TextProperty =
        DependencyProperty.RegisterAttached(
            "Text",
            typeof(string),
            typeof(PlaceholderText),
            new PropertyMetadata(""));

    public static string GetText(DependencyObject element)
    {
        return (string)element.GetValue(TextProperty);
    }

    public static void SetText(DependencyObject element, string value)
    {
        element.SetValue(TextProperty, value);
    }
}
