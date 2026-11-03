import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { AiScout, parseCandidates } from "./aiScout.ts";

let db: Db;
let store: Store;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  store.upsertAiService({ id: "asker", name: "Asker", url: "https://asker.example.test", adapterType: "manual" });
});
afterEach(() => db.close());

const ANSWER = `はい、候補です。
\`\`\`json
[
 {"name":"Alpha AI","url":"https://alpha.example.test","use":"コード作成","provider":"Alpha","googleLogin":true,"free":true},
 {"name":"Beta AI","url":"https://beta.example.test","use":"画像生成","provider":"Beta","googleLogin":false,"free":true},
 {"name":"Gamma AI","url":"https://gamma.example.test","use":"動画生成","provider":"Gamma","googleLogin":false,"free":true},
 {"name":"Dead AI","url":"https://dead.example.test","use":"調べもの","googleLogin":true,"free":true},
 {"name":"Bad","url":"http://insecure.test","googleLogin":true}
]
\`\`\``;

const pages: Record<string, string | undefined> = {
  "alpha.example.test": "<html><body>Alpha Free plan. Continue with Google to start.</body></html>",
  "beta.example.test": "<html><body>Beta: sign in with email only.</body></html>",
  "gamma.example.test": "<html><body>Gamma: Sign in with Google. Free tier available.</body></html>",
};
const fetchFake = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = pages[url.hostname];
  if (body === undefined) throw new Error("ECONNREFUSED");
  return new Response(body, { status: 200 });
}) as unknown as typeof fetch;

const make = (text: string | null) => {
  const ai = store.listAiServices()[0]!;
  return new AiScout(store, { asker: { ask: async () => (text === null ? { ok: false as const, error: "down" } : { ok: true as const, text }) }, fetchImpl: fetchFake, pick: () => ai, now: () => new Date("2026-11-03T00:00:00Z") });
};

describe("parseCandidates", () => {
  it("reads the array out of chatter and drops entries without an https url", () => {
    const c = parseCandidates(ANSWER);
    expect(c.map((x) => x.name)).toEqual(["Alpha AI", "Beta AI", "Gamma AI", "Dead AI"]);
    expect(parseCandidates("no json here")).toEqual([]);
  });
  it("falls back to the links of a plain-list answer, claiming nothing about login or price", () => {
    const c = parseCandidates("1. [Zeta](https://zeta.example/app) - コード\n2. https://www.omega.example/. 画像\n3. https://zeta.example/other");
    expect(c.map((x) => [x.name, x.url, x.googleLogin, x.free])).toEqual([["Zeta", "https://zeta.example/app", false, false], ["omega.example", "https://www.omega.example/", false, false]]);
  });
});

describe("AiScout", () => {
  it("proposes only reachable sites that show or claim a Google sign-in, and never re-proposes", async () => {
    const scout = make(ANSWER);
    const st = await scout.run();
    expect(st.proposals.map((p) => [p.id, p.googleLogin])).toEqual([["alpha-ai", "page"], ["gamma-ai", "page"]]);
    expect(st.lastNote).toContain("2件");
    expect(scout.due()).toBe(false);
    const again = await scout.run();
    expect(again.proposals).toHaveLength(2); // same answer: nothing new
    expect(again.lastNote).toContain("登録済みか前に出した候補");
  });

  it("adds an accepted proposal to the registry as a manual AI, and keeps a dropped one out", async () => {
    const scout = make(ANSWER);
    await scout.run();
    expect(scout.accept("alpha-ai")?.status).toBe("added");
    const svc = store.getAiService("alpha-ai");
    expect(svc).toMatchObject({ adapterType: "manual", automationLevel: 1 });
    expect(scout.dismiss("gamma-ai")).toBe(true);
    expect(scout.accept("gamma-ai")).toBeNull();
    await scout.run();
    expect(scout.state().proposals.filter((p) => p.id === "gamma-ai")).toHaveLength(1);
  });

  it("stays due when there is nobody to ask yet", async () => {
    const scout = new AiScout(store, { asker: { ask: async () => ({ ok: false as const, error: "x" }) }, fetchImpl: fetchFake, pick: () => null });
    expect((await scout.run()).lastNote).toContain("探せるAIがありません");
    expect(scout.due()).toBe(true);
  });

  it("reports when the asked AI is down or the answer cannot be read", async () => {
    expect((await make(null).run()).lastNote).toContain("聞けませんでした");
    expect((await make("すみません、分かりません").run()).lastNote).toContain("読み取れません");
  });
});
