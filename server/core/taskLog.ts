// Live log of what an AI is doing inside a task. Kept in memory only (a ring
// buffer per task): it is for watching a run, the durable record stays in the
// events / ai_runs tables.

export type LogKind = "text" | "tool" | "info" | "error";
export type LogEntry = { seq: number; at: string; kind: LogKind; text: string };

const MAX_ENTRIES = 300;
const MAX_TEXT = 400;
const MAX_TASKS = 200;

export class TaskLogStore {
  private readonly logs = new Map<string, { next: number; entries: LogEntry[] }>();

  append(taskId: string, kind: LogKind, text: string): void {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    let log = this.logs.get(taskId);
    if (!log) {
      if (this.logs.size >= MAX_TASKS) this.logs.delete(this.logs.keys().next().value as string);
      log = { next: 1, entries: [] };
      this.logs.set(taskId, log);
    }
    log.entries.push({ seq: log.next++, at: new Date().toISOString(), kind, text: clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}…` : clean });
    if (log.entries.length > MAX_ENTRIES) log.entries.splice(0, log.entries.length - MAX_ENTRIES);
  }

  /** Entries newer than `after` (a seq the caller already has). */
  read(taskId: string, after = 0): LogEntry[] {
    return (this.logs.get(taskId)?.entries ?? []).filter((e) => e.seq > after);
  }

  /** A new attempt starts a clean slate for the task. */
  clear(taskId: string): void {
    this.logs.delete(taskId);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One-line description of a tool call ("ファイルを書く: src/a.ts"). */
export function describeToolUse(name: string, input: Record<string, unknown>): string {
  const file = str(input.file_path) || str(input.path) || str(input.notebook_path);
  switch (name) {
    case "Write":
      return `ファイルを書く: ${file}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `ファイルを編集: ${file}`;
    case "Read":
      return `ファイルを読む: ${file}`;
    case "Bash":
    case "PowerShell":
      return `コマンド実行: ${str(input.command)}`;
    case "Glob":
    case "Grep":
      return `検索: ${str(input.pattern)}`;
    case "TodoWrite":
      return "作業計画を更新";
    default:
      return `${name}${file ? `: ${file}` : ""}`;
  }
}

/**
 * Feeds raw stdout chunks of `claude --output-format stream-json` and writes
 * readable entries. Lines that are not JSON, or event types it does not know,
 * are ignored: the log is best effort and must never affect the run.
 */
export class StreamJsonLogger {
  private buffer = "";

  constructor(
    private readonly logs: TaskLogStore,
    private readonly taskId: string,
    /** The project folder: paths under it are shown relative to it. */
    private readonly cwd?: string,
  ) {}

  private rel(text: string): string {
    if (!this.cwd) return text;
    return text.split(this.cwd + "\\").join("").split(this.cwd + "/").join("");
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (line) this.handle(line);
    }
    if (this.buffer.length > 1_000_000) this.buffer = "";
  }

  private handle(line: string): void {
    let ev: { type?: string; subtype?: string; message?: { content?: unknown }; is_error?: boolean };
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.type === "system" && ev.subtype === "init") return void this.logs.append(this.taskId, "info", "Claude Code を起動しました");
    if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content as { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (block.type === "text" && block.text) this.logs.append(this.taskId, "text", block.text);
        else if (block.type === "tool_use" && block.name) this.logs.append(this.taskId, "tool", this.rel(describeToolUse(block.name, block.input ?? {})));
      }
    } else if (ev.type === "user" && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content as { type?: string; is_error?: boolean; content?: unknown }[]) {
        if (block.type === "tool_result" && block.is_error) this.logs.append(this.taskId, "error", `ツールが失敗: ${typeof block.content === "string" ? block.content : "(詳細なし)"}`);
      }
    } else if (ev.type === "result") {
      this.logs.append(this.taskId, ev.is_error ? "error" : "info", ev.is_error ? "Claude Code がエラーで終了しました" : "Claude Code の作業が終わりました");
    }
  }
}
