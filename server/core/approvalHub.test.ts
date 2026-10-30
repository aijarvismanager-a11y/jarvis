import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { ApprovalHub } from "./approvalHub.ts";
import { PermissionPolicy } from "./permissionPolicy.ts";

let db: Db;
let store: Store;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  store.createProject({ id: "p1", name: "p" });
});
afterEach(() => db.close());

const req = (taskId = "t1", signal?: AbortSignal) => ({ projectId: "p1", taskId, level: "DESTRUCTIVE" as const, reason: "古いファイルを削除", signal });
const events = (type: string) => store.listEvents({ projectId: "p1" }).filter((e) => e.type === type);

describe("ApprovalHub", () => {
  it("holds the request until the user approves, then lets the task go on", async () => {
    const hub = new ApprovalHub(store);
    const answer = hub.gate(req());
    const [pending] = hub.list("p1");
    expect(pending).toMatchObject({ taskId: "t1", level: "DESTRUCTIVE" });
    hub.resolve(pending!.id, true);
    expect(await answer).toBe(true);
    expect(hub.list()).toEqual([]);
    expect(events("APPROVAL_REQUESTED")).toHaveLength(1);
    expect(events("APPROVAL_GRANTED")).toHaveLength(1);
  });

  it("a denial resolves false and is recorded", async () => {
    const hub = new ApprovalHub(store);
    const answer = hub.gate(req());
    hub.resolve(hub.list()[0]!.id, false);
    expect(await answer).toBe(false);
    expect(events("APPROVAL_REFUSED")).toHaveLength(1);
  });

  it("waits for the user by default, denies on an explicit timeout and when the task is aborted, and cannot be answered twice", async () => {
    const slow = new ApprovalHub(store, 20);
    expect(await slow.gate(req())).toBe(false);
    expect(slow.list()).toEqual([]);

    const hub = new ApprovalHub(store);
    void hub.gate(req("t0"));
    await new Promise((r) => setTimeout(r, 40));
    expect(hub.list()).toHaveLength(1); // no default timeout: still waiting
    const [waiting] = hub.list();
    hub.resolve(waiting!.id, true);
    const controller = new AbortController();
    const aborted = hub.gate(req("t2", controller.signal));
    controller.abort();
    expect(await aborted).toBe(false);
    expect(hub.list()).toEqual([]);

    const id = (() => {
      void hub.gate(req("t3"));
      return hub.list()[0]!.id;
    })();
    hub.resolve(id, true);
    expect(() => hub.resolve(id, true)).toThrow("処理済み");
  });

  it("an approval only lifts the restriction for the task that asked", async () => {
    const hub = new ApprovalHub(store);
    const policy = new PermissionPolicy(undefined, hub.gate);
    const ensured = policy.ensure(req("t1"));
    hub.resolve(hub.list()[0]!.id, true);
    expect(await ensured).toBe(true);
    expect(policy.restrictionsFor({ role: "coding", id: "t1" }).disallowedTools).not.toContain("Bash(rm:*)");
    expect(policy.restrictionsFor({ role: "coding", id: "t2" }).disallowedTools).toContain("Bash(rm:*)");
  });
});
