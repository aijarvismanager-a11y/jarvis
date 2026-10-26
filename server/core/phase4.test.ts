import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { AIBroker, capabilityForTaskRole, chooseAi, costGuardReason } from "./aiBroker.ts";
import { seedRegistryProfiles } from "./aiRegistry.ts";
import { AiHealthChecker } from "./aiHealth.ts";
import { MissionEngine } from "./missionEngine.ts";
import { createOrchestratorRouter } from "./api.ts";
import type { Planner } from "./planner.ts";

let db: Db;
let store: Store;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  store.setSetting("allowManualTextAis", true); // these tests exercise the manual copy-and-paste path
});
afterEach(() => db.close());

function register() {
  store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code" });
  store.upsertAiService({ id: "claude-web", name: "Claude (Web)", url: "https://claude.ai" });
  store.upsertAiService({ id: "gemini", name: "Gemini (Web)", url: "https://gemini.google.com" });
  store.upsertAiService({ id: "mystery", name: "Mystery AI", url: "https://example.test" });
}

describe("AI registry seeding", () => {
  it("classifies registered services and leaves unknown ones unscored", () => {
    register();
    expect(seedRegistryProfiles(store).sort()).toEqual(["claude-code", "claude-web", "gemini"]);
    expect(store.getAiService("claude-code")).toMatchObject({ qualityScore: 5, automationLevel: 3, freeStatus: "free_tier", capabilityScores: { coding: 5 } });
    expect(store.getAiService("mystery")!.capabilities).toEqual([]);
    expect(store.listDecisions(null).some((d) => d.is_assumption === 1)).toBe(true);
  });

  it("does not overwrite anything already tuned, and is idempotent", () => {
    register();
    store.setCapabilities("gemini", { research: 1 });
    store.patchAiService("gemini", { qualityScore: 1 });
    expect(seedRegistryProfiles(store)).not.toContain("gemini");
    expect(store.getAiService("gemini")).toMatchObject({ qualityScore: 1, capabilityScores: { research: 1 } });
    expect(seedRegistryProfiles(store)).toEqual([]);
  });
});

describe("AI Broker", () => {
  beforeEach(() => {
    register();
    seedRegistryProfiles(store);
  });

  it("maps planner roles to capabilities", () => {
    expect(capabilityForTaskRole("Implementation")).toBe("coding");
    expect(capabilityForTaskRole("market research")).toBe("research");
    expect(capabilityForTaskRole("実装")).toBe("coding");
    expect(capabilityForTaskRole("whatever")).toBe("unclassified");
  });

  it("scores with the 4/3/2/1 weights and picks the highest total", () => {
    const d = new AIBroker(store).select({ role: "coding" });
    expect(d.selected?.aiId).toBe("claude-code");
    // fit 5*4 + quality 5*3 + automation 5*2 + safety 5 = 50
    expect(d.selected).toMatchObject({ total: 50, score10: 10, breakdown: { fit: 5, quality: 5, automation: 5, safety: 5 } });
    expect(d.ranked.map((c) => c.aiId)).toEqual(["claude-code", "claude-web"]);
    expect(d.excluded).toEqual([]);
  });

  it("only considers AIs that have the capability; unscored services never win", () => {
    const d = new AIBroker(store).select({ role: "research" });
    expect(d.ranked.map((c) => c.aiId)).not.toContain("mystery");
    // the CLI has the higher total (automation weight 2) but the two are within the "equally good" band: the specialist, the
    // better researcher, is taken (before the band existed the CLI won on total alone)
    expect(d.ranked[0].aiId).toBe("claude-code");
    expect(d.selected?.aiId).toBe("gemini");
    expect(d.alternatives.A?.aiId).toBe("gemini");
  });

  it("restricts to executable adapters", () => {
    const d = new AIBroker(store).select({ role: "research" }, { executableAdapters: ["claude-code"] });
    expect(d.selected?.aiId).toBe("claude-code");
    expect(d.excluded.some((e) => e.aiId === "gemini" && e.reason.includes("実行できない"))).toBe(true);
    expect(new AIBroker(store).select({ role: "translation" }, { executableAdapters: ["claude-code"] }).selected).toBeNull();
  });

  it("Cost Guard blocks paid / API-key services unless allow_paid", () => {
    store.upsertAiService({ id: "paid-api", name: "Paid API", adapterType: "api", accessMode: "api", freeStatus: "paid", requiresApiKey: true });
    store.setCapabilities("paid-api", { coding: 5 });
    store.patchAiService("paid-api", { qualityScore: 5 });
    const blocked = new AIBroker(store).select({ role: "coding" });
    expect(blocked.ranked.map((c) => c.aiId)).not.toContain("paid-api");
    expect(blocked.excluded.find((e) => e.aiId === "paid-api")?.reason).toContain("Cost Guard");
    expect(new AIBroker(store).select({ role: "coding" }, { budgetPolicy: "allow_paid" }).ranked.map((c) => c.aiId)).toContain("paid-api");
    expect(costGuardReason({ freeStatus: "free", requiresApiKey: true }, "free_only")).toContain("APIキー");
    expect(costGuardReason({ freeStatus: "free_tier", requiresApiKey: false }, "free_only")).toBeNull();
  });

  it("excludes unavailable services", () => {
    store.patchAiService("claude-code", { status: "unavailable" });
    const d = new AIBroker(store).select({ role: "coding" });
    expect(d.selected?.aiId).toBe("claude-web");
    expect(d.excluded[0]).toMatchObject({ aiId: "claude-code" });
  });

  it("returns confidence in the spec's bands and flags low confidence", () => {
    const strong = new AIBroker(store).select({ role: "coding" });
    expect(strong.confidence).toBeGreaterThan(0.7);
    expect(strong.confidence).toBeLessThanOrEqual(1);
    const unclassified = new AIBroker(store).select({ role: "whatever" });
    expect(unclassified.confidence).toBeLessThanOrEqual(0.6);
    expect(unclassified.confidenceLabel).toBe("low");
    expect(unclassified.needsReview).toBe(true);
    expect(chooseAi([], "coding")).toMatchObject({ selected: null, confidence: 0, needsReview: false });
  });

  it("verification raises confidence", () => {
    const before = new AIBroker(store).select({ role: "coding" }).confidence;
    store.patchAiService("claude-code", { lastVerifiedAt: new Date().toISOString() });
    expect(new AIBroker(store).select({ role: "coding" }).confidence).toBeGreaterThan(before);
  });

  it("offers A/B/C alternatives", () => {
    const d = new AIBroker(store).select({ role: "research" });
    expect(d.alternatives.A?.aiId).toBeTruthy();
    expect(d.alternatives.B?.aiId).toBe("claude-code"); // highest automation
    expect(d.alternatives.C).not.toBeNull();
  });
});

describe("AI health check", () => {
  const ok = (status = 200) => (async () => new Response("", { status })) as unknown as typeof fetch;
  const down = (async () => {
    throw new Error("ENOTFOUND");
  }) as unknown as typeof fetch;
  const cli = (code: number | null) => async () => ({ stdout: "2.1.0 (Claude Code)\n", stderr: "", code });

  beforeEach(register);

  it("marks reachable services verified and treats a 403 as up", async () => {
    const checker = new AiHealthChecker(store, { fetchImpl: ok(403), runner: cli(0), now: () => new Date("2026-10-23T00:00:00Z") });
    const results = await checker.checkAll();
    expect(results.find((r) => r.aiId === "gemini")).toMatchObject({ healthy: true });
    expect(store.getAiService("gemini")).toMatchObject({ status: "active", lastVerifiedAt: "2026-10-23T00:00:00.000Z" });
    expect(store.getAiService("claude-code")!.lastVerifiedAt).not.toBeNull();
  });

  it("never claims login / free status was verified", async () => {
    const [r] = await new AiHealthChecker(store, { fetchImpl: ok(), runner: cli(0) }).checkAll(["gemini"]);
    expect(r.checks.filter((c) => c.name === "login" || c.name === "free_status").every((c) => c.status === "unverified")).toBe(true);
  });

  it("marks a service down on a 5xx while others stay up", async () => {
    const fetchImpl = (async (url: string) => new Response("", { status: String(url).includes("gemini") ? 503 : 200 })) as unknown as typeof fetch;
    await new AiHealthChecker(store, { fetchImpl, runner: cli(0) }).checkAll();
    expect(store.getAiService("gemini")!.status).toBe("unavailable");
    expect(store.getAiService("claude-web")!.status).toBe("active");
  });

  it("does not mark everything unavailable when the machine looks offline", async () => {
    await new AiHealthChecker(store, { fetchImpl: down, runner: cli(0) }).checkAll();
    expect(store.listAiServices().filter((s) => s.status === "unavailable")).toEqual([]);
  });

  it("marks the CLI unavailable when the binary is missing", async () => {
    const runner = async () => {
      throw new Error("spawn claude ENOENT");
    };
    await new AiHealthChecker(store, { fetchImpl: ok(), runner }).checkAll(["claude-code"]);
    expect(store.getAiService("claude-code")!.status).toBe("unavailable");
  });
});

describe("Mission Engine picks the AI", () => {
  const planner: Planner = {
    name: "p",
    plan: async () => ({ summary: "", tasks: [{ key: "a", role: "coding", objective: "build", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }),
  };

  it("records selected_ai, an event and a decision before the task runs", async () => {
    register();
    seedRegistryProfiles(store);
    store.createProject({ id: "p1", name: "p" });
    const seen: (string | null)[] = [];
    const engine = new MissionEngine(store, {
      planner,
      executor: {
        name: "fake",
        adapterTypes: ["claude-code"],
        execute: async (task) => {
          seen.push(task.selectedAi);
          return { ok: true };
        },
      },
      broker: new AIBroker(store),
    });
    const { mission } = await engine.createMission({ projectId: "p1", goal: "g" });
    engine.approvePlan("p1", mission.id);
    expect(await engine.run("p1", mission.id)).toBe("completed");
    expect(seen).toEqual(["claude-code"]);
    expect(store.listEvents({ projectId: "p1" }).some((e) => e.type === "AI_SELECTED")).toBe(true);
    expect(store.listDecisions("p1").some((d) => String(d.title).startsWith("AI選定"))).toBe(true);
  });

  it("still runs the task when the Broker has no candidate or throws", async () => {
    store.createProject({ id: "p1", name: "p" });
    const broken = { select: () => { throw new Error("boom"); } } as unknown as AIBroker;
    for (const broker of [new AIBroker(store), broken]) {
      const engine = new MissionEngine(store, { planner, executor: { name: "fake", adapterTypes: ["claude-code"], execute: async () => ({ ok: true }) }, broker });
      const { mission } = await engine.createMission({ projectId: "p1", goal: "g" });
      engine.approvePlan("p1", mission.id);
      expect(await engine.run("p1", mission.id)).toBe("completed");
    }
  });
});

describe("registry / broker API", () => {
  let server: http.Server;
  let base: string;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  async function boot(withChecker: boolean) {
    register();
    seedRegistryProfiles(store);
    const engine = new MissionEngine(store, { planner: { name: "p", plan: async () => ({ summary: "", tasks: [] }) }, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v2",
      createOrchestratorRouter({
        store,
        engine,
        canExecute: true,
        tokenMatches: (c) => c === "tok",
        healthChecker: withChecker ? new AiHealthChecker(store, { fetchImpl: (async () => new Response("")) as unknown as typeof fetch, runner: async () => ({ stdout: "1", stderr: "", code: 0 }) }) : undefined,
        executableAdapters: ["claude-code"],
      }),
    );
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
  }

  it("lists the registry and previews a Broker decision (read-only)", async () => {
    await boot(true);
    const list = (await (await fetch(`${base}/ai-services`)).json()) as { services: { id: string }[] };
    expect(list.services.map((s) => s.id)).toContain("claude-code");
    const preview = (await (await fetch(`${base}/broker/preview?role=coding`)).json()) as { capability: string; decision: { selected: { aiId: string } } };
    expect(preview).toMatchObject({ capability: "coding", decision: { selected: { aiId: "claude-code" } } });
    expect((await fetch(`${base}/broker/preview`)).status).toBe(400);
  });

  it("health-check needs the token and a wired checker", async () => {
    await boot(true);
    const post = (token?: string) => fetch(`${base}/ai-services/health-check`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-orchestrator-token": token } : {}) }, body: "{}" });
    expect((await post()).status).toBe(403);
    const res = await post("tok");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { results: unknown[] }).results.length).toBeGreaterThan(0);
  });

  it("health-check answers 501 without a checker", async () => {
    await boot(false);
    const res = await fetch(`${base}/ai-services/health-check`, { method: "POST", headers: { "content-type": "application/json", "x-orchestrator-token": "tok" }, body: "{}" });
    expect(res.status).toBe(501);
  });
});
