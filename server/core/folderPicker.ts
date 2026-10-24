import { spawn } from "node:child_process";

// A browser cannot hand a web page the absolute path of a folder, so the server (which runs on the
// user's own PC) opens the Windows folder dialog and returns the chosen path.

const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '取り込むフォルダを選んでください'
$dialog.ShowNewFolderButton = $false
$owner.Show()
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }
$owner.Dispose()
`;

let open: Promise<string | null> | null = null;

/** Shows the folder dialog and resolves with the chosen path, or null when cancelled. One dialog at a time. */
export function pickFolder(timeoutMs = 5 * 60_000): Promise<string | null> {
  if (process.platform !== "win32") return Promise.reject(new Error("フォルダ選択ダイアログは Windows でのみ使えます。パスを入力してください"));
  if (open) return open;
  open = new Promise<string | null>((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const child = spawn("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: false });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error(`フォルダ選択ダイアログを開けませんでした${err.trim() ? `: ${err.trim().slice(0, 200)}` : ""}`));
      resolve(out.trim() || null);
    });
  }).finally(() => {
    open = null;
  });
  return open;
}
