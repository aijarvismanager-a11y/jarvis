import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { AIBroker } from "./aiBroker.ts";
import { buildMissionReport } from "./missionReport.ts";

let db: Db;
let root: string;
beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "revauth-"));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("a review when no other AI is left", () => {
  it("is done by the AI that wrote the work (and says so) instead of failing the mission", async () => {
    const store = new Store(db, root);
    store.createProject({ id: "p1", name: "p" });
    // only Claude Code exists: every other AI is resting or failed
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier" });
    store.setCapabilities("claude-code", { coding: 5, ux_review: 4 });
    const engine = new MissionEngine(store, {
      planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) },
      executor: { name: "fake", adapterTypes: ["claude-code"] as never, execute: async (_t: Task) => ({ ok: true, artifacts: [] }) },
      broker: new AIBroker(store),
    });
    const mission = engine.startFixedMission({
      projectId: "p1",
      goal: "g",
      draft: {
        summary: "",
        tasks: [
          { key: "a", role: "coding", objective: "書く", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] },
          { key: "b", role: "review", objective: "見る", inputs: [], expectedOutputs: [], constraints: [], dependsOn: ["a"] },
        ],
      },
    });
    await engine.run("p1", mission.id);
    expect(store.getMission("p1", mission.id)?.status).toBe("completed");
    const evs = store.listEvents({ projectId: "p1", limit: 1000 });
    expect(evs.some((e) => e.type === "AI_REVIEW_BY_AUTHOR")).toBe(true);
    expect(buildMissionReport(store, "p1", mission.id).notes.join("\n")).toContain("書いたAI自身がレビューした");
  });

  it("is not reported for a task only the code executor can do (running tests): no other AI was ever possible", async () => {
    const store = new Store(db, root);
    store.createProject({ id: "p2", name: "p" });
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier" });
    store.setCapabilities("claude-code", { coding: 5, testing: 4 });
    const engine = new MissionEngine(store, {
      planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) },
      executor: { name: "fake", adapterTypes: ["claude-code", "web"] as never, adapterTypesFor: () => ["claude-code"] as never, execute: async (_t: Task) => ({ ok: true, artifacts: [] }) },
      broker: new AIBroker(store),
    });
    const task = (key: string, role: string, dependsOn: string[]) => ({ key, role, objective: "x", inputs: [], expectedOutputs: [], constraints: [], dependsOn });
    const mission = engine.startFixedMission({ projectId: "p2", goal: "g", draft: { summary: "", tasks: [task("a", "coding", []), task("b", "test", ["a"])] } });
    await engine.run("p2", mission.id);
    expect(store.getMission("p2", mission.id)?.status).toBe("completed");
    expect(store.listEvents({ projectId: "p2", limit: 1000 }).some((e) => e.type === "AI_REVIEW_BY_AUTHOR")).toBe(false);
  });
});
