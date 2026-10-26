import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { AIBroker } from "./aiBroker.ts";
import { createOrchestratorRouter } from "./api.ts";
import type { Planner } from "./planner.ts";

let db: Db;
let store: Store;
let root: string;
let server: http.Server;
let base: string;

const planner: Planner = {
  name: "scripted",
  plan: async () => ({ summary: "", tasks: [{ key: "a", role: "research", objective: "調べる", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }),
};

beforeEach(async () => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "selrec-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
  for (const [id, name] of [["gemini", "Gemini (Web)"], ["perplexity", "Perplexity (Web)"]] as const) {
    store.upsertAiService({ id, name, url: `https://${id}.test`, accessMode: "web", adapterType: "manual", automationLevel: 3, freeStatus: "free_tier" });
    store.setCapabilities(id, { research: 5 });
    store.patchAiService(id, { qualityScore: 4 });
  }
  const engine = new MissionEngine(store, { planner, executor: { name: "fake", adapterTypes: ["manual"] as const, execute: async (_t: Task) => ({ ok: true }) }, broker: new AIBroker(store) });
  const app = express();
  app.use(express.json());
  app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: false, tokenMatches: () => true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the record of why an AI was chosen", () => {
  it("keeps the reason, the candidates, who was equally good and how much each was used", async () => {
    const engine = new MissionEngine(store, { planner, executor: { name: "fake", adapterTypes: ["manual"] as const, execute: async () => ({ ok: true }) }, broker: new AIBroker(store) });
    const { mission } = await engine.createMission({ projectId: "p1", goal: "調べる" });
    await engine.approvePlan("p1", mission.id);
    expect(await engine.run("p1", mission.id)).toBe("completed");
    const ev = store.listEvents({ projectId: "p1", type: "AI_SELECTED" })[0];
    const p = ev.payload as { selected: string; reason: string; chosen: { name: string; score10: number }; ranked: { aiId: string }[]; shared: { aiId: string; mission: number; recent: number }[] };
    expect(["gemini", "perplexity"]).toContain(p.selected);
    expect(p.reason).toContain("同程度のAIが2件");
    expect(p.chosen.name).toMatch(/Web/);
    expect(p.ranked.map((c) => c.aiId).sort()).toEqual(["gemini", "perplexity"]);
    expect(p.shared).toHaveLength(2);
    expect(p.shared[0]).toMatchObject({ mission: 0, recent: 0 });
  });

  it("the API returns every selection of the project, even when there are far more than 200 other events", async () => {
    const mission = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    const task = store.createTask({ projectId: "p1", missionId: mission.id, role: "research", status: "running" });
    store.appendEvent({ projectId: "p1", taskId: task.id, type: "AI_SELECTED", payload: { selected: "gemini", capability: "research" } });
    for (let i = 0; i < 300; i++) store.appendEvent({ projectId: "p1", taskId: task.id, type: "TASK_TRANSITION", payload: { n: i } });
    store.appendEvent({ projectId: "p1", taskId: task.id, type: "AI_FALLBACK", payload: { from: "gemini", to: "perplexity" } });
    const plain = (await (await fetch(`${base}/projects/p1/events`)).json()) as { events: { type: string }[] };
    expect(plain.events.some((e) => e.type === "AI_SELECTED")).toBe(false); // the first selection has scrolled out of the latest 200
    const sel = (await (await fetch(`${base}/projects/p1/ai-selections`)).json()) as { events: { type: string; id: number }[] };
    expect(sel.events.map((e) => e.type)).toEqual(["AI_SELECTED", "AI_FALLBACK"]);
  });
});
