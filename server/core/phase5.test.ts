import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { seedRegistryProfiles } from "./aiRegistry.ts";
import { chooseAi } from "./aiBroker.ts";
import { AiDiscovery, CatalogSource, judgeFreeStatus, type RawCandidate } from "./aiDiscovery.ts";
import { MissionEngine } from "./missionEngine.ts";
import { createOrchestratorRouter } from "./api.ts";

let db: Db;
let store: Store;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  store.setSetting("allowManualTextAis", true); // these tests exercise the manual copy-and-paste path
});
afterEach(() => db.close());

const FREE_PAGE = "<html><body><h1>Pricing</h1><p>Free plan: 20 messages per day. Pro plan $20 per month for higher limits and priority access.</p></body></html>";
const PAID_PAGE = "<html><body><p>Subscribe for $30 per month. Pro plan includes everything. No other plans are offered at this time.</p></body></html>";
const API_PAGE = "<html><body><p>Create an API key. Pricing is $2 per 1M tokens, pay as you go, billed monthly to your account.</p></body></html>";
const BLANK_PAGE = "<html><body>Loading</body></html>";

const cand = (over: Partial<RawCandidate> & { id: string }): RawCandidate => ({ name: over.id, url: `https://${over.id}.example.test`, capabilities: { translation: 4 }, ...over });

/** fetch fake: host -> body (undefined = unreachable) */
function fakeFetch(pages: Record<string, string | undefined>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = pages[url.hostname];
    if (body === undefined) throw new Error("ECONNREFUSED");
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

const fixedNow = () => new Date("2026-10-23T00:00:00.000Z");

describe("judgeFreeStatus", () => {
  it("separates a free tier from paid-only, API-only, trial-only and unreadable pages", () => {
    expect(judgeFreeStatus(FREE_PAGE)).toMatchObject({ status: "free_tier", requiresApiKey: false });
    expect(judgeFreeStatus(FREE_PAGE).evidence).toContain("Free plan");
    expect(judgeFreeStatus(PAID_PAGE).status).toBe("paid");
    expect(judgeFreeStatus(API_PAGE)).toMatchObject({ status: "paid", requiresApiKey: true });
    expect(judgeFreeStatus("<p>Start your free trial today. After the trial, plans are billed on a regular basis to your card.</p>").status).toBe("trial");
    expect(judgeFreeStatus(BLANK_PAGE)).toMatchObject({ status: "unknown", evidence: null });
  });

  it("ignores script and style content", () => {
    const html = `<style>.free{}</style><script>var free = "無料"</script><p>${"Plans and billing information. ".repeat(3)}Subscribe for $9 per month.</p>`;
    expect(judgeFreeStatus(html).status).toBe("paid");
  });
});

describe("AiDiscovery", () => {
  beforeEach(() => {
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", adapterType: "claude-code", url: "https://claude.ai" });
    store.upsertAiService({ id: "gemini", name: "Gemini (Web)", url: "https://gemini.google.com" });
    seedRegistryProfiles(store);
  });

  const make = (pages: Record<string, string | undefined>, cands: RawCandidate[]) => new AiDiscovery(store, { fetchImpl: fakeFetch(pages), sources: [new CatalogSource(cands)], now: fixedNow });

  it("does nothing when the registry already covers the capability", async () => {
    const d = make({}, [cand({ id: "x", capabilities: { research: 5 } })]);
    const r = await d.discover({ requiredCapabilities: ["research"] });
    expect(r.source).toBe("registry");
    expect(r.existing.length).toBeGreaterThan(0);
    expect(r.candidates).toEqual([]);
  });

  it("discovers, evaluates and saves a qualifying candidate", async () => {
    const ok = await make({ "good.example.test": FREE_PAGE }, [cand({ id: "good", capabilities: { ocr: 4 } })]).discover({ requiredCapabilities: ["ocr"], save: true });
    expect(ok.source).toBe("web");
    expect(ok.candidates.map((c) => c.raw.id)).toEqual(["good"]);
    expect(ok.saved).toEqual(["good"]);
    expect(store.getAiService("good")).toMatchObject({
      status: "active",
      freeStatus: "free_tier",
      adapterType: "manual",
      automationLevel: 1,
      lastVerifiedAt: "2026-10-23T00:00:00.000Z",
      capabilityScores: { ocr: 4 },
    });
    expect(store.getAiService("good")!.freeLimit).toContain("Free plan");
    expect(store.listDecisions(null).some((d2) => String(d2.title).includes("AI Discovery") && d2.is_assumption === 1)).toBe(true);
  });

  it("does not save without save:true, and a saved AI is found in the registry next time", async () => {
    const d = make({ "good.example.test": FREE_PAGE }, [cand({ id: "good", capabilities: { ocr: 4 } })]);
    const dry = await d.discover({ requiredCapabilities: ["ocr"] });
    expect(dry.candidates).toHaveLength(1);
    expect(store.getAiService("good")).toBeNull();
    await d.discover({ requiredCapabilities: ["ocr"], save: true });
    expect((await d.discover({ requiredCapabilities: ["ocr"] })).source).toBe("registry");
  });

  it("rejects paid, API-key, unreachable and unverifiable candidates when free is required", async () => {
    const caps = { ocr: 4 };
    const d = make(
      { "paid.example.test": PAID_PAGE, "api.example.test": API_PAGE, "blank.example.test": BLANK_PAGE, "down.example.test": undefined },
      [cand({ id: "paid", capabilities: caps }), cand({ id: "api", capabilities: caps }), cand({ id: "blank", capabilities: caps }), cand({ id: "down", capabilities: caps })],
    );
    const r = await d.discover({ requiredCapabilities: ["ocr"], save: true });
    expect(r.candidates).toEqual([]);
    expect(r.saved).toEqual([]);
    const why = Object.fromEntries(r.rejected.map((c) => [c.raw.id, c.rejectedBecause.join("|")]));
    expect(why.api).toContain("APIキー");
    expect(why.paid).toContain("無料条件");
    expect(why.blank).toContain("unknown");
    expect(why.down).toContain("アクセスできない");
    expect(store.listAiServices().map((s) => s.id).sort()).toEqual(["claude-code", "gemini"]);
  });

  it("allows paid candidates only when free is not required (still never API-key ones)", async () => {
    const caps = { ocr: 4 };
    const d = make({ "paid.example.test": PAID_PAGE, "api.example.test": API_PAGE }, [cand({ id: "paid", capabilities: caps }), cand({ id: "api", capabilities: caps })]);
    const r = await d.discover({ requiredCapabilities: ["ocr"], freeRequired: false });
    expect(r.candidates.map((c) => c.raw.id)).toEqual(["paid"]);
  });

  it("filters by language, ranks by fit and returns at most three", async () => {
    const pages = Object.fromEntries(["a", "b", "c", "d"].map((id) => [`${id}.example.test`, FREE_PAGE]));
    const d = make(pages, [
      cand({ id: "a", capabilities: { ocr: 3 }, languages: ["ja"] }),
      cand({ id: "b", capabilities: { ocr: 5 }, languages: ["ja"] }),
      cand({ id: "c", capabilities: { ocr: 4 }, languages: ["ja"] }),
      cand({ id: "d", capabilities: { ocr: 5 }, languages: ["en"] }),
    ]);
    const r = await d.discover({ requiredCapabilities: ["ocr"], language: "ja" });
    expect(r.candidates.map((c) => c.raw.id)).toEqual(["b", "c", "a"]);
    expect(r.rejected.map((c) => c.raw.id)).toEqual(["d"]);
  });

  it("skips candidates already registered (by id or host) and survives a failing source", async () => {
    const d = new AiDiscovery(store, {
      fetchImpl: fakeFetch({ "gemini.google.com": FREE_PAGE, "new.example.test": FREE_PAGE }),
      sources: [
        { name: "broken", find: async () => Promise.reject(new Error("down")) },
        new CatalogSource([cand({ id: "gemini-clone", url: "https://www.gemini.google.com", capabilities: { ocr: 5 } }), cand({ id: "new", capabilities: { ocr: 4 } })]),
      ],
      now: fixedNow,
    });
    const r = await d.discover({ requiredCapabilities: ["ocr"] });
    expect(r.candidates.map((c) => c.raw.id)).toEqual(["new"]);
  });

  it("a saved candidate is usable by the Broker for its capability but never an executable adapter", async () => {
    await make({ "good.example.test": FREE_PAGE }, [cand({ id: "good", capabilities: { ocr: 4 } })]).discover({ requiredCapabilities: ["ocr"], save: true });
    expect(chooseAi(store.listAiServices(), "ocr", { allowManualText: true }).selected?.aiId).toBe("good");
    const executable = chooseAi(store.listAiServices(), "ocr", { allowManualText: true, executableAdapters: ["claude-code"] });
    expect(executable.selected).toBeNull();
    expect(executable.excluded.map((e) => e.aiId)).toContain("good");
  });
});

describe("POST /ai-discovery", () => {
  let server: http.Server;
  let base: string;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  async function boot(withDiscovery: boolean) {
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
        discovery: withDiscovery ? new AiDiscovery(store, { fetchImpl: fakeFetch({ "good.example.test": FREE_PAGE }), sources: [new CatalogSource([cand({ id: "good", capabilities: { ocr: 4 } })])], now: fixedNow }) : undefined,
      }),
    );
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
  }
  const post = (body: unknown, token?: string) => fetch(`${base}/ai-discovery`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-orchestrator-token": token } : {}) }, body: JSON.stringify(body) });

  it("needs the token, validates input, and answers 501 without a discovery module", async () => {
    await boot(true);
    expect((await post({ requiredCapabilities: ["ocr"] })).status).toBe(403);
    expect((await post({ requiredCapabilities: [] }, "tok")).status).toBe(400);
    await new Promise<void>((r) => server.close(() => r()));
    await boot(false);
    expect((await post({ requiredCapabilities: ["ocr"] }, "tok")).status).toBe(501);
  });

  it("returns candidates and persists them on save", async () => {
    await boot(true);
    const res = await post({ requiredCapabilities: ["ocr"], save: true }, "tok");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: "web", saved: ["good"] });
    expect(store.getAiService("good")).not.toBeNull();
  });
});
