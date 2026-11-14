// Symbole aus dem Infobereich (rechts unten in der alten Taskleiste: Discord, Steam, Virenscanner ...).
// Die Bibliothek ManagedShell fängt die Anmeldungen der Programme ab und reicht sie zusätzlich an Windows weiter.
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using ManagedShell;
using ManagedShell.Common.Helpers;
using ManagedShell.WindowsTray;

namespace InselHelper;

internal static class Tray
{
    private static ShellManager? shell;
    private static Dispatcher? dispatcher;
    private static string last = "";
    private static readonly Dictionary<object, string> iconCache = new();

    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();

    public static void Start(Action<object> emit)
    {
        var t = new Thread(() =>
        {
            try
            {
                dispatcher = Dispatcher.CurrentDispatcher;
                shell = new ShellManager(ShellManager.DefaultShellConfig);
                if (shell.NotificationArea == null || shell.NotificationArea.IsFailed)
                {
                    emit(new { t = "tray", ok = false, icons = Array.Empty<object>() });
                }
                else
                {
                    var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                    timer.Tick += (_, _) => { try { Publish(emit); } catch (Exception e) { emit(new { t = "error", m = "tray: " + e.Message }); } };
                    timer.Start();
                    Publish(emit);
                }
                Dispatcher.Run();
            }
            catch (Exception e) { emit(new { t = "error", m = "tray: " + e.Message }); }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
    }

    private static void Publish(Action<object> emit)
    {
        var icons = shell!.NotificationArea.TrayIcons
            .Where(i => !i.IsHidden)
            .Select(i => new { id = i.Identifier, title = i.Title ?? "", icon = Png(i.Icon) })
            .ToList();
        var state = JsonSerializer.Serialize(icons);
        if (state == last) return;
        last = state;
        emit(new { t = "tray", ok = true, icons });
    }

    private static string Png(System.Windows.Media.ImageSource? src)
    {
        if (src is not BitmapSource bmp) return "";
        if (iconCache.TryGetValue(src, out var cached)) return cached;
        string url = "";
        try
        {
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using var ms = new MemoryStream();
            enc.Save(ms);
            url = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
        catch { }
        if (iconCache.Count > 300) iconCache.Clear();
        iconCache[src] = url;
        return url;
    }

    // Klick auf ein Symbol weitergeben; das Programm öffnet dann sein Fenster oder Menü an der Mausposition.
    public static void Click(string id, string button)
    {
        dispatcher?.InvokeAsync(() =>
        {
            var icon = shell?.NotificationArea.TrayIcons.FirstOrDefault(i => i.Identifier == id);
            if (icon == null) return;
            var b = button == "right" ? MouseButton.Right : MouseButton.Left;
            uint mouse = MouseHelper.GetCursorPositionParam();
            int dbl = (int)GetDoubleClickTime();
            icon.IconMouseEnter(mouse);
            icon.IconMouseDown(b, mouse, dbl);
            icon.IconMouseUp(b, mouse, dbl);
        });
    }

    public static void Stop()
    {
        try { dispatcher?.InvokeAsync(() => { shell?.Dispose(); shell = null; }).Wait(TimeSpan.FromSeconds(2)); } catch { }
    }
}
