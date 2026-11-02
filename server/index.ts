import express from "express";
import path from "node:path";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { openDatabase } from "./core/db.ts";
import { Store } from "./core/store.ts";
import { MissionEngine } from "./core/missionEngine.ts";
import { ClaudeCodeExecutor } from "./core/claudeCodeExecutor.ts";
import { ProjectValidator } from "./core/taskValidator.ts";
import { ClaudeCodePlanner } from "./core/planner.ts";
import { createOrchestratorRouter } from "./core/api.ts";
import { AIBroker } from "./core/aiBroker.ts";
import { AiHealthChecker } from "./core/aiHealth.ts";
import { AiDiscovery } from "./core/aiDiscovery.ts";
import { AiScout } from "./core/aiScout.ts";
import { ensureClaudeCode, seedBuiltInWebAis, applyGoogleLoginRegistry, applyIdeationCapability, applyClaudeCodeReview, applyLaterRetirements, seedRegistryProfiles } from "./core/aiRegistry.ts";
import { ChromiumDriver, findBrowserExecutable } from "./core/browserDriver.ts";
import { RoutingExecutor, WebAiExecutor, needsCodeExecutor } from "./core/webAiExecutor.ts";
import { WEB_ADAPTER_TYPES, WebHandoffHub } from "./core/webHandoff.ts";
import { AppSmokeTester } from "./core/appSmokeTest.ts";
import { TaskLogStore } from "./core/taskLog.ts";
import { PreviewManager } from "./core/previewManager.ts";
import { SnapshotManager } from "./core/snapshotManager.ts";
import { ApprovalHub } from "./core/approvalHub.ts";
import { PermissionPolicy } from "./core/permissionPolicy.ts";
import { autoReflectMission } from "./core/autoReflect.ts";
import { runVerification } from "./core/postVerify.ts";
import { resolveInProject } from "./core/paths.ts";
import { pickFolder } from "./core/folderPicker.ts";
import { DepsInstaller } from "./core/depsInstaller.ts";
import { SystemCheck } from "./core/systemCheck.ts";
import { VersionWatch } from "./core/version.ts";
import { archiveOldRecords } from "./core/recordsArchive.ts";
import { newProjectRoot } from "./core/deliveryFolder.ts";

// ROOT = where the user data lives (data/, projects/, backups/): the working directory.
// APP_DIR = where the program itself is (server/, dist/): the same folder when run from the repository,
// a separate read-only folder when the desktop installer runs it (it sets ORCHESTRATOR_APP_DIR).
const ROOT = path.resolve(process.cwd());
const APP_DIR = process.env.ORCHESTRATOR_APP_DIR ? path.resolve(process.env.ORCHESTRATOR_APP_DIR) : ROOT;
const INSTALLED = APP_DIR !== ROOT;
const PORT = Number(process.env.PORT ?? 4173);
// The API can start local CLI processes, so it must only be
// reachable from the user's own browser on this machine: bind to loopback,
// reject requests whose Host/Origin aren't local (blocks DNS rebinding and
// cross-site requests), and require a per-launch token for mutating /api/v2 calls.
const BIND_HOST = "127.0.0.1";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SESSION_TOKEN = randomBytes(32).toString("hex");

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

function isLocalHostHeader(hostHeader: string | undefined): boolean {
  const name = hostnameOf(hostHeader);
  return name !== null && LOCAL_HOSTNAMES.has(name);
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser callers and same-origin GETs send none
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function tokenMatches(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(SESSION_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = express();
app.use((req, res, next) => {
  // Before/after pages run in a sandboxed iframe, so their own requests carry "Origin: null"; only the read-only snapshot files accept that.
  const sandboxedRead = req.method === "GET" && req.headers.origin === "null" && /^\/api\/v2\/projects\/[^/]+\/snapshot-site\//.test(req.path);
  if (!isLocalHostHeader(req.headers.host) || !(sandboxedRead || isLocalOrigin(req.headers.origin))) {
    res.status(403).json({ error: "このアプリはローカルのブラウザからのみ利用できます" });
    return;
  }
  next();
});
app.use(express.json({ limit: "2mb" }));

// New orchestrator (Phase 2/3): Claude Code plans and executes inside each
// project's own directory, restricted by the Permission Policy and checked by
// Validation L1-L3.
const coreStore = new Store(openDatabase(path.join(ROOT, "data", "orchestrator.db")), path.join(ROOT, "projects"));
// requests migrated from the old app stay "draft" although every task is done: they are finished
coreStore.db.prepare("UPDATE missions SET status = 'completed' WHERE status = 'draft' AND EXISTS (SELECT 1 FROM tasks WHERE tasks.mission_id = missions.id) AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.mission_id = missions.id AND tasks.status != 'completed')").run();
ensureClaudeCode(coreStore);
seedBuiltInWebAis(coreStore);
applyGoogleLoginRegistry(coreStore);
applyLaterRetirements(coreStore);
seedRegistryProfiles(coreStore);
applyIdeationCapability(coreStore);
applyClaudeCodeReview(coreStore);
const approvals = new ApprovalHub(coreStore);
const previews = new PreviewManager(path.join(ROOT, "projects"));
// Preview servers are children of this process: never leave them behind.
process.once("exit", () => previews.stopAll());
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => process.exit(0));
const taskLogs = new TaskLogStore();
const snapshots = new SnapshotManager(path.join(ROOT, "projects"));
const claudeExecutor = new ClaudeCodeExecutor(coreStore, { policy: new PermissionPolicy(undefined, approvals.gate), logs: taskLogs, snapshots });
// Web AI automation (Phase 6): off until the user switches it on (PUT /api/v2/web-ai/settings).
// Level 2/3 drive the user's own Edge/Chrome/Brave in a dedicated profile; Level 1 needs no browser.
const browserExecutable = findBrowserExecutable();
const webDriver = browserExecutable ? new ChromiumDriver({ executable: browserExecutable, profileDir: path.join(ROOT, "data", "browser-profile") }) : undefined;
const webHub = new WebHandoffHub(coreStore);
const webExecutor = new WebAiExecutor(coreStore, webHub, { driver: webDriver });
const executor = new RoutingExecutor(coreStore, claudeExecutor, webExecutor);
const scout = new AiScout(coreStore, { asker: webExecutor });
const engine = new MissionEngine(coreStore, {
  planner: new ClaudeCodePlanner({ cwd: ROOT }),
  executor,
  aiReview: { reviewer: webExecutor },
  validator: new ProjectValidator(path.join(ROOT, "projects"), { smoke: new AppSmokeTester(), snapshots, runsOnWebChat: (task) => { const svc = task.selectedAi ? coreStore.getAiService(task.selectedAi) : null; return !!svc && (WEB_ADAPTER_TYPES as readonly string[]).includes(svc.adapterType) && !needsCodeExecutor(task); } }),
  broker: new AIBroker(coreStore),
  onMissionCompleted: (projectId, missionId) =>
    void autoReflectMission(coreStore, path.join(ROOT, "backups", "sync"), projectId, missionId, (rel) => {
      try {
        return readFileSync(resolveInProject(coreStore.projectsRoot, projectId, rel), "utf-8").slice(0, 200_000);
      } catch {
        return null;
      }
    }).then((r) => (r.applied > 0 ? runVerification(coreStore, ROOT, projectId, missionId) : undefined)),
});
// A restart leaves approved missions marked "running" with no loop behind them: pick them up again.
for (const project of coreStore.listProjects()) {
  for (const mission of coreStore.listMissions(project.id)) {
    if (mission.status === "running") void engine.run(project.id, mission.id).catch(() => undefined);
  }
}
// Restart = run scripts/restart-server.ps1 (it kills this process tree and starts a new server). It is created through
// WMI so it is not a child of this process and survives being killed with it.
function restartSelf(): void {
  if (process.platform !== "win32") return;
  const q = (v: string) => v.replace(/'/g, "''");
  const script = path.join(ROOT, "scripts", "restart-server.ps1");
  const command = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell -NoProfile -ExecutionPolicy Bypass -File "${q(script)}" -Port ${PORT}'; CurrentDirectory = '${q(ROOT)}' } | Out-Null`;
  spawn("powershell", ["-NoProfile", "-Command", command], { stdio: "ignore", windowsHide: true }).unref();
}
app.use(
  "/api/v2",
  createOrchestratorRouter({ store: coreStore, engine, canExecute: true, system: new SystemCheck(), pickFolder, deps: new DepsInstaller(path.join(ROOT, "projects")), restart: process.platform === "win32" && !INSTALLED ? restartSelf : undefined, syncBackupsRoot: path.join(ROOT, "backups", "sync"), appRoot: ROOT, newProjectRoot: () => newProjectRoot(coreStore), approvals, previews, logs: taskLogs, snapshots, tokenMatches, healthChecker: new AiHealthChecker(coreStore), discovery: new AiDiscovery(coreStore), scout, executableAdapters: () => [...executor.adapterTypes], webAi: { hub: webHub, browserAvailable: () => browserExecutable !== null, status: () => webExecutor.browserStatus(), openLogin: (url) => webDriver?.openForLogin(url), probe: async (aiId) => { const svc = coreStore.getAiService(aiId); return svc ? webExecutor.probe(svc) : { ok: false, reason: "AIが見つかりません" }; }, importSignIn: async () => { if (!webDriver) throw new Error("ブラウザが見つかりません"); return webDriver.importSignIn(); } } }),
);

// Lets the UI tell the user when this process is running older code than what is on disk.
const versionWatch = new VersionWatch(path.join(APP_DIR, "server"));
// The app's own version (package.json), shown in the screen.
const APP_VERSION = (() => {
  try {
    return String((JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8")) as { version?: string }).version ?? "");
  } catch {
    return "";
  }
})();
app.get("/api/version", (_req, res) => {
  // `root`: where this server keeps the person's data; `busy`: a request is being worked on right now. The desktop window uses both when it
  // has to replace a server of another version (it must not stop work in progress, and the new server has to open the same data).
  let busy = false;
  try {
    busy = coreStore.db.prepare("SELECT 1 FROM missions WHERE status = 'running' LIMIT 1").get() !== undefined;
  } catch {
    busy = true; // cannot tell: assume work is going on
  }
  res.json({ ...versionWatch.status(), version: APP_VERSION, root: ROOT, busy });
});

app.get("/api/session-token", (_req, res) => {
  res.json({ token: SESSION_TOKEN });
});

// Production mode: when the screen has been built (npm run build) this server serves it too, so one process on one
// port is the whole app (no Vite dev server to start, to keep alive, or to lose). During development `npm start` still uses Vite.
const UI_DIR = path.join(APP_DIR, "dist");
if (existsSync(path.join(UI_DIR, "index.html"))) {
  app.use(express.static(UI_DIR, { index: false, setHeaders: (res, file) => { if (/\.html$/i.test(file)) res.setHeader("cache-control", "no-store"); } }));
  // any other page address (a reload on a sub-page) gets the app; API paths never do
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader("cache-control", "no-store");
    res.sendFile(path.join(UI_DIR, "index.html"));
  });
  console.log(`[ai-orchestrator] serving the built screen from ${UI_DIR}`);
}

const server = http.createServer(app);
// Mission runs can outlast Node's default request/header timeouts.
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, BIND_HOST, () => {
  console.log(`[ai-orchestrator] server listening on http://${BIND_HOST}:${PORT}`);
});

// Old AI records (_ai-records/<name>/ untouched for two weeks) are packed into backups/records by themselves: once a minute
// after start-up, then once a day. Nothing to press, nothing in the way of the user's own files.
const packOldRecords = () =>
  archiveOldRecords({ projectsRoot: path.join(ROOT, "projects"), backupsRoot: path.join(ROOT, "backups") })
    .then((r) => { if (r.archived.length) console.log(`[ai-orchestrator] packed old AI records: ${r.archived.join(", ")}`); })
    .catch((err) => console.warn("[ai-orchestrator] packing old AI records failed:", err instanceof Error ? err.message : err));
setTimeout(() => void packOldRecords(), 60_000).unref();
setInterval(() => void packOldRecords(), 86_400_000).unref();
// Once a week the scout asks a running web AI for new Google-sign-in AIs; only while no mission is running (it uses the browser).
setInterval(() => {
  try {
    if (scout.due() && coreStore.db.prepare("SELECT 1 FROM missions WHERE status = 'running' LIMIT 1").get() === undefined) void scout.run();
  } catch {
    /* try again next hour */
  }
}, 3_600_000).unref();
