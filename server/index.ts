import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WorkflowFile } from "../src/types/workflow.ts";
import { AiServiceList } from "../src/types/aiService.ts";
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

// Real "implement this" tasks routinely take longer than a couple minutes
// (multiple file reads/writes, occasionally a lint/test pass) — this was
// confirmed by an actual timeout during real-machine testing at the old
// 120s limit. 10 minutes is a more realistic ceiling for a one-shot,
// non-interactive coding run.
const EXECUTE_TIMEOUT_MS = 10 * 60 * 1000;

const ROOT = path.resolve(process.cwd());
const WORKFLOW_PATH = path.join(ROOT, "config", "workflow.json");
const AI_SERVICES_PATH = path.join(ROOT, "config", "ai_services.json");
const OLLAMA_CONFIG_PATH = path.join(ROOT, "config", "ollama.json");
const WORKSPACE_DIR = path.join(ROOT, "workspace");
const PORT = Number(process.env.PORT ?? 4173);
// Local model calls can take a while on modest hardware (CPU-only, larger
// models) — long enough that the default fetch/HTTP timeouts would look
// like a hang rather than "still thinking".
const OLLAMA_TIMEOUT_MS = 3 * 60 * 1000;

// The API can run arbitrary shell commands (see /execute), so it must only be
// reachable from the user's own browser on this machine: bind to loopback,
// reject requests whose Host/Origin aren't local (blocks DNS rebinding and
// cross-site requests), and require a per-launch token for /execute.
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
  if (!isLocalHostHeader(req.headers.host) || !isLocalOrigin(req.headers.origin)) {
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
const executor = new ClaudeCodeExecutor(coreStore);
const engine = new MissionEngine(coreStore, {
  planner: new ClaudeCodePlanner({ cwd: ROOT }),
  executor,
  validator: new ProjectValidator(path.join(ROOT, "projects")),
  broker: new AIBroker(coreStore),
});
app.use(
  "/api/v2",
  createOrchestratorRouter({ store: coreStore, engine, canExecute: true, tokenMatches, healthChecker: new AiHealthChecker(coreStore), discovery: new AiDiscovery(coreStore), executableAdapters: [...executor.adapterTypes] }),
);

app.get("/api/session-token", (_req, res) => {
  res.json({ token: SESSION_TOKEN });
});

app.get("/api/workflow", async (_req, res) => {
  try {
    const raw = await readFile(WORKFLOW_PATH, "utf-8");
    res.type("application/json").send(raw);
  } catch (err) {
    res.status(500).json({ error: "workflow.json の読み込みに失敗しました", detail: String(err) });
  }
});

app.put("/api/workflow", async (req, res) => {
  const parsed = WorkflowFile.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "workflow の形式が不正です", detail: parsed.error.issues[0]?.message });
    return;
  }
  try {
    await writeFile(WORKFLOW_PATH, JSON.stringify(parsed.data, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "workflow.json の書き込みに失敗しました", detail: String(err) });
  }
});

app.get("/api/ai-services", async (_req, res) => {
  try {
    const raw = await readFile(AI_SERVICES_PATH, "utf-8");
    res.type("application/json").send(raw);
  } catch {
    res.json([]);
  }
});

app.put("/api/ai-services", async (req, res) => {
  const parsed = AiServiceList.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "ai_services の形式が不正です", detail: parsed.error.issues[0]?.message });
    return;
  }
  try {
    await writeFile(AI_SERVICES_PATH, JSON.stringify(parsed.data, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "ai_services.json の書き込みに失敗しました", detail: String(err) });
  }
});

const DEFAULT_OLLAMA_CONFIG = { baseUrl: "http://localhost:11434", model: "llama3.2" };

app.get("/api/ollama-config", async (_req, res) => {
  try {
    const raw = await readFile(OLLAMA_CONFIG_PATH, "utf-8");
    res.type("application/json").send(raw);
  } catch {
    res.json(DEFAULT_OLLAMA_CONFIG);
  }
});

app.put("/api/ollama-config", async (req, res) => {
  try {
    await writeFile(OLLAMA_CONFIG_PATH, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "ollama.json の書き込みに失敗しました", detail: String(err) });
  }
});

// Lightweight "is Ollama up, and what models does it have" check — lets
// the settings screen confirm the connection and list real model names
// without waiting on an actual (slower) generation call.
app.get("/api/ollama/status", async (req, res) => {
  const baseUrl = typeof req.query.baseUrl === "string" && req.query.baseUrl.trim() ? req.query.baseUrl.trim() : DEFAULT_OLLAMA_CONFIG.baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
    if (!upstream.ok) {
      res.json({ connected: false, models: [] });
      return;
    }
    const data = (await upstream.json()) as { models?: { name: string }[] };
    res.json({ connected: true, models: (data.models ?? []).map((m) => m.name) });
  } catch {
    res.json({ connected: false, models: [] });
  } finally {
    clearTimeout(timeout);
  }
});

// Proxies a single non-streaming generation call to a locally-running
// Ollama instance. This is the app's only "AI calls AI" path, and it's
// deliberately scoped to stay inside the app's own no-paid-API principle:
// Ollama runs entirely on the user's machine with models they downloaded
// themselves, so this is the same trust level as the existing "ローカルで
// 実行" Claude Code button — a local process the user already has, called
// only when they explicitly click a button, never automatically.
app.post("/api/ollama/generate", async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt は必須です" });
    return;
  }
  let config = DEFAULT_OLLAMA_CONFIG;
  try {
    config = JSON.parse(await readFile(OLLAMA_CONFIG_PATH, "utf-8"));
  } catch {
    // no saved config yet — use defaults
  }
  const baseUrl = typeof req.body?.baseUrl === "string" && req.body.baseUrl.trim() ? req.body.baseUrl.trim() : config.baseUrl;
  const model = typeof req.body?.model === "string" && req.body.model.trim() ? req.body.model.trim() : config.model;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      res.status(502).json({ error: `Ollamaがエラーを返しました（${upstream.status}）`, detail: text });
      return;
    }
    const data = (await upstream.json()) as { response?: string };
    await logOllamaHistory(req.body, true).catch(() => {});
    res.json({ text: data.response ?? "" });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    await logOllamaHistory(req.body, false).catch(() => {});
    res.status(502).json({
      error: timedOut
        ? "Ollamaの応答がタイムアウトしました（3分）"
        : `Ollamaに接続できませんでした。起動しているか、URL（${baseUrl}）が正しいか確認してください。`,
      detail: String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
});

// Piggybacks Ollama generations onto the same per-project execution-history
// log Claude Code runs use, so a step's "生成する" attempts show up in the
// same success-rate accounting instead of vanishing with no record. Only
// logs when the client passed a projectId (i.e. it was called from a real
// step, not some other future caller of this endpoint).
async function logOllamaHistory(body: unknown, ok: boolean): Promise<void> {
  const b = body as { projectId?: unknown; stepId?: unknown; role?: unknown };
  if (typeof b.projectId !== "string") return;
  const dir = projectDir(b.projectId);
  if (!dir) return;
  await appendHistory(dir, {
    id: `hist_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
    stepId: typeof b.stepId === "string" ? b.stepId : null,
    role: typeof b.role === "string" ? b.role : null,
    command: "ollama generate",
    exitCode: ok ? 0 : 1,
    timedOut: false,
    finishedAt: new Date().toISOString(),
  });
}

// Each project gets its own workspace/<projectId>/ folder so unrelated
// projects never share or collide over files. projectId is user-supplied
// (comes from the project's id in workflow.json) so it's restricted to a
// safe charset — this also rules out path traversal via the id itself.
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]+$/;

function projectDir(projectId: string): string | null {
  if (!PROJECT_ID_RE.test(projectId)) return null;
  return path.join(WORKSPACE_DIR, projectId);
}

function isPathInsideDir(dir: string, targetPath: string) {
  const resolved = path.resolve(dir, targetPath);
  return resolved === dir || resolved.startsWith(dir + path.sep);
}

// Runs a command the user chose to execute from the app (e.g. the
// generated "claude ..." command for a step). This deliberately allows
// arbitrary shell commands — the app is a single-user local tool and the
// command text is something the user typed or accepted in the UI, same
// trust level as them running it in their own terminal. It is opt-in per
// click, never automatic. cwd is workspace/<projectId>/ so the relative
// file paths in generated commands (docs/..., src/...) resolve the same
// way they would if the user ran the command by hand from that folder.
// Execution history is a simple append-only JSON array per project, used to
// show a success-rate panel per step (see roadmap item from the competitive
// teardown: legacy-ai-manager tracked nothing here, and neither did the
// current app until now). Kept under workspace/<id>/logs/ so it rides along
// with the rest of that project's files and shows up like any other
// artifact if the user goes looking.
const HISTORY_LIMIT = 200;

function historyPath(dir: string): string {
  return path.join(dir, "logs", "execution_history.json");
}

type HistoryEntry = {
  id: string;
  stepId: string | null;
  role: string | null;
  command: string;
  exitCode: number;
  timedOut: boolean;
  finishedAt: string;
};

async function readHistory(dir: string): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(historyPath(dir), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendHistory(dir: string, entry: HistoryEntry): Promise<void> {
  const existing = await readHistory(dir);
  const next = [...existing, entry].slice(-HISTORY_LIMIT);
  await mkdir(path.dirname(historyPath(dir)), { recursive: true });
  await writeFile(historyPath(dir), JSON.stringify(next, null, 2), "utf-8");
}

app.get("/api/projects/:projectId/history", async (req, res) => {
  const dir = projectDir(req.params.projectId);
  if (!dir) {
    res.status(400).json({ error: "不正なプロジェクトIDです" });
    return;
  }
  res.json({ entries: await readHistory(dir) });
});

app.post("/api/projects/:projectId/execute", async (req, res) => {
  if (!tokenMatches(req.headers["x-orchestrator-token"])) {
    res.status(403).json({ error: "実行トークンが無効です。ページを再読み込みしてください" });
    return;
  }
  const dir = projectDir(req.params.projectId);
  if (!dir) {
    res.status(400).json({ error: "不正なプロジェクトIDです" });
    return;
  }
  const command = req.body?.command;
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command は必須です" });
    return;
  }
  const stepId = typeof req.body?.stepId === "string" ? req.body.stepId : null;
  const role = typeof req.body?.role === "string" ? req.body.role : null;
  // A brand-new project has no workspace/<id>/ folder yet — exec's cwd
  // option requires the directory to already exist.
  await mkdir(dir, { recursive: true }).catch(() => {});
  // On Windows, cmd.exe defaults to the system codepage (e.g. Shift-JIS),
  // which mojibakes any non-ASCII output since we read it back as UTF-8.
  // Switching to codepage 65001 (UTF-8) first fixes that for commands that
  // print UTF-8, without changing the command the user sees and approved.
  const shellCommand = process.platform === "win32" ? `chcp 65001>nul && ${command}` : command;
  exec(
    shellCommand,
    { cwd: dir, timeout: EXECUTE_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
    async (err, stdout, stderr) => {
      const timedOut = !!err?.killed && err.signal === "SIGTERM";
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      await appendHistory(dir, {
        id: `hist_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
        stepId,
        role,
        command,
        exitCode,
        timedOut,
        finishedAt: new Date().toISOString(),
      }).catch(() => {});
      res.json({ exitCode, timedOut, timeoutMs: EXECUTE_TIMEOUT_MS, stdout, stderr });
    },
  );
});

async function listFilesRecursive(dir: string, baseDir: string): Promise<{ path: string; mtimeMs: number }[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const results: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(full, baseDir)));
    } else {
      const s = await stat(full);
      results.push({ path: path.relative(baseDir, full).replace(/\\/g, "/"), mtimeMs: s.mtimeMs });
    }
  }
  return results;
}

app.get("/api/projects/:projectId/artifacts", async (req, res) => {
  const dir = projectDir(req.params.projectId);
  if (!dir) {
    res.status(400).json({ error: "不正なプロジェクトIDです" });
    return;
  }
  try {
    const files = await listFilesRecursive(dir, dir);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: "workspace/ の一覧取得に失敗しました", detail: String(err) });
  }
});

app.get("/api/projects/:projectId/artifacts/*", async (req, res) => {
  const dir = projectDir(req.params.projectId);
  if (!dir) {
    res.status(400).json({ error: "不正なプロジェクトIDです" });
    return;
  }
  const relPath = (req.params as Record<string, string>)[0] ?? "";
  if (!isPathInsideDir(dir, relPath)) {
    res.status(400).json({ error: "不正なパスです" });
    return;
  }
  try {
    const content = await readFile(path.join(dir, relPath), "utf-8");
    res.type("text/plain").send(content);
  } catch (err) {
    res.status(404).json({ error: "ファイルが見つかりません", detail: String(err) });
  }
});

// Lets a step's "paste the AI's reply here" box save straight to that
// step's output file, so the web-AI hand-off (copy prompt -> paste into
// ChatGPT/etc. -> bring the reply back) doesn't require the user to open
// a separate text editor and get the exact folder/filename right by hand.
app.put("/api/projects/:projectId/artifacts/*", async (req, res) => {
  const dir = projectDir(req.params.projectId);
  if (!dir) {
    res.status(400).json({ error: "不正なプロジェクトIDです" });
    return;
  }
  const relPath = (req.params as Record<string, string>)[0] ?? "";
  if (!isPathInsideDir(dir, relPath)) {
    res.status(400).json({ error: "不正なパスです" });
    return;
  }
  const content = req.body?.content;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content は必須です" });
    return;
  }
  try {
    const target = path.join(dir, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "ファイルの保存に失敗しました", detail: String(err) });
  }
});

const server = http.createServer(app);
// Node's http.Server has its own request/header timeouts (independent of
// the child_process timeout above) that would otherwise cut off a long
// /api/execute response before EXECUTE_TIMEOUT_MS is reached.
server.requestTimeout = 0;
server.headersTimeout = 0;
const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: ({ req }: { req: http.IncomingMessage }) => isLocalHostHeader(req.headers.host) && isLocalOrigin(req.headers.origin),
});

function broadcast(message: unknown) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

const watcher = chokidar.watch([WORKSPACE_DIR, WORKFLOW_PATH, AI_SERVICES_PATH], {
  ignoreInitial: true,
});

watcher
  .on("add", (p) => broadcast({ type: "fs-change", event: "add", path: p }))
  .on("change", (p) => broadcast({ type: "fs-change", event: "change", path: p }))
  .on("unlink", (p) => broadcast({ type: "fs-change", event: "unlink", path: p }));

server.listen(PORT, BIND_HOST, () => {
  console.log(`[ai-orchestrator] server listening on http://${BIND_HOST}:${PORT}`);
  console.log(`[ai-orchestrator] watching ${WORKSPACE_DIR} and ${WORKFLOW_PATH}`);
});
