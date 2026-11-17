// Zusätze: Windows-Taste abfangen, Lautstärke pro Programm, Mikrofon stummschalten.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace InselHelper;

// ---------- Windows-Taste: allein gedrückt öffnet sie das Menü der Insel statt das Startmenü ----------
internal static class WinKey
{
    private delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);

    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);

    public static volatile bool Enabled;
    private static HookProc? proc;          // als Feld halten, sonst räumt die Laufzeit den Rückruf weg
    private static IntPtr hook;
    private static bool down, other;
    private static Action<object>? emit;

    public static void Start(Action<object> emitter)
    {
        emit = emitter;
        var t = new Thread(() =>
        {
            try
            {
                proc = Callback;
                hook = SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, proc, GetModuleHandle(null), 0);
                if (hook == IntPtr.Zero) emitter(new { t = "error", m = "winkey: Hook nicht gesetzt" });
                Dispatcher.Run();
            }
            catch (Exception e) { emitter(new { t = "error", m = "winkey: " + e.Message }); }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
    }

    private static IntPtr Callback(int code, IntPtr w, IntPtr l)
    {
        try
        {
            if (code >= 0)
            {
                int key = Marshal.ReadInt32(l), flags = Marshal.ReadInt32(l, 8), msg = (int)w;
                bool injected = (flags & 0x10) != 0;
                bool isDown = msg == 0x100 || msg == 0x104;
                bool isWin = key == 0x5B || key == 0x5C;
                if (!injected)
                {
                    if (isWin)
                    {
                        if (isDown) { if (!down) { down = true; other = false; } }
                        else
                        {
                            if (down && !other && Enabled)
                            {
                                // Ein unsichtbarer Tastendruck dazwischen: Windows hält die Taste dann für ein Kürzel
                                // und öffnet sein eigenes Startmenü nicht.
                                Native.keybd_event(0xFF, 0, 0, UIntPtr.Zero);
                                Native.keybd_event(0xFF, 0, 2, UIntPtr.Zero);
                                var em = emit;
                                if (em != null) ThreadPool.QueueUserWorkItem(_ => em(new { t = "winkey" }));
                            }
                            down = false;
                        }
                    }
                    else if (isDown && down) other = true;   // Win+D, Win+Umschalt+S usw. bleiben unangetastet
                }
            }
        }
        catch { }
        return CallNextHookEx(hook, code, w, l);
    }
}

// ---------- Ton: einzelne Programme und Mikrofon ----------
internal static class Audio
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
        [PreserveSig] int _0(); [PreserveSig] int _1(); [PreserveSig] int _2(); [PreserveSig] int _3(); [PreserveSig] int _4();
        [PreserveSig] int _5(); [PreserveSig] int _6(); [PreserveSig] int _7(); [PreserveSig] int _8(); [PreserveSig] int _9(); [PreserveSig] int _10();
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        [PreserveSig] int _GetAudioSessionControl();
        [PreserveSig] int _GetSimpleAudioVolume();
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int _GetDisplayName(); [PreserveSig] int _SetDisplayName(); [PreserveSig] int _GetIconPath(); [PreserveSig] int _SetIconPath();
        [PreserveSig] int _GetGroupingParam(); [PreserveSig] int _SetGroupingParam(); [PreserveSig] int _Register(); [PreserveSig] int _Unregister();
        // IAudioSessionControl2
        [PreserveSig] int _GetSessionIdentifier(); [PreserveSig] int _GetSessionInstanceIdentifier();
        [PreserveSig] int GetProcessId(out uint pid);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    private static bool WithDevice(int dataFlow, int role, Guid iid, Action<object> use)
    {
        object? enumerator = null, iface = null;
        IMMDevice? device = null;
        try
        {
            enumerator = new MMDeviceEnumerator();
            if (((IMMDeviceEnumerator)enumerator).GetDefaultAudioEndpoint(dataFlow, role, out device) != 0 || device == null) return false;
            if (device.Activate(ref iid, 23, IntPtr.Zero, out iface) != 0 || iface == null) return false;
            use(iface);
            return true;
        }
        catch { return false; }
        finally
        {
            if (iface != null) Marshal.ReleaseComObject(iface);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    // ----- Mikrofon (Standardgerät für Gespräche und Standardgerät allgemein) -----
    public static bool MicState(out bool muted)
    {
        bool m = false;
        bool ok = WithDevice(1 /* Aufnahme */, 2 /* Gespräche */, typeof(IAudioEndpointVolume).GUID, o => ((IAudioEndpointVolume)o).GetMute(out m));
        muted = m;
        return ok;
    }

    public static void MicToggle()
    {
        if (!MicState(out bool muted)) return;
        foreach (int role in new[] { 2, 0 })
            WithDevice(1, role, typeof(IAudioEndpointVolume).GUID, o => { var ctx = Guid.Empty; ((IAudioEndpointVolume)o).SetMute(!muted, ref ctx); });
    }

    // ----- Lautstärke pro Programm -----
    public record AppVolume(uint pid, string name, double level, bool muted);

    private static void EachSession(Action<uint, ISimpleAudioVolume> use)
    {
        WithDevice(0 /* Wiedergabe */, 1, typeof(IAudioSessionManager2).GUID, o =>
        {
            if (((IAudioSessionManager2)o).GetSessionEnumerator(out var list) != 0 || list == null) return;
            try
            {
                list.GetCount(out int n);
                for (int i = 0; i < n; i++)
                {
                    if (list.GetSession(i, out var s) != 0 || s == null) continue;
                    try
                    {
                        var c = (IAudioSessionControl2)s;
                        c.GetState(out int state);
                        if (state == 2 /* abgelaufen */) continue;
                        c.GetProcessId(out uint pid);
                        use(pid, (ISimpleAudioVolume)s);
                    }
                    catch { }
                    finally { Marshal.ReleaseComObject(s); }
                }
            }
            finally { Marshal.ReleaseComObject(list); }
        });
    }

    public static List<AppVolume> Mixer()
    {
        var byPid = new Dictionary<uint, AppVolume>();
        EachSession((pid, vol) =>
        {
            if (byPid.ContainsKey(pid)) return;
            vol.GetMasterVolume(out float level);
            vol.GetMute(out bool muted);
            string name = "Systemtöne";
            if (pid != 0)
            {
                try { using var p = Process.GetProcessById((int)pid); name = p.ProcessName; }
                catch { return; }
            }
            byPid[pid] = new AppVolume(pid, name, Math.Round(level, 2), muted);
        });
        // gleiche Programme (z. B. mehrere Browser-Prozesse) zu einem Eintrag zusammenfassen
        return byPid.Values.GroupBy(v => v.name).Select(g => g.First()).OrderBy(v => v.pid == 0 ? 1 : 0).ThenBy(v => v.name).ToList();
    }

    public static void SetAppVolume(string name, float level)
    {
        EachSession((pid, vol) =>
        {
            string n = "Systemtöne";
            if (pid != 0) { try { using var p = Process.GetProcessById((int)pid); n = p.ProcessName; } catch { return; } }
            if (n != name) return;
            var ctx = Guid.Empty;
            vol.SetMasterVolume(level, ref ctx);
            if (level > 0) vol.SetMute(false, ref ctx);
        });
    }
}
