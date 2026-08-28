import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import http from "node:http";

// Real "implement this" tasks routinely take longer than a couple minutes
// (multiple file reads/writes, occasionally a lint/test pass) — this was
// confirmed by an actual timeout during real-machine testing at the old
// 120s limit. 10 minutes is a more realistic ceiling for a one-shot,
// non-interactive coding run.
const EXECUTE_TIMEOUT_MS = 10 * 60 * 1000;

const ROOT = path.resolve(process.cwd());
const WORKFLOW_PATH = path.join(ROOT, "config", "workflow.json");
const AI_SERVICES_PATH = path.join(ROOT, "config", "ai_services.json");
const WORKSPACE_DIR = path.join(ROOT, "workspace");
const PORT = Number(process.env.PORT ?? 4173);

const app = express();
app.use(express.json());

app.get("/api/workflow", async (_req, res) => {
  try {
    const raw = await readFile(WORKFLOW_PATH, "utf-8");
    res.type("application/json").send(raw);
  } catch (err) {
    res.status(500).json({ error: "workflow.json の読み込みに失敗しました", detail: String(err) });
  }
});

app.put("/api/workflow", async (req, res) => {
  try {
    await writeFile(WORKFLOW_PATH, JSON.stringify(req.body, null, 2), "utf-8");
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
  try {
    await writeFile(AI_SERVICES_PATH, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "ai_services.json の書き込みに失敗しました", detail: String(err) });
  }
});

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
app.post("/api/projects/:projectId/execute", async (req, res) => {
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
    (err, stdout, stderr) => {
      const timedOut = !!err?.killed && err.signal === "SIGTERM";
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
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
const wss = new WebSocketServer({ server, path: "/ws" });

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

server.listen(PORT, () => {
  console.log(`[ai-orchestrator] server listening on http://localhost:${PORT}`);
  console.log(`[ai-orchestrator] watching ${WORKSPACE_DIR} and ${WORKFLOW_PATH}`);
});
