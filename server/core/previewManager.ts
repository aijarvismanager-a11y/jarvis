import http from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { detectApps, freePort, probePage, startServer, waitReady, type Started } from "./appSmokeTest.ts";
import { findBrowserExecutable } from "./browserDriver.ts";
import { killTree } from "./commandRunner.ts";
import { projectDir } from "./paths.ts";

// Preview: lets the user open what has been built so far, while the mission is
// still running. It starts the project's own dev servers (the same detection as
// the integration gate) or, for plain HTML, a small static server. Everything
// listens on a free local port; one preview per project, a few overall, and all
// of it is stopped on request, when a new one is needed, and at shutdown.

export type PreviewState = "stopped" | "starting" | "running" | "error";
export type PreviewStatus = {
  state: PreviewState;
  /** What the user opens: the frontend, else the backend, else the static page. */
  url: string | null;
  message: string;
  startedAt: string | null;
  /** Result of opening the page once after it came up (blank page / errors), when a browser was available. */
  check: { ok: boolean; problems: string[] } | null;
  log: string;
};

const MAX_PREVIEWS = 2;
const IDLE: PreviewStatus = { state: "stopped", url: null, message: "", startedAt: null, check: null, log: "" };
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);
export const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

/** Folder holding an index.html (project root first, then one or two levels down), for projects without a dev server. */
export function findStaticRoot(root: string): string | null {
  const walk = (dir: string, depth: number): string | null => {
    if (existsSync(path.join(dir, "index.html"))) return dir;
    if (depth >= 2) return null;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    for (const n of names) {
      const sub = path.join(dir, n);
      if (SKIP_DIRS.has(n) || n.startsWith(".") || !statSync(sub).isDirectory()) continue;
      const hit = walk(sub, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, 0);
}

function staticServer(dir: string, port: number): Promise<http.Server> {
  const base = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(base, `.${rel}`);
    if (file !== base && !file.startsWith(base + path.sep)) return void res.writeHead(403).end();
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

type Entry = { status: PreviewStatus; procs: Started[]; server: http.Server | null; token: number };

export class PreviewManager {
  private readonly entries = new Map<string, Entry>();
  private seq = 0;

  constructor(
    private readonly projectsRoot: string,
    private readonly opts: { browserExecutable?: string | null; maxPreviews?: number } = {},
  ) {}

  status(projectId: string): PreviewStatus {
    const e = this.entries.get(projectId);
    if (!e) return IDLE;
    return { ...e.status, log: e.procs.map((p) => p.log()).filter(Boolean).join("\n---\n").slice(-1500) };
  }

  /** Begins starting the preview and returns at once; the caller polls status(). */
  start(projectId: string): PreviewStatus {
    const current = this.entries.get(projectId);
    if (current && (current.status.state === "starting" || current.status.state === "running")) return this.status(projectId);
    this.stop(projectId);
    const live = [...this.entries.values()].filter((e) => e.status.state === "starting" || e.status.state === "running").length;
    if (live >= (this.opts.maxPreviews ?? MAX_PREVIEWS)) throw new Error(`同時に動かせるプレビューは${this.opts.maxPreviews ?? MAX_PREVIEWS}件までです。ほかのプレビューを止めてください`);
    const entry: Entry = { status: { ...IDLE, state: "starting", message: "起動しています…", startedAt: new Date().toISOString() }, procs: [], server: null, token: ++this.seq };
    this.entries.set(projectId, entry);
    void this.boot(projectId, entry);
    return this.status(projectId);
  }

  stop(projectId: string): void {
    const e = this.entries.get(projectId);
    if (!e) return;
    this.entries.delete(projectId);
    for (const p of e.procs) killTree(p.proc.pid);
    e.server?.close();
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }

  private async boot(projectId: string, entry: Entry): Promise<void> {
    const alive = () => this.entries.get(projectId) === entry;
    const fail = (message: string) => {
      if (!alive()) return;
      entry.status = { ...entry.status, state: "error", message };
      // keep the log for the message, but do not leave half-started servers running
      for (const p of entry.procs) killTree(p.proc.pid);
      entry.server?.close();
    };
    try {
      const root = projectDir(this.projectsRoot, projectId);
      const apps = existsSync(root) ? detectApps(root) : [];
      const frontend = apps.find((a) => a.kind === "frontend");
      const backend = apps.find((a) => a.kind === "backend");
      const target = frontend ?? backend;
      let url: string;
      let apiOrigin = "";

      if (target) {
        for (const a of [frontend, backend]) if (a && !existsSync(path.join(a.dir, "node_modules"))) return fail(`${path.relative(root, a.dir) || "."} に node_modules がありません(依存が未インストールのため起動できません)`);
        const backendPort = backend ? await freePort() : 0;
        if (backend) {
          apiOrigin = `http://localhost:${backendPort}`;
          const b = startServer(backend, [], { PORT: String(backendPort) });
          entry.procs.push(b);
          if (!(await waitReady(apiOrigin, b))) return fail(b.exited() ? "バックエンドが起動できませんでした(下のログを確認してください)" : "バックエンドの起動を確認できませんでした(PORT環境変数に対応していない可能性があります)");
          if (!alive()) return;
        }
        if (frontend) {
          const port = await freePort();
          url = `http://localhost:${port}`;
          const f = startServer(frontend, ["--", "--port", String(port), "--strictPort"], { PORT: String(backendPort || ""), ...(backend ? { VITE_API_PROXY_TARGET: apiOrigin, CORS_ORIGIN: url } : {}) });
          entry.procs.push(f);
          if (!(await waitReady(url, f))) return fail(f.exited() ? "フロントエンドが起動できませんでした(下のログを確認してください)" : "フロントエンドの起動を確認できませんでした");
        } else {
          url = apiOrigin;
        }
      } else {
        const dir = existsSync(root) ? findStaticRoot(root) : null;
        if (!dir) return fail("起動できるものが見つかりません(package.json の dev/start スクリプトも index.html もありません)");
        const port = await freePort();
        entry.server = await staticServer(dir, port);
        url = `http://localhost:${port}/`;
      }
      if (!alive()) return;
      entry.status = { ...entry.status, state: "running", url, message: "動作中" };

      const browser = this.opts.browserExecutable === undefined ? findBrowserExecutable() : this.opts.browserExecutable;
      if (browser && frontend) {
        try {
          const report = await probePage(browser, url, [url, ...(apiOrigin ? [apiOrigin] : [])]);
          const problems = report.problems.slice(0, 6);
          if (report.textLength === 0) problems.unshift("画面が真っ白です(表示された文字が0件)");
          if (alive()) entry.status = { ...entry.status, check: { ok: problems.length === 0, problems } };
        } catch {
          /* the page check is a bonus: the preview itself is up */
        }
      }
    } catch (err) {
      fail(`起動できませんでした: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
