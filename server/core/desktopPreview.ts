import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

// Preview of a desktop app (.NET WPF / WinForms): build a throw-away copy of the project folder and start its window on this PC.
// A copy, because the mission's own AI builds in the project folder at the same time (two builds in one folder break each other).

const SKIP = new Set(["bin", "obj", "node_modules", ".git", ".vs", ".idea", "packages"]);

/** The .csproj of the app itself (a windowed .NET program), not a library or a test project. Looks up to four folders down. */
export function findDesktopProject(root: string): string | null {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const full = path.join(dir, n);
      if (n.toLowerCase().endsWith(".csproj")) {
        try {
          const text = readFileSync(full, "utf8");
          if (/<OutputType>\s*WinExe\s*<\/OutputType>/i.test(text) && !/Test/i.test(n)) found.push(full);
        } catch {
          /* unreadable project file: skip it */
        }
        continue;
      }
      if (depth >= 4 || SKIP.has(n) || n.startsWith(".")) continue;
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1);
      } catch {
        /* vanished while walking */
      }
    }
  };
  walk(root, 0);
  return found.sort((a, b) => a.length - b.length)[0] ?? null;
}

export type DesktopRun = { dir: string; proc: ChildProcess | null; log: () => string; exited: () => boolean };

const run = (cmd: string, args: string[], cwd: string, keep: (s: string) => void): ChildProcess => {
  const proc = spawn(cmd, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DOTNET_NOLOGO: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1" } });
  proc.stdout?.on("data", (b: Buffer) => keep(b.toString()));
  proc.stderr?.on("data", (b: Buffer) => keep(b.toString()));
  return proc;
};

/**
 * Builds a copy of the project and opens the app's window. Resolves with a status the caller can show:
 * ok=true once the window process has stayed up a few seconds; otherwise a plain reason and the build/start log.
 */
export async function startDesktopApp(
  root: string,
  csproj: string,
  entry: { procs: { proc: ChildProcess; log: () => string; exited: () => boolean }[] },
  opts: { alive: () => boolean; settleMs?: number; /** root is already a throw-away folder (an exported snapshot): build in place, no copy */ inPlace?: boolean } = { alive: () => true },
): Promise<{ ok: true; dir: string } | { ok: false; reason: string; dir: string }> {
  const dir = opts.inPlace ? root : mkdtempSync(path.join(os.tmpdir(), "orch-preview-"));
  let out = "";
  const keep = (s: string) => (out = (out + s).slice(-20_000));
  const log = () => out.trim().slice(-1500);
  if (!opts.inPlace) {
    try {
      cpSync(root, dir, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
    } catch (err) {
      return { ok: false, dir, reason: `作業フォルダのコピーに失敗しました: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const project = opts.inPlace ? csproj : path.join(dir, path.relative(root, csproj));
  if (!existsSync(project)) return { ok: false, dir, reason: "コピーしたフォルダに、アプリのプロジェクトファイルが見つかりません" };

  const build = run("dotnet", ["build", project, "-nologo", "-v:q", "-clp:ErrorsOnly"], dir, keep);
  entry.procs.push({ proc: build, log, exited: () => build.exitCode !== null });
  const code = await new Promise<number | null>((resolve) => {
    build.once("error", () => resolve(null));
    build.once("exit", (c) => resolve(c));
  });
  if (!opts.alive()) return { ok: false, dir, reason: "停止されました" };
  if (code === null) return { ok: false, dir, reason: "dotnet を起動できませんでした(.NET SDKが入っていない可能性があります)" };
  if (code !== 0) return { ok: false, dir, reason: "ビルドに失敗しました(下のログを確認してください)" };

  const app = run("dotnet", ["run", "--project", project, "--no-build", "-nologo"], dir, keep);
  entry.procs.push({ proc: app, log, exited: () => app.exitCode !== null });
  await new Promise((r) => setTimeout(r, opts.settleMs ?? 4000));
  if (!opts.alive()) return { ok: false, dir, reason: "停止されました" };
  if (app.exitCode !== null && app.exitCode !== 0) return { ok: false, dir, reason: "アプリが起動の直後に終了しました(下のログを確認してください)" };
  return { ok: true, dir };
}

export const removeDir = (dir: string | null | undefined): void => {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked file: the temp folder is cleaned by the OS later */
  }
};

/** The program's file name without ".exe": <AssemblyName> in the project file, else the project file's own name. */
export function assemblyNameOf(csproj: string): string {
  try {
    const m = readFileSync(csproj, "utf8").match(/<AssemblyName>\s*([^<\s]+)\s*<\/AssemblyName>/i);
    if (m) return m[1];
  } catch {
    /* fall through to the file name */
  }
  return path.basename(csproj, ".csproj");
}

const SHOT_SCRIPT = `
param([string]$Name, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class OrchWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
}
"@
[void][OrchWin]::SetProcessDPIAware()
$p = $null
for ($i = 0; $i -lt 20 -and -not $p; $i++) {
  $p = Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { Start-Sleep -Milliseconds 500 }
}
if (-not $p) { Write-Output "NOWINDOW"; exit 2 }
$h = $p.MainWindowHandle
$r = New-Object OrchWin+RECT
[void][OrchWin]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
if ($w -le 0 -or $ht -le 0) { Write-Output "EMPTY"; exit 3 }
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][OrchWin]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$dark = 0; $n = 0
for ($x = 0; $x -lt $w; $x += [Math]::Max(1, [int]($w / 20))) { for ($y = 0; $y -lt $ht; $y += [Math]::Max(1, [int]($ht / 20))) { $n++; $c = $bmp.GetPixel($x, $y); if ($c.R + $c.G + $c.B -eq 0) { $dark++ } } }
if ($n -gt 0 -and $dark -ge $n) { $g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $w, $ht)) }
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "OK $w x $ht"
`;

/** A picture of the app's window (by the program's name). Resolves to an error text when no window could be captured. */
export async function captureWindow(processName: string, outPng: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (process.platform !== "win32") return { ok: false, reason: "ウィンドウの画像を撮れるのはWindowsだけです" };
  const dir = mkdtempSync(path.join(os.tmpdir(), "orch-shot-"));
  const script = path.join(dir, "shot.ps1");
  writeFileSync(script, SHOT_SCRIPT, "utf8");
  const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
    let out = "";
    const proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Name", processName, "-Out", outPng], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout?.on("data", (b: Buffer) => (out += b.toString()));
    proc.stderr?.on("data", (b: Buffer) => (out += b.toString()));
    const timer = setTimeout(() => proc.kill(), 60_000);
    proc.once("error", () => resolve({ code: null, out }));
    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
  removeDir(dir);
  if (result.code === 0 && existsSync(outPng)) return { ok: true };
  if (/NOWINDOW/.test(result.out)) return { ok: false, reason: "アプリのウィンドウが見つかりませんでした(起動に時間がかかっているか、ウィンドウが開く前に終わった可能性があります)" };
  return { ok: false, reason: `ウィンドウの画像を撮れませんでした: ${result.out.trim().slice(0, 200)}` };
}
