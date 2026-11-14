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

// Symbole für das Startmenü der Insel: Windows liefert das Bild zu jedem Eintrag aus dem Ordner "Apps".
internal static class AppIcons
{
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr bitmap);
    }

    [StructLayout(LayoutKind.Sequential)] private struct SIZE { public int cx, cy; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory? item);

    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr h);

    public static string Get(string id)
    {
        var iid = typeof(IShellItemImageFactory).GUID;
        if (SHCreateItemFromParsingName("shell:AppsFolder\\" + id, IntPtr.Zero, ref iid, out var factory) != 0 || factory == null) return "";
        try
        {
            if (factory.GetImage(new SIZE { cx = 48, cy = 48 }, 0, out var hbm) != 0 || hbm == IntPtr.Zero) return "";
            try
            {
                var raw = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(hbm, IntPtr.Zero, System.Windows.Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                // Die Punkte enthalten Transparenz, auch wenn das Format es nicht ausweist: als solche neu verpacken.
                int w = raw.PixelWidth, h = raw.PixelHeight, stride = w * 4;
                var px = new byte[stride * h];
                raw.CopyPixels(px, stride, 0);
                var img = BitmapSource.Create(w, h, 96, 96, System.Windows.Media.PixelFormats.Pbgra32, null, px, stride);
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(img));
                using var ms = new MemoryStream();
                enc.Save(ms);
                return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
            }
            finally { DeleteObject(hbm); }
        }
        catch { return ""; }
        finally { Marshal.ReleaseComObject(factory); }
    }
}
