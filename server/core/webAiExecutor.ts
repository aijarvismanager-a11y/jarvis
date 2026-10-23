import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WebAiBlockedError, type WebChatDriver, type WebChatPage } from "./browserDriver.ts";
import type { ExecutionResult, TaskExecutor } from "./missionEngine.ts";
import { resolveInProject } from "./paths.ts";
import { isWriteTask } from "./scheduler.ts";
import type { AiService, Mission, Store, Task } from "./store.ts";
import { transitionTask } from "./taskStateMachine.ts";
import { declaredPaths } from "./taskValidator.ts";
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
    `あなたはソフトウェア開発ミッション「${mission.goal}」の次のタスクを担当します。`,
    `役割: ${task.role}`,
    `目的: ${task.objective}`,
  ];
  if (task.inputs.length) lines.push(`入力: ${task.inputs.join(" / ")}`);
  if (task.expectedOutputs.length) lines.push(`期待する成果物: ${task.expectedOutputs.join(" / ")}`);
  if (task.constraints.length) lines.push(`制約: ${task.constraints.join(" / ")}`);
  if (input.context.length) lines.push("", "【前のタスクの成果(抜粋)】", ...input.context);
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
    private readonly opts: { driver?: WebChatDriver; autoTimeoutMs?: number; handoffTimeoutMs?: number } = {},
  ) {}

  async execute(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<WebExecutionResult> {
    const svc = task.selectedAi ? this.store.getAiService(task.selectedAi) : null;
    if (!svc) return { ok: false, summary: "担当のWeb AIが選ばれていません" };

    const outputPaths = declaredPaths(task.expectedOutputs);
    const prompt = buildWebPrompt({ task, mission: ctx.mission, context: this.dependencyContext(task), outputPaths, previousFailure: this.previousFailure(task) });
    const site = resolveSiteProfile(this.store, svc.id);
    const driver = this.opts.driver && site && svc.url ? this.opts.driver : null;
    let level: 1 | 2 | 3 = driver ? (Math.min(3, Math.max(1, svc.automationLevel)) as 1 | 2 | 3) : 1;
    let note: string | null = driver || svc.automationLevel <= 1 ? null : "ブラウザ操作の準備(ブラウザ・サイト設定)がないためLevel 1で実行します";
    let text: string | null = null;
    let usedLevel: 1 | 2 | 3 = 1;
    let page: WebChatPage | null = null;

    if (level === 3 && driver && site) {
      try {
        const p = await driver.open({ url: svc.url!, site, signal: ctx.signal });
        try {
          await p.fillPrompt(prompt);
          await p.submit();
          text = await p.waitForResponse({ timeoutMs: this.opts.autoTimeoutMs ?? DEFAULT_AUTO_TIMEOUT_MS, signal: ctx.signal });
          usedLevel = 3;
        } finally {
          await p.close();
        }
        this.resetFailures(svc);
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
      files = [[outputPaths[0]!, path.extname(outputPaths[0]!) === ".md" ? text : unwrapSingleFence(text)]];
    } else {
      files = [[`web-ai/${slug(task.role)}-${task.id.slice(0, 8)}.md`, text]];
    }
    const saved: string[] = [];
    for (const [rel, body] of files) {
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
    if (task.retryCount === 0) return undefined;
    const failed = this.store
      .listValidations(task.projectId)
      .filter((v) => v.task_id === task.id && v.status === "failed")
      .pop();
    const detail = (failed?.detail as string | null) ?? this.store.listAiRuns(task.projectId).filter((r) => r.task_id === task.id && r.status === "failed").pop()?.summary;
    return typeof detail === "string" && detail ? detail.slice(-2000) : "(詳細不明)";
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
    if (err instanceof WebAiBlockedError) return;
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
      reason: `Level ${level}の自動操作が${DOWNGRADE_AFTER_FAILURES}回連続で失敗(${errMsg(err)})。サイトのUI変更の可能性があるため降格。Level 1は常に動作するため、ミッション全体は止めない`,
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
