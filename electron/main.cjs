// Desktop shell: a window around the same server the browser version uses (http://127.0.0.1:4173).
// If no server is running it starts one (npm run app = build the screen + serve it) and stops it again on quit.
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 4173;
const URL_BASE = `http://127.0.0.1:${PORT}`;
let spawned = false;
let child = null; // installed build: the server process this window started
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

/** > 0 when version a is newer than b ("1.5.57" vs "1.5.56"). */
const versionCompare = (a, b) => {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** What the server on the port says about itself ({version, pid, root, busy}); null when it does not answer. */
const serverInfo = () =>
  new Promise((resolve) => {
    const req = http.get(`${URL_BASE}/api/version`, { timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });

/** Installed build: run the bundled server with Electron's own Node. `dataDir` = where the person's data lives (data/, projects/). */
function startBundledServer(dataDir) {
  const loader = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
  // the server's output goes to a log file in the data folder, so a failed start can be diagnosed
  const log = fs.openSync(path.join(app.getPath("userData"), "server.log"), "a");
  child = spawn(process.execPath, ["--import", loader, path.join(ROOT, "server", "index.ts")], {
    cwd: dataDir,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ORCHESTRATOR_APP_DIR: ROOT, PORT: String(PORT) },
  });
  child.on("exit", () => { child = null; });
  spawned = true;
}

async function ensureServer() {
  if (await isUp()) return true;
  spawned = true;
  if (app.isPackaged) {
    startBundledServer(app.getPath("userData"));
  } else {
    spawn("cmd.exe", ["/c", "npm run app"], { cwd: ROOT, windowsHide: true, stdio: "ignore", detached: false });
  }
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    if (await isUp()) return true;
  }
  return false;
}

const splash = (text) => "data:text/html;charset=utf-8," + encodeURIComponent(`<meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#fbf9f5;color:#2b2a26;font-family:'Yu Gothic',system-ui,sans-serif"><div style="text-align:center"><div style="font-size:20px;font-weight:700">AIオーケストラ</div><p style="color:#8a8578">${text}</p></div>`);

function stopOwnServer() {
  if (!spawned) return;
  if (app.isPackaged) {
    // children of the server (preview servers, Claude Code) go with it
    if (child) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "restart-server.ps1"), "-Port", String(PORT), "-StopOnly"], { cwd: ROOT, windowsHide: true, timeout: 30000 });
}

/**
 * The server on the port is of another version than this app (e.g. one started from the project folder before the installer was run).
 * Nothing for the person to press: when no request is being worked on, the old server is stopped and this app's own server is started on
 * the SAME data; when one is running, the window stays on the old server and says plainly that the switch has to wait for it to finish
 * (and checks again by itself).
 */
async function switchToOwnServer() {
  const info = await serverInfo();
  if (!info || !info.version || info.version === app.getVersion()) return;
  if (versionCompare(info.version, app.getVersion()) > 0) {
    // the server is NEWER than this installer (a build made after it): never go back to the older version, just say the installer is behind
    void dialog.showMessageBox(win, { type: "info", title: "AIオーケストラ", message: `このインストーラ(v${app.getVersion()})より新しい版(v${info.version})で動いています`, detail: "そのまま使えます。インストーラは、新しい版のものに作り直したら入れ替えてください。", buttons: ["OK"] });
    return;
  }
  if (!info.root) {
    // an older server does not tell where its data is or whether it is working: stopping it blind could lose work or open the wrong data
    await dialog.showMessageBox(win, {
      type: "info",
      title: "AIオーケストラ",
      message: `先に動いていたサーバー(v${info.version})の画面を開いています`,
      detail: `このアプリは v${app.getVersion()} ですが、古い版のサーバーのため、実行中の依頼があるかどうかを確かめられず、自動では切り替えられません。
実行中の依頼がないことを確かめて、そのサーバーを止めてから、このアプリを開き直してください。`,
      buttons: ["OK"],
    });
    return;
  }
  if (info.busy !== false) {
    // not awaited: the waiting below must go on whether or not the person closes this notice
    void dialog.showMessageBox(win, {
      type: "info",
      title: "AIオーケストラ",
      message: `いま依頼を実行中のため、v${app.getVersion()} への切り替えを待っています`,
      detail: `先に動いていたサーバー(v${info.version})の画面を開いています。実行中の依頼が終わると、自動で、このアプリ(v${app.getVersion()})に切り替えます(途中で止めると、作業が失われるため)。\nこの案内を閉じても、そのまま使えます。`,
      buttons: ["OK"],
    });
    // look again until the work is done, then switch without asking
    for (;;) {
      await sleep(15000);
      if (!win || win.isDestroyed()) return;
      const now = await serverInfo();
      if (!now || now.version === app.getVersion()) return;
      if (now.busy === false) return switchToOwnServer();
    }
  }
  await win.loadURL(splash(`v${app.getVersion()} に切り替えています…(データはそのままです)`));
  if (info.pid) spawnSync("taskkill", ["/PID", String(info.pid), "/T", "/F"], { windowsHide: true });
  for (let i = 0; i < 30 && (await isUp()); i++) await sleep(500);
  if (await isUp()) {
    await win.loadURL(splash("古いサーバーを止められませんでした。手動で止めてから、このアプリを開き直してください。"));
    return;
  }
  startBundledServer(info.root && fs.existsSync(info.root) ? info.root : app.getPath("userData"));
  for (let i = 0; i < 120 && !(await isUp()); i++) await sleep(1000);
  await win.loadURL(URL_BASE);
}

async function start() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 480,
    minHeight: 480,
    title: "AIオーケストラ",
    icon: app.isPackaged ? path.join(process.resourcesPath, "app-icon.ico") : path.join(ROOT, "public", "app-icon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#fbf9f5",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Anything that is not the app itself (previews, source links, the manual) opens in the normal browser.
  // the screen can tell which installer's window it is shown in (and say so when the server it talks to is of another version)
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} AIOrchestratorDesktop/${app.getVersion()}`);
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
  const alreadyRunning = await isUp();
  if (await ensureServer()) {
    await win.loadURL(URL_BASE);
    // This window only shows a server. If another server (for example one started from the project folder) was already on the port, its
    // version is what the screen shows, not this installer's: it is replaced by this app's own server when nothing is running, else after the work is done.
    if (app.isPackaged && alreadyRunning) void switchToOwnServer();
  } else {
    await win.loadURL(splash(app.isPackaged ? `サーバーを起動できませんでした。ほかのアプリがポート${PORT}を使っていないか確認してください。詳細: ${path.join(app.getPath("userData"), "server.log")}` : "サーバーを起動できませんでした。start-ai-orchestrator.bat から起動して、内容を確認してください。"));
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
