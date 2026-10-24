// Desktop shell: a window around the same server the browser version uses (http://127.0.0.1:4173).
// If no server is running it starts one (npm run app = build the screen + serve it) and stops it again on quit.
const { app, BrowserWindow, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 4173;
const URL_BASE = `http://127.0.0.1:${PORT}`;
let spawned = false;
let win = null;

const isUp = () =>
  new Promise((resolve) => {
    const req = http.get(`${URL_BASE}/api/version`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServer() {
  if (await isUp()) return true;
  spawned = true;
  spawn("cmd.exe", ["/c", "npm run app"], { cwd: ROOT, windowsHide: true, stdio: "ignore", detached: false });
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    if (await isUp()) return true;
  }
  return false;
}

const splash = (text) => "data:text/html;charset=utf-8," + encodeURIComponent(`<meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#fbf9f5;color:#2b2a26;font-family:'Yu Gothic',system-ui,sans-serif"><div style="text-align:center"><div style="font-size:20px;font-weight:700">AIオーケストラ</div><p style="color:#8a8578">${text}</p></div>`);

function stopOwnServer() {
  if (!spawned) return;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "restart-server.ps1"), "-Port", String(PORT), "-StopOnly"], { cwd: ROOT, windowsHide: true, timeout: 30000 });
}

async function start() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 480,
    minHeight: 480,
    title: "AIオーケストラ",
    icon: path.join(ROOT, "public", "app-icon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#fbf9f5",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Anything that is not the app itself (previews, source links, the manual) opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(URL_BASE) && !url.startsWith("data:")) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  await win.loadURL(splash("起動しています…(初回は画面の準備に少し時間がかかります)"));
  if (await ensureServer()) {
    await win.loadURL(URL_BASE);
  } else {
    await win.loadURL(splash("サーバーを起動できませんでした。start-ai-orchestrator.bat から起動して、内容を確認してください。"));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", stopOwnServer);
}
