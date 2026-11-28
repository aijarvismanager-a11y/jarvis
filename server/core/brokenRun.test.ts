import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { MissionEngine } from "./missionEngine.ts";
import { Store } from "./store.ts";

describe("an error inside the app during a task", () => {
  it("does not leave the task running with nobody working on it", async () => {
    const db = openDatabase(":memory:");
    const root = mkdtempSync(path.join(os.tmpdir(), "broken-"));
    const store = new Store(db, root);
    store.createProject({ id: "p1", name: "p" });
    // an AI that is not registered: saving the run breaks the database rule, outside the executor's own error handling
    const engine = new MissionEngine(store, { planner: { name: "p", plan: async () => ({ summary: "", tasks: [] }) }, executor: { name: "x", execute: async () => ({ ok: true, aiId: "nobody" }) } });
    const mission = engine.startFixedMission({ projectId: "p1", goal: "目標", draft: { summary: "s", tasks: [{ key: "a", role: "research", objective: "調べる", inputs: [], expectedOutputs: ["a.md"], constraints: [], dependsOn: [] }] } });
    await engine.run("p1", mission.id);
    const task = store.listTasks("p1")[0]!;
    expect(store.listEvents({ projectId: "p1", type: "ENGINE_ERROR", limit: 10 }).length).toBeGreaterThan(0);
    expect(task.status).toBe("failed");
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
});
