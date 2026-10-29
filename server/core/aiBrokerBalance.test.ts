import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { AIBroker, NEAR_BEST, aiUsage, capabilityForTaskRole, pickBalanced, type BrokerCandidate } from "./aiBroker.ts";
import { pickReviewer, reviewCapabilityFor } from "./aiReview.ts";
import { IDEATION_SCORES, applyIdeationCapability } from "./aiRegistry.ts";
import { setWebAiSettings } from "./webAiSites.ts";
import { recordBotCheck } from "./botCheck.ts";

let db: Db;
let store: Store;
let root: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "balance-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const cand = (aiId: string, name: string, total: number): BrokerCandidate => ({ aiId, name, total, score10: total / 5, breakdown: { fit: 0, quality: 0, automation: 0, safety: 0 }, notes: [] });

/** A web AI at Level 3 with the given capability scores and quality. */
function web(id: string, name: string, scores: Record<string, number>, quality = 4) {
  store.upsertAiService({ id, name, url: `https://${id}.test`, accessMode: "web", adapterType: "manual", automationLevel: 3, freeStatus: "free_tier" });
  store.setCapabilities(id, scores);
  store.patchAiService(id, { qualityScore: quality });
}
const run = (aiId: string, n = 1) => {
  for (let i = 0; i < n; i++) store.recordAiRun({ projectId: "p1", taskId: null, aiId, executor: "web-ai", status: "succeeded" });
};

describe("sharing the work among equally good AIs", () => {
  const ranked = [cand("a", "Alpha", 40), cand("b", "Beta", 40 - NEAR_BEST / 2), cand("c", "Gamma", 40 - NEAR_BEST - 0.5)];

  it("takes the best total (then the name) when nothing is known about usage", () => {
    expect(pickBalanced(ranked).pick?.aiId).toBe("a");
    expect(pickBalanced([cand("p", "Perplexity", 47), cand("g", "Gemini", 47)].sort((x, y) => x.name.localeCompare(y.name))).pick?.aiId).toBe("g");
  });

  it("with usage, takes the least used among those within the margin - never one that is clearly worse", () => {
    expect(pickBalanced(ranked, { a: { mission: 0, recent: 5 }, b: { mission: 0, recent: 0 } }).pick?.aiId).toBe("b");
    // Gamma is unused but is outside the margin
    expect(pickBalanced(ranked, { a: { mission: 3, recent: 9 }, b: { mission: 3, recent: 9 } }).pick?.aiId).not.toBe("c");
  });

  it("counts use inside this mission before use in the last day", () => {
    const usage = { a: { mission: 0, recent: 50 }, b: { mission: 1, recent: 0 } };
    expect(pickBalanced(ranked, usage).pick?.aiId).toBe("a");
  });

  it("falls back to the higher total, then the name, when usage is equal and fits are equal", () => {
    expect(pickBalanced(ranked, {}).pick?.aiId).toBe("a");
  });

  it("prefers the specialist (higher fit) among equals when usage is equal", () => {
    const withFit = (c: BrokerCandidate, fit: number): BrokerCandidate => ({ ...c, breakdown: { ...c.breakdown, fit } });
    const list = [withFit(cand("big", "Big", 40), 4), withFit(cand("spec", "Spec", 39), 5)];
    expect(pickBalanced(list, {}).pick?.aiId).toBe("spec");
  });

  it("breaks a real tie by the task, not always by the name", () => {
    const tied = [cand("g", "Gemini", 47), cand("p", "Perplexity", 47)];
    const picks = new Set(Array.from({ length: 30 }, (_, i) => pickBalanced(tied, {}, `task_${i}`).pick?.aiId));
    expect(picks).toEqual(new Set(["g", "p"])); // both get work
    expect(pickBalanced(tied, {}, "task_7").pick?.aiId).toBe(pickBalanced(tied, {}, "task_7").pick?.aiId); // the same task always decides the same way
  });
});

describe("the broker uses the recorded usage", () => {
  beforeEach(() => {
    for (const [id, name] of [["gemini", "Gemini (Web)"], ["perplexity", "Perplexity (Web)"]] as const) web(id, name, { research: 5 });
  });

  it("gives Perplexity the research work once Gemini has been used, and says why", () => {
    const broker = new AIBroker(store);
    expect(broker.select({ role: "research" }).selected?.aiId).toBe("gemini"); // nothing used yet: the name decides, as before
    run("gemini", 3);
    const d = broker.select({ role: "research" });
    expect(d.selected?.aiId).toBe("perplexity");
    expect(d.reason).toContain("同程度のAIが2件");
    expect(d.ranked[0].aiId).toBe("gemini"); // the ranking itself is still by score
  });

  it("counts the other tasks of the same mission first", () => {
    const mission = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    store.createTask({ projectId: "p1", missionId: mission.id, role: "research", selectedAi: "gemini", status: "completed" });
    const current = store.createTask({ projectId: "p1", missionId: mission.id, role: "research", status: "ready" });
    expect(new AIBroker(store).select(current).selected?.aiId).toBe("perplexity");
  });

  it("aiUsage counts runs of the last day and the tasks of the mission, and ignores old runs", () => {
    run("gemini", 2);
    const mission = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    store.createTask({ projectId: "p1", missionId: mission.id, role: "research", selectedAi: "perplexity", status: "completed" });
    const t = store.createTask({ projectId: "p1", missionId: mission.id, role: "research", selectedAi: "gemini", status: "ready" });
    expect(aiUsage(store, { missionId: mission.id, taskId: t.id })).toMatchObject({ gemini: { recent: 2, mission: 0 }, perplexity: { mission: 1 } });
    expect(aiUsage(store, { now: Date.now() + 25 * 3600_000 }).gemini?.recent ?? 0).toBe(0);
  });
});

describe("new roles", () => {
  it("maps idea work to ideation and fact checking to research", () => {
    for (const role of ["ideation", "brainstorm", "naming", "copywriting"]) expect(capabilityForTaskRole(role)).toBe("ideation");
    expect(capabilityForTaskRole("fact check")).toBe("research");
  });

  it("the one-time registry update adds ideation to scored services, keeps their other scores, and runs once", () => {
    web("pi", "Pi (Web)", { translation: 3, documentation: 3 }, 3);
    web("chatgpt", "ChatGPT (Web)", { research: 4, ideation: 1 });
    expect(applyIdeationCapability(store).sort()).toEqual(["pi"]); // chatgpt already has a value: left alone
    expect(store.getAiService("pi")?.capabilityScores).toEqual({ translation: 3, documentation: 3, ideation: IDEATION_SCORES.pi });
    expect(store.getAiService("chatgpt")?.capabilityScores.ideation).toBe(1);
    expect(applyIdeationCapability(store)).toEqual([]);
  });

  it("Pi is among the equally good AIs for idea work and gets its turns (its field outweighs a lower general quality)", () => {
    web("pi", "Pi (Web)", { ideation: 5 }, 3);
    web("chatgpt", "ChatGPT (Web)", { ideation: 4 }, 4.5);
    web("claude-web", "Claude (Web)", { ideation: 4 }, 5);
    const broker = new AIBroker(store);
    const first = broker.select({ role: "brainstorm" });
    expect(first.ranked.map((c) => c.aiId)).toEqual(expect.arrayContaining(["pi", "chatgpt", "claude-web"]));
    expect(first.selected?.aiId).toBe("pi"); // nothing used yet: the specialist
    run("pi", 3);
    expect(broker.select({ role: "brainstorm" }).selected?.aiId).not.toBe("pi"); // it takes turns once it has been used
  });
});

describe("who reviews", () => {
  beforeEach(() => {
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", automationLevel: 3, freeStatus: "free_tier" });
    web("chatgpt", "ChatGPT (Web)", { coding: 4.5, ux_review: 4.5 }, 4);
    web("qwen", "Qwen Chat (Web)", { coding: 4, ux_review: 2 }, 4);
    web("gemini", "Gemini (Web)", { ux_review: 3 }, 4);
    setWebAiSettings(store, { enabled: true, loggedIn: { chatgpt: true, qwen: true, gemini: true } });
  });

  it("looks for code skills when code was written, for a second opinion otherwise", () => {
    expect(reviewCapabilityFor("coding")).toBe("coding");
    expect(reviewCapabilityFor("implementation")).toBe("coding");
    expect(reviewCapabilityFor("design")).toBe("ux_review");
  });

  it("code reviews take turns between the AIs that are good at code (never the author's maker)", () => {
    expect(pickReviewer(store, "claude-code", "coding")?.svc.id).toBe("chatgpt");
    run("chatgpt", 4);
    expect(pickReviewer(store, "claude-code", "coding")?.svc.id).toBe("qwen");
    expect(pickReviewer(store, "claude-code", "coding")?.ranked).toEqual(expect.arrayContaining(["chatgpt", "qwen"]));
  });

  it("a text is still reviewed by the best second opinion", () => {
    run("chatgpt", 4);
    expect(pickReviewer(store, "claude-code", "design")?.svc.id).toBe("chatgpt"); // Gemini and Qwen are clearly behind: no turn-taking
  });

describe("bot checks and the level of automation", () => {
  it("rests a fully automatic AI that was checked, but not a semi-automatic one (the person is at its page and passes the check)", () => {
    web("full", "Full", { research: 5 });
    web("semi", "Semi", { research: 5 });
    store.patchAiService("semi", { automationLevel: 2 });
    for (const id of ["full", "semi"]) for (let i = 0; i < 3; i++) recordBotCheck(store, id);
    const d = new AIBroker(store).select({ role: "research" });
    expect(d.ranked.map((c) => c.aiId)).toContain("semi");
    expect(d.ranked.map((c) => c.aiId)).not.toContain("full");
    expect(d.excluded.find((e) => e.aiId === "full")?.reason).toContain("ボット確認");
  });
});
});
