import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine, type ExecutionResult, type TaskExecutor, type TaskValidator } from "./missionEngine.ts";
import type { PlanRequest, Planner } from "./planner.ts";
import type { PlanDraft } from "./taskGraph.ts";

let db: Db;
let store: Store;
const pid = "p1";
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  store.createProject({ id: pid, name: "p" });
});
afterEach(() => db.close());

const t = (key: string, dependsOn: string[] = [], role = "research") => ({ key, role, objective: key, inputs: [], expectedOutputs: [], constraints: [], dependsOn });
const plan = (...tasks: ReturnType<typeof t>[]): PlanDraft => ({ summary: "", tasks });

class ScriptedPlanner implements Planner {
  name = "scripted";
  requests: PlanRequest[] = [];
  constructor(private drafts: PlanDraft[]) {}
  async plan(req: PlanRequest) {
    this.requests.push(req);
    const d = this.drafts.length > 1 ? this.drafts.shift()! : this.drafts[0];
    return d;
  }
}

/** Executor whose per-task behaviour the test controls; records peak concurrency. */
class FakeExecutor implements TaskExecutor {
  name = "fake";
  running = 0;
  peak = 0;
  peakWriters = 0;
  writers = 0;
  order: string[] = [];
  attempts = new Map<string, number>();
  gates = new Map<string, () => void>();
  constructor(public behave: (task: Task, attempt: number) => Promise<ExecutionResult> | ExecutionResult = () => ({ ok: true })) {}
  async execute(task: Task, ctx: { signal: AbortSignal }): Promise<ExecutionResult> {
    this.order.push(task.objective);
    const attempt = (this.attempts.get(task.id) ?? 0) + 1;
    this.attempts.set(task.id, attempt);
    this.running++;
    this.peak = Math.max(this.peak, this.running);
    const writer = task.role === "coding";
    if (writer) this.writers++;
    this.peakWriters = Math.max(this.peakWriters, this.writers);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return await this.behave(task, attempt);
    } finally {
      this.running--;
      if (writer) this.writers--;
      void ctx;
    }
  }
}

const tasksOf = (mid: string) => store.listTasks(pid).filter((x) => x.missionId === mid);
const byObjective = (mid: string, o: string) => tasksOf(mid).find((x) => x.objective === o)!;

async function started(engine: MissionEngine, goal = "g") {
  const { mission } = await engine.createMission({ projectId: pid, goal });
  engine.approvePlan(pid, mission.id);
  return mission.id;
}

describe("planning and the approval gate", () => {
  it("proposes a plan but creates no tasks and runs nothing until approved", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"))]), executor: exec });
    const { mission, proposal } = await engine.createMission({ projectId: pid, goal: "g" });
    expect(mission.status).toBe("planning");
    expect(proposal.draft.tasks).toHaveLength(1);
    expect(tasksOf(mission.id)).toHaveLength(0);
    expect(exec.order).toEqual([]);
    expect(await engine.run(pid, mission.id)).toBe("planning"); // not running -> does nothing
    expect(exec.order).toEqual([]);
    engine.approvePlan(pid, mission.id);
    expect(store.getMission(pid, mission.id)!.status).toBe("running");
    expect(tasksOf(mission.id)).toHaveLength(1);
    expect(() => engine.approvePlan(pid, mission.id)).toThrow(/承認待ち/);
  });

  it("rejecting asks the planner again with the feedback", async () => {
    const planner = new ScriptedPlanner([plan(t("a")), plan(t("a"), t("b"))]);
    const engine = new MissionEngine(store, { planner, executor: new FakeExecutor() });
    const { mission } = await engine.createMission({ projectId: pid, goal: "g" });
    const second = await engine.rejectPlan(pid, mission.id, "もっと細かく");
    expect(planner.requests[1].feedback).toBe("もっと細かく");
    expect(second.draft.tasks).toHaveLength(2);
    expect(tasksOf(mission.id)).toHaveLength(0);
  });

  it("marks the mission failed when the planner throws", async () => {
    const planner: Planner = { name: "bad", plan: async () => { throw new Error("boom"); } };
    const engine = new MissionEngine(store, { planner, executor: new FakeExecutor() });
    await expect(engine.createMission({ projectId: pid, goal: "g" })).rejects.toThrow("boom");
    expect(store.listMissions(pid)[0].status).toBe("failed");
  });
});

describe("running the graph", () => {
  it("respects dependencies and completes the mission", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]), t("c", ["b"]))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(exec.order).toEqual(["a", "b", "c"]);
    expect(tasksOf(mid).every((x) => x.status === "completed")).toBe(true);
    expect(store.listAiRuns(pid)).toHaveLength(3);
    expect(store.listValidations(pid)).toHaveLength(3);
  });

  it("runs at most 2 tasks in parallel", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b"), t("c"), t("d"))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(exec.peak).toBe(2);
  });

  it("never runs two code-editing tasks at once, but overlaps them with reviews", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, {
      planner: new ScriptedPlanner([plan(t("w1", [], "coding"), t("w2", [], "coding"), t("w3", [], "coding"), t("r1", [], "review"))]),
      executor: exec,
      maxParallel: 3,
    });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(exec.peakWriters).toBe(1);
    expect(exec.peak).toBeGreaterThan(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });
  });

  it("two missions in the same project still share one writer", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("w1", [], "coding"), t("w2", [], "coding"))]), executor: exec, maxParallel: 4 });
    const m1 = await started(engine, "g1");
    const m2 = await started(engine, "g2");
    const results = await Promise.all([engine.run(pid, m1), engine.run(pid, m2)]);
    expect(results).toEqual(["completed", "completed"]);
    expect(exec.peakWriters).toBe(1);
  });

  it("a failing validator fails the task (and it is retried)", async () => {
    const validator: TaskValidator = { validate: async (_t, _r) => ({ passed: false, detail: "lint" }) };
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"))]), executor: new FakeExecutor(), validator });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(byObjective(mid, "a").retryCount).toBe(5);
    expect(store.listValidations(pid).every((v) => v.status === "failed")).toBe(true);
  });
});

describe("retry", () => {
  it("retries a flaky task and succeeds", async () => {
    const exec = new FakeExecutor((_t, attempt) => (attempt < 3 ? { ok: false, summary: "flaky" } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(byObjective(mid, "a").retryCount).toBe(2);
    expect(exec.order).toHaveLength(3);
  });

  it("gives up after exactly 5 retries (6 executions), blocks dependents and fails the mission", async () => {
    const exec = new FakeExecutor((task) => (task.objective === "a" ? { ok: false, summary: "always" } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(exec.order.filter((o) => o === "a")).toHaveLength(6);
    expect(byObjective(mid, "a").status).toBe("failed");
    expect(byObjective(mid, "a").retryCount).toBe(5);
    expect(byObjective(mid, "b").status).toBe("blocked");
    expect(exec.order).not.toContain("b");
  });

  it("does not retry a failure the executor marks as unretryable (e.g. a denied approval)", async () => {
    const exec = new FakeExecutor((task) => (task.objective === "a" ? { ok: false, retryable: false, summary: "approval denied" } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(exec.order.filter((o) => o === "a")).toHaveLength(1);
    expect(byObjective(mid, "a")).toMatchObject({ status: "failed", retryCount: 0 });
    expect(byObjective(mid, "b").status).toBe("blocked");
  });

  it("an executor that throws counts as a failure", async () => {
    const exec = new FakeExecutor((_t, attempt) => {
      if (attempt === 1) throw new Error("crash");
      return { ok: true };
    });
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("completed");
  });
});

describe("pause / resume / cancel", () => {
  it("pauses mid-flight, then resumes and completes without redoing finished work", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const exec = new FakeExecutor(async (task, attempt) => {
      if (task.objective === "b" && attempt === 1) {
        await gate; // never resolves before the abort; engine aborts via signal
      }
      return { ok: true };
    });
    // make the executor honour the abort signal
    const original = exec.execute.bind(exec);
    exec.execute = async (task, ctx) => {
      const p = original(task, ctx);
      if (task.objective === "b" && (exec.attempts.get(task.id) ?? 1) === 1) {
        return Promise.race([p, new Promise<ExecutionResult>((res) => ctx.signal.addEventListener("abort", () => res({ ok: false, summary: "aborted" })))]);
      }
      return p;
    };
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]), t("c", ["b"]))]), executor: exec });
    const mid = await started(engine);
    const run = engine.run(pid, mid);
    while (!exec.order.includes("b")) await new Promise((r) => setTimeout(r, 2));
    await engine.pause(pid, mid);
    expect(await run).toBe("paused");
    expect(byObjective(mid, "a").status).toBe("completed");
    expect(byObjective(mid, "b").status).toBe("paused");
    expect(byObjective(mid, "b").retryCount).toBe(0); // a pause is not a failure
    expect(byObjective(mid, "c").status).toBe("pending");
    release();
    expect(await engine.resume(pid, mid)).toBe("completed");
    expect(exec.order.filter((o) => o === "a")).toHaveLength(1);
    expect(exec.order.filter((o) => o === "b")).toHaveLength(2);
  });

  it("recovers tasks left running by a crash when the mission is run again", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    // simulate a process that died mid-task: a is "running", lock still held
    const a = byObjective(mid, "a");
    db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(a.id);
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(exec.order).toEqual(["a", "b"]);
  });

  it("cancel stops the mission and cancels unfinished tasks", async () => {
    const exec = new FakeExecutor();
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    await engine.cancel(pid, mid);
    expect(store.getMission(pid, mid)!.status).toBe("cancelled");
    expect(tasksOf(mid).every((x) => x.status === "cancelled")).toBe(true);
    expect(await engine.run(pid, mid)).toBe("cancelled");
    expect(exec.order).toEqual([]);
  });

  it("resume is only legal from paused", async () => {
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"))]), executor: new FakeExecutor() });
    const mid = await started(engine);
    await engine.run(pid, mid);
    expect(() => engine.resume(pid, mid)).toThrow(/不正な状態遷移/);
  });
});

describe("replan", () => {
  it("keeps completed work, cancels the rest only after approval, and gives the planner context", async () => {
    const exec = new FakeExecutor((task) => (task.objective === "b" ? { ok: false, summary: "bad idea" } : { ok: true }));
    const planner = new ScriptedPlanner([plan(t("a"), t("b", ["a"])), plan(t("b2"), t("c", ["b2"]))]);
    const engine = new MissionEngine(store, { planner, executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");

    const proposal = await engine.replan(pid, mid, "別のやり方で");
    expect(proposal.kind).toBe("replan");
    expect(planner.requests[1].completed).toEqual([{ role: "research", objective: "a" }]);
    expect(planner.requests[1].failed?.map((f) => f.objective)).toEqual(["b"]);
    expect(planner.requests[1].feedback).toBe("別のやり方で");
    // nothing changed yet
    expect(byObjective(mid, "b").status).toBe("failed");

    engine.approvePlan(pid, mid);
    expect(byObjective(mid, "a").status).toBe("completed");
    expect(byObjective(mid, "b").status).toBe("cancelled");
    exec.behave = () => ({ ok: true });
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(byObjective(mid, "c").status).toBe("completed");
    expect(exec.order.filter((o) => o === "a")).toHaveLength(1);
  });

  it("refuses to replan while tasks are in flight, and a completed mission cannot be replanned", async () => {
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"))]), executor: new FakeExecutor() });
    const mid = await started(engine);
    const run = engine.run(pid, mid);
    await expect(engine.replan(pid, mid)).rejects.toThrow(/一時停止/);
    expect(await run).toBe("completed");
    await expect(engine.replan(pid, mid)).rejects.toThrow(/終了/);
  });

  it("a failed replan leaves the old graph intact", async () => {
    const exec = new FakeExecutor(() => ({ ok: false }));
    let calls = 0;
    const planner: Planner = {
      name: "p",
      plan: async () => {
        if (++calls > 1) throw new Error("planner down");
        return plan(t("a"));
      },
    };
    const engine = new MissionEngine(store, { planner, executor: exec });
    const mid = await started(engine);
    await engine.run(pid, mid);
    await expect(engine.replan(pid, mid)).rejects.toThrow("planner down");
    expect(byObjective(mid, "a").status).toBe("failed");
  });
});
