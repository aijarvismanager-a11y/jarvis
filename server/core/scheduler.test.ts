import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { Scheduler, isWriteTask, writeLockOwner, writeLockResource } from "./scheduler.ts";

let db: Db;
let store: Store;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  for (const id of ["p1", "p2"]) {
    store.createProject({ id, name: id });
    store.createMission({ projectId: id, goal: "g" });
  }
});
afterEach(() => db.close());

const task = (pid: string, role: string) => store.createTask({ projectId: pid, missionId: store.listMissions(pid)[0].id, role, status: "ready" });

describe("scheduler", () => {
  it("classifies code-editing roles", () => {
    expect(isWriteTask({ role: "coding" })).toBe(true);
    expect(isWriteTask({ role: " Refactor " })).toBe(true);
    expect(isWriteTask({ role: "review" })).toBe(false);
  });

  it("runs at most maxParallel (default 2) tasks", () => {
    const s = new Scheduler(store);
    const ready = [task("p1", "research"), task("p1", "design"), task("p1", "review")];
    expect(s.select("p1", ready, 0)).toHaveLength(2);
    expect(s.select("p1", ready, 1)).toHaveLength(1);
    expect(s.select("p1", ready, 2)).toHaveLength(0);
  });

  it("allows only one code-editing task per project and holds the write lock", () => {
    const s = new Scheduler(store);
    const w1 = task("p1", "coding");
    const w2 = task("p1", "coding");
    const r = task("p1", "review");
    const picked = s.select("p1", [w1, w2, r], 0);
    expect(picked.map((t) => t.id)).toEqual([w1.id, r.id]);
    expect(db.prepare("SELECT owner FROM locks WHERE resource = ?").get(writeLockResource("p1"))).toEqual({ owner: writeLockOwner(w1.id) });
    expect(s.select("p1", [w2], 1)).toHaveLength(0);
    s.release("p1", w1);
    expect(s.select("p1", [w2], 0).map((t) => t.id)).toEqual([w2.id]);
  });

  it("does not release a lock owned by another task", () => {
    const s = new Scheduler(store);
    const w1 = task("p1", "coding");
    const w2 = task("p1", "coding");
    s.select("p1", [w1], 0);
    s.release("p1", w2);
    expect(s.select("p1", [w2], 0)).toHaveLength(0);
  });

  it("locks are per project", () => {
    const s = new Scheduler(store);
    expect(s.select("p1", [task("p1", "coding")], 0)).toHaveLength(1);
    expect(s.select("p2", [task("p2", "coding")], 0)).toHaveLength(1);
  });

  it("a stale lock expires", () => {
    const s = new Scheduler(store, { lockTtlMs: -1 });
    const w1 = task("p1", "coding");
    const w2 = task("p1", "coding");
    s.select("p1", [w1], 0);
    expect(s.select("p1", [w2], 0)).toHaveLength(1);
  });
});
