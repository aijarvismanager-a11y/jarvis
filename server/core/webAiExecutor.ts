import { projectDir } from "./paths.ts";
import { referenceBudget, referenceContext } from "./projectContext.ts";
import { clearBotCheck, recordBotCheck } from "./botCheck.ts";
import { pickReviewer } from "./aiReview.ts";
import { MANUAL_TEXT_KEY, capabilityForTaskRole, isMediaCapability } from "./aiBroker.ts";
import { readTextIfExists } from "./autoChecks.ts";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebAiBlockedError, WebAiBrowserError, WebAiProfileBusyError, WebAiPromptTooLongError, type WebChatDriver, type WebChatPage } from "./browserDriver.ts";
import type { ExecutionResult, TaskExecutor } from "./missionEngine.ts";
import { resolveInProject } from "./paths.ts";
import { isWriteTask } from "./scheduler.ts";
import { isHistoryFile } from "./missionReport.ts";
import { isHistoryTask } from "./planner.ts";
import type { AiService, Mission, Store, Task } from "./store.ts";
import { transitionTask } from "./taskStateMachine.ts";
import { cleanFileText, webOutputPaths } from "./webOutputs.ts";
import { clearUsageLimit, looksLikeUsageLimit, recordUsageLimit } from "./usageLimit.ts";
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
  /** The project's file list and the excerpts of the files the task names (see projectContext.ts). */
  references?: string[];
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
  if (input.references?.length) lines.push(...input.references);
  lines.push("", "【回答の形式】");
  if (outputPaths.length === 1) {
    lines.push(`回答の本文がそのまま「${outputPaths[0]}」の内容として保存されます。前置き・あとがき・説明文は付けず、そのファイルの内容だけを返してください。`);
  } else if (outputPaths.length > 1) {
    lines.push("次のファイルごとに、先頭に区切り行を置いて内容を返してください(区切り行の形式は厳守。前置き・あとがきは不要):", ...outputPaths.map((p) => `=== FILE: ${p} ===`));
  } else {
    lines.push("Markdownで、結論から先に、簡潔に答えてください。");
  }
  lines.push("あなたはファイルを直接作成できないため、内容は回答の中に全文書いてください。");
  if (!isWriteTask(task) && !(outputPaths.length > 0 && outputPaths.every((p) => /\.(m?js|cjs|ts|tsx|jsx|json|py|cs|css|html)$/i.test(p)))) lines.push("調査・確認・レビューの成果物は、最後の行に、頼まれたことを確かめられた度合いを次のどれか1つで書いてください: 「確認状況: 確定」「確認状況: 一部未確認」「確認状況: 確認できず」");
  if (input.previousFailure) lines.push("", "【前回の回答は検証に失敗しました】原因を直した回答を返してください。失敗内容:", input.previousFailure);
  return lines.join("\n");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "task";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tasks a web chat cannot do: editing code, or updating the project's running records (TESTLOG, PLAN...), which a chat answer would overwrite whole. They go straight to the code executor instead of failing on the site first. */
export const needsCodeExecutor = (task: Pick<Task, "role" | "expectedOutputs"> & Partial<Pick<Task, "objective">>): boolean => isWriteTask(task) || isHistoryTask(task) || task.expectedOutputs.some(isHistoryFile) || task.expectedOutputs.some(isSourceFile);

/** A source / test file: a chat page turns "/" and "[a](b)" in code into links and escapes (measured: 5 tries in a row of a broken test file), so code is written by the code executor. */
const isSourceFile = (rel: string): boolean => /\.(m?js|cjs|jsx|tsx?|py|cs|java|go|rs|sh|ps1|css|html)$/i.test(rel.trim());

/** A picture task already turned into "draw it as SVG first" (see pictureAsSvg). */
const SVG_SUFFIX = /\n\(画像はまず SVG\(文字で書く画像\)として作ってください。[\s\S]*\)$/;
export const isSvgTask = (task: Pick<Task, "objective">): boolean => SVG_SUFFIX.test(task.objective);

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
        if (text.trim()) clearBotCheck(this.store, svc.id);
        return text.trim() ? { ok: true } : { ok: false, reason: "返事を読み取れませんでした" };
      } finally {
        await page.close();
      }
    } catch (err) {
      if (err instanceof WebAiProfileBusyError) return { ok: false, reason: "ログイン用の窓が開いたままです。その窓を閉じてから、もう一度押してください" };
      if (err instanceof WebAiBlockedError && err.reason === "captcha") {
        recordBotCheck(this.store, svc.id);
        return { ok: false, reason: "ボット確認(「私はロボットではありません」など)が表示されました。「確認を済ませる」で開いたブラウザで、そのAIに1通メッセージを送って、出た確認をご自身で済ませてください(確認は、送信したときに出ることがあります)" };
      }
      if (err instanceof WebAiBlockedError && err.reason === "limit") {
        recordUsageLimit(this.store, svc.id, err.detail ?? "");
        return { ok: false, reason: "このAIは、いま利用上限に達しているようです。時間をおいてから、もう一度確認してください" };
      }
      if (err instanceof WebAiBlockedError) return { ok: false, reason: "ログインが必要です。「ログインして使えるようにする」で済ませて、窓を閉じてから、もう一度押してください" };
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
    // the SVG came first and did not work: an image AI takes the picture as originally planned (and if that fails too, it is put on hold)
    const triedSvg = capabilityForTaskRole(task.role) === "image_generation" && isSvgTask(task);
    if (triedSvg) task = this.pictureAsImage(task);

    const outputPaths = webOutputPaths(task);
    let prompt = this.fittedPrompt(task, ctx.mission, svc, outputPaths);
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
     for (let tries = 0; ; tries++) {
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
        clearBotCheck(this.store, svc.id);
        this.hub.cancelPendingFor(task.id); // an earlier attempt of this task may have left a manual step waiting
        break;
      } catch (err) {
        if (ctx.signal.aborted) return { ok: false, summary: "中断されました" };
        if (err instanceof WebAiPromptTooLongError && tries < 2) {
          // the site told how much it takes: remember it, send a shorter prompt (less project excerpt first) instead of falling back
          this.learnPromptCap(svc, err);
          prompt = this.fittedPrompt(task, ctx.mission, svc, outputPaths);
          continue;
        }
        text = null;
        note = `自動操作(Level 3)に失敗したためLevel ${err instanceof WebAiBlockedError ? 1 : 2}に切り替えました: ${errMsg(err)}`;
        this.recordFailure(svc, 3, err, task);
        level = err instanceof WebAiBlockedError ? 1 : 2; // a login / bot check is the user's to clear: no point typing into that page
        break;
      }
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
        if (err instanceof WebAiPromptTooLongError) this.learnPromptCap(svc, err);
        note = `${note ? `${note} / ` : ""}半自動(Level 2)に失敗したためLevel 1に切り替えました: ${errMsg(err)}`;
        this.recordFailure(svc, 2, err, task);
        level = 1;
      }
    }

    // Pictures, music, video and voice are never left waiting for the person to carry a file between English sites:
    // a picture is drawn as SVG by Claude Code; the rest is put on hold with what was meant to be made, and the mission goes on.
    const capability = capabilityForTaskRole(task.role);
    if (text === null && isMediaCapability(capability)) {
      await page?.close().catch(() => {});
      return capability === "image_generation" && !triedSvg ? this.pictureAsSvg(task, svc, note) : this.holdMedia(task, svc, capability, prompt, note);
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

    if (looksLikeUsageLimit(text)) {
      // the site answered with "you have reached the limit": not a deliverable. Rest this AI and let the engine hand the task to another one.
      const until = recordUsageLimit(this.store, svc.id, text);
      this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "WEB_AI_USAGE_LIMIT", payload: { aiId: svc.id, until, text: text.slice(0, 300) } });
      return { ok: false, aiId: svc.id, automationLevel: usedLevel, summary: `${svc.name}が利用上限に達したと答えました。しばらく休ませて、ほかのAIに回します` };
    }
    clearUsageLimit(this.store, svc.id);
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
        if (looksLikeUsageLimit(text)) {
          recordUsageLimit(this.store, svc.id, text);
          return { ok: false, error: `${svc.name}が利用上限に達したと答えました` };
        }
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

  /** The picture could not be made by a web AI: the same task is redone by Claude Code as an SVG (a picture written as text), with the expected file renamed to .svg. */
  private pictureAsSvg(task: Task, svc: AiService | null, note: string | null): WebExecutionResult {
    const toSvg = (p: string) => p.replace(/\.(png|jpe?g|webp|gif)$/i, ".svg");
    let outs = task.expectedOutputs.map(toSvg).filter((p) => p.toLowerCase().endsWith(".svg"));
    if (!outs.length) outs = [`assets/image-${task.id.slice(0, 8)}.svg`];
    const objective = `${task.objective}\n(画像はまず SVG(文字で書く画像)として作ってください。1つの .svg ファイルに、width・height・viewBox を付けて書き、外部の画像やフォントは読み込まないこと。保存先: ${outs.join(", ")})`;
    this.store.setTaskPlan(task.projectId, task.id, { objective, expectedOutputs: [...task.expectedOutputs.filter((p) => !/\.(png|jpe?g|webp|gif)$/i.test(p)), ...outs] });
    this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "MEDIA_AS_SVG", payload: { aiId: svc?.id ?? null, outputs: outs, note } });
    return { ok: false, fallback: true, summary: `画像は、トークンを多く使う画像生成の前に、まずSVGとしてClaude Codeで作ります(うまくいかないときだけ、画像を作るAIで代わりにします)` };
  }

  /**
   * Claude has little design sense: the look of a picture (logo, banner, site mock-up) is drawn as SVG by an automatic AI of ANOTHER maker,
   * answered as text (cheap, no image generation). Never waits for a person; any failure hands the task to Claude Code's own SVG.
   */
  async designSvg(task: Task, mission: Mission, svc: AiService, signal: AbortSignal): Promise<WebExecutionResult> {
    const outs = task.expectedOutputs.filter((p) => p.toLowerCase().endsWith(".svg"));
    if (!outs.length) return { ok: false, fallback: true, summary: "SVGの保存先がありません" };
    const context = this.dependencyContext(task);
    const prompt = [
      "あなたは経験豊富なグラフィック・Webデザイナーです。次の依頼のデザインを、SVG(文字で書く画像)で作ってください。",
      `全体の目的: ${mission.goal}`,
      `依頼: ${task.objective.replace(SVG_SUFFIX, "")}`,
      ...(task.constraints.length ? [`条件: ${task.constraints.join(" / ")}`] : []),
      ...(context.length ? ["参考(前の作業の結果):", ...context] : []),
      "",
      `出力のルール: SVG を ${outs.length} 個、${outs.map((p, i) => `${i + 1}個目=${p}`).join("、")}、この順に svg のコードブロックで出してください。説明文は不要です。`,
      ' 各SVGには width・height・viewBox を付け、外部の画像・フォント・スクリプトは使わないこと。文字は <text> で font-family="sans-serif" を使う。',
      "各SVGの先頭に <!-- --> のコメントで、使った色コード・フォント・余白の方針を短く書くこと(あとで実装するAIが読みます)。",
      "見た目の質を最優先に: 余白・配色(3色程度)・文字の大きさの差・整列を意識してください。",
    ].join("\n");
    const got = await this.ask({ svc, prompt, task, signal });
    if (!got.ok) return { ok: false, fallback: true, summary: `${svc.name}にSVGを頼めませんでした(${got.error})。Claude CodeでSVGを作ります` };
    // some pages hand the code back with its angle brackets escaped ("&lt;svg ...&gt;")
    if (!/<svg/i.test(got.text) && /&lt;svg/i.test(got.text)) got.text = got.text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const svgs = (got.text.match(/<svg[\s\S]*?<\/svg>/gi) ?? []).filter((s) => s.length >= 150 && !/<script/i.test(s));
    if (svgs.length < outs.length) {
      // keep what the site actually gave back: without it nobody can tell a page that hides the code from an answer that is only prose
      this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "DESIGN_SVG_ANSWER", payload: { aiId: svc.id, length: got.text.length, svgFound: svgs.length, head: got.text.slice(0, 600), tail: got.text.slice(-300) } });
      return { ok: false, fallback: true, summary: `${svc.name}の回答にSVGが足りませんでした。Claude CodeでSVGを作ります` };
    }
    const saved: string[] = [];
    outs.forEach((rel, i) => {
      const abs = resolveInProject(this.store.projectsRoot, task.projectId, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, `${svgs[i]!}\n`, "utf8");
      this.store.createArtifact({ projectId: task.projectId, taskId: task.id, path: rel, createdBy: svc.id, sourceAi: svc.id, sourceUrl: svc.url });
      saved.push(rel);
    });
    this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "DESIGN_SVG_BY_AI", payload: { aiId: svc.id, outputs: saved } });
    return { ok: true, summary: `${svc.name}がデザインをSVGで作りました(仮の画像): ${saved.join(", ")}`, artifacts: saved, aiId: svc.id, automationLevel: 3, executor: this.name };
  }

  /** The SVG attempt did not work: the picture task goes back to what was planned (an image file) so an image AI can take it. */
  private pictureAsImage(task: Task): Task {
    this.store.setTaskPlan(task.projectId, task.id, { objective: task.objective.replace(SVG_SUFFIX, ""), expectedOutputs: task.expectedOutputs.map((p) => p.replace(/\.svg$/i, ".png")) });
    return this.store.getTask(task.projectId, task.id) ?? task;
  }

  /** Music, video or voice that no AI can make by itself: the task is closed as "on hold" with a note of what was meant to be made, so the mission is not stopped. */
  private holdMedia(task: Task, svc: AiService | null, capability: string, prompt: string, note: string | null): WebExecutionResult {
    const rel = `_ai-records/pending-media/${task.id.slice(0, 8)}-${capability}.md`;
    const kind = capability === "music_generation" ? "音楽" : capability === "video_generation" ? "動画" : capability === "voice_generation" ? "音声" : "素材";
    const body = [
      `# 保留: ${kind}の作成(まだ作られていません)`,
      "",
      `- 作る予定だったもの: ${task.objective}`,
      `- 予定の保存先: ${task.expectedOutputs.join(", ") || "(指定なし)"}`,
      `- 保留の理由: アプリが自動で${kind}を作れるAIがないため。人の手で英語のサイトを操作する方法には、頼っていません。${note ? `(${note})` : ""}`,
      "- 作りたくなったとき: 下の指示文を、音楽・動画・音声を作れるAIに渡してください。できたファイルは、予定の保存先に置いてください。",
      "",
      "## AIに渡す指示文",
      "",
      prompt,
      "",
    ].join("\n");
    const abs = resolveInProject(this.store.projectsRoot, task.projectId, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
    this.store.createArtifact({ projectId: task.projectId, taskId: task.id, path: rel, createdBy: svc?.id ?? "orchestrator", ...(svc ? { sourceAi: svc.id, sourceUrl: svc.url } : {}) });
    this.store.setTaskPlan(task.projectId, task.id, { expectedOutputs: [rel] });
    this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "MEDIA_ON_HOLD", payload: { aiId: svc?.id ?? null, capability, note } });
    return { ok: true, summary: `${kind}は自動で作れないため保留にしました(作る予定だった内容と指示文を ${rel} に残しました。ミッションは止めません)`, artifacts: [rel], ...(svc ? { aiId: svc.id } : {}), automationLevel: 1, executor: this.name };
  }

  /**
   * Picture / music / video / voice work that no automatic AI can take (the broker never chooses a manual one): a picture is redone as SVG
   * by Claude Code, the rest is put on hold. Never waits for a person.
   */
  mediaWithoutAi(task: Task, mission: Mission, hold = false): WebExecutionResult {
    const capability = capabilityForTaskRole(task.role);
    const note = "自動で使えるAIがありません";
    if (capability === "image_generation" && !hold) return this.pictureAsSvg(task, null, note);
    const prompt = buildWebPrompt({ task, mission, context: this.dependencyContext(task), references: [], outputPaths: webOutputPaths(task), previousFailure: undefined });
    return this.holdMedia(task, null, capability, prompt, note);
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
        // an empty or tiny "image" (an icon, a blank placeholder) is not the picture: it must never be saved as the deliverable
        const images = (await page.readImages()).filter((img) => img.base64.length >= 1000);
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
    // A site answers in chat, so it cannot append to a long existing file: its text would replace the whole history (TESTLOG, PLAN...). Leave the file alone and let Claude Code do it.
    for (const [rel, raw] of files) {
      const abs = resolveInProject(this.store.projectsRoot, projectId, rel);
      const before = existsSync(abs) ? readTextIfExists(abs) : null;
      const lines = (t: string) => t.split("\n").length;
      if (before !== null && lines(before) >= 30 && lines(cleanFileText(rel, raw)) < lines(before) / 2) {
        return { ok: false, fallback: true, aiId: svc.id, automationLevel: level, summary: `${rel} は既存の長いファイルなので、Webのチャットの回答では上書きせず、Claude Codeで追記します` };
      }
    }
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
  /** How many characters this site takes in one prompt, as it once told us ("クエリが上限を…文字超えています"); null = not known. */
  private promptCap(aiId: string): number | null {
    return this.store.getSetting<number | null>(`web_prompt_cap:${aiId}`, null);
  }

  private learnPromptCap(svc: AiService, err: WebAiPromptTooLongError): void {
    const cap = Math.max(1500, err.cap - 200);
    const known = this.promptCap(svc.id);
    this.store.setSetting(`web_prompt_cap:${svc.id}`, known ? Math.min(known, cap) : cap);
    this.store.appendEvent({ type: "WEB_AI_PROMPT_CAP", payload: { aiId: svc.id, cap, overBy: err.overBy, length: err.length } });
  }

  /** The prompt for `svc`; when its character limit is known, earlier results and project excerpts are cut until the whole text fits. */
  private fittedPrompt(task: Task, mission: Mission, svc: AiService, outputPaths: string[]): string {
    const make = (context: string[], references: string[]) => buildWebPrompt({ task, mission, context, references, outputPaths, previousFailure: this.previousFailure(task) });
    const cap = this.promptCap(svc.id);
    const context = this.dependencyContext(task);
    if (!cap) return make(context, this.referenceLines(task, mission.goal, svc.id));
    let ctx = context;
    let base = make(ctx, []);
    for (let i = 0; i < 8 && base.length > cap - 300 && ctx.length; i++) {
      ctx = i === 7 ? [] : ctx.map((l) => l.slice(0, Math.floor(l.length / 2)));
      base = make(ctx, []);
    }
    let room = cap - base.length - 300;
    let out = base;
    for (let i = 0; i < 4 && room >= 1500; i++) {
      out = make(ctx, this.referenceLines(task, mission.goal, svc.id, Math.min(room, referenceBudget(svc.id))));
      if (out.length <= cap - 200) return out;
      room -= out.length - (cap - 200) + 200; // the file list and headings are not part of the excerpt budget
    }
    return out.length <= cap ? out : base;
  }

  /** Web AIs cannot see the project folder, so earlier results are quoted (shortened) into the prompt. */
  /** The AI cannot open the project's files: its file list and the files the task names go into the prompt. */
  private referenceLines(task: Task, goal = "", aiId?: string, budget = referenceBudget(aiId)): string[] {
    try {
      return referenceContext(projectDir(this.store.projectsRoot, task.projectId), task.inputs, [task.objective, ...task.inputs, ...task.constraints, goal], budget);
    } catch {
      return [];
    }
  }

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
    if (err instanceof WebAiBlockedError && err.reason === "captcha") recordBotCheck(this.store, svc.id); // rested for a while; dropped after repeated checks
    if (err instanceof WebAiBlockedError && err.reason === "limit") recordUsageLimit(this.store, svc.id, err.detail ?? ""); // the site says its allowance is used up
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
    return needsCodeExecutor(task) ? [...(this.code.adapterTypes ?? [])] : this.adapterTypes;
  }

  async execute(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<ExecutionResult> {
    const svc = task.selectedAi ? this.store.getAiService(task.selectedAi) : null;
    const toWeb = getWebAiSettings(this.store).enabled && svc !== null && this.web.adapterTypes.some((t) => t === svc.adapterType) && !needsCodeExecutor(task);
    // picture / music / video / voice work nobody automatic can take: SVG by Claude Code or on hold (never a person at an English site)
    const onCode = svc !== null && !!this.code.adapterTypes?.includes(svc.adapterType);
    const picture = capabilityForTaskRole(task.role) === "image_generation" && !needsCodeExecutor(task);
    const toCode = async (t: Task) => {
      const codeAi = this.store.listAiServices().find((s) => this.code.adapterTypes?.includes(s.adapterType));
      if (codeAi) this.store.setTaskSelectedAi(t.projectId, t.id, codeAi.id);
      return this.runCode(this.store.getTask(t.projectId, t.id) ?? t, ctx);
    };
    if (picture) {
      // pictures cost a lot of tokens to generate: SVG by Claude Code comes first
      if (!isSvgTask(task)) {
        this.web.mediaWithoutAi(task, ctx.mission);
        task = this.store.getTask(task.projectId, task.id) ?? task;
      }
      if (task.retryCount < 1) {
        // design sense: an AI of another maker (not Claude) draws it first; Claude Code only when none can
        const designer = getWebAiSettings(this.store).enabled ? pickReviewer(this.store, "claude-code", "design", task.id) : null;
        if (designer) {
          this.store.setTaskSelectedAi(task.projectId, task.id, designer.svc.id);
          const done = await this.web.designSvg(this.store.getTask(task.projectId, task.id) ?? task, ctx.mission, designer.svc, ctx.signal);
          if (!done.fallback) return { ...done, executor: done.executor ?? this.web.name };
          // without this the only trace of a failed design AI was the name shown for a moment: nobody could tell why Claude Code drew it
          this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "DESIGN_SVG_FALLBACK", payload: { aiId: designer.svc.id, reason: done.summary } });
        }
        return toCode(task);
      }
      // the SVG did not work: an automatic image AI takes the picture; with none, it is put on hold
      const imageAi = getWebAiSettings(this.store).enabled ? this.store.listAiServices().find((s) => s.accessMode === "web" && s.automationLevel >= 3 && s.status === "active" && s.capabilities.includes("image_generation") && this.web.adapterTypes.some((x) => x === s.adapterType)) : undefined;
      if (!imageAi) {
        const held = this.web.mediaWithoutAi(task, ctx.mission, true);
        return { ...held, executor: held.executor ?? this.web.name };
      }
      this.store.setTaskSelectedAi(task.projectId, task.id, imageAi.id);
      const res = await this.web.execute(this.store.getTask(task.projectId, task.id) ?? task, ctx);
      return res.fallback ? toCode(task) : { ...res, executor: res.executor ?? this.web.name };
    }
    if (!onCode && !needsCodeExecutor(task) && !picture && isMediaCapability(capabilityForTaskRole(task.role)) && (svc === null || svc.automationLevel <= 2)) {
      const media = this.web.mediaWithoutAi(task, ctx.mission);
      if (!media.fallback) return { ...media, executor: media.executor ?? this.web.name };
      const fallbackAi = this.store.listAiServices().find((s) => this.code.adapterTypes?.includes(s.adapterType));
      if (fallbackAi) this.store.setTaskSelectedAi(task.projectId, task.id, fallbackAi.id);
      return this.runCode(this.store.getTask(task.projectId, task.id) ?? task, ctx);
    }
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
