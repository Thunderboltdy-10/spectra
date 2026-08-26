$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeOmFix {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("oleacc.dll")]
  public static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IDispatch)] out object ppv);
  public static IntPtr FindWwg(uint targetPid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      var cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      if (cls.ToString() != "OpusApp") return true;
      EnumChildWindows(h, (ch, cl) => {
        var c2 = new StringBuilder(256);
        GetClassName(ch, c2, 256);
        if (c2.ToString() == "_WwG") { found = ch; return false; }
        return true;
      }, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static object Get(IntPtr hwnd) {
    Guid iid = new Guid("00020400-0000-0000-C000-000000000046");
    object obj;
    int hr = AccessibleObjectFromWindow(hwnd, 0xFFFFFFF0, ref iid, out obj);
    if (hr != 0 || obj == null) throw new Exception("AccessibleObjectFromWindow hr=" + hr);
    return obj;
  }
}
"@
$pabloPid = 24396
$target = $null
foreach ($proc in Get-Process WINWORD -ErrorAction SilentlyContinue) {
  if ($proc.Id -eq $pabloPid) { continue }
  $wwg = [NativeOmFix]::FindWwg([uint32]$proc.Id)
  if ($wwg -eq [IntPtr]::Zero) { continue }
  try {
    $docWin = [NativeOmFix]::Get($wwg)
    $path = [string]$docWin.Application.ActiveDocument.FullName
  } catch { continue }
  if ($path -notmatch "spectra-p1v3-rerun-fixture") { continue }
  if ($path -match "PS 6\.docx|PS 8\.docx") { throw "refusing Pablo document: $path" }
  $target = @{ Pid = $proc.Id; Hwnd = $wwg; Path = $path; DocWin = $docWin }
  break
}
if (-not $target) { throw "no fixture Word document found" }
Write-Output "DOC=$($target.Path) PID=$($target.Pid) HWND=$($target.Hwnd)"
$marker = "P1.V3 W1W3 FIX WORD-LOCK 2026-08-26"
$d = $target.DocWin.Application.ActiveDocument
$d.Range(0, 0).InsertBefore($marker + [char]13)
$d.Save()
Write-Output "SAVED=$($d.Saved) SIZE=$((Get-Item -LiteralPath $target.Path).Length) MARKER=$marker"
