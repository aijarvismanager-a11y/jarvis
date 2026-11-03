import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { AIBroker } from "./aiBroker.ts";
import { clearUsageLimit, recordUsageLimit } from "./usageLimit.ts";
import { readAllResting, restingList } from "./allResting.ts";
import type { Planner } from "./planner.ts";

let db: Db;
let store: Store;
let root: string;

const planner: Planner = {
  name: "scripted",
  plan: async () => ({ summary: "", tasks: [{ key: "a", role: "research", objective: "調べる", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }),
};

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "resting-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
  for (const [id, name] of [["gemini", "Gemini (Web)"], ["perplexity", "Perplexity (Web)"]] as const) {
    store.upsertAiService({ id, name, url: `https://${id}.test`, accessMode: "web", adapterType: "manual", automationLevel: 3, freeStatus: "free_tier" });
    store.setCapabilities(id, { research: 5 });
    store.patchAiService(id, { qualityScore: 4 });
  }
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
};

describe("when every capable AI is resting", () => {
  it("lists the resting AIs with the time each is back", () => {
    recordUsageLimit(store, "gemini");
    const list = restingList(store);
    expect(list.map((r) => [r.aiId, r.reason])).toEqual([["gemini", "limit"]]);
    expect(Date.parse(list[0]!.until)).toBeGreaterThan(Date.now());
  });

  it("the task waits (not failed), the screen state is kept, and it goes on as soon as an AI is back", async () => {
    recordUsageLimit(store, "gemini");
    recordUsageLimit(store, "perplexity");
    const ran: string[] = [];
    const engine = new MissionEngine(store, { planner, executor: { name: "fake", adapterTypes: ["manual"] as const, execute: async (t: Task) => { ran.push(t.selectedAi ?? "?"); return { ok: true }; } }, broker: new AIBroker(store) });
    const { mission } = await engine.createMission({ projectId: "p1", goal: "調べる" });
    await engine.approvePlan("p1", mission.id);
    const done = engine.run("p1", mission.id);
    await until(() => readAllResting(store) !== null);
    const state = readAllResting(store)!;
    expect(state.tasks).toBe(1);
    expect(state.ais.map((a) => a.aiId).sort()).toEqual(["gemini", "perplexity"]);
    expect(store.listTasks("p1")[0]!.status).not.toBe("failed");
    expect(ran).toEqual([]);

    clearUsageLimit(store, "gemini");
    expect(engine.recheckResting()).toBe(1);
    expect(await done).toBe("completed");
    expect(ran).toEqual(["gemini"]);
    expect(readAllResting(store)).toBeNull();
  });

  it("does not wait when only some of the AIs are resting", async () => {
    recordUsageLimit(store, "gemini");
    const engine = new MissionEngine(store, { planner, executor: { name: "fake", adapterTypes: ["manual"] as const, execute: async () => ({ ok: true }) }, broker: new AIBroker(store) });
    const { mission } = await engine.createMission({ projectId: "p1", goal: "調べる" });
    await engine.approvePlan("p1", mission.id);
    expect(await engine.run("p1", mission.id)).toBe("completed");
    expect(readAllResting(store)).toBeNull();
    expect(store.listEvents({ projectId: "p1", type: "AI_SELECTED" })[0]!.payload).toMatchObject({ selected: "perplexity" });
  });
});
