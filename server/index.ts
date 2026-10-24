import express from "express";
import path from "node:path";
import http from "node:http";
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
import { seedRegistryProfiles } from "./core/aiRegistry.ts";
import { ChromiumDriver, findBrowserExecutable } from "./core/browserDriver.ts";
import { RoutingExecutor, WebAiExecutor } from "./core/webAiExecutor.ts";
import { WebHandoffHub } from "./core/webHandoff.ts";
import { AppSmokeTester } from "./core/appSmokeTest.ts";
import { TaskLogStore } from "./core/taskLog.ts";
import { PreviewManager } from "./core/previewManager.ts";
import { SnapshotManager } from "./core/snapshotManager.ts";
import { ApprovalHub } from "./core/approvalHub.ts";
import { PermissionPolicy } from "./core/permissionPolicy.ts";

const ROOT = path.resolve(process.cwd());
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
seedRegistryProfiles(coreStore);
const approvals = new ApprovalHub(coreStore);
const previews = new PreviewManager(path.join(ROOT, "projects"));
// Preview servers are children of this process: never leave them behind.
process.once("exit", () => previews.stopAll());
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => process.exit(0));
const taskLogs = new TaskLogStore();
const snapshots = new SnapshotManager(path.join(ROOT, "projects"));
const claudeExecutor = new ClaudeCodeExecutor(coreStore, { policy: new PermissionPolicy(undefined, approvals.gate), logs: taskLogs, snapshots });
// Web AI automation (Phase 6): off until the user switches it on (PUT /api/v2/web-ai/settings).
// Level 2/3 drive the user's own Edge/Chrome in a dedicated profile; Level 1 needs no browser.
const browserExecutable = findBrowserExecutable();
const webDriver = browserExecutable ? new ChromiumDriver({ executable: browserExecutable, profileDir: path.join(ROOT, "data", "browser-profile") }) : undefined;
const webHub = new WebHandoffHub(coreStore);
const executor = new RoutingExecutor(coreStore, claudeExecutor, new WebAiExecutor(coreStore, webHub, { driver: webDriver }));
const engine = new MissionEngine(coreStore, {
  planner: new ClaudeCodePlanner({ cwd: ROOT }),
  executor,
  validator: new ProjectValidator(path.join(ROOT, "projects"), { smoke: new AppSmokeTester() }),
  broker: new AIBroker(coreStore),
});
app.use(
  "/api/v2",
  createOrchestratorRouter({ store: coreStore, engine, canExecute: true, approvals, previews, logs: taskLogs, snapshots, tokenMatches, healthChecker: new AiHealthChecker(coreStore), discovery: new AiDiscovery(coreStore), executableAdapters: () => [...executor.adapterTypes], webAi: { hub: webHub, browserAvailable: () => browserExecutable !== null } }),
);

app.get("/api/session-token", (_req, res) => {
  res.json({ token: SESSION_TOKEN });
});

const server = http.createServer(app);
// Mission runs can outlast Node's default request/header timeouts.
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, BIND_HOST, () => {
  console.log(`[ai-orchestrator] server listening on http://${BIND_HOST}:${PORT}`);
});
