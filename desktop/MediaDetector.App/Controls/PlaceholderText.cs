using System.Windows;

namespace MediaDetector.App.Controls;

// WPF has no watermark/placeholder on TextBox, so the global TextBox template
// draws this string greyed out whenever the box is empty.
//
// An attached property rather than reusing Tag: Tag is a general-purpose slot,
// and the first later use of it for anything else would silently blank the
// placeholder with no error to explain it.
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
