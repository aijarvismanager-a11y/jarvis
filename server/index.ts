import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import http from "node:http";

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

// Runs a command the user chose to execute from the app (e.g. the
// generated "claude ..." command for a step). This deliberately allows
// arbitrary shell commands — the app is a single-user local tool and the
// command text is something the user typed or accepted in the UI, same
// trust level as them running it in their own terminal. It is opt-in per
// click, never automatic. cwd is workspace/ so the relative file paths in
// generated commands (docs/..., src/...) resolve the same way they would
// if the user ran the command by hand from that folder.
app.post("/api/execute", (req, res) => {
  const command = req.body?.command;
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command は必須です" });
    return;
  }
  exec(
    command,
    { cwd: WORKSPACE_DIR, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const timedOut = !!err?.killed && err.signal === "SIGTERM";
      const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      res.json({ exitCode, timedOut, stdout, stderr });
    },
  );
});

function isPathInsideWorkspace(targetPath: string) {
  const resolved = path.resolve(WORKSPACE_DIR, targetPath);
  return resolved === WORKSPACE_DIR || resolved.startsWith(WORKSPACE_DIR + path.sep);
}

async function listFilesRecursive(dir: string): Promise<{ path: string; mtimeMs: number }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(full)));
    } else {
      const s = await stat(full);
      results.push({ path: path.relative(WORKSPACE_DIR, full).replace(/\\/g, "/"), mtimeMs: s.mtimeMs });
    }
  }
  return results;
}

app.get("/api/artifacts", async (_req, res) => {
  try {
    const files = await listFilesRecursive(WORKSPACE_DIR);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: "workspace/ の一覧取得に失敗しました", detail: String(err) });
  }
});

app.get("/api/artifacts/*", async (req, res) => {
  const relPath = (req.params as Record<string, string>)[0] ?? "";
  if (!isPathInsideWorkspace(relPath)) {
    res.status(400).json({ error: "不正なパスです" });
    return;
  }
  try {
    const content = await readFile(path.join(WORKSPACE_DIR, relPath), "utf-8");
    res.type("text/plain").send(content);
  } catch (err) {
    res.status(404).json({ error: "ファイルが見つかりません", detail: String(err) });
  }
});

const server = http.createServer(app);
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
