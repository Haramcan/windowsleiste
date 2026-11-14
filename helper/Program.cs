// InselHelper: liefert der Insel alles, was nur Windows selbst weiß.
// Ausgabe (stdout): eine JSON-Zeile pro Ereignis.  Eingabe (stdin): eine JSON-Zeile pro Befehl.
//   Ereignisse: media, thumb, volume, windows, fullscreen, error
//   Befehle:    {"c":"media","a":"toggle|next|prev"}  {"c":"volume","v":0.5}  {"c":"mute"}
//               {"c":"activate","h":123}  {"c":"taskbar","hide":true}  {"c":"start"}
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace InselHelper;

internal static class Program
{
    private static readonly object OutLock = new();
    private static uint hostPid;

    private static void Emit(object o)
    {
        var line = JsonSerializer.Serialize(o);
        lock (OutLock) { Console.Out.WriteLine(line); Console.Out.Flush(); }
    }

    private static void Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        if (args.Length > 0) uint.TryParse(args[0], out hostPid);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Taskbar.Set(false);

        new Thread(PollLoop) { IsBackground = true }.Start();

        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            try { Handle(line); }
            catch (Exception e) { Emit(new { t = "error", m = e.Message }); }
        }
        Taskbar.Set(false);   // Insel wurde beendet: alte Taskleiste wieder zeigen
    }

    private static void Handle(string line)
    {
        using var doc = JsonDocument.Parse(line);
        var r = doc.RootElement;
        switch (r.GetProperty("c").GetString())
        {
            case "media": Media.Command(r.GetProperty("a").GetString() ?? "").GetAwaiter().GetResult(); break;
            case "volume": Volume.Set((float)Math.Clamp(r.GetProperty("v").GetDouble(), 0, 1)); break;
            case "mute": Volume.ToggleMute(); break;
            case "activate": WindowList.Activate(new IntPtr(r.GetProperty("h").GetInt64())); break;
            case "taskbar": Taskbar.Set(r.GetProperty("hide").GetBoolean()); break;
            case "start": Native.keybd_event(0x5B, 0, 0, UIntPtr.Zero); Native.keybd_event(0x5B, 0, 2, UIntPtr.Zero); break;
        }
    }

    private static void PollLoop()
    {
        string lastWindows = "", lastVolume = "";
        bool lastFull = false;
        int n = 0;
        while (true)
        {
            try
            {
                var list = WindowList.List(hostPid, out bool full);
                var w = JsonSerializer.Serialize(list);
                if (w != lastWindows) { lastWindows = w; Emit(new { t = "windows", list }); }
                if (full != lastFull) { lastFull = full; Emit(new { t = "fullscreen", on = full }); }

                if (Volume.Get(out float level, out bool muted))
                {
                    var v = $"{Math.Round(level, 2)}|{muted}";
                    if (v != lastVolume) { lastVolume = v; Emit(new { t = "volume", level = Math.Round(level, 2), muted }); }
                }

                Taskbar.KeepHidden();
                if (n++ % 2 == 0) Media.Poll(Emit).GetAwaiter().GetResult();
            }
            catch (Exception e) { Emit(new { t = "error", m = e.Message }); }
            Thread.Sleep(500);
        }
    }
}

// ---------- Musik: was gerade in Spotify, im Browser usw. läuft ----------
internal static class Media
{
    private static GlobalSystemMediaTransportControlsSessionManager? mgr;
    private static string lastState = "", thumbKey = "", thumb = "";

    public static async Task Poll(Action<object> emit)
    {
        mgr ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var s = mgr.GetCurrentSession();
        if (s == null)
        {
            if (lastState != "none") { lastState = "none"; thumbKey = ""; thumb = ""; emit(new { t = "media", has = false }); emit(new { t = "thumb", data = "" }); }
            return;
        }
        var p = await s.TryGetMediaPropertiesAsync();
        var info = s.GetPlaybackInfo();
        var tl = s.GetTimelineProperties();
        bool playing = info != null && info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        double dur = Math.Max(0, (tl.EndTime - tl.StartTime).TotalSeconds);
        double pos = Math.Max(0, (tl.Position - tl.StartTime).TotalSeconds);
        if (playing && dur > 0 && tl.LastUpdatedTime.Year > 2000)
            pos = Math.Min(dur, pos + (DateTimeOffset.UtcNow - tl.LastUpdatedTime).TotalSeconds);

        string title = p?.Title ?? "", artist = p?.Artist ?? "";
        var ev = new { t = "media", has = true, title, artist, app = s.SourceAppUserModelId ?? "", playing, pos = Math.Round(pos), dur = Math.Round(dur) };
        var state = JsonSerializer.Serialize(ev);
        if (state != lastState) { lastState = state; emit(ev); }

        // Cover nur neu laden, wenn der Titel wechselt (oder es noch fehlt)
        string key = title + "|" + artist;
        if (key != thumbKey || thumb == "")
        {
            var data = await ReadThumb(p?.Thumbnail);
            if (key != thumbKey || data != thumb) { thumbKey = key; thumb = data; emit(new { t = "thumb", data }); }
        }
    }

    private static async Task<string> ReadThumb(IRandomAccessStreamReference? r)
    {
        if (r == null) return "";
        try
        {
            using var st = await r.OpenReadAsync();
            uint size = (uint)st.Size;
            if (size == 0 || size > 4_000_000) return "";
            using var reader = new DataReader(st);
            await reader.LoadAsync(size);
            var bytes = new byte[size];
            reader.ReadBytes(bytes);
            var type = string.IsNullOrEmpty(st.ContentType) ? "image/png" : st.ContentType;
            return "data:" + type + ";base64," + Convert.ToBase64String(bytes);
        }
        catch { return ""; }
    }

    public static async Task Command(string action)
    {
        mgr ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var s = mgr.GetCurrentSession();
        if (s == null) return;
        switch (action)
        {
            case "toggle": await s.TryTogglePlayPauseAsync(); break;
            case "next": await s.TrySkipNextAsync(); break;
            case "prev": await s.TrySkipPreviousAsync(); break;
        }
    }
}

// ---------- Lautstärke des Standard-Ausgabegeräts ----------
internal static class Volume
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Das Gerät wird jedes Mal frisch geholt, damit ein Wechsel (z. B. Kopfhörer) sofort wirkt.
    private static bool With(Action<IAudioEndpointVolume> use)
    {
        object? enumerator = null, endpoint = null;
        IMMDevice? device = null;
        try
        {
            enumerator = new MMDeviceEnumerator();
            if (((IMMDeviceEnumerator)enumerator).GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device) != 0 || device == null) return false;
            var iid = typeof(IAudioEndpointVolume).GUID;
            if (device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out endpoint) != 0 || endpoint == null) return false;
            use((IAudioEndpointVolume)endpoint);
            return true;
        }
        catch { return false; }
        finally
        {
            if (endpoint != null) Marshal.ReleaseComObject(endpoint);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public static bool Get(out float level, out bool muted)
    {
        float l = 0; bool m = false;
        bool ok = With(v => { v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); });
        level = l; muted = m;
        return ok;
    }

    public static void Set(float level) => With(v =>
    {
        var ctx = Guid.Empty;
        v.SetMasterVolumeLevelScalar(level, ref ctx);
        if (level > 0) v.SetMute(false, ref ctx);
    });

    public static void ToggleMute() => With(v =>
    {
        var ctx = Guid.Empty;
        v.GetMute(out bool m);
        v.SetMute(!m, ref ctx);
    });
}

// ---------- Offene Fenster ----------
internal record WindowInfo(long h, string title, string exe, bool active);

internal static class WindowList
{
    private static IntPtr lastActive;

    public static List<WindowInfo> List(uint hostPid, out bool fullscreen)
    {
        var fg = Native.GetForegroundWindow();
        var found = new List<(IntPtr h, string title, string exe)>();
        Native.EnumWindows((h, _) =>
        {
            if (!Native.IsWindowVisible(h)) return true;
            if (Native.GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            long ex = Native.GetWindowLongPtr(h, -20 /* GWL_EXSTYLE */).ToInt64();
            if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;            // Werkzeugfenster
            if (Native.DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, out int cloaked, 4) == 0 && cloaked != 0) return true;
            int len = Native.GetWindowTextLength(h);
            if (len == 0) return true;
            Native.GetWindowThreadProcessId(h, out uint pid);
            if (pid == hostPid) return true;                                    // die Insel selbst
            var sb = new StringBuilder(len + 1);
            Native.GetWindowText(h, sb, sb.Capacity);
            found.Add((h, sb.ToString(), ExePath(pid)));
            return true;
        }, IntPtr.Zero);

        if (found.Any(f => f.h == fg)) lastActive = fg;
        else if (!found.Any(f => f.h == lastActive)) lastActive = IntPtr.Zero;

        fullscreen = found.Any(f => f.h == fg) && !Native.IsZoomed(fg) && CoversMonitor(fg);   // maximiert zählt nicht als Vollbild
        return found.Select(f => new WindowInfo(f.h.ToInt64(), f.title, f.exe, f.h == lastActive && !Native.IsIconic(f.h))).ToList();
    }

    private static string ExePath(uint pid)
    {
        var p = Native.OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
        if (p == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(1024);
            int size = sb.Capacity;
            return Native.QueryFullProcessImageName(p, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { Native.CloseHandle(p); }
    }

    // Vollbild (Spiele, Videos): das Fenster deckt seinen ganzen Bildschirm ab.
    private static bool CoversMonitor(IntPtr h)
    {
        var cls = new StringBuilder(64);
        Native.GetClassName(h, cls, cls.Capacity);
        var c = cls.ToString();
        if (c is "Progman" or "WorkerW" or "Shell_TrayWnd") return false;
        if (!Native.GetWindowRect(h, out var r)) return false;
        var mi = new Native.MONITORINFO { cbSize = Marshal.SizeOf<Native.MONITORINFO>() };
        if (!Native.GetMonitorInfo(Native.MonitorFromWindow(h, 2), ref mi)) return false;
        return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
    }

    // Wie in der Taskleiste: Klick holt das Fenster nach vorn, Klick auf das aktive Fenster minimiert es.
    public static void Activate(IntPtr h)
    {
        if (!Native.IsWindow(h)) return;
        if (Native.GetForegroundWindow() == h && !Native.IsIconic(h)) { Native.ShowWindow(h, 6 /* SW_MINIMIZE */); return; }
        if (Native.IsIconic(h)) Native.ShowWindow(h, 9 /* SW_RESTORE */);
        // Windows erlaubt den Wechsel nur nach einer Eingabe; ein kurzer Alt-Tastendruck genügt dafür.
        Native.keybd_event(0x12, 0, 0, UIntPtr.Zero);
        Native.SetForegroundWindow(h);
        Native.keybd_event(0x12, 0, 2, UIntPtr.Zero);
    }
}

// ---------- Alte Taskleiste aus- und einblenden ----------
internal static class Taskbar
{
    private static bool hidden;
    private static int savedState = -1;

    private static List<IntPtr> Bars()
    {
        var list = new List<IntPtr>();
        var main = Native.FindWindow("Shell_TrayWnd", null);
        if (main != IntPtr.Zero) list.Add(main);
        var h = IntPtr.Zero;
        while ((h = Native.FindWindowEx(IntPtr.Zero, h, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) list.Add(h);
        return list;
    }

    public static void Set(bool hide)
    {
        if (hide == hidden) return;
        hidden = hide;
        var bars = Bars();
        if (bars.Count == 0) return;
        // "Automatisch ausblenden" gibt den Platz der Taskleiste für maximierte Fenster frei.
        var abd = new Native.APPBARDATA { cbSize = Marshal.SizeOf<Native.APPBARDATA>(), hWnd = bars[0] };
        if (hide)
        {
            savedState = (int)Native.SHAppBarMessage(4 /* ABM_GETSTATE */, ref abd).ToInt64();
            abd.lParam = new IntPtr(1 /* ABS_AUTOHIDE */);
            Native.SHAppBarMessage(10 /* ABM_SETSTATE */, ref abd);
        }
        else if (savedState >= 0)
        {
            abd.lParam = new IntPtr(savedState);
            Native.SHAppBarMessage(10, ref abd);
        }
        foreach (var b in bars) Native.ShowWindow(b, hide ? 0 /* SW_HIDE */ : 5 /* SW_SHOW */);
    }

    // Windows blendet die Taskleiste gelegentlich von selbst wieder ein.
    public static void KeepHidden()
    {
        if (!hidden) return;
        foreach (var b in Bars()) if (Native.IsWindowVisible(b)) Native.ShowWindow(b, 0);
    }
}

internal static class Native
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string? cls, string? title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? cls, string? title);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("shell32.dll")] public static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
}
