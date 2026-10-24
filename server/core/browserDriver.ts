import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import net from "node:net";
import WebSocket from "ws";
import { killTree } from "./commandRunner.ts";
import { BLOCK_MESSAGES, classifyBlocker, type BlockReason, type SiteProfile } from "./webAiSites.ts";

// Browser driver for Level 2/3 (spec §10). Talks the Chrome DevTools Protocol to
// the user's own Edge/Chrome/Brave, started with a dedicated profile folder. The user
// logs in there themselves, in the normal visible window; this code never reads
// cookies or passwords, never fills credentials, and stops (rather than tries to
// get around it) at a login page or a bot check (spec §11).

export class WebAiBlockedError extends Error {
  constructor(readonly reason: BlockReason) {
    super(BLOCK_MESSAGES[reason]);
    this.name = "WebAiBlockedError";
  }
}
/** The page is reachable but does not look the way the profile expects (the site's UI changed). */
export class WebAiUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAiUiError";
  }
}
export class WebAiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAiTimeoutError";
  }
}

export interface WebChatPage {
  /** Types the prompt into the page's prompt box (does not send it). */
  fillPrompt(text: string): Promise<void>;
  /** Presses the send button (or Enter). */
  submit(): Promise<void>;
  /** Waits for a new answer to appear and stop changing; returns its text. */
  waitForResponse(opts: { timeoutMs: number; signal?: AbortSignal }): Promise<string>;
  close(): Promise<void>;
}
export interface WebChatDriver {
  /** Opens the site in a visible tab. Throws WebAiBlockedError / WebAiUiError when the prompt box is not usable. */
  open(req: { url: string; site: SiteProfile; signal?: AbortSignal }): Promise<WebChatPage>;
  shutdown(): Promise<void>;
}

// ---- finding a browser ------------------------------------------------------
export function findBrowserExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.WEB_AI_BROWSER,
    // Brave first (Chromium based, same DevTools Protocol), then Edge/Chrome.
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe` : undefined,
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/brave-browser",
    "/usr/bin/brave",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

// ---- carrying the user's sign-ins over from their everyday browser -----------------
// A browser cannot be driven through the debugging port while it uses its normal profile folder (Chromium refuses),
// so the automation browser keeps its own folder. To save the user from signing in to Google again there, the
// sign-in state (cookies and site storage) of the everyday profile is copied into it once. Saved passwords,
// history and extensions are never copied. The everyday browser must be closed: its files are locked while it runs.
const SIGNIN_ITEMS = ["Network/Cookies", "Network/Cookies-journal", "Preferences", "Local Storage", "IndexedDB"];

export function everydayProfileRoot(exe: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const local = env.LOCALAPPDATA;
  if (!local) return null;
  const name = path.basename(exe).toLowerCase();
  const rel = name.includes("brave") ? ["BraveSoftware", "Brave-Browser"] : name.includes("msedge") ? ["Microsoft", "Edge"] : name.includes("chrome") ? ["Google", "Chrome"] : null;
  const root = rel ? path.join(local, ...rel, "User Data") : null;
  return root && existsSync(path.join(root, "Local State")) ? root : null;
}

function isRunning(exeName: string): boolean {
  try {
    return execFileSync("tasklist", ["/FI", `IMAGENAME eq ${exeName}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).toLowerCase().includes(exeName.toLowerCase());
  } catch {
    return false;
  }
}

export function importEverydaySignIn(exe: string, destRoot: string, env: NodeJS.ProcessEnv = process.env, running: (exeName: string) => boolean = isRunning): { profile: string; copied: string[] } {
  const src = everydayProfileRoot(exe, env);
  if (!src) throw new Error("ふだん使っているブラウザのデータが見つかりません");
  if (running(path.basename(exe))) throw new Error(`${path.basename(exe)} が起動中です。ウィンドウをすべて閉じて(右下の常駐も終了して)、もう一度押してください`);
  const state = JSON.parse(readFileSync(path.join(src, "Local State"), "utf8")) as { profile?: { last_used?: string } };
  const profile = state.profile?.last_used || "Default";
  const from = path.join(src, profile);
  if (!existsSync(from)) throw new Error(`プロフィール「${profile}」が見つかりません`);
  const to = path.join(destRoot, "Default");
  mkdirSync(path.join(to, "Network"), { recursive: true });
  cpSync(path.join(src, "Local State"), path.join(destRoot, "Local State"));
  const copied: string[] = [];
  for (const item of SIGNIN_ITEMS) {
    const a = path.join(from, item);
    if (!existsSync(a)) continue;
    rmSync(path.join(to, item), { recursive: true, force: true });
    cpSync(a, path.join(to, item), { recursive: true });
    copied.push(item);
  }
  return { profile, copied };
}

// ---- minimal CDP client -----------------------------------------------------
export class CdpClient {
  private id = 0;
  /** CDP events (Runtime.exceptionThrown, Log.entryAdded, ...), for callers that watch a page rather than drive it. */
  onEvent: ((method: string, params: Record<string, unknown>) => void) | null = null;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.id === undefined) {
        if (msg.method) this.onEvent?.(msg.method, msg.params ?? {});
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
    const failAll = () => {
      for (const p of this.pending.values()) p.reject(new Error("ブラウザとの接続が切れました"));
      this.pending.clear();
    };
    ws.on("close", failAll);
    ws.on("error", failAll);
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      ws.once("open", () => resolve(new CdpClient(ws)));
      ws.once("error", reject);
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value as T;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("中断されました"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("中断されました"));
      },
      { once: true },
    );
  });

export async function waitUntil<T>(probe: () => Promise<T | null | false>, opts: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal }): Promise<T | null> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(opts.intervalMs ?? 300, opts.signal);
  }
}

const q = (s: string) => JSON.stringify(s);

/** In-page helpers: first element matching any of the selectors, and the text of the last answer. */
const firstMatch = (selector: string) => `document.querySelector(${q(selector)})`;

function pageSnapshotExpr(site: SiteProfile): string {
  return `(() => {
    const all = document.querySelectorAll(${q(site.responseSelector)});
    const last = all.length ? all[all.length - 1] : null;
    return { count: all.length, text: last ? (last.innerText || last.textContent || "") : "", busy: ${site.stopSelector ? `[...document.querySelectorAll(${q(site.stopSelector)})].some((e) => e.getClientRects().length > 0)` : "false"} };
  })()`;
}

class CdpChatPage implements WebChatPage {
  private baseline: { count: number; text: string } = { count: 0, text: "" };

  constructor(
    private readonly cdp: CdpClient,
    private readonly site: SiteProfile,
    private readonly closeTab: () => Promise<void>,
  ) {}

  async captureBaseline(): Promise<void> {
    const s = await this.cdp.evaluate<{ count: number; text: string }>(pageSnapshotExpr(this.site));
    this.baseline = { count: s.count, text: s.text };
  }

  async fillPrompt(text: string): Promise<void> {
    await this.captureBaseline();
    const focused = await this.cdp.evaluate<boolean>(`(() => {
      const el = ${firstMatch(this.site.inputSelector)};
      if (!el) return false;
      el.focus();
      if (typeof el.select === "function") el.select();
      else { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      return true;
    })()`);
    if (!focused) throw new WebAiUiError("プロンプト入力欄が見つかりません(サイトのUIが変わった可能性があります)");
    await this.cdp.send("Input.insertText", { text });
    const probe = text.slice(0, 20);
    const ok = await this.cdp.evaluate<boolean>(`(() => {
      const el = ${firstMatch(this.site.inputSelector)};
      const v = el ? (el.value ?? el.innerText ?? "") : "";
      return v.includes(${q(probe)});
    })()`);
    if (!ok) throw new WebAiUiError("プロンプトを入力欄に入れられませんでした(サイトのUIが変わった可能性があります)");
  }

  async submit(): Promise<void> {
    if (this.site.sendSelector) {
      // a real mouse click at the button's centre: some sites ignore synthetic el.click()
      const rect = await this.cdp.evaluate<{ x: number; y: number } | null>(`(() => {
        const b = ${firstMatch(this.site.sendSelector)};
        if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return null;
        const r = b.getBoundingClientRect();
        return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      })()`);
      if (rect) {
        for (const type of ["mousePressed", "mouseReleased"]) {
          await this.cdp.send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        }
        return;
      }
    }
    for (const type of ["rawKeyDown", "keyUp"]) {
      await this.cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "rawKeyDown" ? "\r" : undefined });
    }
  }

  async waitForResponse(opts: { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
    const STABLE_MS = 3000;
    let lastText = "";
    let since = Date.now();
    const done = await waitUntil(
      async () => {
        const s = await this.cdp.evaluate<{ count: number; text: string; busy: boolean }>(pageSnapshotExpr(this.site));
        const fresh = s.count > this.baseline.count || (s.count > 0 && s.text !== this.baseline.text);
        if (!fresh || !s.text.trim()) return null;
        if (s.text !== lastText) {
          lastText = s.text;
          since = Date.now();
          return null;
        }
        return !s.busy && Date.now() - since >= STABLE_MS ? s.text : null;
      },
      { timeoutMs: opts.timeoutMs, intervalMs: 500, signal: opts.signal },
    );
    if (done === null) throw new WebAiTimeoutError(`回答を取得できませんでした(${Math.round(opts.timeoutMs / 1000)}秒待機)`);
    return done.trim();
  }

  async close(): Promise<void> {
    this.cdp.close();
    await this.closeTab();
  }
}

export type ChromiumDriverOptions = {
  executable?: string;
  /** Dedicated browser profile (keeps the user's logins between runs; never the user's everyday profile). */
  profileDir: string;
  headless?: boolean;
  /** How long to wait for the prompt box after navigation. */
  inputTimeoutMs?: number;
};

export class ChromiumDriver implements WebChatDriver {
  private proc: ChildProcess | null = null;
  private port: number | null = null;
  private starting: Promise<number> | null = null;

  constructor(private readonly opts: ChromiumDriverOptions) {}

  private async freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address() as net.AddressInfo;
        srv.close(() => resolve(port));
      });
    });
  }

  /**
   * Opens `url` in the dedicated profile so the user can sign in by hand (the login is kept for later runs).
   * Starts a plain window without the debugging port; if the automation browser already runs on this profile, the page opens in it.
   */
  openForLogin(url: string): void {
    if (!/^https?:\/\//i.test(url)) throw new Error("開けるのはhttp(s)のページだけです");
    const exe = this.opts.executable ?? findBrowserExecutable();
    if (!exe) throw new Error("Edge・Chrome・Braveのいずれも見つかりません(環境変数 WEB_AI_BROWSER で実行ファイルを指定できます)");
    mkdirSync(this.opts.profileDir, { recursive: true });
    const proc = spawn(exe, [`--user-data-dir=${this.opts.profileDir}`, "--no-first-run", "--no-default-browser-check", url], { stdio: "ignore", detached: true });
    proc.once("error", () => {});
    proc.unref();
  }

  /** Copies the everyday browser's sign-ins into the automation profile (see importEverydaySignIn). Stops the automation browser first. */
  async importSignIn(): Promise<{ profile: string; copied: string[] }> {
    const exe = this.opts.executable ?? findBrowserExecutable();
    if (!exe) throw new Error("Edge・Chrome・Braveのいずれも見つかりません");
    await this.shutdown();
    return importEverydaySignIn(exe, this.opts.profileDir);
  }

  private ensureBrowser(): Promise<number> {
    if (this.port !== null && this.proc && this.proc.exitCode === null) return Promise.resolve(this.port);
    return (this.starting ??= this.launch().finally(() => (this.starting = null)));
  }

  private async launch(): Promise<number> {
    const exe = this.opts.executable ?? findBrowserExecutable();
    if (!exe) throw new Error("Edge・Chrome・Braveのいずれも見つかりません(環境変数 WEB_AI_BROWSER で実行ファイルを指定できます)");
    mkdirSync(this.opts.profileDir, { recursive: true });
    const port = await this.freePort();
    const args = [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${this.opts.profileDir}`, "--no-first-run", "--no-default-browser-check", "about:blank"];
    if (this.opts.headless) args.unshift("--headless=new");
    const proc = spawn(exe, args, { stdio: "ignore", windowsHide: false });
    this.proc = proc;
    proc.once("exit", () => {
      if (this.proc === proc) this.port = null;
    });
    const up = await waitUntil(
      async () => {
        if (proc.exitCode !== null) throw new Error("ブラウザが起動直後に終了しました(同じプロファイルが別のブラウザで使用中の可能性があります)");
        try {
          const r = await fetch(`http://127.0.0.1:${port}/json/version`);
          return r.ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 20_000, intervalMs: 250 },
    );
    if (!up) {
      killTree(proc.pid);
      throw new Error("ブラウザの操作ポートに接続できませんでした");
    }
    this.port = port;
    return port;
  }

  async open(req: { url: string; site: SiteProfile; signal?: AbortSignal }): Promise<WebChatPage> {
    if (!/^https?:\/\//i.test(req.url)) throw new Error("http(s)のURLのみ開けます");
    const port = await this.ensureBrowser();
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { id: string; webSocketDebuggerUrl: string };
    const closeTab = async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
      } catch {
        /* browser already gone */
      }
    };
    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Page.navigate", { url: req.url });
      await waitUntil(async () => (await cdp.evaluate<string>("document.readyState")) === "complete", { timeoutMs: 30_000, signal: req.signal });
      const found = await waitUntil(async () => cdp.evaluate<boolean>(`!!${firstMatch(req.site.inputSelector)}`), { timeoutMs: this.opts.inputTimeoutMs ?? 20_000, signal: req.signal });
      if (!found) {
        const snap = await cdp.evaluate<{ url: string; text: string; hasChallengeFrame: boolean }>(`({
          url: location.href,
          text: (document.body && document.body.innerText || "").slice(0, 4000),
          hasChallengeFrame: !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]'),
        })`);
        const blocked = classifyBlocker(snap);
        if (blocked) throw new WebAiBlockedError(blocked);
        throw new WebAiUiError("プロンプト入力欄が見つかりません(サイトのUIが変わった可能性があります)");
      }
      await cdp.send("Page.bringToFront");
      const page = new CdpChatPage(cdp, req.site, closeTab);
      await page.captureBaseline();
      return page;
    } catch (err) {
      cdp.close();
      await closeTab();
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    this.port = null;
    if (proc && proc.exitCode === null) killTree(proc.pid);
  }
}
