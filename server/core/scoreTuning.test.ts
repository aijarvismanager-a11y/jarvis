import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store, type Task } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { AIBroker } from "./aiBroker.ts";
import { createOrchestratorRouter } from "./api.ts";
import { projectDir } from "./paths.ts";
import type { Planner } from "./planner.ts";
import { MAX_SHIFT, MIN_WEIGHT, recordOutcome, resetTuning, setTuningEnabled, shiftedScore, tuningOf, tuningReport, type Outcome } from "./scoreTuning.ts";
import { setWebAiSettings } from "./webAiSites.ts";
import type { AiReviewer } from "./aiReview.ts";

let db: Db;
let store: Store;
let root: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "tuning-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
  store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier" });
  store.setCapabilities("claude-code", { architecture: 4, coding: 5, documentation: 3, scratch: null });
  store.patchAiService("claude-code", { qualityScore: 4, reliabilityScore: 4 });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const times = (n: number, outcome: Outcome, cap: string | null = "architecture") => {
  for (let i = 0; i < n; i++) recordOutcome(store, "claude-code", cap, outcome);
};
const svc = () => store.getAiService("claude-code")!;

describe("the adjustment", () => {
  it("moves nothing before there is enough evidence, and nothing when the results are as expected", () => {
    expect(shiftedScore(4, { good: 1, bad: 1 }, 0.8)).toBe(4); // 2 < MIN_WEIGHT
    expect(shiftedScore(4, { good: 8, bad: 2 }, 0.8)).toBe(4); // exactly the expected share
    expect(MIN_WEIGHT).toBe(3);
  });

  it("raises a score for good results and lowers it for bad ones, slowly, and never by more than the limit", () => {
    const few = shiftedScore(3, { good: 4, bad: 0 }, 0.8);
    const many = shiftedScore(3, { good: 40, bad: 0 }, 0.8);
    expect(few).toBeGreaterThan(3);
    expect(many).toBeGreaterThan(few); // more evidence, more effect
    expect(many - 3).toBeLessThanOrEqual(MAX_SHIFT);
    expect(shiftedScore(3, { good: 0, bad: 40 }, 0.8)).toBeGreaterThanOrEqual(3 - MAX_SHIFT);
    expect(shiftedScore(3, { good: 0, bad: 40 }, 0.8)).toBeLessThan(3);
    expect(shiftedScore(4.9, { good: 100, bad: 0 }, 0.8)).toBeLessThanOrEqual(5);
    expect(shiftedScore(0.2, { good: 0, bad: 100 }, 0.8)).toBeGreaterThanOrEqual(0);
  });
});

describe("recording outcomes", () => {
  it("keeps the starting values, tallies per AI and kind of work, and writes the adjusted scores", () => {
    times(2, "review_approve"); // weight 2: nothing moves yet
    expect(svc().capabilityScores.architecture).toBe(4);
    times(10, "review_approve");
    expect(svc().capabilityScores.architecture).toBeGreaterThan(4);
    expect(svc().qualityScore).toBeGreaterThan(4);
    expect(svc().capabilityScores.coding).toBe(5); // another kind of work: untouched
    expect(svc().capabilities).toContain("scratch"); // an unscored capability is kept
    const report = tuningReport(store);
    const item = report.entries[0].items.find((i) => i.key === "cap:architecture")!;
    expect(item).toMatchObject({ start: 4, good: 12, bad: 0 });
    expect(item.now).toBe(svc().capabilityScores.architecture);
    expect(tuningOf(store, "claude-code", "architecture")).toMatchObject({ start: 4, good: 12 });
  });

  it("lowers scores for failed checks and 要修正 reviews; failed runs only count against reliability", () => {
    times(6, "review_revise");
    expect(svc().capabilityScores.architecture).toBeLessThan(4);
    expect(svc().qualityScore).toBeLessThan(4);
    expect(svc().reliabilityScore).toBe(4);
    times(8, "exec_fail", null);
    expect(svc().reliabilityScore).toBeLessThan(4);
    expect(svc().capabilityScores.architecture).toBeLessThan(4);
  });

  it("is switched off and back on, and can be put back to the starting values", () => {
    times(12, "review_revise");
    const lowered = svc().qualityScore;
    expect(lowered).toBeLessThan(4);
    setTuningEnabled(store, false);
    expect(svc().qualityScore).toBe(4); // back to the start while off
    times(3, "review_revise");
    expect(svc().qualityScore).toBe(4); // still counted, not applied
    setTuningEnabled(store, true);
    expect(svc().qualityScore).toBeLessThan(4);
    resetTuning(store, "claude-code");
    expect(svc().qualityScore).toBe(4);
    expect(svc().capabilityScores.architecture).toBe(4);
    expect(tuningReport(store).entries).toEqual([]);
  });

  it("remembers what was learned when a project is deleted, and ignores unknown AIs", () => {
    times(10, "review_approve");
    store.deleteProject("p1");
    expect(tuningReport(store).entries).toHaveLength(1);
    recordOutcome(store, "nobody", "coding", "exec_ok");
    recordOutcome(store, null, "coding", "exec_ok");
    expect(tuningReport(store).entries).toHaveLength(1);
  });
});

describe("inside the engine and the API", () => {
  const planner: Planner = { name: "scripted", plan: async () => ({ summary: "", tasks: [{ key: "a", role: "design", objective: "設計", inputs: [], expectedOutputs: ["d.md"], constraints: [], dependsOn: [] }] }) };
  const executor = (ok: boolean) => ({
    name: "fake",
    adapterTypes: ["claude-code"] as const,
    execute: async (task: Task) => {
      if (!ok) return { ok: false, aiId: "claude-code", summary: "壊れた" };
      const abs = path.join(projectDir(root, "p1"), "d.md");
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, "x");
      store.createArtifact({ projectId: "p1", taskId: task.id, path: "d.md", createdBy: "claude-code" });
      return { ok: true, aiId: "claude-code" };
    },
  });

  async function runMission(ok: boolean, verdicts: string[]) {
    store.upsertAiService({ id: "chatgpt", name: "ChatGPT (Web)", url: "https://c.test", accessMode: "web", adapterType: "manual", automationLevel: 3, freeStatus: "free_tier" });
    store.setCapabilities("chatgpt", { ux_review: 4 });
    setWebAiSettings(store, { enabled: true, loggedIn: { chatgpt: true } });
    let n = 0;
    const reviewer: AiReviewer = { ask: async () => ({ ok: true, text: verdicts[Math.min(n++, verdicts.length - 1)] }) };
    const engine = new MissionEngine(store, { planner, executor: executor(ok), broker: new AIBroker(store), aiReview: { reviewer } });
    const { mission } = await engine.createMission({ projectId: "p1", goal: "g" });
    await engine.approvePlan("p1", mission.id);
    return engine.run("p1", mission.id);
  }
  const quality = () => tuningReport(store).entries.find((e) => e.aiId === "claude-code")?.items.find((i) => i.key === "quality");

  it("counts an approving review as good and a run's success for reliability", async () => {
    expect(await runMission(true, ["判定: 承認"])).toBe("completed");
    expect(quality()).toMatchObject({ good: 1, bad: 0 });
    expect(tuningReport(store).entries[0].items.find((i) => i.key === "reliability")).toMatchObject({ good: 1, bad: 0 });
  });

  it("counts a 要修正 review as bad (and the repaired attempt that follows as good)", async () => {
    expect(await runMission(true, ["判定: 要修正\n- 直す", "判定: 承認"])).toBe("completed");
    expect(quality()).toMatchObject({ good: 1, bad: 1.5 });
  });

  it("counts a failed run against reliability only", async () => {
    await runMission(false, ["判定: 承認"]);
    const r = tuningReport(store).entries[0].items;
    expect(r.find((i) => i.key === "reliability")?.bad).toBeGreaterThan(0);
    expect(r.find((i) => i.key === "quality")).toMatchObject({ good: 0, bad: 0 });
  });

  it("is available through the API: report, switch, reset", async () => {
    times(10, "review_revise");
    const engine = new MissionEngine(store, { planner, executor: executor(true) });
    const app = express();
    app.use(express.json());
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: false, tokenMatches: () => true }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    const call = async (method: string, p: string, body?: unknown) => (await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<{ enabled: boolean; entries: { aiId: string }[] }>;
    try {
      expect((await call("GET", "/score-tuning")).entries.map((e) => e.aiId)).toEqual(["claude-code"]);
      expect((await call("PUT", "/score-tuning", { enabled: false })).enabled).toBe(false);
      expect(svc().qualityScore).toBe(4);
      expect((await call("POST", "/score-tuning/reset", { aiId: "claude-code" })).entries).toEqual([]);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
