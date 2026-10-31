# Gage の「Win+D のあとでも、フェンスが見えるか」を、実際に作り直して動かして測る確認の手順。
# AIオーケストラが、依頼を元のフォルダへ反映したあとに実行します(あなたが承認した内容のときだけ)。
#
# やること: (1) PCを使っていないことを確かめる (2) 動いている Gage を終了 (3) tools\publish.ps1 で作り直す
#           (4) 起動して、Win+D を3回押し、フェンスが Progman(デスクトップ層)の後ろに隠れた最長の時間を測る
#           (5) Gage は、新しいものを起動したままにする
# 終了コード: 0=通過 / 2=PCを使っているため延期 / それ以外=失敗
# 触るもの: 元のフォルダの bin・obj・publish(作り直し)。ほかのファイルは変更しません。

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = $env:VERIFY_SOURCE
if (-not $src -or -not (Test-Path $src)) { Write-Output "結果: 元のフォルダが見つかりません"; exit 1 }
$limitMs = 120      # 基準: フェンスが隠れてよい最長の時間(ミリ秒)
$idleNeedSec = 45   # これ以上、キーボード・マウスが動いていないときだけ実行する

Add-Type @"
using System; using System.Text; using System.Diagnostics; using System.Collections.Generic; using System.Runtime.InteropServices;
public class GageVerify {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static double IdleSeconds() {
    var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i);
    return ((uint)Environment.TickCount - i.dwTime) / 1000.0;
  }
  public static int FenceCount(uint gp) { int n = 0; EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); var c = new StringBuilder(256); GetClassName(h, c, 256); if (pid == gp && IsWindowVisible(h) && c.ToString().StartsWith("HwndWrapper")) n++; return true; }, IntPtr.Zero); return n; }
  // how many visible fences are behind the frontmost visible desktop layer (= hidden from the person)
  static int Hidden(uint gp) {
    int idx = 0, layer = -1; var fences = new List<int>();
    EnumWindows((h, l) => { var c = new StringBuilder(256); GetClassName(h, c, 256); uint pid; GetWindowThreadProcessId(h, out pid);
      string cn = c.ToString(); bool v = IsWindowVisible(h);
      if (v && layer < 0 && (cn == "Progman" || cn == "WorkerW")) layer = idx;
      if (pid == gp && v && cn.StartsWith("HwndWrapper")) fences.Add(idx);
      idx++; return true; }, IntPtr.Zero);
    int bad = 0; foreach (var f in fences) if (layer >= 0 && f > layer) bad++; return bad;
  }
  static void WinD() { keybd_event(0x5B,0,0,UIntPtr.Zero); keybd_event(0x44,0,0,UIntPtr.Zero); keybd_event(0x44,0,2,UIntPtr.Zero); keybd_event(0x5B,0,2,UIntPtr.Zero); }
  // presses Win+D, watches for 3.5 s, then presses it again to bring the windows back; returns the last moment (ms) a fence was hidden
  public static long Cycle(uint gp) {
    var sw = Stopwatch.StartNew(); WinD(); long last = 0;
    while (sw.ElapsedMilliseconds < 3500) { if (Hidden(gp) > 0) last = sw.ElapsedMilliseconds; System.Threading.Thread.Sleep(15); }
    WinD(); System.Threading.Thread.Sleep(1800); return last;
  }
}
"@

$idle = [GageVerify]::IdleSeconds()
if ($idle -lt $idleNeedSec) { Write-Output ("結果: PCを使用中のため延期します(最後の操作から {0:N0} 秒)" -f $idle); exit 2 }

Write-Output "手順1/4: 動いている Gage を終了します"
Get-Process Gage -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

Write-Output "手順2/4: tools\publish.ps1 で作り直します(数分かかります)"
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
Push-Location $src
try {
  & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src "tools\publish.ps1") 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Output "  $_" }
  if ($LASTEXITCODE -ne 0) { Write-Output "結果: 作り直しに失敗しました(終了コード $LASTEXITCODE)"; exit 1 }
} finally { Pop-Location }
$exe = Join-Path $src "publish\win-x64\Gage.exe"
if (-not (Test-Path $exe)) { Write-Output "結果: Gage.exe ができていません"; exit 1 }

Write-Output "手順3/4: 起動します"
Start-Process $exe
$p = $null
for ($i = 0; $i -lt 40; $i++) { Start-Sleep 1; $p = Get-Process Gage -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p -and [GageVerify]::FenceCount([uint32]$p.Id) -gt 0) { break } }
if (-not $p) { Write-Output "結果: 起動後に Gage が見つかりません(起動に失敗した可能性)"; exit 1 }
Start-Sleep 8
$fences = [GageVerify]::FenceCount([uint32]$p.Id)
if ($fences -eq 0) { Write-Output "結果: 起動しましたが、表示中のフェンスが1枚もありません"; exit 1 }

Write-Output "手順4/4: Win+D を慣らしに1回、測定に3回押して、フェンスが隠れる時間を測ります(画面が一瞬切り替わります)"
# 起動直後は準備中で遅くなりやすいので、1回は測らずに押して慣らす
$warm = [GageVerify]::Cycle([uint32]$p.Id)
Write-Output ("  (慣らし: {0} ミリ秒。判定には使いません)" -f $warm)
$worst = 0
for ($n = 1; $n -le 3; $n++) {
  $ms = [GageVerify]::Cycle([uint32]$p.Id)
  Write-Output ("  {0}回目: フェンスが隠れた最長 {1} ミリ秒" -f $n, $ms)
  if ($ms -gt $worst) { $worst = $ms }
}
$after = [GageVerify]::FenceCount([uint32]$p.Id)
if ($after -eq 0) { Write-Output "結果: 測ったあと、フェンスが表示されていません"; exit 1 }
if ($worst -gt $limitMs) { Write-Output ("結果: Win+D のあと、フェンスが最長 {0} ミリ秒、隠れました(基準 {1} ミリ秒以内。フェンス {2} 枚)" -f $worst, $limitMs, $after); exit 1 }
Write-Output ("結果: 通過 — Win+D のあと、フェンスが隠れた最長は {0} ミリ秒(基準 {1} ミリ秒以内。フェンス {2} 枚が表示中)" -f $worst, $limitMs, $after)
exit 0
