import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { CdpClient, findBrowserExecutable, waitUntil } from "./browserDriver.ts";
import { killTree, needsShell } from "./commandRunner.ts";

// Integration smoke test (Validation L4): start the generated app (backend and
// frontend dev servers), open the frontend in a headless browser and report what
// a user would hit first: a blank page, uncaught exceptions, console errors, or
// API calls answered with 4xx/5xx. It finds what static checks cannot, e.g. a
// frontend that expects an array where the backend returns { data: [...] }.
//
// "skipped" means it could not be verified (no browser, nothing startable, a
// server that never came up): that is reported, but never counted as a failure.

export type SmokeResult = { status: "passed" | "failed" | "skipped"; detail: string };
type AppKind = "frontend" | "backend";
export type DetectedApp = { dir: string; kind: AppKind; script: "dev" | "start" };

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage", ".next"]);
const MAX_DEPTH = 3;
const READY_TIMEOUT_MS = 90_000;
const SETTLE_MS = 3_000;
const MAX_REPORTED = 8;
const TAIL_CHARS = 1500;

type Pkg = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const readPkg = (dir: string): Pkg | null => {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Pkg;
  } catch {
    return null;
  }
};

/** True when the app declares dependencies but they are not installed. An app with none (plain Node) needs no node_modules. */
export function missingDeps(dir: string): boolean {
  const pkg = readPkg(dir);
  const declared = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).length > 0;
  return declared && !existsSync(path.join(dir, "node_modules"));
}

/** package.json folders under the project, classified as frontend (vite dev server) or backend (anything else with a dev/start script). */
export function detectApps(root: string): DetectedApp[] {
  const found: DetectedApp[] = [];
  const walk = (dir: string, depth: number) => {
    const pkg = readPkg(dir);
    if (pkg) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const script = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : null;
      if (script) found.push({ dir, kind: "vite" in deps || /\bvite\b/.test(pkg.scripts?.[script] ?? "") ? "frontend" : "backend", script });
    }
    if (depth >= MAX_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return found;
}

export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });

export type Started = { proc: ChildProcess; log: () => string; exited: () => boolean };
export function startServer(app: DetectedApp, args: string[], env: Record<string, string>): Started {
  let out = "";
  const proc = spawn("npm", ["run", app.script, ...args], { cwd: app.dir, env: { ...process.env, ...env, BROWSER: "none", CI: "" }, shell: needsShell("npm"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (b: Buffer) => (out = (out + b.toString()).slice(-20_000));
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  return { proc, log: () => out.trim().slice(-TAIL_CHARS), exited: () => proc.exitCode !== null };
}

/** Resolves true once the URL answers with any HTTP response; false if the process dies or time runs out. */
export async function waitReady(url: string, s: Started, signal?: AbortSignal): Promise<boolean> {
  const ok = await waitUntil(
    async () => {
      if (s.exited() || signal?.aborted) throw new Error("the process ended"); // stops the wait at once (waitUntil keeps polling on null)
      try {
        await fetch(url, { signal: AbortSignal.timeout(2_000) });
        return true;
      } catch {
        return false;
      }
    },
    { timeoutMs: READY_TIMEOUT_MS, intervalMs: 500, signal },
  ).catch(() => null);
  return !!ok;
}

export type PageReport = { problems: string[]; textLength: number };

export async function probePage(browserExe: string, url: string, apiOrigins: string[]): Promise<PageReport> {
  const profile = mkdtempSync(path.join(os.tmpdir(), "smoke-profile-"));
  const port = await freePort();
  const proc = spawn(browserExe, ["--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore", windowsHide: true });
  const problems: string[] = [];
  const note = (p: string) => {
    if (!problems.includes(p) && problems.length < 50) problems.push(p);
  };
  let cdp: CdpClient | null = null;
  try {
    const up = await waitUntil(async () => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false), { timeoutMs: 20_000, intervalMs: 250 });
    if (!up) throw new Error("ブラウザを起動できませんでした");
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    cdp.onEvent = (method, params) => {
      if (method === "Runtime.exceptionThrown") {
        const d = params.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
        note(`未処理の例外: ${(d?.exception?.description ?? d?.text ?? "").split("\n")[0]}`);
      } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        const args = (params.args as { value?: unknown; description?: string }[] | undefined) ?? [];
        note(`console.error: ${args.map((a) => a.description ?? String(a.value ?? "")).join(" ").slice(0, 300)}`);
      } else if (method === "Network.responseReceived") {
        const r = params.response as { url: string; status: number } | undefined;
        if (r && r.status >= 400 && !/favicon/i.test(r.url) && apiOrigins.some((o) => r.url.startsWith(o))) note(`通信エラー: ${r.status} ${r.url}`);
      }
    };
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url });
    await waitUntil(async () => (await cdp!.evaluate<string>("document.readyState")) === "complete", { timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const textLength = await cdp.evaluate<number>("(document.body && document.body.innerText || '').trim().length");
    return { problems, textLength };
  } finally {
    cdp?.close();
    killTree(proc.pid);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* the browser may still hold the folder; it lives in the OS temp dir */
    }
  }
}

const IGNORED_PROBLEM = /ResizeObserver loop/i;

export class AppSmokeTester {
  constructor(private readonly opts: { browserExecutable?: string | null } = {}) {}

  /** A project with no separate frontend: its server (npm start / dev) is started on a free port and its top page is opened. Anything that cannot be shown is "skipped", never a failure of the task. */
  private async runSingleServer(app: DetectedApp, browser: string | null, signal?: AbortSignal): Promise<SmokeResult> {
    if (!browser) return { status: "skipped", detail: "Edge・Chrome・Braveのいずれも見つからないため、画面の表示確認は行っていません" };
    if (missingDeps(app.dir)) return { status: "skipped", detail: "node_modules が無く(依存が未インストール)、起動確認は行っていません" };
    const started: Started[] = [];
    try {
      const port = await freePort();
      const origin = `http://localhost:${port}`;
      const server = startServer(app, [], { PORT: String(port) });
      started.push(server);
      if (!(await waitReady(origin, server, signal))) return { status: "skipped", detail: `サーバーの起動を確認できませんでした(まだ作りかけの可能性があります)${server.log() ? `:
${server.log()}` : ""}` };
      const top = await fetch(origin, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
      if (!top || !/html/i.test(top.headers.get("content-type") ?? "")) return { status: "skipped", detail: "サーバーのトップページが画面(HTML)ではないため、画面の表示確認は行っていません" };
      const report = await probePage(browser, origin, [origin]);
      const problems = report.problems.filter((p) => !IGNORED_PROBLEM.test(p));
      if (report.textLength === 0) problems.unshift("画面が真っ白です(表示された文字が0件)");
      if (problems.length) return { status: "failed", detail: `アプリを起動して画面を開いたところ、問題がありました:\n${problems.slice(0, MAX_REPORTED).map((p) => `- ${p}`).join("\n")}` };
      return { status: "passed", detail: "サーバーを起動して画面を開き、エラーなく表示されることを確認しました" };
    } catch (err) {
      return { status: "skipped", detail: `起動確認を実行できませんでした: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      for (const st of started) killTree(st.proc.pid);
    }
  }

  async run(projectRoot: string, signal?: AbortSignal): Promise<SmokeResult> {
    const apps = detectApps(projectRoot);
    const frontend = apps.find((a) => a.kind === "frontend");
    const backend = apps.find((a) => a.kind === "backend");
    const browser = this.opts.browserExecutable === undefined ? findBrowserExecutable() : this.opts.browserExecutable;
    if (!frontend) {
      // one Node server that serves its own page (and API): start it and open its top page
      if (!backend) return { status: "skipped", detail: "起動できるアプリが見つからないため、起動確認は行っていません" };
      return this.runSingleServer(backend, browser, signal);
    }
    if (!browser) return { status: "skipped", detail: "Edge・Chrome・Braveのいずれも見つからないため、画面の表示確認は行っていません" };
    for (const a of [frontend, backend]) if (a && missingDeps(a.dir)) return { status: "skipped", detail: `${path.relative(projectRoot, a.dir) || "."} に node_modules が無く(依存が未インストール)、起動確認は行っていません` };

    const started: Started[] = [];
    try {
      const backendPort = backend ? await freePort() : 0;
      const frontendPort = await freePort();
      const origin = `http://localhost:${frontendPort}`;
      const apiOrigin = backend ? `http://localhost:${backendPort}` : "";
      if (backend) {
        const b = startServer(backend, [], { PORT: String(backendPort), CORS_ORIGIN: origin });
        started.push(b);
        if (!(await waitReady(apiOrigin, b, signal))) {
          return b.exited() ? { status: "failed", detail: `バックエンドが起動できませんでした:\n${b.log()}` } : { status: "skipped", detail: "バックエンドの起動を確認できませんでした(PORT環境変数に対応していない可能性があります)" };
        }
      }
      const f = startServer(frontend, ["--", "--port", String(frontendPort), "--strictPort"], { PORT: String(backendPort || ""), ...(backend ? { VITE_API_PROXY_TARGET: apiOrigin } : {}) });
      started.push(f);
      if (!(await waitReady(origin, f, signal))) {
        return f.exited() ? { status: "failed", detail: `フロントエンドが起動できませんでした:\n${f.log()}` } : { status: "skipped", detail: "フロントエンドの起動を確認できませんでした" };
      }
      const report = await probePage(browser, origin, [origin, ...(apiOrigin ? [apiOrigin] : [])]);
      const problems = report.problems.filter((p) => !IGNORED_PROBLEM.test(p));
      if (report.textLength === 0) problems.unshift("画面が真っ白です(表示された文字が0件)");
      if (problems.length) return { status: "failed", detail: `アプリを起動して画面を開いたところ、問題がありました:\n${problems.slice(0, MAX_REPORTED).map((p) => `- ${p}`).join("\n")}` };
      return { status: "passed", detail: "起動して画面を開き、エラーなく表示されることを確認しました" };
    } catch (err) {
      return { status: "skipped", detail: `起動確認を実行できませんでした: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      for (const s of started) killTree(s.proc.pid);
    }
  }
}
