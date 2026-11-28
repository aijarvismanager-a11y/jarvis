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
import { createOrchestratorRouter } from "./api.ts";
import { WebHandoffHub } from "./webHandoff.ts";
import { WebAiExecutor } from "./webAiExecutor.ts";

let db: Db;
let store: Store;
let root: string;
const pid = "p1";

beforeEach(() => {
  db = openDatabase(":memory:");
  root = mkdtempSync(path.join(os.tmpdir(), "handoff-reassign-"));
  store = new Store(db, root);
  store.setSetting("allowManualTextAis", true); // these tests exercise the manual copy-and-paste path
  store.createProject({ id: pid, name: "p" });
  store.upsertAiService({ id: "gemini", name: "Gemini (Web)", url: "https://gemini.test", freeStatus: "free" });
  store.upsertAiService({ id: "chatgpt", name: "ChatGPT (Web)", url: "https://chatgpt.test", freeStatus: "free" });
  store.upsertAiService({ id: "paid-ai", name: "Paid", url: "https://paid.test", freeStatus: "paid" });
  store.upsertAiService({ id: "keyed", name: "Needs key", url: "https://keyed.test", requiresApiKey: true });
  store.upsertAiService({ id: "claude-code", name: "Claude Code", accessMode: "cli", adapterType: "claude-code" });
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function pendingHandoff(hub: WebHandoffHub, aiId?: string) {
  for (let i = 0; i < 600; i++) {
    const h = hub.list({ status: "pending" }).find((x) => !aiId || x.aiId === aiId);
    if (h) return h;
    await tick();
  }
  throw new Error("no pending handoff");
}
function makeTask(): Task {
  const m = store.createMission({ projectId: pid, goal: "目標", status: "running" });
  return store.createTask({ projectId: pid, missionId: m.id, role: "research", objective: "市場調査", selectedAi: "gemini", status: "running", expectedOutputs: ["research/market.md"] });
}
const ctxFor = (task: Task) => ({ mission: store.getMission(pid, task.missionId)!, signal: new AbortController().signal });

describe("reassigning a handoff to another web AI", () => {
  it("moves the task to the chosen AI, opens a new handoff there, and records who finally answered", async () => {
    const hub = new WebHandoffHub(store);
    const task = makeTask();
    const run = new WebAiExecutor(store, hub).execute(task, ctxFor(task));

    const first = await pendingHandoff(hub, "gemini");
    hub.reassign(first.id, "chatgpt");
    const second = await pendingHandoff(hub, "chatgpt");
    expect(second.taskId).toBe(task.id);
    expect(store.getTask(pid, task.id)!.selectedAi).toBe("chatgpt");
    hub.submit(second.id, "# 市場\nChatGPTの回答");

    expect(await run).toMatchObject({ ok: true, aiId: "chatgpt" });
    expect(hub.get(first.id)).toMatchObject({ status: "skipped", reassignTo: "chatgpt" });
    expect(store.listEvents({ projectId: pid }).some((e) => e.type === "AI_REASSIGNED")).toBe(true);
  });

  it("cannot reassign a handoff that was already answered", () => {
    const hub = new WebHandoffHub(store);
    const h = hub.request({ projectId: pid, taskId: "t1", aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    hub.submit(h.id, "done");
    expect(() => hub.reassign(h.id, "chatgpt")).toThrow("処理済み");
  });
});

describe("handoff API", () => {
  let server: http.Server;
  let base: string;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));
  async function boot() {
    const hub = new WebHandoffHub(store);
    const engine = new MissionEngine(store, { planner: { name: "p", plan: async () => ({ summary: "", tasks: [] }) }, executor: { name: "x", execute: async () => ({ ok: true }) } });
    const app = express();
    app.use(express.json());
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: true, tokenMatches: (c) => c === "tok", webAi: { hub, browserAvailable: () => false } }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    return hub;
  }
  const send = (method: string, url: string, body?: unknown) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", "x-orchestrator-token": "tok" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("does not offer a picture maker for written work", async () => {
    store.upsertAiService({ id: "painter", name: "Painter", url: "https://painter.test", freeStatus: "free", capabilities: ["image_generation"] });
    const hub = await boot();
    const task = makeTask();
    hub.request({ projectId: pid, taskId: task.id, aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    const listed = ((await (await fetch(`${base}/web-handoffs?status=pending`)).json()) as { handoffs: { alternatives: { id: string }[] }[] }).handoffs;
    expect(listed[0]!.alternatives.map((a) => a.id)).toEqual(["chatgpt"]);
  });

  it("lists only free, key-less web AIs as alternatives, and refuses to switch to any other", async () => {
    const hub = await boot();
    const h = hub.request({ projectId: pid, taskId: "t1", aiId: "gemini", aiName: "G", url: null, level: 1, prompt: "P", note: null });
    const listed = ((await (await fetch(`${base}/web-handoffs?status=pending`)).json()) as { handoffs: { alternatives: { id: string }[] }[] }).handoffs;
    expect(listed[0]!.alternatives.map((a) => a.id)).toEqual(["chatgpt"]);

    expect((await send("POST", `/web-handoffs/${h.id}/reassign`, { aiId: "paid-ai" })).status).toBe(400);
    expect((await send("POST", `/web-handoffs/${h.id}/reassign`, { aiId: "keyed" })).status).toBe(400);
    expect((await send("POST", `/web-handoffs/${h.id}/reassign`, { aiId: "claude-code" })).status).toBe(400);
    expect((await send("POST", `/web-handoffs/${h.id}/reassign`, { aiId: "chatgpt" })).status).toBe(200);
    expect(hub.get(h.id)?.reassignTo).toBe("chatgpt");
  });
});
