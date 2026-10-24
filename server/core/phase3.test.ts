import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeExecutor, buildTaskPrompt, changedFiles, parseExecutorCapabilities, parseRunOutput, snapshotDir } from "./claudeCodeExecutor.ts";
import type { CommandRunner } from "./commandRunner.ts";
import { spawnRunner } from "./commandRunner.ts";
import { openDatabase, type Db } from "./db.ts";
import { MissionEngine } from "./missionEngine.ts";
import { PermissionPolicy, classifyCommand, requestedElevatedLevels } from "./permissionPolicy.ts";
import { Store, type Task } from "./store.ts";
import { ProjectValidator, declaredPaths } from "./taskValidator.ts";

const HELP = `
  --allowedTools, --allowed-tools <tools...>  Comma or space-separated list
  --disallowedTools, --disallowed-tools <tools...>  deny list
  --no-session-persistence   Disable session persistence
  --output-format <format>   (choices: "text", "json", "stream-json")
  --permission-mode <mode>   Permission mode (choices: "acceptEdits", "auto", "plan")
  --permission-prompts <target>  "host" or "none" (choices: "host", "none")
  -p, --print                Print response and exit
`;

let db: Db;
let store: Store;
let root: string;
const pid = "p1";

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "phase3-"));
  db = openDatabase(":memory:");
  store = new Store(db, root);
  store.createProject({ id: pid, name: "p" });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function makeTask(over: Partial<Parameters<Store["createTask"]>[0]> = {}): Task {
  const mission = store.createMission({ projectId: pid, goal: "make a thing", status: "running" });
  return store.createTask({ projectId: pid, missionId: mission.id, role: "coding", objective: "write code", ...over } as Parameters<Store["createTask"]>[0]);
}

type Call = { command: string; args: string[]; input?: string; cwd?: string };
function fakeClaude(onRun: (call: Call) => { stdout?: string; stderr?: string; code?: number; timedOut?: boolean } | Promise<never>) {
  const calls: Call[] = [];
  const runner: CommandRunner = async (command, args, opts) => {
    calls.push({ command, args, input: opts.input, cwd: opts.cwd });
    if (args[0] === "--help") return { stdout: HELP, stderr: "", code: 0 };
    const r = await onRun({ command, args, input: opts.input, cwd: opts.cwd });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code ?? 0, timedOut: r.timedOut };
  };
  return { calls, runner };
}
const ctx = (task: Task) => ({ mission: store.getMission(pid, task.missionId)!, signal: new AbortController().signal });

describe("PermissionPolicy", () => {
  it("classifies commands by the level they need", () => {
    expect(classifyCommand("rm -rf build")).toBe("DESTRUCTIVE");
    expect(classifyCommand("git reset --hard HEAD")).toBe("DESTRUCTIVE");
    expect(classifyCommand("git push origin main")).toBe("DEPLOY");
    expect(classifyCommand("npm publish")).toBe("DEPLOY");
    expect(classifyCommand("curl https://x.test")).toBe("NETWORK");
    expect(classifyCommand("npm install express")).toBe("NETWORK");
    expect(classifyCommand("git status")).toBe("READ");
    expect(classifyCommand("node build.js")).toBe("WORKSPACE_WRITE");
  });

  it("denies network/deploy/destructive tools by default and allows npm only for code tasks", () => {
    const p = new PermissionPolicy();
    const code = p.restrictionsFor({ role: "coding" });
    expect(code.allowedTools).toContain("Bash(npm:*)");
    expect(code.disallowedTools).toEqual(expect.arrayContaining(["WebFetch", "Bash(git push:*)", "Bash(rm:*)"]));
    expect(p.restrictionsFor({ role: "research" }).allowedTools).toEqual([]);
  });

  it("grants a level only when the gate approves, then lifts that deny list", async () => {
    const denied = new PermissionPolicy(undefined, async () => false);
    expect(await denied.ensure({ projectId: pid, taskId: "t", level: "DEPLOY", reason: "" })).toBe(false);
    const approved = new PermissionPolicy(undefined, async () => true);
    expect(await approved.ensure({ projectId: pid, taskId: "t", level: "DEPLOY", reason: "" })).toBe(true);
    expect(approved.restrictionsFor({ role: "coding", id: "t" }).disallowedTools).not.toContain("Bash(git push:*)");
    // the approval belongs to that task only
    expect(approved.restrictionsFor({ role: "coding", id: "other" }).disallowedTools).toContain("Bash(git push:*)");
  });

  it("spots deploy/delete wording in a task", () => {
    expect(requestedElevatedLevels({ objective: "本番にデプロイする", constraints: [] })).toEqual(["DEPLOY"]);
    expect(requestedElevatedLevels({ objective: "古いファイルを削除", constraints: [] })).toEqual(["DESTRUCTIVE"]);
    expect(requestedElevatedLevels({ objective: "ログイン画面を作る", constraints: [] })).toEqual([]);
  });

  it("does not treat an app's own delete feature as a destructive request", () => {
    expect(requestedElevatedLevels({ objective: "商品一覧・登録・編集・削除のUI/UXワイヤーフレームを設計する", constraints: [] })).toEqual([]);
    // a prohibition is not a request (the import analysis task says exactly this)
    expect(requestedElevatedLevels({ objective: "現状を調べる。既存のコードは一切変更しないでください", constraints: ["既存ファイルの変更・削除・移動は禁止。新規に作るのはレポートのみ"] })).toEqual([]);
    expect(requestedElevatedLevels({ objective: "古いファイルを削除", constraints: ["本番へのデプロイは禁止"] })).toEqual(["DESTRUCTIVE"]);
    expect(requestedElevatedLevels({ objective: "商品の削除APIを実装する", constraints: [] })).toEqual([]);
    expect(requestedElevatedLevels({ objective: "Implement a delete button and drop-down menu", constraints: [] })).toEqual([]);
    expect(requestedElevatedLevels({ objective: "rm -rf dist して作り直す", constraints: [] })).toEqual(["DESTRUCTIVE"]);
  });
});

describe("ClaudeCodeExecutor", () => {
  it("parses only flags that --help lists", () => {
    expect(parseExecutorCapabilities(HELP)).toEqual({ print: true, outputFormatJson: true, acceptEdits: true, permissionPromptsNone: true, allowedTools: true, disallowedTools: true, noSessionPersistence: true, streamJson: false });
    expect(parseExecutorCapabilities("Usage: other").acceptEdits).toBe(false);
  });

  it("runs in the project dir, sends the prompt via stdin and registers changed files as artifacts", async () => {
    const task = makeTask({ expectedOutputs: ["code/app.js"] });
    const { calls, runner } = fakeClaude(({ cwd }) => {
      mkdirSync(path.join(cwd!, "code"), { recursive: true });
      writeFileSync(path.join(cwd!, "code", "app.js"), "console.log(1)");
      return { stdout: JSON.stringify({ is_error: false, result: "done" }) };
    });
    const res = await new ClaudeCodeExecutor(store, { runner }).execute(task, ctx(task));
    expect(res).toMatchObject({ ok: true, summary: "done", artifacts: ["code/app.js"] });
    const run = calls.find((c) => c.args[0] !== "--help")!;
    expect(run.cwd).toBe(path.join(root, pid));
    expect(run.args).toEqual(expect.arrayContaining(["--print", "--permission-mode", "acceptEdits", "--permission-prompts", "none"]));
    expect(run.args.join(" ")).not.toContain("bypassPermissions");
    expect(run.args.join(" ")).toContain("--disallowed-tools");
    expect(run.input).toContain("write code");
    expect(store.listArtifacts(pid).map((a) => [a.path, a.taskId, a.createdBy])).toEqual([["code/app.js", task.id, "claude-code"]]);
  });

  it("refuses to run when the CLI cannot restrict permissions", async () => {
    const task = makeTask();
    const runner: CommandRunner = async (_c, args) => ({ stdout: args[0] === "--help" ? "-p, --print" : "", stderr: "", code: 0 });
    await expect(new ClaudeCodeExecutor(store, { runner }).execute(task, ctx(task))).rejects.toThrow(/acceptEdits/);
  });

  it("reports login problems, timeouts and non-zero exits as failures", async () => {
    const task = makeTask();
    const auth = fakeClaude(() => ({ code: 1, stdout: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }) }));
    expect((await new ClaudeCodeExecutor(store, { runner: auth.runner }).execute(task, ctx(task))).summary).toContain("ログイン");
    const expired = fakeClaude(() => ({ code: 1, stderr: "Failed to authenticate: OAuth session expired and could not be refreshed" }));
    expect((await new ClaudeCodeExecutor(store, { runner: expired.runner }).execute(task, ctx(task))).summary).toContain("ログイン");
    const slow = fakeClaude(() => ({ code: null as unknown as number, timedOut: true }));
    expect((await new ClaudeCodeExecutor(store, { runner: slow.runner }).execute(task, ctx(task))).summary).toContain("タイムアウト");
    const bad = fakeClaude(() => ({ code: 2, stderr: "boom" }));
    const r = await new ClaudeCodeExecutor(store, { runner: bad.runner }).execute(task, ctx(task));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("boom");
  });

  it("does not run a deploy task when approval is denied", async () => {
    const task = makeTask({ objective: "本番にデプロイする" });
    const { calls, runner } = fakeClaude(() => ({}));
    const res = await new ClaudeCodeExecutor(store, { runner }).execute(task, ctx(task));
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("承認");
    expect(calls.some((c) => c.args[0] !== "--help")).toBe(false);
  });

  it("feeds the previous failure back on a retry (self-repair)", async () => {
    const task = makeTask();
    store.addValidation({ projectId: pid, taskId: task.id, level: 3, status: "failed", detail: "テスト失敗: expected 2 got 3" });
    db.prepare("UPDATE tasks SET retry_count = 1 WHERE id = ?").run(task.id);
    const { calls, runner } = fakeClaude(() => ({ stdout: JSON.stringify({ result: "fixed" }) }));
    await new ClaudeCodeExecutor(store, { runner }).execute(store.getTask(pid, task.id)!, ctx(task));
    expect(calls.find((c) => c.args[0] !== "--help")!.input).toContain("expected 2 got 3");
  });

  it("builds a prompt and parses CLI output", () => {
    const prompt = buildTaskPrompt({ task: { role: "coding", objective: "o", inputs: [], expectedOutputs: ["a.js"], constraints: [] }, mission: { goal: "g" }, dependencyNotes: ["[design] d"] });
    expect(prompt).toContain("a.js");
    expect(prompt).toContain("[design] d");
    expect(parseRunOutput(JSON.stringify({ result: "x", is_error: true }))).toEqual({ text: "x", isError: true });
    expect(parseRunOutput("plain")).toEqual({ text: "plain", isError: false });
  });

  it("detects changed files by snapshot and ignores node_modules", () => {
    const dir = path.join(root, "snap");
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    writeFileSync(path.join(dir, "a.txt"), "1");
    const before = snapshotDir(dir);
    writeFileSync(path.join(dir, "b.txt"), "2");
    writeFileSync(path.join(dir, "node_modules", "x.js"), "3");
    writeFileSync(path.join(dir, "a.txt"), "changed!");
    expect(changedFiles(before, snapshotDir(dir))).toEqual(["a.txt", "b.txt"]);
  });
});

describe("ProjectValidator", () => {
  const write = (rel: string, body: string) => {
    const abs = path.join(root, pid, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const noRun: CommandRunner = async () => ({ stdout: "", stderr: "", code: 0 });

  it("picks only path-like expected outputs", () => {
    expect(declaredPaths(["code/app.js", "要件定義書", "README.md", "a b.txt"])).toEqual(["code/app.js", "README.md"]);
  });

  it("L1 fails on missing or empty declared files and on a code task that changed nothing", async () => {
    const v = new ProjectValidator(root, { runner: noRun });
    const task = makeTask({ expectedOutputs: ["code/app.js"] });
    expect(await v.validate(task, { ok: true })).toMatchObject({ passed: false, level: 1 });
    write("code/app.js", "");
    expect(await v.validate(task, { ok: true })).toMatchObject({ passed: false, level: 1 });
    const bare = makeTask({ expectedOutputs: [] });
    expect(await v.validate(bare, { ok: true, artifacts: [] })).toMatchObject({ passed: false, level: 1 });
  });

  it("L2 rejects broken JSON and JS syntax errors", async () => {
    write("data.json", "{oops");
    const v = new ProjectValidator(root);
    const task = makeTask({ role: "design" });
    expect(await v.validate(task, { ok: true, artifacts: ["data.json"] })).toMatchObject({ passed: false, level: 2 });
    write("data.json", "{}");
    write("bad.js", "const = ;");
    const res = await v.validate(task, { ok: true, artifacts: ["bad.js"] });
    expect(res).toMatchObject({ passed: false, level: 2 });
    write("bad.js", "const x = 1;");
    expect(await v.validate(task, { ok: true, artifacts: ["bad.js", "data.json"] })).toMatchObject({ passed: true, level: 2 });
  });

  it("L3 runs npm test for code tasks and reports the failure output", async () => {
    write("package.json", JSON.stringify({ scripts: { test: "node t.js" } }));
    write("src.js", "1");
    const task = makeTask();
    let calls: string[][] = [];
    const failing: CommandRunner = async (_c, args) => {
      calls.push(args);
      return args[0] === "--check" ? { stdout: "", stderr: "", code: 0 } : { stdout: "AssertionError: expected 2", stderr: "", code: 1 };
    };
    const res = await new ProjectValidator(root, { runner: failing }).validate(task, { ok: true, artifacts: ["src.js"] });
    expect(res).toMatchObject({ passed: false, level: 3 });
    expect(res.detail).toContain("expected 2");
    expect(calls.some((a) => a[0] === "test")).toBe(true);
    calls = [];
    const passing: CommandRunner = async () => ({ stdout: "", stderr: "", code: 0 });
    expect(await new ProjectValidator(root, { runner: passing }).validate(task, { ok: true, artifacts: ["src.js"] })).toMatchObject({ passed: true, level: 3 });
  });

  it("skips L3 when there is no real test script", async () => {
    write("package.json", JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    write("a.js", "1");
    const res = await new ProjectValidator(root, { runner: noRun }).validate(makeTask(), { ok: true, artifacts: ["a.js"] });
    expect(res).toMatchObject({ passed: true, level: 2 });
  });
});

describe("engine integration: self-repair loop", () => {
  it("fails validation, retries with the failure fed back, then completes", async () => {
    let attempt = 0;
    const { runner } = fakeClaude(({ cwd, input }) => {
      attempt++;
      // first attempt writes broken JSON; the second (which sees the failure text) fixes it
      writeFileSync(path.join(cwd!, "out.json"), attempt === 1 ? "{broken" : "{}");
      if (attempt === 2) expect(input).toContain("JSONとして不正");
      return { stdout: JSON.stringify({ result: `attempt ${attempt}` }) };
    });
    const planner = { name: "p", plan: async () => ({ summary: "", tasks: [{ key: "a", role: "design", objective: "emit json", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }) };
    const engine = new MissionEngine(store, { planner, executor: new ClaudeCodeExecutor(store, { runner }), validator: new ProjectValidator(root, { runner }) });
    const { mission } = await engine.createMission({ projectId: pid, goal: "g" });
    engine.approvePlan(pid, mission.id);
    expect(await engine.run(pid, mission.id)).toBe("completed");
    expect(attempt).toBe(2);
    expect(store.listValidations(pid).map((v) => [v.level, v.status])).toEqual([[2, "failed"], [2, "passed"]]);
  });
});

describe("spawnRunner", () => {
  it("kills a long-running process on timeout and on abort", async () => {
    const node = process.execPath;
    const t0 = Date.now();
    const res = await spawnRunner(node, ["-e", "setTimeout(()=>{}, 30000)"], { timeoutMs: 300 });
    expect(res.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
    const ac = new AbortController();
    const p = spawnRunner(node, ["-e", "setTimeout(()=>{}, 30000)"], { signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes stdin through and captures output", async () => {
    const res = await spawnRunner(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "hello" });
    expect(res).toMatchObject({ stdout: "hello", code: 0 });
  });
});
