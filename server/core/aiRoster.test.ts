import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { AiRoster } from "./aiRoster.ts";

let db: Db;
let store: Store;
beforeEach(() => {
  db = openDatabase(":memory:");
  store = new Store(db, "unused");
  for (const id of ["a", "b", "c"]) store.upsertAiService({ id, name: id.toUpperCase(), url: `https://${id}.test`, accessMode: "web", automationLevel: 1, adapterType: "manual", capabilities: ["research"] });
});
afterEach(() => db.close());

const roster = (gone: string[], probe = async () => ({ ok: false as const, reason: "x" })) =>
  new AiRoster(store, { probe, fetchImpl: (async (url: string) => { if (gone.some((g) => String(url).includes(g))) return { status: 404 }; return { status: 200 }; }) as unknown as typeof fetch });

describe("AI roster", () => {
  it("takes a site out only after two checks in a row, keeps its record, and puts it back", async () => {
    const r = roster(["a.test"]);
    await r.run();
    expect(store.getAiService("a")).not.toBeNull();
    await r.run();
    expect(store.getAiService("a")).toBeNull();
    expect(r.state().removed[0]!.service.id).toBe("a");
    expect(r.restore("a")).toBe(true);
    expect(store.getAiService("a")).toMatchObject({ name: "A", capabilities: ["research"] });
    expect(r.state().removed).toHaveLength(0);
  });

  it("removes nothing when every site looks gone (the network is down)", async () => {
    const r = roster(["a.test", "b.test", "c.test"]);
    await r.run();
    await r.run();
    expect(store.listAiServices()).toHaveLength(3);
  });

  it("a site that answers again clears its first strike", async () => {
    let gone = true;
    const r = new AiRoster(store, { probe: async () => ({ ok: false, reason: "x" }), fetchImpl: (async (url: string) => ({ status: gone && String(url).includes("a.test") ? 404 : 200 })) as unknown as typeof fetch });
    await r.run();
    gone = false;
    await r.run();
    gone = true;
    await r.run();
    expect(store.getAiService("a")).not.toBeNull();
  });
});
