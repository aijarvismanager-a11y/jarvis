# UI probe: starts a desktop app, resizes its window, takes a picture of it, clicks, sends keys and lists the Tab order.
# Called only through tools/ui-probe.mjs (which checks the paths). Output is plain text; pictures are PNG files.
param([string]$Cmd, [string]$Target = "", [string]$Out = "", [int]$X = 0, [int]$Y = 0, [int]$WinW = 0, [int]$WinH = 0, [string]$Keys = "", [int]$Count = 20, [string]$Title = "", [int]$WaitSec = 8)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public class UP {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[UP]::SetProcessDPIAware() | Out-Null
$stateFile = Join-Path $env:TEMP "ui-probe-state.json"
function Get-State { if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json } else { $null } }
function Get-Proc { $st = Get-State; if (-not $st) { throw "no app started: run launch first" }; $p = Get-Process -Id $st.pid -ErrorAction SilentlyContinue; if (-not $p) { throw "the app has exited (pid $($st.pid))" }; $p.Refresh(); $p }
function Get-Hwnd { $p = Get-Proc; if ($p.MainWindowHandle -eq 0) { throw "the app has no window yet" }; $p.MainWindowHandle }

switch ($Cmd) {
  "launch" {
    # $Target is a .exe, or a .dll run by dotnet; the app is started detached so that it outlives this call
    if ($Target -like "*.dll") { $exe = "dotnet"; $args2 = "`"$Target`"" } else { $exe = $Target; $args2 = "" }
    $before = @(Get-Process | Select-Object -ExpandProperty Id)
    $p = if ($args2) { Start-Process -FilePath $exe -ArgumentList $args2 -PassThru } else { Start-Process -FilePath $exe -PassThru }
    $end = (Get-Date).AddSeconds($WaitSec); while ((Get-Date) -lt $end -and -not $p.HasExited) { $p.Refresh(); if ($p.MainWindowHandle -ne 0) { break }; Start-Sleep -Milliseconds 300 }
    if ($p.HasExited) { throw "the app exited right away (code $($p.ExitCode))" }
    Start-Sleep -Milliseconds 1500; $p.Refresh()
    @{ pid = $p.Id; title = $p.MainWindowTitle } | ConvertTo-Json | Set-Content $stateFile
    "started pid=$($p.Id) title=[$($p.MainWindowTitle)] hasWindow=$($p.MainWindowHandle -ne 0)"
  }
  "resize" { $h = Get-Hwnd; [UP]::ShowWindow($h, 9) | Out-Null; $s = [UP]::GetDpiForWindow($h) / 96.0; [UP]::MoveWindow($h, 40, 40, [int]($WinW * $s), [int]($WinH * $s), $true) | Out-Null; Start-Sleep -Milliseconds 800; "resized to ${WinW}x${WinH} (dip)" }
  "shot" {
    $h = Get-Hwnd; [UP]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 500
    $r = New-Object UP+RECT; [UP]::GetWindowRect($h, [ref]$r) | Out-Null; $w = $r.R - $r.L; $hh = $r.B - $r.T
    $bmp = New-Object System.Drawing.Bitmap $w, $hh; $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc(); [UP]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); "saved ${w}x${hh} $Out"
  }
  "click" {
    $h = Get-Hwnd; [UP]::SetForegroundWindow($h) | Out-Null; $r = New-Object UP+RECT; [UP]::GetWindowRect($h, [ref]$r) | Out-Null
    [UP]::SetCursorPos($r.L + $X, $r.T + $Y) | Out-Null; Start-Sleep -Milliseconds 150; [UP]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [UP]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 600; "clicked ($X,$Y)"
  }
  "keys" { $h = Get-Hwnd; [UP]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait($Keys); Start-Sleep -Milliseconds 500; "sent $Keys" }
  "tab-order" {
    # presses Tab $Count times and lists what takes the focus each time (name, kind, id)
    $h = Get-Hwnd; [UP]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 300
    for ($i = 1; $i -le $Count; $i++) {
      [System.Windows.Forms.SendKeys]::SendWait("{TAB}"); Start-Sleep -Milliseconds 250
      try { $e = [System.Windows.Automation.AutomationElement]::FocusedElement; "$i`t$($e.Current.ControlType.ProgrammaticName -replace 'ControlType\.','')`t$($e.Current.Name)`t$($e.Current.AutomationId)" } catch { "$i`t?" }
    }
  }
  "controls" {
    # lists the named controls of the window with their state (and the value of sliders)
    $w = [System.Windows.Automation.AutomationElement]::FromHandle((Get-Hwnd))
    foreach ($e in $w.FindAll("Descendants", [System.Windows.Automation.Condition]::TrueCondition)) {
      $n = $e.Current.Name; if (-not $n) { continue }
      $t = $e.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''; $v = ""
      try { $rp = $e.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern); $v = " value=$($rp.Current.Value)/$($rp.Current.Maximum)" } catch {}
      "$t [$n]$v enabled=$($e.Current.IsEnabled)"
    }
  }
  "stop" { $st = Get-State; if ($st) { Stop-Process -Id $st.pid -ErrorAction SilentlyContinue; Remove-Item $stateFile -ErrorAction SilentlyContinue; "stopped pid=$($st.pid)" } else { "nothing to stop" } }
  default { throw "unknown command: $Cmd (launch, resize, shot, click, keys, tab-order, controls, stop)" }
}
