import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { ClaudeCodeExecutor, parseExecutorCapabilities, parseRunOutput } from "./claudeCodeExecutor.ts";
import type { CommandRunner } from "./commandRunner.ts";
import { StreamJsonLogger, TaskLogStore, describeToolUse } from "./taskLog.ts";

const ev = (o: unknown) => `${JSON.stringify(o)}\n`;
const assistant = (...content: unknown[]) => ev({ type: "assistant", message: { content } });

describe("StreamJsonLogger", () => {
  it("turns stream-json events into readable entries, even when lines arrive in pieces", () => {
    const logs = new TaskLogStore();
    const logger = new StreamJsonLogger(logs, "t1");
    const raw =
      ev({ type: "system", subtype: "init" }) +
      assistant({ type: "text", text: "まず設計を読みます" }, { type: "tool_use", name: "Read", input: { file_path: "design/api.md" } }) +
      assistant({ type: "tool_use", name: "Write", input: { file_path: "code/app.js" } }, { type: "tool_use", name: "Bash", input: { command: "npm test" } }) +
      ev({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "ENOENT" }] } }) +
      ev({ type: "result", is_error: false, result: "done" });
    const cut = Math.floor(raw.length / 3);
    logger.push("not json\n"); // junk lines are ignored
    logger.push(raw.slice(0, cut));
    logger.push(raw.slice(cut, cut * 2));
    logger.push(raw.slice(cut * 2));

    expect(logs.read("t1").map((e) => `${e.kind}:${e.text}`)).toEqual([
      "info:Claude Code を起動しました",
      "text:まず設計を読みます",
      "tool:ファイルを読む: design/api.md",
      "tool:ファイルを書く: code/app.js",
      "tool:コマンド実行: npm test",
      "error:ツールが失敗: ENOENT",
      "info:Claude Code の作業が終わりました",
    ]);
  });

  it("read(after) returns only newer entries, long text is cut, and the buffer is capped", () => {
    const logs = new TaskLogStore();
    for (let i = 0; i < 350; i++) logs.append("t", "info", `line ${i}`);
    const all = logs.read("t");
    expect(all).toHaveLength(300);
    expect(logs.read("t", all[298]!.seq).map((e) => e.text)).toEqual(["line 349"]);
    logs.append("t", "text", "x".repeat(1000));
    expect(logs.read("t").at(-1)!.text.length).toBeLessThanOrEqual(401);
    logs.clear("t");
    expect(logs.read("t")).toEqual([]);
    expect(describeToolUse("Unknown", {})).toBe("Unknown");
  });
});

describe("stream-json run output", () => {
  it("takes the verdict from the result event, and still reads the plain JSON envelope", () => {
    const stream = ev({ type: "system" }) + assistant({ type: "text", text: "t" }) + ev({ type: "result", is_error: true, result: "boom" });
    expect(parseRunOutput(stream)).toEqual({ text: "boom", isError: true });
    expect(parseRunOutput(JSON.stringify({ is_error: false, result: "ok" }))).toEqual({ text: "ok", isError: false });
  });

  it("detects --verbose + stream-json support from --help", () => {
    const help = `--output-format <format> (choices: "text", "json", "stream-json")\n--verbose  Override verbose mode`;
    expect(parseExecutorCapabilities(help).streamJson).toBe(true);
    expect(parseExecutorCapabilities(`--output-format <format> (choices: "text", "json", "stream-json")`).streamJson).toBe(false);
  });
});

describe("ClaudeCodeExecutor live log", () => {
  let db: Db;
  let store: Store;
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "tasklog-"));
    db = openDatabase(":memory:");
    store = new Store(db, root);
    store.createProject({ id: "p1", name: "p" });
  });
  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const HELP = `--print\n--output-format <f> (choices: "text", "json", "stream-json")\n--verbose\n--permission-mode <m> (choices: "acceptEdits")\n--disallowed-tools <t>\n--permission-prompts <t> (choices: "none")`;

  it("streams while the run is going and still returns the final result", async () => {
    const m = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    const task = store.createTask({ projectId: "p1", missionId: m.id, role: "research", objective: "調べる", status: "running" });
    const logs = new TaskLogStore();
    const seen: string[][] = [];
    let args: string[] = [];
    const runner: CommandRunner = async (_c, a, opts) => {
      if (a[0] === "--help") return { stdout: HELP, stderr: "", code: 0 };
      args = a;
      opts.onStdout?.(assistant({ type: "tool_use", name: "Write", input: { file_path: "research/a.md" } }));
      seen.push(logs.read(task.id).map((e) => e.text)); // visible before the run has finished
      opts.onStdout?.(ev({ type: "result", is_error: false, result: "完了しました" }));
      return { stdout: assistant({ type: "text", text: "x" }) + ev({ type: "result", is_error: false, result: "完了しました" }), stderr: "", code: 0 };
    };
    const res = await new ClaudeCodeExecutor(store, { runner, logs }).execute(task, { mission: m, signal: new AbortController().signal });
    expect(res).toMatchObject({ ok: true, summary: "完了しました" });
    expect(args).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--verbose"]));
    expect(seen[0]).toEqual(["ファイルを書く: research/a.md"]);
  });

  it("without a log store it keeps using the plain json output", async () => {
    const m = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    const task = store.createTask({ projectId: "p1", missionId: m.id, role: "research", objective: "調べる", status: "running" });
    let args: string[] = [];
    const runner: CommandRunner = async (_c, a) => {
      if (a[0] === "--help") return { stdout: HELP, stderr: "", code: 0 };
      args = a;
      return { stdout: JSON.stringify({ is_error: false, result: "ok" }), stderr: "", code: 0 };
    };
    await new ClaudeCodeExecutor(store, { runner }).execute(task, { mission: m, signal: new AbortController().signal });
    expect(args).toContain("json");
    expect(args).not.toContain("stream-json");
  });
});
