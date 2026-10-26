import { MANUAL_TEXT_KEY, capabilityForTaskRole, isMediaCapability } from "./aiBroker.ts";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebAiBlockedError, WebAiBrowserError, WebAiProfileBusyError, type WebChatDriver, type WebChatPage } from "./browserDriver.ts";
import type { ExecutionResult, TaskExecutor } from "./missionEngine.ts";
import { resolveInProject } from "./paths.ts";
import { isWriteTask } from "./scheduler.ts";
import type { AiService, Mission, Store, Task } from "./store.ts";
import { transitionTask } from "./taskStateMachine.ts";
import { cleanFileText, webOutputPaths } from "./webOutputs.ts";
import { recordOutcome } from "./scoreTuning.ts";
import { WEB_ADAPTER_TYPES, type WebHandoffHub } from "./webHandoff.ts";
import { getWebAiSettings, resolveSiteProfile } from "./webAiSites.ts";

// WebAiExecutor (spec §10, Phase 6): runs a Task on a web AI.
//   Level 3  open the page, type the prompt, send, wait, read the answer, save.
//   Level 2  open the page and type the prompt; the user sends it; the answer is
//            read from the page (or pasted).
//   Level 1  the user takes the prompt to the AI and pastes the answer back.
// A Level 3 run that breaks (the site changed, a login or bot check appeared)
// drops to the next level for that run instead of failing the mission, and after
// repeated breakage the service's registry level is lowered. Levels are never
// raised automatically.

export type WebExecutionResult = ExecutionResult & {
  /** The user chose not to use a web AI for this task: run it on the default executor instead. */
  fallback?: boolean;
};

const DOWNGRADE_AFTER_FAILURES = 2;
const MAX_DEP_FILE_CHARS = 6000;
const MAX_DEP_TOTAL_CHARS = 20_000;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".html", ".css", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".yaml", ".yml"]);
export const DEFAULT_AUTO_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_PROFILE_WAIT_MS = 30 * 60_000;
export const DEFAULT_HANDOFF_TIMEOUT_MS = 12 * 60 * 60_000;

const FILE_MARKER = /^=== FILE: (.+?) ===[ \t]*$/gm;

/** Splits "=== FILE: path ===" sections. Only paths in `wanted` are kept. */
export function parseFileBlocks(text: string, wanted: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const marks = [...text.matchAll(FILE_MARKER)];
  marks.forEach((m, i) => {
    const file = m[1]!.trim().replace(/^`+|`+$/g, "");
    const body = text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length);
    if (wanted.includes(file)) out.set(file, unwrapSingleFence(body.trim()));
  });
  return out;
}

/** "```js\ncode\n```" -> "code" when the whole answer is one fenced block. */
export function unwrapSingleFence(text: string): string {
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text.trim());
  return m && !m[1]!.includes("```") ? m[1]! : text;
}

export function buildWebPrompt(input: {
  task: Pick<Task, "role" | "objective" | "inputs" | "expectedOutputs" | "constraints">;
  mission: Pick<Mission, "goal">;
  context: string[];
  outputPaths: string[];
  previousFailure?: string;
}): string {
  const { task, mission, outputPaths } = input;
  const lines = [
    `あなたはソフトウェア開発依頼「${mission.goal}」の次の作業を担当します。`,
    `役割: ${task.role}`,
    `目的: ${task.objective}`,
  ];
  if (task.inputs.length) lines.push(`入力: ${task.inputs.join(" / ")}`);
  if (task.expectedOutputs.length) lines.push(`期待する成果物: ${task.expectedOutputs.join(" / ")}`);
  if (task.constraints.length) lines.push(`制約: ${task.constraints.join(" / ")}`);
  if (input.context.length) lines.push("", "【前の作業の成果(抜粋)】", ...input.context);
  lines.push("", "【回答の形式】");
  if (outputPaths.length === 1) {
    lines.push(`回答の本文がそのまま「${outputPaths[0]}」の内容として保存されます。前置き・あとがき・説明文は付けず、そのファイルの内容だけを返してください。`);
  } else if (outputPaths.length > 1) {
    lines.push("次のファイルごとに、先頭に区切り行を置いて内容を返してください(区切り行の形式は厳守。前置き・あとがきは不要):", ...outputPaths.map((p) => `=== FILE: ${p} ===`));
  } else {
    lines.push("Markdownで、結論から先に、簡潔に答えてください。");
  }
  lines.push("あなたはファイルを直接作成できないため、内容は回答の中に全文書いてください。");
  if (input.previousFailure) lines.push("", "【前回の回答は検証に失敗しました】原因を直した回答を返してください。失敗内容:", input.previousFailure);
  return lines.join("\n");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "task";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class WebAiExecutor implements TaskExecutor {
  readonly name = "web-ai";
  /** Registry adapter types this executor can run: every web AI starts as `manual` (Level 1). */
  readonly adapterTypes = WEB_ADAPTER_TYPES;

  constructor(
    private readonly store: Store,
    private readonly hub: WebHandoffHub,
    private readonly opts: { driver?: WebChatDriver; autoTimeoutMs?: number; handoffTimeoutMs?: number; /** how often a task waiting for a sign-in window to be closed looks again */ profilePollMs?: number; /** how long it waits before giving up on full automation */ profileWaitMs?: number } = {},
  ) {}

  /** Tasks that are waiting because a window of the person's (a sign-in window) uses the browser profile. */
  private readonly profileWaiters = new Set<string>();

  /** "Can the app use this AI by itself?": one tiny prompt, nothing recorded against the AI. Returns what to tell the person when not. */
  async probe(svc: AiService): Promise<{ ok: true } | { ok: false; reason: string }> {
    const site = resolveSiteProfile(this.store, svc.id);
    const driver = this.opts.driver;
    if (!driver || !site || !svc.url) return { ok: false, reason: "このAIは、ブラウザの自動操作の準備(サイト設定)がないため、自動にできません" };
    try {
      const page = await driver.open({ url: svc.url, site, signal: AbortSignal.timeout(120_000) });
      try {
        await page.fillPrompt("「OK」とだけ返信してください。");
        await page.submit();
        const text = await page.waitForResponse({ timeoutMs: 90_000 });
        return text.trim() ? { ok: true } : { ok: false, reason: "返事を読み取れませんでした" };
      } finally {
        await page.close();
      }
    } catch (err) {
      if (err instanceof WebAiProfileBusyError) return { ok: false, reason: "ログイン用の窓が開いたままです。その窓を閉じてから、もう一度押してください" };
      if (err instanceof WebAiBlockedError) return { ok: false, reason: "ログインか、人間確認(年齢確認など)が必要です。「ログイン用に開く」で済ませて、窓を閉じてから、もう一度押してください" };
      return { ok: false, reason: `自動で操作できませんでした(${errMsg(err)})。ログインが済んでいるか確認してください` };
    }
  }

  /** What the screen shows: is such a window open, and how many tasks wait for it to be closed. */
  async browserStatus(): Promise<{ loginWindowOpen: boolean; waiting: number }> {
    return { loginWindowOpen: (await this.opts.driver?.profileBusy?.().catch(() => false)) ?? false, waiting: this.profileWaiters.size };
  }

  /**
   * While a sign-in window of the person's holds the browser profile, the automation browser cannot start. Nothing is broken and
   * no other AI is needed: the task waits (visibly), looks again every few seconds, and goes on as soon as the window is closed.
   * Returns false when it was not freed within the time limit (the normal fallbacks then apply).
   */
  private async waitForProfile(task: Task, svc: AiService, signal: AbortSignal): Promise<boolean> {
    const driver = this.opts.driver;
    if (!driver?.profileBusy || !(await driver.profileBusy().catch(() => false))) return true;
    const { projectId } = task;
    this.profileWaiters.add(task.id);
    this.store.appendEvent({ projectId, taskId: task.id, type: "WEB_PROFILE_BUSY", payload: { aiId: svc.id } });
    transitionTask(this.store, projectId, task.id, "waiting", "ログイン用の窓が開いているため、閉じられるのを待っています");
    try {
      const deadline = Date.now() + (this.opts.profileWaitMs ?? DEFAULT_PROFILE_WAIT_MS);
      while (Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, this.opts.profilePollMs ?? 3000);
          signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
        });
        if (!(await driver.profileBusy().catch(() => false))) {
          this.store.appendEvent({ projectId, taskId: task.id, type: "WEB_PROFILE_FREED", payload: { aiId: svc.id } });
          transitionTask(this.store, projectId, task.id, "running", "ログイン用の窓が閉じられたため、続けます");
          return true;
        }
      }
      transitionTask(this.store, projectId, task.id, "running", "ログイン用の窓が閉じられなかったため、待つのをやめました");
      return false;
    } catch {
      return false; // paused or cancelled: the engine settles the task
    } finally {
      this.profileWaiters.delete(task.id);
    }
  }

  async execute(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<WebExecutionResult> {
    const svc = task.selectedAi ? this.store.getAiService(task.selectedAi) : null;
    if (!svc) return { ok: false, summary: "担当のWeb AIが選ばれていません" };

    const outputPaths = webOutputPaths(task);
    const prompt = buildWebPrompt({ task, mission: ctx.mission, context: this.dependencyContext(task), outputPaths, previousFailure: this.previousFailure(task) });
    const site = resolveSiteProfile(this.store, svc.id);
    const driver = this.opts.driver && site && svc.url ? this.opts.driver : null;
    let level: 1 | 2 | 3 = driver ? (Math.min(3, Math.max(1, svc.automationLevel)) as 1 | 2 | 3) : 1;
    let note: string | null = driver || svc.automationLevel <= 1 ? null : "ブラウザ操作の準備(ブラウザ・サイト設定)がないためLevel 1で実行します";
    let text: string | null = null;
    let usedLevel: 1 | 2 | 3 = 1;
    let page: WebChatPage | null = null;

    if (level >= 2 && driver && site && !(await this.waitForProfile(task, svc, ctx.signal)) && ctx.signal.aborted) return { ok: false, summary: "中断されました" };

    // picture work: the answer is an image, read straight from the page; when that breaks it falls back to the manual hand-over below
    if (level === 3 && driver && site && capabilityForTaskRole(task.role) === "image_generation") {
      const made = await this.generateImages({ task, svc, site, driver, outputPaths, ctx });
      if ("result" in made) return made.result;
      note = made.note;
      level = 1;
    }

    if (level === 3 && driver && site) {
      try {
        const p = await driver.open({ url: svc.url!, site, signal: ctx.signal });
        try {
          await p.fillPrompt(prompt);
          await p.submit();
          text = await p.waitForResponse({ timeoutMs: this.opts.autoTimeoutMs ?? DEFAULT_AUTO_TIMEOUT_MS, signal: ctx.signal });
          // the page's plain text has lost the Markdown (headings, lists, tables, code): read the answer back as Markdown for the file
          const markdown = await p.readMarkdown?.().catch(() => null);
          if (markdown && markdown.trim().length >= text.trim().length * 0.5) text = markdown;
          usedLevel = 3;
        } finally {
          await p.close();
        }
        this.resetFailures(svc);
        this.hub.cancelPendingFor(task.id); // an earlier attempt of this task may have left a manual step waiting
      } catch (err) {
        if (ctx.signal.aborted) return { ok: false, summary: "中断されました" };
        text = null;
        note = `自動操作(Level 3)に失敗したためLevel ${err instanceof WebAiBlockedError ? 1 : 2}に切り替えました: ${errMsg(err)}`;
        this.recordFailure(svc, 3, err, task);
        level = err instanceof WebAiBlockedError ? 1 : 2; // a login / bot check is the user's to clear: no point typing into that page
      }
    }

    if (text === null && level === 2 && driver && site) {
      try {
        page = await driver.open({ url: svc.url!, site, signal: ctx.signal });
        await page.fillPrompt(prompt);
      } catch (err) {
        await page?.close().catch(() => {});
        page = null;
        if (ctx.signal.aborted) return { ok: false, summary: "中断されました" };
        note = `${note ? `${note} / ` : ""}半自動(Level 2)に失敗したためLevel 1に切り替えました: ${errMsg(err)}`;
        this.recordFailure(svc, 2, err, task);
        level = 1;
      }
    }

    if (text === null && !isMediaCapability(capabilityForTaskRole(task.role)) && !this.store.getSetting<boolean>(MANUAL_TEXT_KEY, false)) {
      // text work never waits for a person to copy and paste: report the failure so the engine hands the task to another AI
      return { ok: false, aiId: svc.id, automationLevel: level, summary: `${svc.name}を自動で操作できませんでした(${note ?? "手動の設定です"})。ほかのAIに回します` };
    }

    if (text === null) {
      const waited = await this.waitForUser({ task, svc, prompt, level: level === 2 ? 2 : 1, note, page, ctx });
      await page?.close().catch(() => {});
      if ("result" in waited) return waited.result;
      if ("reassignTo" in waited) {
        this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AI_REASSIGNED", payload: { from: svc.id, to: waited.reassignTo } });
        this.store.setTaskSelectedAi(task.projectId, task.id, waited.reassignTo);
        return this.execute(this.store.getTask(task.projectId, task.id) ?? task, ctx);
      }
      text = waited.text;
      usedLevel = level === 2 ? 2 : 1;
    }

    return this.save(task, svc, text, outputPaths, usedLevel);
  }

  /**
   * Puts one prompt to a web AI fully automatically (Level 3 only) and returns the answer; never waits for the person.
   * Used by the AI B Review. A break of the automation is counted like any other Level 3 failure.
   */
  async ask(input: { svc: AiService; prompt: string; task: Task; signal: AbortSignal }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const { svc, prompt, task, signal } = input;
    const site = resolveSiteProfile(this.store, svc.id);
    const driver = this.opts.driver;
    if (!driver || !site || !svc.url) return { ok: false, error: "ブラウザ操作の準備(ブラウザ・サイト設定)がありません" };
    try {
      const page = await driver.open({ url: svc.url, site, signal });
      try {
        await page.fillPrompt(prompt);
        await page.submit();
        const text = await page.waitForResponse({ timeoutMs: this.opts.autoTimeoutMs ?? DEFAULT_AUTO_TIMEOUT_MS, signal });
        this.resetFailures(svc);
        return { ok: true, text };
      } finally {
        await page.close();
      }
    } catch (err) {
      if (signal.aborted) return { ok: false, error: "中断されました" };
      this.recordFailure(svc, 3, err, task);
      return { ok: false, error: errMsg(err) };
    }
  }

  /** Level 3 picture work: asks for the picture, waits for it, saves what the page shows. */
  private async generateImages(input: { task: Task; svc: AiService; site: NonNullable<ReturnType<typeof resolveSiteProfile>>; driver: WebChatDriver; outputPaths: string[]; ctx: { mission: Mission; signal: AbortSignal } }): Promise<{ result: WebExecutionResult } | { note: string }> {
    const { task, svc, site, driver, ctx } = input;
    const prompt = ["次の画像を生成してください。画像だけを出力し、説明や前置きは不要です。", task.objective, ...(task.constraints.length ? [`条件: ${task.constraints.join(" / ")}`] : [])].join("\n");
    try {
      const page = await driver.open({ url: svc.url!, site, signal: ctx.signal });
      try {
        if (!page.waitForImages || !page.readImages) throw new Error("このブラウザ操作では画像を読み取れません");
        await page.fillPrompt(prompt);
        await page.submit();
        await page.waitForImages({ timeoutMs: this.opts.autoTimeoutMs ?? DEFAULT_AUTO_TIMEOUT_MS, signal: ctx.signal });
        const images = await page.readImages();
        if (!images.length) throw new Error("画像を読み取れませんでした");
        const wanted = input.outputPaths.filter((p) => /\.(png|jpe?g|webp|gif)$/i.test(p));
        const saved: string[] = [];
        images.forEach((img, i) => {
          const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : img.mime.includes("gif") ? "gif" : "png";
          const rel = wanted[i] ?? `web-ai/image-${task.id.slice(0, 8)}-${i + 1}.${ext}`;
          const abs = resolveInProject(this.store.projectsRoot, task.projectId, rel);
          mkdirSync(path.dirname(abs), { recursive: true });
          writeFileSync(abs, Buffer.from(img.base64, "base64"));
          this.store.createArtifact({ projectId: task.projectId, taskId: task.id, path: rel, createdBy: svc.id, sourceAi: svc.id, sourceUrl: svc.url });
          saved.push(rel);
        });
        this.resetFailures(svc);
        return { result: { ok: true, summary: `${svc.name}(Level 3)が画像を生成して保存しました: ${saved.join(", ")}`, artifacts: saved, aiId: svc.id, automationLevel: 3, executor: this.name } };
      } finally {
        await page.close();
      }
    } catch (err) {
      if (ctx.signal.aborted) return { result: { ok: false, summary: "中断されました" } };
      this.recordFailure(svc, 3, err, task);
      return { note: `画像の自動生成に失敗したため手動に切り替えます: ${errMsg(err)}` };
    }
  }

  // ---- Level 1/2: wait for the answer -----------------------------------------
  private async waitForUser(input: {
    task: Task;
    svc: AiService;
    prompt: string;
    level: 1 | 2;
    note: string | null;
    page: WebChatPage | null;
    ctx: { mission: Mission; signal: AbortSignal };
  }): Promise<{ text: string } | { result: WebExecutionResult } | { reassignTo: string }> {
    const { task, svc, ctx } = input;
    const { projectId } = task;
    const handoff = this.hub.request({ projectId, taskId: task.id, aiId: svc.id, aiName: svc.name, url: svc.url, level: input.level, prompt: input.prompt, note: input.note });
    const timeout = AbortSignal.timeout(this.opts.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS);
    const signal = AbortSignal.any([ctx.signal, timeout]);

    // Level 2: also read the answer straight from the page once the user has sent the prompt.
    const pageWatch = new AbortController();
    if (input.page) {
      void input.page
        .waitForResponse({ timeoutMs: this.opts.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS, signal: AbortSignal.any([signal, pageWatch.signal]) })
        .then((answer) => {
          try {
            this.hub.submit(handoff.id, answer);
          } catch {
            /* already answered by hand */
          }
        })
        .catch(() => {});
    }

    transitionTask(this.store, projectId, task.id, "waiting", `Web AI(${svc.name})の回答待ち(Level ${input.level})`);
    try {
      const done = await this.hub.wait(handoff.id, signal);
      transitionTask(this.store, projectId, task.id, "running", "回答を受け取りました");
      if (done.status === "skipped" && done.reassignTo) return { reassignTo: done.reassignTo };
      if (done.status === "skipped") {
        this.store.appendEvent({ projectId, taskId: task.id, type: "WEB_AI_FALLBACK", payload: { aiId: svc.id } });
        return { result: { ok: false, fallback: true, summary: "Web AIには任せず、Claude Codeで実行します" } };
      }
      if (done.status !== "submitted" || !done.resultText) return { result: { ok: false, summary: "Web AIの回答を受け取れませんでした" } };
      this.hub.markConsumed(handoff.id);
      return { text: done.resultText };
    } catch (err) {
      if (ctx.signal.aborted) {
        if (this.store.getMission(projectId, ctx.mission.id)?.status === "cancelled") this.hub.cancel(handoff.id);
        return { result: { ok: false, summary: "中断されました" } };
      }
      this.hub.cancel(handoff.id);
      return { result: { ok: false, summary: timeout.aborted ? "Web AIの回答待ちがタイムアウトしました" : errMsg(err) } };
    } finally {
      pageWatch.abort();
    }
  }

  // ---- saving the answer ------------------------------------------------------
  private save(task: Task, svc: AiService, text: string, outputPaths: string[], level: 1 | 2 | 3): WebExecutionResult {
    const { projectId } = task;
    let files: [string, string][];
    if (outputPaths.length > 1) {
      const blocks = parseFileBlocks(text, outputPaths);
      const missing = outputPaths.filter((p) => !blocks.get(p));
      if (missing.length) return { ok: false, aiId: svc.id, automationLevel: level, summary: `回答にファイル区切り(=== FILE: パス ===)が見つからないか内容が空です: ${missing.join(", ")}` };
      files = outputPaths.map((p) => [p, blocks.get(p)!]);
    } else if (outputPaths.length === 1) {
      files = [[outputPaths[0]!, unwrapSingleFence(text)]];
    } else {
      files = [[`web-ai/${slug(task.role)}-${task.id.slice(0, 8)}.md`, text]];
    }
    const saved: string[] = [];
    for (const [rel, raw] of files) {
      const body = cleanFileText(rel, raw);
      const abs = resolveInProject(this.store.projectsRoot, projectId, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, body.endsWith("\n") ? body : `${body}\n`, "utf8");
      this.store.createArtifact({ projectId, taskId: task.id, path: rel, createdBy: svc.id, sourceAi: svc.id, sourceUrl: svc.url });
      saved.push(rel);
    }
    return { ok: true, summary: `${svc.name}(Level ${level})の回答を保存しました: ${saved.join(", ")}`, artifacts: saved, aiId: svc.id, automationLevel: level, executor: this.name };
  }

  // ---- context for the prompt -------------------------------------------------
  /** Web AIs cannot see the project folder, so earlier results are quoted (shortened) into the prompt. */
  private dependencyContext(task: Task): string[] {
    const out: string[] = [];
    let total = 0;
    const artifacts = this.store.listArtifacts(task.projectId);
    for (const depId of task.dependsOn) {
      const dep = this.store.getTask(task.projectId, depId);
      if (!dep) continue;
      out.push(`■ [${dep.role}] ${dep.objective}`);
      for (const a of artifacts.filter((x) => x.taskId === depId)) {
        if (!TEXT_EXTENSIONS.has(path.extname(a.path).toLowerCase()) || total >= MAX_DEP_TOTAL_CHARS) continue;
        try {
          const abs = resolveInProject(this.store.projectsRoot, task.projectId, a.path);
          if (!existsSync(abs) || statSync(abs).size > 2_000_000) continue;
          const body = readFileSync(abs, "utf8").slice(0, MAX_DEP_FILE_CHARS);
          total += body.length;
          out.push(`--- ${a.path} ---`, body);
        } catch {
          /* unreadable: skip */
        }
      }
    }
    return out;
  }

  private previousFailure(task: Task): string | undefined {
    const failed = this.store
      .listValidations(task.projectId)
      .filter((v) => v.task_id === task.id && v.status === "failed")
      .pop();
    const detail = (failed?.detail as string | null) ?? this.store.listAiRuns(task.projectId).filter((r) => r.task_id === task.id && r.status === "failed").pop()?.summary;
    if (typeof detail === "string" && detail) return detail.slice(-2000);
    return task.retryCount === 0 ? undefined : "(詳細不明)";
  }

  // ---- automatic downgrade (spec §10) -----------------------------------------
  private failureKey = (svc: AiService) => `web_ai_failures:${svc.id}`;
  private resetFailures(svc: AiService): void {
    if (this.store.getSetting<number>(this.failureKey(svc), 0) !== 0) this.store.setSetting(this.failureKey(svc), 0);
  }

  /**
   * Counts a break of the automation (not a login/bot check, which the user clears).
   * After DOWNGRADE_AFTER_FAILURES in a row the registry level drops by one.
   */
  private recordFailure(svc: AiService, level: 2 | 3, err: unknown, task: Task): void {
    this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "WEB_AI_AUTOMATION_FAILED", payload: { aiId: svc.id, level, message: errMsg(err), blocked: err instanceof WebAiBlockedError ? err.reason : null } });
    if (err instanceof WebAiBlockedError || err instanceof WebAiBrowserError) return; // the person's to clear / the PC's problem: the site did not break
    recordOutcome(this.store, svc.id, null, "automation_break");
    const count = this.store.getSetting<number>(this.failureKey(svc), 0) + 1;
    if (count < DOWNGRADE_AFTER_FAILURES) {
      this.store.setSetting(this.failureKey(svc), count);
      return;
    }
    const current = this.store.getAiService(svc.id)?.automationLevel ?? level;
    const next = Math.max(1, Math.min(current, level) - 1);
    this.store.patchAiService(svc.id, { automationLevel: next });
    this.store.setSetting(this.failureKey(svc), 0);
    this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AUTOMATION_DOWNGRADED", payload: { aiId: svc.id, from: current, to: next } });
    this.store.addDecision({
      projectId: task.projectId,
      title: `自動降格: ${svc.name} Level ${current} → ${next}`,
      reason: `Level ${level}の自動操作が${DOWNGRADE_AFTER_FAILURES}回連続で失敗(${errMsg(err)})。サイトのUI変更の可能性があるため降格。Level 1は常に動作するため、依頼全体は止めない`,
      isAssumption: true,
    });
  }
}

/**
 * The executor wired into the engine. Claude Code stays the default and the only
 * code writer; a task goes to a web AI only when the master switch is on, the
 * Broker picked a web AI for it, and it does not edit code.
 */
export class RoutingExecutor implements TaskExecutor {
  readonly name = "router";

  constructor(
    private readonly store: Store,
    private readonly code: TaskExecutor,
    private readonly web: WebAiExecutor,
  ) {}

  /** What the Broker may choose from: includes the web AIs only while the master switch is on. */
  get adapterTypes(): readonly string[] {
    return getWebAiSettings(this.store).enabled ? [...(this.code.adapterTypes ?? []), ...this.web.adapterTypes] : [...(this.code.adapterTypes ?? [])];
  }

  /** Code-editing tasks only ever run on the code executor, so the Broker must not pick a web AI for them. */
  adapterTypesFor(task: Task): readonly string[] {
    return isWriteTask(task) ? [...(this.code.adapterTypes ?? [])] : this.adapterTypes;
  }

  async execute(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<ExecutionResult> {
    const svc = task.selectedAi ? this.store.getAiService(task.selectedAi) : null;
    const toWeb = getWebAiSettings(this.store).enabled && svc !== null && this.web.adapterTypes.some((t) => t === svc.adapterType) && !isWriteTask(task);
    if (!toWeb) return this.runCode(task, ctx);
    const res = await this.web.execute(task, ctx);
    if (!res.fallback) return { ...res, executor: res.executor ?? this.web.name };
    const fallbackAi = this.store.listAiServices().find((s) => this.code.adapterTypes?.includes(s.adapterType));
    if (fallbackAi) this.store.setTaskSelectedAi(task.projectId, task.id, fallbackAi.id);
    return this.runCode(this.store.getTask(task.projectId, task.id) ?? task, ctx);
  }

  private async runCode(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<ExecutionResult> {
    const res = await this.code.execute(task, ctx);
    return { ...res, executor: res.executor ?? this.code.name };
  }
}
