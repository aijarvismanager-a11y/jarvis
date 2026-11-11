import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine, SAME_FAILURE_LIMIT, type ExecutionResult, type TaskExecutor } from "./missionEngine.ts";
import type { PlanRequest, Planner } from "./planner.ts";
import type { PlanDraft } from "./taskGraph.ts";
import { transitionTask } from "./taskStateMachine.ts";
import { ProjectValidator, scriptInsteadOfDocument, truncationReason } from "./taskValidator.ts";
import { projectDir } from "./paths.ts";
import { parseDeniedCommands, parseRunOutput } from "./claudeCodeExecutor.ts";
import { PermissionPolicy, approvableCommands, classifyCommand } from "./permissionPolicy.ts";

// Scenario tests: the real engine and validator on a throw-away database, with an executor that behaves the way real runs went wrong.
// Each one is something that happened (or could) on a real project; none touches real data or a real AI.

let db: Db;
let store: Store;
let root: string;
const pid = "p1";
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "scenario-"));
  db = openDatabase(":memory:");
  store = new Store(db, root);
  store.createProject({ id: pid, name: "p" });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

type Draft = { key: string; role: string; objective: string; inputs: string[]; expectedOutputs: string[]; constraints: string[]; dependsOn: string[] };
const t = (key: string, dependsOn: string[] = [], over: Partial<Draft> = {}): Draft => ({ key, role: "research", objective: key, inputs: [], expectedOutputs: [], constraints: [], dependsOn, ...over });
const plan = (...tasks: Draft[]): PlanDraft => ({ summary: "", tasks });
class OnePlan implements Planner {
  name = "one";
  constructor(private draft: PlanDraft) {}
  async plan(_req: PlanRequest) {
    return this.draft;
  }
}

/** An executor whose answer for each attempt of each task is a function the test writes. */
class Scripted implements TaskExecutor {
  name = "scripted";
  attempts = new Map<string, number>();
  constructor(public behave: (task: Task, attempt: number, signal: AbortSignal) => Promise<ExecutionResult> | ExecutionResult) {}
  async execute(task: Task, ctx: { signal: AbortSignal }): Promise<ExecutionResult> {
    const n = (this.attempts.get(task.objective) ?? 0) + 1;
    this.attempts.set(task.objective, n);
    await new Promise((r) => setTimeout(r, 2));
    return this.behave(task, n, ctx.signal);
  }
}

const tasksOf = (mid: string) => store.listTasks(pid).filter((x) => x.missionId === mid);
const task = (mid: string, o: string) => tasksOf(mid).find((x) => x.objective === o)!;
const eventTypes = (taskId: string) => (db.prepare("SELECT type FROM events WHERE task_id = ?").all(taskId) as { type: string }[]).map((e) => e.type);
async function start(engine: MissionEngine) {
  const { mission } = await engine.createMission({ projectId: pid, goal: "g" });
  engine.approvePlan(pid, mission.id);
  return mission.id;
}

describe("a task keeps failing", () => {
  it("stops the automatic retries when the same reason comes back, instead of using all of them", async () => {
    const exec = new Scripted((_t, n) => ({ ok: false, summary: `承認の画面が無いため拒否されました(${n}回目、${n * 7}秒)` }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"), t("b", ["a"]))), executor: exec });
    const mid = await start(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(exec.attempts.get("a")).toBe(SAME_FAILURE_LIMIT); // not 1 + MAX_RETRIES
    expect(eventTypes(task(mid, "a").id)).toContain("RETRY_STOPPED");
    expect(task(mid, "b").status).toBe("blocked");
  });

  it("still uses every retry when each failure is different", async () => {
    const exec = new Scripted((_t, n) => ({ ok: false, summary: `別の理由: ${"x".repeat(n)}` }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"))), executor: exec });
    const mid = await start(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(exec.attempts.get("a")).toBe(6);
    expect(eventTypes(task(mid, "a").id)).not.toContain("RETRY_STOPPED");
  });

  it("gives a manual retry its own fresh count, and a success after it completes the mission", async () => {
    const exec = new Scripted((tk, n) => (tk.objective === "a" && n <= SAME_FAILURE_LIMIT ? { ok: false, summary: "同じ失敗" } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"), t("b", ["a"]))), executor: exec });
    const mid = await start(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(await engine.retryFailedTask(pid, mid, task(mid, "a").id)).toBe("completed");
    expect(task(mid, "b").status).toBe("completed");
  });

  it("does not retry at all when the executor says retrying cannot help", async () => {
    const exec = new Scripted(() => ({ ok: false, retryable: false, summary: "許可されませんでした" }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"))), executor: exec });
    const mid = await start(engine);
    await engine.run(pid, mid);
    expect(exec.attempts.get("a")).toBe(1);
  });
});

describe("a failure in the middle of a chain", () => {
  it("blocks everything behind it and says the mission failed, while independent work still finishes", async () => {
    const exec = new Scripted((tk) => (tk.objective === "root" ? { ok: false, retryable: false, summary: "boom" } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("root"), t("mid", ["root"]), t("leaf", ["mid"]), t("other"))), executor: exec });
    const mid = await start(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(task(mid, "root").status).toBe("failed");
    expect(task(mid, "mid").status).toBe("blocked");
    expect(task(mid, "leaf").status).toBe("blocked");
    expect(task(mid, "other").status).toBe("completed");
  });
});

describe("a deliverable that is not what it should be", () => {
  const write = (rel: string, body: string) => {
    const file = path.join(projectDir(root, pid), rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  const run = async (expectedOutputs: string[]) => {
    const exec = new Scripted(() => ({ ok: true, artifacts: [] }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a", [], { expectedOutputs }))), executor: exec, validator: new ProjectValidator(root, { dotnetBuild: false }) });
    const mid = await start(engine);
    // one run only: the retries would repeat the same files
    db.prepare("UPDATE tasks SET retry_count = 5 WHERE mission_id = ?").run(mid);
    await engine.run(pid, mid);
    const v = db.prepare("SELECT status, detail FROM validations WHERE task_id = ? ORDER BY id DESC").get(task(mid, "a").id) as { status: string; detail: string } | undefined;
    return { status: task(mid, "a").status, detail: v?.detail ?? "" };
  };

  it("fails a deliverable that is missing or empty", async () => {
    expect((await run(["docs/none.md"])).status).toBe("failed");
    write("docs/empty.md", "");
    expect((await run(["docs/empty.md"])).detail).toContain("空です");
  });

  it("sends back a Markdown file that was cut off, and accepts a finished one", async () => {
    write("docs/cut.md", "# 監査\n\n## 1. 要約\n\n本文です。\n\n### 2-2. 設");
    const cut = await run(["docs/cut.md"]);
    expect(cut.status).toBe("failed");
    expect(cut.detail).toContain("途中で終わっている");
    write("docs/open-fence.md", "# 手順\n\n```\ndotnet build\n");
    expect((await run(["docs/open-fence.md"])).status).toBe("failed");
    write("docs/ok.md", "# 監査\n\n## 1. 要約\n\n本文です。\n");
    expect((await run(["docs/ok.md"])).status).toBe("completed");
  });

  it("recognises the two signs of a cut-off file, and nothing else", () => {
    expect(truncationReason("# a\n\nbody\n\n### 2-2. 設")).toContain("見出し");
    expect(truncationReason("text\n```js\nx")).toContain("コードブロック");
    expect(truncationReason("# only a title")).toBeNull(); // a one-line file is not "cut"
    // a chat AI that answers with the program that would write the document: the file holds code, not the document
    const script = '```\ncontent = """# レビュー\\n本文"""\nimport os\nwith open("_ai-records/x/review.md", "w", encoding="utf-8") as f:\n    f.write(content)\n```';
    expect(scriptInsteadOfDocument(script)).toContain("プログラム");
    expect(scriptInsteadOfDocument("# レビュー\n\n本文。\n\n```\nopen('a.md','w')\n```\n")).toBeNull(); // prose with a code sample is a document
    expect(scriptInsteadOfDocument("```js\nconsole.log(1)\n```")).toBeNull(); // code that does not write a document
    expect(truncationReason("# a\n\nbody\n\n```\ncode\n```\n")).toBeNull();
    expect(truncationReason("| a | b |\n|---|---|\n| 1 | 2 |")).toBeNull();
    expect(truncationReason("")).toBeNull();
  });
});

describe("a task that never answers", () => {
  it("is stopped by pausing the mission, and picks up again on resume", async () => {
    const exec = new Scripted((_t, n, signal) => (n === 1 ? new Promise<ExecutionResult>((res) => signal.addEventListener("abort", () => res({ ok: false, summary: "aborted" }))) : { ok: true }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"))), executor: exec });
    const mid = await start(engine);
    const running = engine.run(pid, mid);
    await new Promise((r) => setTimeout(r, 30));
    expect(task(mid, "a").status).toBe("running");
    await engine.pause(pid, mid);
    expect(await running).toBe("paused");
    expect(task(mid, "a").status).toBe("paused");
    expect(await engine.resume(pid, mid)).toBe("completed");
    expect(task(mid, "a").retryCount).toBe(0); // a pause is not a failure
  });

  it("is stopped by cancelling the mission", async () => {
    const exec = new Scripted((_t, _n, signal) => new Promise<ExecutionResult>((res) => signal.addEventListener("abort", () => res({ ok: false, summary: "aborted" }))));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"), t("b", ["a"]))), executor: exec });
    const mid = await start(engine);
    const running = engine.run(pid, mid);
    await new Promise((r) => setTimeout(r, 30));
    await engine.cancel(pid, mid);
    expect(await running).toBe("cancelled");
    expect(task(mid, "a").status).toBe("cancelled");
  });
});

describe("the server stops in the middle of a mission", () => {
  it("puts a task that was running back to ready on the next start, without counting it as a retry", async () => {
    const exec = new Scripted(() => ({ ok: true }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"), t("b", ["a"]))), executor: exec });
    const mid = await start(engine);
    // what a killed server leaves behind: the task running in the database, nothing running in memory
    transitionTask(store, pid, task(mid, "a").id, "ready", "dependencies completed");
    transitionTask(store, pid, task(mid, "a").id, "running", "scheduled");
    const restarted = new MissionEngine(store, { planner: new OnePlan(plan(t("a"))), executor: exec });
    expect(await restarted.run(pid, mid)).toBe("completed");
    expect(exec.attempts.get("a")).toBe(1);
    expect(task(mid, "a").retryCount).toBe(0);
    expect(task(mid, "b").status).toBe("completed");
  });

  it("survives being stopped over and over: the retry count does not grow and no task is lost", async () => {
    const exec = new Scripted(() => ({ ok: true }));
    const engine = new MissionEngine(store, { planner: new OnePlan(plan(t("a"), t("b", ["a"]), t("c", ["b"]))), executor: exec });
    const mid = await start(engine);
    for (let i = 0; i < 4; i++) {
      const a = task(mid, "a");
      if (a.status === "pending") transitionTask(store, pid, a.id, "ready", "dependencies completed");
      if (task(mid, "a").status === "ready") transitionTask(store, pid, a.id, "running", "scheduled");
      new MissionEngine(store, { planner: new OnePlan(plan(t("a"))), executor: new Scripted(() => new Promise<ExecutionResult>(() => {})) }).recover(pid, mid);
      expect(task(mid, "a").status).toBe("ready");
      expect(task(mid, "a").retryCount).toBe(0);
    }
    expect(await new MissionEngine(store, { planner: new OnePlan(plan(t("a"))), executor: exec }).run(pid, mid)).toBe("completed");
    expect(tasksOf(mid)).toHaveLength(3);
  });
});

describe("garbage in", () => {
  // a small seeded generator: the same "random" input every run, so a failure can be reproduced
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pieces = ['{"type":"result"', '"tool_use"', '"is_error":true', "\n", "\r\n", "{", "}", '"', "\\", "あいう", "\u0000", "Permission for this tool use was denied", '"permission_denials":[', "]", "null", "  ", "&&", ";", "|", "powershell -File x", "rm -rf /", '"command":"a b"'];
  const junk = (r: () => number, n: number) => Array.from({ length: n }, () => pieces[Math.floor(r() * pieces.length)]).join("");

  it("never throws on broken or odd run output, and only ever returns strings", () => {
    const r = rng(42);
    for (let i = 0; i < 300; i++) {
      const s = junk(r, 1 + Math.floor(r() * 40));
      const denied = parseDeniedCommands(s);
      expect(Array.isArray(denied) && denied.every((x) => typeof x === "string")).toBe(true);
      const out = parseRunOutput(s);
      expect(typeof out.text).toBe("string");
      expect(typeof out.isError).toBe("boolean");
    }
  });

  it("handles a huge single line and a huge number of lines", () => {
    expect(parseDeniedCommands("x".repeat(5_000_000))).toEqual([]);
    expect(parseDeniedCommands("{}\n".repeat(200_000))).toEqual([]);
    expect(parseRunOutput("{".repeat(1_000_000)).isError).toBe(false);
  });

  it("never offers anything for approval that is empty, chained with a delete, or an inline-code interpreter", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      for (const c of approvableCommands(junk(r, 1 + Math.floor(r() * 12)), [])) {
        expect(c.part.trim()).not.toBe("");
        expect(["READ", "WORKSPACE_WRITE"]).toContain(classifyCommand(c.part)); // never a delete / publish / download
        expect(c.pattern).not.toMatch(/ -(c|command|e)\b/i);
      }
    }
    const allowed = new PermissionPolicy().restrictionsFor({ role: "coding" }).allowedTools;
    expect(approvableCommands("cd x && rm -rf y", allowed)).toEqual([]); // cd is already allowed, rm needs a higher level
    expect(approvableCommands("cd x && tool.exe", allowed).map((c) => c.part)).toEqual(["tool.exe"]);
    expect(approvableCommands("powershell -Command Remove-Item a", allowed)).toEqual([]);
  });
});
