// Screen check for desktop apps, for the workers: start the app of the project, set its window size, take a picture, click, press keys,
// list the Tab order and the controls. Runs without asking, because it only touches the project's own program and its own folder:
//   node <orchestrator>/tools/ui-probe.mjs launch bin/Debug/net8.0-windows/App.dll   (the program must be inside the project folder)
//   node .../ui-probe.mjs resize 1000 600 | shot out.png | click X Y | keys "{TAB}" | tab-order [N] | controls | stop
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui-probe.ps1");
const inside = (root, p) => { const rel = path.relative(root, p); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
const int = (v, name, lo, hi) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${name} must be a whole number from ${lo} to ${hi}`); return n; };

/** The powershell arguments for a command line, or an Error when the line is not allowed (paths must stay in the project folder). */
export function buildProbeArgs(argv, root) {
  const [cmd, ...a] = argv;
  const out = ["-Cmd", cmd];
  switch (cmd) {
    case "launch": {
      if (!a[0]) throw new Error("launch needs the program (.exe or .dll)");
      const target = path.resolve(root, a[0]);
      if (!inside(root, target)) throw new Error("the program must be inside the project folder");
      if (!/\.(exe|dll)$/i.test(target)) throw new Error("the program must be an .exe or a .dll");
      return [...out, "-Target", target];
    }
    case "resize": return [...out, "-WinW", String(int(a[0], "width", 300, 4000)), "-WinH", String(int(a[1], "height", 200, 4000))];
    case "shot": {
      if (!a[0]) throw new Error("shot needs the picture file (.png)");
      const file = path.resolve(root, a[0]);
      if (!inside(root, file) || !/\.png$/i.test(file)) throw new Error("the picture must be a .png inside the project folder");
      return [...out, "-Out", file];
    }
    case "click": return [...out, "-X", String(int(a[0], "x", 0, 4000)), "-Y", String(int(a[1], "y", 0, 4000))];
    case "keys": {
      if (!a[0] || a[0].length > 200) throw new Error("keys needs 1 to 200 characters");
      return [...out, "-Keys", a[0]];
    }
    case "tab-order": return [...out, "-Count", String(int(a[0] ?? 20, "count", 1, 80))];
    case "controls":
    case "stop": return out;
    default: throw new Error(`unknown command: ${cmd ?? ""} (launch, resize, shot, click, keys, tab-order, controls, stop)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "win32") { console.error("ui-probe works on Windows only"); process.exit(2); }
  let args;
  try { args = buildProbeArgs(process.argv.slice(2), process.cwd()); } catch (e) { console.error(e.message); process.exit(2); }
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args], { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (err) { console.error((stderr || err.message).trim()); process.exit(1); }
  });
}
