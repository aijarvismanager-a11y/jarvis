import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carryHistory, condenseHistory, encodeProjectDir, findSessions, historyInfo, readConversation } from "./conversationHistory.ts";
import type { CommandRunner } from "./planner.ts";
import { HISTORY_NOTES_PATH } from "./projectImport.ts";
import { hashTree } from "./projectSync.ts";

const HELP = ["  --print", '  --permission-mode <mode>  (choices: "acceptEdits", "plan", "default")', "  --no-session-persistence", ""].join("\n");
const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const line = (o: unknown) => JSON.stringify(o);
const user = (text: string, extra: object = {}) => line({ type: "user", timestamp: "2026-10-01T10:00:00Z", message: { role: "user", content: text }, ...extra });
const assistant = (parts: unknown[], extra: object = {}) => line({ type: "assistant", timestamp: "2026-10-01T10:00:05Z", message: { role: "assistant", content: parts }, ...extra });

/** A fake home with one recorded session for `folder`, stored under the usual encoded name. */
function setup(folderName = "my app") {
  const base = mkdtempSync(path.join(os.tmpdir(), "hist-"));
  tmps.push(base);
  const home = path.join(base, "home");
  const folder = path.join(base, folderName);
  const project = path.join(base, "copy");
  mkdirSync(folder, { recursive: true });
  mkdirSync(project, { recursive: true });
  const dir = path.join(home, ".claude", "projects", encodeProjectDir(folder));
  mkdirSync(dir, { recursive: true });
  const session = [
    line({ type: "queue-operation", operation: "enqueue" }),
    user("ログイン画面を作りたい。パスワードはsk-secret-123を使う"),
    assistant([{ type: "thinking", thinking: "..." }, { type: "text", text: "了解です。まず認証方式を決めましょう。" }, { type: "tool_use", name: "Bash", input: { command: "ls" } }]),
    line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "TOOL OUTPUT MUST NOT APPEAR" }] } }),
    user("<system-reminder>harness noise</system-reminder>"),
    user("sidechain text", { isSidechain: true }),
    user("meta text", { isMeta: true }),
    user("セッションはCookie方式にして"),
  ].join("\n");
  writeFileSync(path.join(dir, "11111111-aaaa.jsonl"), session);
  return { base, home, folder, project, dir };
}

describe("conversation history", () => {
  it("encodes a folder like Claude Code does", () => {
    expect(encodeProjectDir("C:\\Users\\cross\\Desktop\\ai-manager")).toMatch(/^[A-Za-z]--Users-cross-Desktop-ai-manager$/i);
  });

  it("finds the sessions of a folder and reports them", async () => {
    const { home, folder } = setup();
    expect((await findSessions(folder, home)).map((s) => s.sessionId)).toEqual(["11111111-aaaa"]);
    const info = await historyInfo(folder, home);
    expect(info).toMatchObject({ found: true, sessions: 1 });
    expect((await historyInfo(path.join(folder, "other"), home)).found).toBe(false);
  });

  it("falls back to the cwd recorded in the session when the folder name is encoded differently", async () => {
    const { home, folder, dir } = setup();
    const odd = path.join(home, ".claude", "projects", "some-other-encoding");
    mkdirSync(odd, { recursive: true });
    writeFileSync(path.join(odd, "s.jsonl"), `${line({ type: "user", cwd: folder, message: { role: "user", content: "hi" } })}\n`);
    rmSync(dir, { recursive: true, force: true });
    expect((await findSessions(folder, home)).map((s) => s.sessionId)).toEqual(["s"]);
  });

  it("keeps only what was said: no tool calls, tool output, thinking, reminders, side chains or meta records", async () => {
    const { dir } = setup();
    const turns = await readConversation(path.join(dir, "11111111-aaaa.jsonl"));
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns.map((t) => t.text).join("|")).not.toMatch(/TOOL OUTPUT|harness noise|sidechain|meta text|thinking/);
    expect(turns[2].text).toBe("セッションはCookie方式にして");
  });

  it("condenses within a budget, newest sessions first but shown oldest first", async () => {
    const { dir } = setup();
    const long = Array.from({ length: 200 }, (_, i) => user(`発言${i} ${"あ".repeat(100)}`)).join("\n");
    writeFileSync(path.join(dir, "22222222-bbbb.jsonl"), long);
    const sessions = await findSessions(path.dirname(dir), "/nonexistent").catch(() => []); // not used; sessions listed directly below
    expect(sessions).toEqual([]);
    const all = [path.join(dir, "22222222-bbbb.jsonl"), path.join(dir, "11111111-aaaa.jsonl")].map((file, i) => ({ file, sessionId: String(i), modifiedAt: 2 - i, bytes: 1 }));
    const c = await condenseHistory(all, 5000);
    expect(c.text.length).toBeLessThan(5600);
    expect(c.text).toContain("途中を省略");
    expect(c.sessions).toBeGreaterThanOrEqual(1);
  });

  it("summarizes through Claude Code in read-only mode and saves the notes in the project", async () => {
    const { home, folder, project } = setup();
    const calls: { args: string[]; input?: string }[] = [];
    const runner: CommandRunner = async (_cmd, args, opts) => {
      calls.push({ args, input: opts.input });
      if (args.includes("--help")) return { code: 0, stdout: HELP, stderr: "", timedOut: false } as never;
      return { code: 0, stdout: "## 目的\nログイン画面を作っている。認証はCookie方式に決定。\n## 未完了\nパスワード処理。", stderr: "", timedOut: false } as never;
    };
    const r = await carryHistory({ sourceFolder: folder, projectDir: project, home, runner });
    expect(r).toMatchObject({ ok: true, sessions: 1, path: HISTORY_NOTES_PATH });
    const run = calls.find((c) => !c.args.includes("--help"))!;
    expect(run.args).toContain("plan"); // read-only
    expect(run.input).toContain("セッションはCookie方式にして");
    expect(run.input).not.toContain("TOOL OUTPUT");
    const notes = readFileSync(path.join(project, HISTORY_NOTES_PATH), "utf8");
    expect(notes).toContain("引き継ぎメモ");
    expect(notes).toContain("Cookie方式");
  });

  it("reports a failure instead of throwing, and writes nothing", async () => {
    const { home, folder, project } = setup();
    const runner: CommandRunner = async (_cmd, args) => (args.includes("--help") ? ({ code: 0, stdout: HELP, stderr: "", timedOut: false } as never) : ({ code: 1, stdout: "", stderr: "boom", timedOut: false } as never));
    const r = await carryHistory({ sourceFolder: folder, projectDir: project, home, runner });
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(project, HISTORY_NOTES_PATH))).toBe(false);
    expect((await carryHistory({ sourceFolder: path.join(folder, "none"), projectDir: project, home, runner })).ok).toBe(false);
  });

  it("the notes file is never part of the sync comparison", () => {
    const { project } = setup();
    mkdirSync(path.join(project, "docs"), { recursive: true });
    writeFileSync(path.join(project, HISTORY_NOTES_PATH), "notes");
    writeFileSync(path.join(project, "a.txt"), "A");
    expect(Object.keys(hashTree(project))).toEqual(["a.txt"]);
  });

  it("refuses to summarize when Claude Code has no read-only mode", async () => {
    const { home, folder, project } = setup();
    const runner: CommandRunner = async () => ({ code: 0, stdout: "  --print", stderr: "", timedOut: false }) as never;
    const r = await carryHistory({ sourceFolder: folder, projectDir: project, home, runner });
    expect(r).toMatchObject({ ok: false });
    expect(existsSync(path.join(project, HISTORY_NOTES_PATH))).toBe(false);
  });

  it("removes a code fence around the whole summary", async () => {
    const { home, folder, project } = setup();
    const runner: CommandRunner = async (_c, args) => (args.includes("--help") ? ({ code: 0, stdout: HELP, stderr: "", timedOut: false } as never) : ({ code: 0, stdout: ["```markdown", "# 引き継ぎメモ", "本文".repeat(30), "```", ""].join("\n"), stderr: "", timedOut: false } as never));
    await carryHistory({ sourceFolder: folder, projectDir: project, home, runner });
    const notes = readFileSync(path.join(project, HISTORY_NOTES_PATH), "utf8");
    expect(notes).toContain("# 引き継ぎメモ");
    expect(notes).not.toContain("```");
  });
});
