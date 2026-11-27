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

  it("proposes one task for a small request without the planner, and splits it only when asked", async () => {
    const planner = new ScriptedPlanner([plan(t("a"), t("b"))]);
    const engine = new MissionEngine(store, { planner, executor: new FakeExecutor(), smallRequests: true });
    const { mission, proposal } = await engine.createMission({ projectId: pid, goal: "src/a.js の丸めを直して" });
    expect(proposal.single).toBe(true);
    expect(proposal.draft.tasks).toHaveLength(1);
    expect(planner.requests).toHaveLength(0);
    const split = await engine.splitPlan(pid, mission.id);
    expect(split.single).toBeUndefined();
    expect(split.draft.tasks).toHaveLength(2);
    await expect(engine.splitPlan(pid, mission.id)).rejects.toThrow(/分けて/);
    // a change request goes to the planner too
    const other = await engine.createMission({ projectId: pid, goal: "src/b.js を直して" });
    await engine.rejectPlan(pid, other.mission.id, "テストを厚く");
    expect(planner.requests).toHaveLength(2);
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
    let n = 0; // the reason differs each time, so the same-failure cap does not apply here
    const validator: TaskValidator = { validate: async (_t, _r) => ({ passed: false, detail: "lint" + "x".repeat(++n) }) };
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
    const exec = new FakeExecutor((task, attempt) => (task.objective === "a" ? { ok: false, summary: "always" + "x".repeat(attempt) } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(exec.order.filter((o) => o === "a")).toHaveLength(6);
    expect(byObjective(mid, "a").status).toBe("failed");
    expect(byObjective(mid, "a").retryCount).toBe(5);
    expect(byObjective(mid, "b").status).toBe("blocked");
    expect(exec.order).not.toContain("b");
  });

  it("a check that cannot be done does not block the checks and records after it, and the request still finishes", async () => {
    const exec = new FakeExecutor((task, attempt) => (task.objective === "shot" ? { ok: false, summary: "cannot" + "x".repeat(attempt) } : { ok: true }));
    const engine = new MissionEngine(store, {
      planner: new ScriptedPlanner([plan(t("build", [], "coding"), t("shot", ["build"], "test"), t("more checks", ["shot"], "test"), t("write-up", ["more checks"], "document"))]),
      executor: exec,
    });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("completed");
    expect(byObjective(mid, "shot").status).toBe("failed");
    expect(byObjective(mid, "more checks").status).toBe("completed");
    expect(byObjective(mid, "write-up").status).toBe("completed");
    const ev = store.listEvents({ projectId: pid, type: "CHECKS_NOT_DONE" });
    expect(ev).toHaveLength(1);
  });

  it("but a failed check still blocks work that BUILDS something behind it", async () => {
    const exec = new FakeExecutor((task, attempt) => (task.objective === "shot" ? { ok: false, summary: "cannot" + "x".repeat(attempt) } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("shot", [], "test"), t("fix", ["shot"], "coding"))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(byObjective(mid, "fix").status).toBe("blocked");
    expect(exec.order).not.toContain("fix");
  });

  it("the user can retry a failed task with an extra instruction: it gets a fresh budget, dependents recover, the mission finishes", async () => {
    const seen: string[][] = [];
    const exec = new FakeExecutor((task, attempt) => {
      if (task.objective === "a") seen.push(task.constraints);
      return task.objective === "a" && attempt <= 6 ? { ok: false, summary: "always" + "x".repeat(attempt) } : { ok: true };
    });
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    expect(await engine.run(pid, mid)).toBe("failed");
    expect(byObjective(mid, "b").status).toBe("blocked");

    const a = byObjective(mid, "a");
    expect(await engine.retryFailedTask(pid, mid, a.id, "もっと小さく作って")).toBe("completed");
    expect(byObjective(mid, "a")).toMatchObject({ status: "completed", retryCount: 0 });
    expect(byObjective(mid, "b").status).toBe("completed");
    expect(seen.at(-1)).toContain("ユーザーからの追加指示: もっと小さく作って");
    expect(store.listEvents({ projectId: pid }).some((e) => e.type === "TASK_MANUAL_RETRY")).toBe(true);
  });

  it("only failed tasks of a live mission can be retried by hand", async () => {
    const exec = new FakeExecutor((task) => (task.objective === "a" ? { ok: false, summary: "x" } : { ok: true }));
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    await engine.run(pid, mid);
    expect(() => engine.retryFailedTask(pid, mid, byObjective(mid, "b").id)).toThrow("失敗した作業");
    expect(() => engine.retryFailedTask(pid, mid, "nope")).toThrow("見つかりません");
    await engine.cancel(pid, mid);
    expect(() => engine.retryFailedTask(pid, mid, byObjective(mid, "a").id)).toThrow("終了した依頼");
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

  it("a pause takes effect even when the executor ignores the abort signal and never returns (a stuck browser)", async () => {
    let hang = true;
    const exec = new FakeExecutor();
    exec.execute = async (task) => {
      if (task.objective === "a" && hang) return new Promise<ExecutionResult>(() => {}); // never settles, ignores ctx.signal
      return { ok: true };
    };
    const engine = new MissionEngine(store, { planner: new ScriptedPlanner([plan(t("a"), t("b", ["a"]))]), executor: exec });
    const mid = await started(engine);
    const run = engine.run(pid, mid);
    await new Promise((r) => setTimeout(r, 20));
    expect(byObjective(mid, "a").status).toBe("running");
    await engine.pause(pid, mid); // used to hang here forever
    expect(await run).toBe("paused");
    expect(byObjective(mid, "a").status).toBe("paused");
    hang = false;
    expect(await engine.resume(pid, mid)).toBe("completed");
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

describe("redirect (change direction mid-run)", () => {
  it("stops the running work, keeps completed tasks, and replaces the rest only after approval", async () => {
    const exec = new FakeExecutor(async (task) => {
      if (task.objective === "b") await new Promise(() => undefined); // hangs until aborted
      return { ok: true };
    });
    const original = exec.execute.bind(exec);
    exec.execute = (task, ctx) => {
      const p = original(task, ctx);
      if (task.objective !== "b") return p;
      return Promise.race([p, new Promise<ExecutionResult>((res) => ctx.signal.addEventListener("abort", () => res({ ok: false, summary: "aborted" })))]);
    };
    const planner = new ScriptedPlanner([plan(t("a"), t("b", ["a"]), t("c", ["b"])), plan(t("x"))]);
    const engine = new MissionEngine(store, { planner, executor: exec });
    const mid = await started(engine);
    const run = engine.run(pid, mid);
    while (!exec.order.includes("b")) await new Promise((r) => setTimeout(r, 2));

    await expect(engine.redirect(pid, mid, "  ")).rejects.toThrow();
    const proposal = await engine.redirect(pid, mid, "検索を先に作って");
    await run;
    expect(proposal.kind).toBe("replan");
    expect(proposal.feedback).toContain("検索を先に作って");
    expect(planner.requests[1]?.completed?.map((c) => c.objective)).toEqual(["a"]);
    expect(store.getMission(pid, mid)?.status).toBe("planning");
    expect(byObjective(mid, "b").status).not.toBe("cancelled"); // untouched until approved

    engine.approvePlan(pid, mid);
    expect(byObjective(mid, "a").status).toBe("completed");
    expect(byObjective(mid, "b").status).toBe("cancelled");
    expect(byObjective(mid, "c").status).toBe("cancelled");
    expect(byObjective(mid, "x").status).toBe("pending"); // becomes ready when the loop runs
  });
});
