import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { WebAiBrowserError, type WebChatDriver } from "./browserDriver.ts";
import { WebAiExecutor } from "./webAiExecutor.ts";
import { WebHandoffHub } from "./webHandoff.ts";

let db: Db;
let store: Store;
let root: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "downgrade-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
  store.upsertAiService({ id: "chatgpt", name: "ChatGPT (Web)", url: "https://chatgpt.test", accessMode: "web", adapterType: "manual", automationLevel: 3, freeStatus: "free_tier" });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const failing = (make: () => Error): WebChatDriver => ({ open: async () => { throw make(); }, shutdown: async () => {} });

async function askThreeTimes(driver: WebChatDriver) {
  const mission = store.createMission({ projectId: "p1", goal: "g", status: "running" });
  const task = store.createTask({ projectId: "p1", missionId: mission.id, role: "design", objective: "x", status: "running" });
  const web = new WebAiExecutor(store, new WebHandoffHub(store), { driver });
  const svc = store.getAiService("chatgpt")!;
  for (let i = 0; i < 3; i++) await web.ask({ svc, prompt: "hi", task, signal: new AbortController().signal });
}

describe("lowering an AI's automation level", () => {
  it("does not count a browser that could not be started (a window using the profile, no browser installed)", async () => {
    await askThreeTimes(failing(() => new WebAiBrowserError("ブラウザが起動直後に終了しました")));
    expect(store.getAiService("chatgpt")?.automationLevel).toBe(3);
    expect(store.listEvents({ projectId: "p1" }).some((e) => e.type === "AUTOMATION_DOWNGRADED")).toBe(false);
  });

  it("still lowers it when the site itself keeps breaking", async () => {
    await askThreeTimes(failing(() => new Error("プロンプト入力欄が見つかりません")));
    expect(store.getAiService("chatgpt")?.automationLevel).toBeLessThan(3);
  });
});
