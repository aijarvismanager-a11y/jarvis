import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { WebHandoffHub } from "./webHandoff.ts";

let db: Db;
let root: string;
beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "handoff-stale-"));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("handoffs left behind by an earlier attempt", () => {
  it("are cancelled when a later automatic run answers the task, and other tasks are untouched", () => {
    const store = new Store(db, root);
    store.createProject({ id: "p1", name: "p" });
    const hub = new WebHandoffHub(store);
    const base = { projectId: "p1", aiId: "claude-web", aiName: "Claude (Web)", url: "https://claude.test", level: 2 as const, prompt: "x", note: null };
    const mine = hub.request({ ...base, taskId: "t1" });
    const other = hub.request({ ...base, taskId: "t2" });
    hub.cancelPendingFor("t1");
    expect(hub.get(mine.id)?.status).toBe("cancelled");
    expect(hub.get(other.id)?.status).toBe("pending");
    expect(hub.list({ status: "pending" }).map((h) => h.taskId)).toEqual(["t2"]);
    hub.cancelPendingFor("t1"); // nothing left to cancel: no error
  });
});
