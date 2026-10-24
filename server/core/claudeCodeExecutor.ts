import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { needsShell, spawnRunner, type CommandRunner } from "./commandRunner.ts";
import type { ExecutionResult, TaskExecutor } from "./missionEngine.ts";
import { StreamJsonLogger, type TaskLogStore } from "./taskLog.ts";
import { PermissionPolicy, requestedElevatedLevels } from "./permissionPolicy.ts";
import { projectDir } from "./paths.ts";
import type { SnapshotManager } from "./snapshotManager.ts";
import type { Mission, Store, Task } from "./store.ts";

// ClaudeCodeExecutor (spec Phase 3): runs one Task through `claude --print` in
// the project's own directory. Only flags that `claude --help` lists are used,
// the prompt goes through stdin, and a failed earlier attempt (validation
// output or error) is fed back so the retry loop is a real self-repair loop.

export type ExecutorCapabilities = {
  print: boolean;
  outputFormatJson: boolean;
  acceptEdits: boolean;
  permissionPromptsNone: boolean;
  allowedTools: boolean;
  disallowedTools: boolean;
  noSessionPersistence: boolean;
  streamJson: boolean;
};

export function parseExecutorCapabilities(helpText: string): ExecutorCapabilities {
  const has = (flag: string) => new RegExp(`(^|[\\s,])${flag.replace(/-/g, "\\-")}(\\s|,|$|=)`, "m").test(helpText);
  const modes = /--permission-mode[\s\S]{0,400}?\(choices:[^)]*\)/.exec(helpText)?.[0] ?? "";
  return {
    print: has("--print") || has("-p"),
    outputFormatJson: has("--output-format") && /"json"/.test(helpText),
    acceptEdits: has("--permission-mode") && /"acceptEdits"/.test(modes),
    permissionPromptsNone: has("--permission-prompts") && /"none"/.test(helpText),
    allowedTools: has("--allowed-tools") || has("--allowedTools"),
    disallowedTools: has("--disallowed-tools") || has("--disallowedTools"),
    noSessionPersistence: has("--no-session-persistence"),
    streamJson: has("--output-format") && /"stream-json"/.test(helpText) && has("--verbose"),
  };
}

const AUTH_ERROR = /not logged in|\/login|invalid api key|oauth (token|session)|failed to authenticate|authenticat(e|ion)[_ ](error|failed)|session expired|unauthorized/i;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_SNAPSHOT_FILES = 20_000;
const MAX_ARTIFACTS = 200;
export const DEFAULT_TASK_TIMEOUT_MS = 20 * 60_000; // shorter than the write-lock TTL (30 min)

type Snapshot = Map<string, string>;

/** relative path -> "mtime:size" for every file under dir (node_modules and .git skipped). */
export function snapshotDir(dir: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (current: string, rel: string) => {
    if (out.size >= MAX_SNAPSHOT_FILES) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // never follow links out of the project
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(current, e.name), childRel);
      } else if (e.isFile()) {
        const st = statSync(path.join(current, e.name));
        out.set(childRel, `${st.mtimeMs}:${st.size}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const changed: string[] = [];
  for (const [file, sig] of after) if (before.get(file) !== sig) changed.push(file);
  return changed.sort();
}

export function buildTaskPrompt(input: {
  task: Pick<Task, "role" | "objective" | "inputs" | "expectedOutputs" | "constraints">;
  mission: Pick<Mission, "goal">;
  dependencyNotes: string[];
  previousFailure?: string;
}): string {
  const { task, mission } = input;
  const lines = [
    `あなたはミッション「${mission.goal}」のLead Developerです。次のタスクを1つだけ実行してください。`,
    `役割: ${task.role}`,
    `目的: ${task.objective}`,
    "作業ディレクトリ(カレント)がこのプロジェクトの全てです。この外のファイルは読み書きしないでください。",
    "成果物はファイルとして保存し(調査はresearch/、設計はdesign/、コードはcode/などサブフォルダ)、最後に何をしたかを短く報告してください。期待する成果物にパスが書かれている場合は、サブフォルダの慣例よりそのパスを優先してください。",
  ];
  if (task.inputs.length) lines.push(`入力: ${task.inputs.join(" / ")}`);
  if (task.expectedOutputs.length) lines.push(`期待する成果物: ${task.expectedOutputs.join(" / ")}`);
  if (task.constraints.length) lines.push(`制約: ${task.constraints.join(" / ")}`);
  if (input.dependencyNotes.length) lines.push("前のタスクの成果:", ...input.dependencyNotes.map((n) => `- ${n}`));
  if (input.previousFailure) {
    lines.push(
      "【前回の試行は失敗しました】原因を解析し、同じ失敗を繰り返さないよう根本原因を直してください。失敗内容:",
      input.previousFailure,
    );
  }
  return lines.join("\n");
}

/** Extracts the CLI's JSON envelope; falls back to treating stdout as the answer text. */
export function parseRunOutput(stdout: string): { text: string; isError: boolean } {
  // stream-json: one event per line; the verdict is the "result" event
  if (stdout.includes('"type":"result"')) {
    for (const line of stdout.trim().split("\n").reverse()) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>;
        if (o.type === "result") return { text: typeof o.result === "string" ? o.result : "", isError: o.is_error === true };
      } catch {
        /* not a JSON line */
      }
    }
  }
  try {
    const o = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (o && typeof o === "object") {
      return { text: typeof o.result === "string" ? o.result : "", isError: o.is_error === true };
    }
  } catch {
    /* plain text output */
  }
  return { text: stdout.trim(), isError: false };
}

const quoteForShell = (v: string) => `"${v.replace(/"/g, "")}"`;

export class ClaudeCodeExecutor implements TaskExecutor {
  readonly name = "claude-code";
  readonly adapterTypes = ["claude-code"] as const;
  private caps: ExecutorCapabilities | null = null;
  /** project -> file -> signature already registered. Parallel tasks in one project see each other's writes; this keeps a file from being registered twice. */
  private readonly registered = new Map<string, Map<string, string>>();

  constructor(
    private readonly store: Store,
    private readonly opts: {
      command?: string;
      runner?: CommandRunner;
      policy?: PermissionPolicy;
      timeoutMs?: number;
      /** When set, the run is streamed (stream-json) and what Claude Code does is written here, per task. */
      logs?: TaskLogStore;
      /** When set, the folder is snapshotted before and after each run so the task's changes can be viewed and rolled back. */
      snapshots?: SnapshotManager;
    } = {},
  ) {}

  private get command() {
    return this.opts.command ?? "claude";
  }
  private get runner() {
    return this.opts.runner ?? spawnRunner;
  }
  private get policy() {
    return (this.opts.policy ??= new PermissionPolicy());
  }

  async capabilities(): Promise<ExecutorCapabilities> {
    if (this.caps) return this.caps;
    const res = await this.runner(this.command, ["--help"], { timeoutMs: 30_000 });
    return (this.caps = parseExecutorCapabilities(`${res.stdout}\n${res.stderr}`));
  }

  buildArgs(caps: ExecutorCapabilities, task: Pick<Task, "role"> & { id?: string }, shell: boolean = needsShell(this.command)): string[] {
    if (!caps.print) throw new Error("このClaude Codeは非対話実行(--print)に対応していないため実行できません");
    // Without a way to deny prompts or restrict tools the run could hang or exceed its grants: refuse.
    if (!caps.acceptEdits) throw new Error("--permission-mode acceptEdits が使えないため、安全にタスクを実行できません");
    if (!caps.disallowedTools) throw new Error("--disallowed-tools が使えないため、権限を制限できず実行できません");
    const q = shell ? quoteForShell : (v: string) => v;
    const args = ["--print"];
if (this.opts.logs && caps.streamJson) args.push("--output-format", "stream-json", "--verbose");
    else if (caps.outputFormatJson) args.push("--output-format", "json");
    args.push("--permission-mode", "acceptEdits");
    if (caps.permissionPromptsNone) args.push("--permission-prompts", "none"); // anything that would prompt is denied, never hangs
    if (caps.noSessionPersistence) args.push("--no-session-persistence");
    const { allowedTools, disallowedTools } = this.policy.restrictionsFor(task);
    if (allowedTools.length && caps.allowedTools) args.push("--allowed-tools", q(allowedTools.join(",")));
    if (disallowedTools.length) args.push("--disallowed-tools", q(disallowedTools.join(",")));
    return args;
  }

  /** Why the last attempt failed (validation output first, then the run summary), for the retry prompt. */
  private previousFailure(task: Task): string | undefined {
    const failedValidation = this.store
      .listValidations(task.projectId)
      .filter((v) => v.task_id === task.id && v.status === "failed")
      .pop();
    const detail = (failedValidation?.detail as string | null) ?? this.store.listAiRuns(task.projectId).filter((r) => r.task_id === task.id && r.status === "failed").pop()?.summary;
    if (typeof detail === "string" && detail) return detail.slice(-3000);
    // a task that never failed has nothing to report; one that did (even after a manual retry reset the counter) does
    return task.retryCount === 0 ? undefined : "(詳細不明)";
  }

  private dependencyNotes(task: Task): string[] {
    const notes: string[] = [];
    const artifacts = this.store.listArtifacts(task.projectId);
    for (const depId of task.dependsOn) {
      const dep = this.store.getTask(task.projectId, depId);
      if (!dep) continue;
      const files = artifacts.filter((a) => a.taskId === depId).map((a) => a.path);
      notes.push(`[${dep.role}] ${dep.objective}${files.length ? ` → ${[...new Set(files)].slice(0, 20).join(", ")}` : ""}`);
    }
    return notes;
  }

  async execute(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<ExecutionResult> {
    const { projectId } = task;
    for (const level of requestedElevatedLevels(task)) {
      const approved = await this.policy.ensure({ projectId, taskId: task.id, level, reason: task.objective, signal: ctx.signal });
      if (!approved) {
        this.store.appendEvent({ projectId, taskId: task.id, type: "APPROVAL_DENIED", payload: { level } });
        return { ok: false, retryable: false, summary: `この操作には承認が必要です(${level})。承認されなかったため実行しませんでした` };
      }
    }

    const cwd = projectDir(this.store.projectsRoot, projectId);
    mkdirSync(cwd, { recursive: true });
    const args = this.buildArgs(await this.capabilities(), task);
    const prompt = buildTaskPrompt({ task, mission: ctx.mission, dependencyNotes: this.dependencyNotes(task), previousFailure: this.previousFailure(task) });

    const before = snapshotDir(cwd);
    const snaps = this.opts.snapshots;
    const snapName = `${projectId}-${task.id}-${task.retryCount}`;
    await snaps?.capture(projectId, `${snapName}-before`).catch(() => undefined);
    const logs = this.opts.logs;
    logs?.clear(task.id);
    const logger = logs ? new StreamJsonLogger(logs, task.id, cwd) : null;
    const res = await this.runner(this.command, args, { input: prompt, cwd, signal: ctx.signal, timeoutMs: this.opts.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS, onStdout: logger ? (chunk) => logger.push(chunk) : undefined });
    const afterSnap = snapshotDir(cwd);
    await snaps?.capture(projectId, `${snapName}-after`).then(() => this.store.appendEvent({ projectId, taskId: task.id, type: "TASK_SNAPSHOT", payload: { name: snapName } })).catch(() => undefined);
    const files = changedFiles(before, afterSnap).slice(0, MAX_ARTIFACTS);
    // Best effort: with parallel tasks a file may be attributed to whichever task finished first.
    const seen = this.registered.get(projectId) ?? new Map<string, string>();
    this.registered.set(projectId, seen);
    for (const file of files) {
      const sig = afterSnap.get(file)!;
      if (seen.get(file) === sig) continue;
      seen.set(file, sig);
      this.store.createArtifact({ projectId, taskId: task.id, path: file, createdBy: this.name });
    }

    const out = parseRunOutput(res.stdout);
    const combined = `${out.text}\n${res.stderr}`;
    if (res.timedOut) return { ok: false, summary: `タイムアウトしました(${Math.round((this.opts.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS) / 60_000)}分)`, artifacts: files };
    if (AUTH_ERROR.test(combined) && (res.code !== 0 || out.isError)) {
      return { ok: false, summary: "Claude Codeにログインできていません。ターミナルで claude を起動してログインしてください", artifacts: files };
    }
    if (res.code !== 0 || out.isError) {
      return { ok: false, summary: `Claude Codeが失敗しました(code=${res.code}): ${(out.text || res.stderr).slice(-1500)}`, artifacts: files };
    }
    return { ok: true, summary: out.text.slice(0, 2000), artifacts: files };
  }
}
