import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import type { WebChatDriver, WebChatPage } from "./browserDriver.ts";
import { WebAiExecutor } from "./webAiExecutor.ts";
import { WebHandoffHub } from "./webHandoff.ts";
import { setWebAiSettings } from "./webAiSites.ts";

// A sign-in window of the person's holds the browser profile: the task waits (visibly), does not fail, is not handed to a person
// and does not lower the AI's level, and goes on by itself once the window is closed.

let db: Db;
let store: Store;
let root: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "profilewait-"));
  store = new Store(db, root);
  store.createProject({ id: "p1", name: "p" });
  store.upsertAiService({ id: "chatgpt", name: "ChatGPT (Web)", url: "https://chatgpt.test", accessMode: "web", adapterType: "manual", automationLevel: 3, freeStatus: "free_tier" });
  setWebAiSettings(store, { enabled: true, loggedIn: { chatgpt: true } });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const page: WebChatPage = {
  fillPrompt: async () => {},
  submit: async () => {},
  waitForResponse: async () => "回答の本文です。",
  close: async () => {},
};

function setup(busyPolls: number) {
  let polls = 0;
  let opened = 0;
  const driver: WebChatDriver = {
    profileBusy: async () => ++polls <= busyPolls,
    open: async () => {
      opened += 1;
      return page;
    },
    shutdown: async () => {},
  };
  const web = new WebAiExecutor(store, new WebHandoffHub(store), { driver, profilePollMs: 10, profileWaitMs: 5000 });
  const mission = store.createMission({ projectId: "p1", goal: "g", status: "running" });
  const task = store.createTask({ projectId: "p1", missionId: mission.id, role: "design", objective: "設計", expectedOutputs: ["design/a.md"], selectedAi: "chatgpt", status: "running" });
  return { web, mission, task, opened: () => opened };
}

describe("a sign-in window holds the browser profile", () => {
  it("waits, then continues at full automation once the window is closed", async () => {
    const { web, mission, task, opened } = setup(4);
    const result = await web.execute(task, { mission, signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    expect(result.automationLevel).toBe(3);
    expect(opened()).toBe(1);
    const types = store.listEvents({ projectId: "p1" }).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["WEB_PROFILE_BUSY", "WEB_PROFILE_FREED"]));
    expect(types).not.toContain("WEB_HANDOFF_REQUESTED");
    expect(types).not.toContain("AUTOMATION_DOWNGRADED");
    expect(store.getAiService("chatgpt")?.automationLevel).toBe(3);
    expect(store.getTask("p1", task.id)?.status).toBe("running");
  });

  it("does not wait at all when no such window is open", async () => {
    const { web, mission, task } = setup(0);
    const result = await web.execute(task, { mission, signal: new AbortController().signal });
    expect(result.ok).toBe(true);
    expect(store.listEvents({ projectId: "p1" }).some((e) => e.type === "WEB_PROFILE_BUSY")).toBe(false);
  });

  it("tells the screen that a window is open and a task is waiting, and can be paused", async () => {
    const { web, mission, task } = setup(1_000_000);
    const controller = new AbortController();
    const running = web.execute(task, { mission, signal: controller.signal });
    let status = await web.browserStatus();
    for (let i = 0; i < 100 && status.waiting === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      status = await web.browserStatus();
    }
    expect(status).toEqual({ loginWindowOpen: true, waiting: 1 });
    expect(store.getTask("p1", task.id)?.status).toBe("waiting");
    controller.abort();
    expect(await running).toMatchObject({ ok: false, summary: "中断されました" });
    expect((await web.browserStatus()).waiting).toBe(0);
  });
});
