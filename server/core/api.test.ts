import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import type { Planner } from "./planner.ts";
import { createOrchestratorRouter } from "./api.ts";

const TOKEN = "tok";
let db: Db;
let store: Store;
let server: http.Server;
let base: string;
let projectsRoot = "unused";

const planner: Planner = {
  name: "scripted",
  plan: async () => ({ summary: "", tasks: [{ key: "a", role: "research", objective: "a", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] }),
};

async function boot(canExecute: boolean) {
  db = openDatabase(":memory:");
  store = new Store(db, projectsRoot);
  store.createProject({ id: "p1", name: "p" });
  const engine = new MissionEngine(store, { planner, executor: { name: "ok", execute: async () => ({ ok: true }) } });
  const app = express();
  app.use(express.json());
  app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute, tokenMatches: (c) => c === TOKEN }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
}

type View = { mission: { id: string; status: string }; tasks: unknown[]; proposal: { draft: { tasks: unknown[] } } | null };
const asView = async (r: Response) => (await r.json()) as View;
const call = (path: string, method = "GET", body?: unknown, token: string | null = TOKEN) =>
  fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { "x-orchestrator-token": token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe("orchestrator API", () => {
  beforeEach(() => boot(false));

  it("requires the token for state changes but not for reads", async () => {
    expect((await call("/projects/p1/missions", "POST", { goal: "g" }, null)).status).toBe(403);
    expect((await call("/projects/p1/missions", "POST", { goal: "g" }, "wrong")).status).toBe(403);
    expect((await call("/projects/p1/missions", "GET", undefined, null)).status).toBe(200);
  });

  it("plan -> approve flow, with the proposal visible before approval", async () => {
    const created = await call("/projects/p1/missions", "POST", { goal: "商品管理" });
    expect(created.status).toBe(201);
    const v = await asView(created);
    expect(v.mission.status).toBe("planning");
    expect(v.tasks).toHaveLength(0);
    expect(v.proposal?.draft.tasks).toHaveLength(1);
    const approved = await asView(await call(`/projects/p1/missions/${v.mission.id}/approve`, "POST"));
    expect(approved.mission.status).toBe("running");
    expect(approved.tasks).toHaveLength(1);
    expect((await call(`/projects/p1/missions/${v.mission.id}/approve`, "POST")).status).toBe(400);
  });

  it("validates input and ids", async () => {
    expect((await call("/projects/p1/missions", "POST", { goal: "" })).status).toBe(400);
    expect((await call("/projects/nope/missions")).status).toBe(404);
    expect((await call("/projects/..%2Fx/missions")).status).toBe(404);
    expect((await call("/projects/p1/missions/mis_x")).status).toBe(404);
  });

  it("reject needs feedback; other projects' missions are not reachable", async () => {
    store.createProject({ id: "p2", name: "q" });
    const v = await asView(await call("/projects/p1/missions", "POST", { goal: "g" }));
    expect((await call(`/projects/p1/missions/${v.mission.id}/reject`, "POST", {})).status).toBe(400);
    expect((await call(`/projects/p1/missions/${v.mission.id}/reject`, "POST", { feedback: "細かく" })).status).toBe(200);
    expect((await call(`/projects/p2/missions/${v.mission.id}`)).status).toBe(404);
  });

  it("run/resume answer 501 while no executor exists", async () => {
    const v = await asView(await call("/projects/p1/missions", "POST", { goal: "g" }));
    await call(`/projects/p1/missions/${v.mission.id}/approve`, "POST");
    expect((await call(`/projects/p1/missions/${v.mission.id}/run`, "POST")).status).toBe(501);
  });
});

describe("orchestrator API with an executor", () => {
  beforeEach(() => boot(true));

  it("run drives the mission to completed", async () => {
    const v = await asView(await call("/projects/p1/missions", "POST", { goal: "g" }));
    await call(`/projects/p1/missions/${v.mission.id}/approve`, "POST");
    expect((await call(`/projects/p1/missions/${v.mission.id}/run`, "POST")).status).toBe(200);
    for (let i = 0; i < 100; i++) {
      const cur = await asView(await call(`/projects/p1/missions/${v.mission.id}`));
      if (cur.mission.status === "completed") return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("mission did not complete");
  });
});

describe("orchestrator API: projects and artifacts (UI)", () => {
  beforeEach(() => {
    projectsRoot = mkdtempSync(path.join(os.tmpdir(), "api-proj-"));
    return boot(false);
  });
  afterEach(() => {
    rmSync(projectsRoot, { recursive: true, force: true });
    projectsRoot = "unused";
  });

  it("lists and creates projects (create needs the token)", async () => {
    expect((await call("/projects", "POST", { name: "新規" }, null)).status).toBe(403);
    expect((await call("/projects", "POST", { name: "  " })).status).toBe(400);
    const created = (await (await call("/projects", "POST", { name: "新規" })).json()) as { project: { id: string; name: string } };
    expect(created.project.name).toBe("新規");
    const list = (await (await call("/projects")).json()) as { projects: { id: string }[] };
    expect(list.projects.map((p) => p.id)).toContain(created.project.id);
  });

  it("overview bundles missions, tasks, artifacts and runs", async () => {
    await call("/projects/p1/missions", "POST", { goal: "g" });
    const o = (await (await call("/projects/p1/overview")).json()) as Record<string, unknown[]>;
    expect(o.missions).toHaveLength(1);
    expect(Object.keys(o).sort()).toEqual(["aiRuns", "artifacts", "missions", "taskNotes", "tasks"]);
  });

  it("serves only registered artifacts, and never outside the project", async () => {
    mkdirSync(path.join(projectsRoot, "p1", "docs"), { recursive: true });
    writeFileSync(path.join(projectsRoot, "p1", "docs", "a.md"), "# hello");
    writeFileSync(path.join(projectsRoot, "secret.txt"), "nope");
    store.createArtifact({ projectId: "p1", path: "docs/a.md", createdBy: "test" });
    store.createArtifact({ projectId: "p1", path: "../secret.txt", createdBy: "test" });
    const ok = await call("/projects/p1/artifact-content?path=" + encodeURIComponent("docs/a.md"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { content: string }).content).toBe("# hello");
    expect((await call("/projects/p1/artifact-content?path=" + encodeURIComponent("docs/unregistered.md"))).status).toBe(404);
    expect((await call("/projects/p1/artifact-content?path=" + encodeURIComponent("../secret.txt"))).status).toBe(404);
  });
});
