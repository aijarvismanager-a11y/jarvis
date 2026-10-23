import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { applyPlan, findCycle, planDraftSchema, refreshReadiness, validatePlan, type PlanDraft } from "./taskGraph.ts";
import { transitionTask } from "./taskStateMachine.ts";

let db: Db;
let store: Store;
const pid = "p1";
let mid: string;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  store.createProject({ id: pid, name: "p" });
  mid = store.createMission({ projectId: pid, goal: "g" }).id;
});
afterEach(() => db.close());

const t = (key: string, dependsOn: string[] = [], role = "coding") => ({ key, role, objective: key, inputs: [], expectedOutputs: [], constraints: [], dependsOn });
const draft = (...tasks: ReturnType<typeof t>[]): PlanDraft => ({ summary: "", tasks });

describe("validatePlan", () => {
  it("accepts a DAG", () => expect(validatePlan(draft(t("a"), t("b", ["a"]), t("c", ["a", "b"])))).toEqual([]));
  it("rejects duplicates, unknown deps, self deps and cycles", () => {
    expect(validatePlan(draft(t("a"), t("a")))[0]).toMatch(/重複/);
    expect(validatePlan(draft(t("a", ["x"])))[0]).toMatch(/存在しない/);
    expect(validatePlan(draft(t("a", ["a"])))[0]).toMatch(/自己依存/);
    expect(validatePlan(draft(t("a", ["c"]), t("b", ["a"]), t("c", ["b"])))[0]).toMatch(/循環/);
  });
  it("findCycle returns null for acyclic graphs", () => expect(findCycle([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: ["a"] }])).toBeNull());
  it("schema rejects empty and oversized plans", () => {
    expect(planDraftSchema.safeParse({ tasks: [] }).success).toBe(false);
    expect(planDraftSchema.safeParse({ tasks: Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, role: "r" })) }).success).toBe(false);
    expect(planDraftSchema.safeParse({ tasks: [{ key: "k", role: "r" }] }).success).toBe(true);
  });
});

describe("applyPlan", () => {
  it("creates tasks with edges mapped from keys to ids", () => {
    const tasks = applyPlan(store, pid, mid, draft(t("a"), t("b", ["a"])));
    expect(tasks).toHaveLength(2);
    expect(tasks[1].dependsOn).toEqual([tasks[0].id]);
    expect(tasks.map((x) => x.status)).toEqual(["pending", "pending"]);
  });
  it("is atomic: an invalid plan creates nothing", () => {
    expect(() => applyPlan(store, pid, mid, draft(t("a"), t("b", ["zzz"])))).toThrow(/不正/);
    expect(store.listTasks(pid)).toHaveLength(0);
  });
});

describe("refreshReadiness", () => {
  it("promotes tasks whose dependencies are completed", () => {
    const [a, b] = applyPlan(store, pid, mid, draft(t("a"), t("b", ["a"])));
    refreshReadiness(store, pid, mid, 5);
    expect(store.getTask(pid, a.id)!.status).toBe("ready");
    expect(store.getTask(pid, b.id)!.status).toBe("pending");
    for (const s of ["running", "validation", "completed"] as const) transitionTask(store, pid, a.id, s);
    refreshReadiness(store, pid, mid, 5);
    expect(store.getTask(pid, b.id)!.status).toBe("ready");
  });

  it("blocks dependents (transitively) when a dependency is exhausted, and recovers", () => {
    const [a, b, c] = applyPlan(store, pid, mid, draft(t("a"), t("b", ["a"]), t("c", ["b"])));
    refreshReadiness(store, pid, mid, 5);
    transitionTask(store, pid, a.id, "running");
    transitionTask(store, pid, a.id, "failed");
    db.prepare("UPDATE tasks SET retry_count = 5 WHERE id = ?").run(a.id);
    refreshReadiness(store, pid, mid, 5);
    expect(store.getTask(pid, b.id)!.status).toBe("blocked");
    expect(store.getTask(pid, c.id)!.status).toBe("blocked");
    db.prepare("UPDATE tasks SET retry_count = 1 WHERE id = ?").run(a.id);
    refreshReadiness(store, pid, mid, 5);
    expect(store.getTask(pid, b.id)!.status).toBe("pending");
    expect(store.getTask(pid, c.id)!.status).toBe("pending");
  });
});
