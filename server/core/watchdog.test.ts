import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine, type ExecutionResult, type TaskExecutor } from "./missionEngine.ts";
import type { Planner } from "./planner.ts";
import { MAX_STALL_ABORTS, STALL_MS, stalledTasks, watchdogTick, type TaskView } from "./watchdog.ts";

const view = (over: Partial<TaskView> = {}): TaskView => ({ id: "t1", status: "running", lastEventType: "TASK_TRANSITION", lastEventMs: 0, stallAborts: 0, ...over });
const NOW = STALL_MS + 1000;

describe("stalledTasks (pure)", () => {
  it("picks a running in-process task that has been quiet longer than the limit", () => {
    expect(stalledTasks([view()], new Set(["t1"]), NOW)).toEqual(["t1"]);
  });
  it("leaves alone: recent activity, not running here, waiting for a person or a resting AI, or already stopped too often", () => {
    expect(stalledTasks([view({ lastEventMs: 2000 })], new Set(["t1"]), NOW)).toEqual([]);
    expect(stalledTasks([view()], new Set(), NOW)).toEqual([]);
    expect(stalledTasks([view({ status: "ready" })], new Set(["t1"]), NOW)).toEqual([]);
    expect(stalledTasks([view({ lastEventType: "APPROVAL_REQUESTED" })], new Set(["t1"]), NOW)).toEqual([]);
    expect(stalledTasks([view({ lastEventType: "TASK_WAITS_ALL_RESTING" })], new Set(["t1"]), NOW)).toEqual([]);
    expect(stalledTasks([view({ stallAborts: MAX_STALL_ABORTS })], new Set(["t1"]), NOW)).toEqual([]);
  });
});

describe("watchdogTick (with a real engine)", () => {
  let db: Db;
  let store: Store;
  const pid = "p1";
  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new Store(db, "unused");
    store.createProject({ id: pid, name: "p" });
  });
  afterEach(() => db.close());

  const planner: Planner = { name: "one", plan: async () => ({ summary: "", tasks: [{ key: "a", role: "research", objective: "a", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }) };

  it("stops a task that hangs with no sign of life; the ordinary retry then finishes the request", async () => {
    let attempt = 0;
    const executor: TaskExecutor = {
      name: "hang-once",
      async execute(_task: Task, ctx: { signal: AbortSignal }): Promise<ExecutionResult> {
        if (++attempt === 1) await new Promise((_r, rej) => ctx.signal.addEventListener("abort", () => rej(new Error("aborted"))));
        return { ok: true };
      },
    };
    const engine = new MissionEngine(store, { planner, executor });
    const { mission } = await engine.createMission({ projectId: pid, goal: "g" });
    engine.approvePlan(pid, mission.id);
    const done = engine.run(pid, mission.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.inFlightTaskIds(mission.id)).toHaveLength(1);

    const res = watchdogTick(store, engine, Date.now() + STALL_MS + 60_000);
    expect(res.stopped).toHaveLength(1);
    expect(await done).toBe("completed");
    expect(attempt).toBe(2);
    expect(store.listEvents({ type: "WATCHDOG_STOPPED_TASK" })).toHaveLength(1);
  });

  it("does not touch a task that is still within the limit", async () => {
    const executor: TaskExecutor = { name: "slow", execute: () => new Promise((r) => setTimeout(() => r({ ok: true }), 150)) };
    const engine = new MissionEngine(store, { planner, executor });
    const { mission } = await engine.createMission({ projectId: pid, goal: "g" });
    engine.approvePlan(pid, mission.id);
    const done = engine.run(pid, mission.id);
    await new Promise((r) => setTimeout(r, 30));
    expect(watchdogTick(store, engine).stopped).toEqual([]);
    expect(await done).toBe("completed");
  });

  it("starts a running request again when nothing is driving it", async () => {
    const executor: TaskExecutor = { name: "ok", execute: async () => ({ ok: true }) };
    const engine = new MissionEngine(store, { planner, executor });
    const { mission } = await engine.createMission({ projectId: pid, goal: "g" });
    engine.approvePlan(pid, mission.id); // running, but run() was never called: no loop
    expect(engine.isDriving(mission.id)).toBe(false);
    expect(watchdogTick(store, engine).restarted).toEqual([mission.id]);
    await new Promise((r) => setTimeout(r, 200));
    expect(store.getMission(pid, mission.id)?.status).toBe("completed");
  });
});

import { approvalsToRemind, hasNoLiveWork, newWatchdogState, NO_PROGRESS_MS } from "./watchdog.ts";

describe("approvals and stopped requests (pure)", () => {
  const T0 = Date.parse("2026-11-14T12:00:00Z");
  const ap = (id: string, minAgo: number) => ({ id, createdAt: new Date(T0 - minAgo * 60_000).toISOString() });
  it("reminds about an approval after 10 minutes, then every 30", () => {
    const last = new Map<string, number>();
    expect(approvalsToRemind([ap("a", 5)], T0, last)).toEqual([]);
    expect(approvalsToRemind([ap("a", 11)], T0, last)).toEqual([{ id: "a", waitedMinutes: 11 }]);
    last.set("a", T0);
    expect(approvalsToRemind([ap("a", 20)], T0 + 9 * 60_000, last)).toEqual([]);
    expect(approvalsToRemind([ap("a", 45)], T0 + 31 * 60_000, last)).toHaveLength(1);
  });
  it("sees a request with work left but nothing alive", () => {
    expect(hasNoLiveWork([{ status: "completed" }, { status: "blocked" }, { status: "pending" }])).toBe(true);
    expect(hasNoLiveWork([{ status: "completed" }, { status: "running" }, { status: "pending" }])).toBe(false);
    expect(hasNoLiveWork([{ status: "completed" }, { status: "cancelled" }])).toBe(false);
  });
});

describe("watchdogTick alerts", () => {
  it("writes a reminder event for a long-waiting approval, once per interval", () => {
    const db = openDatabase(":memory:");
    const store = new Store(db, "unused");
    store.createProject({ id: "p1", name: "p" });
    const engine = new MissionEngine(store, { planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) }, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const now = Date.now();
    const approvals = { list: () => [{ id: "ap_1", projectId: "p1", taskId: "t", createdAt: new Date(now - 15 * 60_000).toISOString(), reason: "撮影" }] };
    const state = newWatchdogState();
    expect(watchdogTick(store, engine, now, { approvals, state }).reminded).toEqual(["ap_1"]);
    expect(watchdogTick(store, engine, now + 60_000, { approvals, state }).reminded).toEqual([]);
    expect(store.listEvents({ type: "WATCHDOG_APPROVAL_WAITING" })).toHaveLength(1);
    void NO_PROGRESS_MS;
    db.close();
  });
});

describe("resumePlanning (after a restart)", () => {
  it("asks the planner again for a request left in planning with no proposal, and not for one that has a proposal", async () => {
    const db = openDatabase(":memory:");
    const store = new Store(db, "unused");
    store.createProject({ id: "p1", name: "p" });
    let calls = 0;
    const planner = { name: "p", plan: async () => { calls++; return { summary: "", tasks: [{ key: "a", role: "research", objective: "a", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }; } };
    const engine = new MissionEngine(store, { planner, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const orphan = store.createMission({ projectId: "p1", goal: "g", status: "planning" });
    expect(engine.resumePlanning("p1", orphan.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
    expect(engine.getProposal(orphan.id)).not.toBeNull();
    expect(engine.resumePlanning("p1", orphan.id)).toBe(false); // already has one
    db.close();
  });
});

describe("resumePlanning for a request the dying server marked failed", () => {
  it("plans it again when it failed just now while planning with no work made, but not an old or ordinary failure", async () => {
    const db = openDatabase(":memory:");
    const store = new Store(db, "unused");
    store.createProject({ id: "p1", name: "p" });
    const planner = { name: "p", plan: async () => ({ summary: "", tasks: [{ key: "a", role: "research", objective: "a", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }) };
    const engine = new MissionEngine(store, { planner, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const m = store.createMission({ projectId: "p1", goal: "g", status: "planning" });
    store.appendEvent({ projectId: "p1", type: "MISSION_STATUS_CHANGED", payload: { missionId: m.id, from: "planning", to: "failed", reason: "planner error: Claude Codeが異常終了しました" } });
    db.prepare("UPDATE missions SET status = 'failed' WHERE id = ?").run(m.id);
    expect(engine.resumePlanning("p1", m.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(store.getMission("p1", m.id)?.status).toBe("planning");
    expect(engine.getProposal(m.id)).not.toBeNull();

    const other = store.createMission({ projectId: "p1", goal: "h", status: "planning" });
    db.prepare("UPDATE missions SET status = 'failed' WHERE id = ?").run(other.id); // failed, but not by a planner error
    expect(engine.resumePlanning("p1", other.id)).toBe(false);
    db.close();
  });
});
