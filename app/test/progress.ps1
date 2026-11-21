# Testprogramm: ein Fenster mit Fortschrittsbalken an seinem Taskleisten-Symbol (40 %), wie ein Download.
Write-Output 'gestartet'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList3 {
  void HrInit(); void AddTab(IntPtr h); void DeleteTab(IntPtr h); void ActivateTab(IntPtr h); void SetActiveAlt(IntPtr h);
  void MarkFullscreenWindow(IntPtr h, [MarshalAs(UnmanagedType.Bool)] bool f);
  void SetProgressValue(IntPtr h, ulong done, ulong total); void SetProgressState(IntPtr h, int state);
}
[ComImport, Guid("56fdf344-fd6d-11d0-958a-006097c9a090"), ClassInterface(ClassInterfaceType.None)]
public class TaskbarListClass {}
public static class InselTB {
  public static void Set(IntPtr h, int pct) {
    var t = (ITaskbarList3)new TaskbarListClass(); t.HrInit(); t.SetProgressState(h, 2); t.SetProgressValue(h, (ulong)pct, 100);
  }
}
'@
$f = New-Object System.Windows.Forms.Form
$f.Text = 'InselFortschritt'
$script:t0 = New-Object System.Windows.Forms.Timer
$script:t0.Interval = 2500
$script:t0.Add_Tick({ $script:t0.Stop(); try { [InselTB]::Set($script:f.Handle, 40); Write-Output 'Fortschritt gesetzt' } catch { Write-Output ('Fehler: ' + $_) } })
$script:f = $f
$f.Add_Shown({ $script:t0.Start() })
$t1 = New-Object System.Windows.Forms.Timer; $t1.Interval = 25000
$t1.Add_Tick({ $f.Close() })
$t1.Start()
[System.Windows.Forms.Application]::Run($f)
