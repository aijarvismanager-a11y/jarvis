import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { TASK_STATUSES, MISSION_STATUSES } from "./schema.ts";
import { MAX_RETRIES, IllegalTransitionError, canTransitionMission, canTransitionTask, retryTask, transitionMission, transitionTask } from "./taskStateMachine.ts";

let db: Db;
let store: Store;
let pid: string;
let mid: string;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  pid = store.createProject({ id: "p1", name: "p" }).id;
  mid = store.createMission({ projectId: pid, goal: "g" }).id;
});
afterEach(() => db.close());

const mk = (status: (typeof TASK_STATUSES)[number] = "pending") => store.createTask({ projectId: pid, missionId: mid, role: "coding", status });

describe("task state machine", () => {
  it("allows the normal lifecycle", () => {
    const t = mk();
    for (const s of ["ready", "running", "validation", "completed"] as const) expect(transitionTask(store, pid, t.id, s).status).toBe(s);
  });

  it("rejects illegal transitions and leaves the row untouched", () => {
    const t = mk();
    expect(() => transitionTask(store, pid, t.id, "completed")).toThrow(IllegalTransitionError);
    expect(store.getTask(pid, t.id)!.status).toBe("pending");
  });

  it("treats completed and cancelled as terminal", () => {
    for (const s of TASK_STATUSES) {
      expect(canTransitionTask("completed", s)).toBe(false);
      expect(canTransitionTask("cancelled", s)).toBe(false);
    }
  });

  it("is a no-op when the target equals the current status", () => {
    const t = mk();
    expect(transitionTask(store, pid, t.id, "pending").status).toBe("pending");
  });

  it("never allows skipping straight to completed except from validation", () => {
    for (const from of TASK_STATUSES) expect(canTransitionTask(from, "completed")).toBe(from === "validation");
    for (const from of MISSION_STATUSES) expect(typeof canTransitionMission(from, "running")).toBe("boolean");
  });

  it("validates mission transitions", () => {
    transitionMission(store, pid, mid, "planning");
    transitionMission(store, pid, mid, "running");
    transitionMission(store, pid, mid, "paused");
    transitionMission(store, pid, mid, "running");
    transitionMission(store, pid, mid, "completed");
    expect(() => transitionMission(store, pid, mid, "running")).toThrow(IllegalTransitionError);
  });

  it("does not leak across projects", () => {
    const other = store.createProject({ id: "p2", name: "q" });
    const t = mk();
    expect(() => transitionTask(store, other.id, t.id, "ready")).toThrow();
  });
});

describe("retry", () => {
  it("increments retry_count and goes failed -> ready, at most 5 times", () => {
    const t = mk("running");
    for (let i = 1; i <= MAX_RETRIES; i++) {
      transitionTask(store, pid, t.id, "failed");
      const r = retryTask(store, pid, t.id);
      expect(r.status).toBe("ready");
      expect(r.retryCount).toBe(i);
      transitionTask(store, pid, t.id, "running");
    }
    transitionTask(store, pid, t.id, "failed");
    expect(() => retryTask(store, pid, t.id)).toThrow(/上限/);
    expect(store.getTask(pid, t.id)!.retryCount).toBe(5);
    expect(store.getTask(pid, t.id)!.status).toBe("failed");
  });

  it("only retries failed tasks", () => {
    const t = mk();
    expect(() => retryTask(store, pid, t.id)).toThrow(IllegalTransitionError);
  });
});
