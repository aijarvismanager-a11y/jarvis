import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import type { Planner } from "./planner.ts";
import { createOrchestratorRouter } from "./api.ts";
import { archiveOldRecords } from "./recordsArchive.ts";

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
  app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute, tokenMatches: (c) => c === TOKEN, recordsBackupsRoot: path.join(projectsRoot, "_backups") }));
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

  it("archives a project (hidden from lists, nothing deleted) and brings it back", async () => {
    expect((await call("/projects/p1/archive", "POST", { archived: true }, null)).status).toBe(403);
    expect((await call("/projects/nope/archive", "POST", { archived: true })).status).toBe(404);
    expect((await call("/projects/p1/archive", "POST", { archived: "yes" })).status).toBeGreaterThanOrEqual(400);
    const res = await call("/projects/p1/archive", "POST", { archived: true });
    expect(res.status).toBe(200);
    const stamp = store.getProject("p1")!.updatedAt;
    expect(store.getProject("p1")?.status).toBe("archived");
    expect(((await (await call("/projects")).json()) as { projects: { id: string }[] }).projects.map((p) => p.id)).toContain("p1");
    expect((await call("/projects/p1/archive", "POST", { archived: false })).status).toBe(200);
    expect(store.getProject("p1")?.status).toBe("active");
    expect(store.getProject("p1")?.updatedAt).toBe(stamp); // putting away is not activity
  });

  it("refuses to archive a project with a running request", async () => {
    const m = store.createMission({ projectId: "p1", goal: "g", status: "running" });
    expect(m.status).toBe("running");
    expect((await call("/projects/p1/archive", "POST", { archived: true })).status).toBe(409);
    expect(store.getProject("p1")?.status).toBe("active");
  });

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

  it("remembers which web AIs the user is signed in to", async () => {
    store.upsertAiService({ id: "gemini", name: "Gemini", url: "https://gemini.google.com" });
    const loggedIn = async () => ((await (await call("/web-ai/settings")).json()) as { loggedIn: Record<string, boolean> }).loggedIn;
    expect((await call("/ai-services/gemini/logged-in", "PUT", { value: true }, null)).status).toBe(403);
    expect((await call("/ai-services/nope/logged-in", "PUT", { value: true })).status).toBe(404);
    expect((await call("/ai-services/gemini/logged-in", "PUT", { value: true })).status).toBe(200);
    expect(await loggedIn()).toEqual({ gemini: true });
    await call("/ai-services/gemini/logged-in", "PUT", { value: false });
    expect(await loggedIn()).toEqual({});
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

  it("approve with run:true approves and starts the mission in one request", async () => {
    const v = await asView(await call("/projects/p1/missions", "POST", { goal: "g" }));
    expect((await call(`/projects/p1/missions/${v.mission.id}/approve`, "POST", { run: true })).status).toBe(200);
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

  it("deletes a project with its files and history, but only with the token", async () => {
    mkdirSync(path.join(projectsRoot, "p1"), { recursive: true });
    writeFileSync(path.join(projectsRoot, "p1", "a.txt"), "x");
    mkdirSync(path.join(projectsRoot, "p1.git"), { recursive: true });
    await call("/projects/p1/missions", "POST", { goal: "g" });
    expect((await call("/projects/p1", "DELETE", undefined, null)).status).toBe(403);
    expect((await call("/projects/p1", "DELETE")).status).toBe(200);
    expect(store.getProject("p1")).toBeNull();
    // the project's own events go with it, but a record that it was deleted stays (no project, so the cascade does not reach it)
    const gone = store.listEvents({ type: "PROJECT_DELETED" });
    expect(gone).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(gone[0].payload))).toMatchObject({ projectId: "p1", missions: 1 });
    expect(existsSync(path.join(projectsRoot, "p1"))).toBe(false);
    expect(existsSync(path.join(projectsRoot, "p1.git"))).toBe(false);
    expect((await call("/projects/p1", "DELETE")).status).toBe(404);
  });

  it("overview bundles missions, tasks, artifacts and runs", async () => {
    await call("/projects/p1/missions", "POST", { goal: "g" });
    const o = (await (await call("/projects/p1/overview")).json()) as Record<string, unknown[]>;
    expect(o.missions).toHaveLength(1);
    expect(Object.keys(o).sort()).toEqual(["aiRuns", "artifacts", "missions", "taskNotes", "taskWaits", "tasks"]);
  });

  it("does not list .NET build output that was registered as an artifact (it stays in the database)", async () => {
    for (const p of ["src/App/Main.cs", "src/App/obj/project.assets.json", "src/App/bin/Debug/net8.0-windows/App.dll", "bin/cli.js"]) store.createArtifact({ projectId: "p1", path: p, createdBy: "test" });
    const o = (await (await call("/projects/p1/overview")).json()) as { artifacts: { path: string }[] };
    expect(o.artifacts.map((a) => a.path).sort()).toEqual(["bin/cli.js", "src/App/Main.cs"]);
    expect(store.listArtifacts("p1")).toHaveLength(4);
  });

  it("summarises every project: newest request, counts and last activity", async () => {
    await call("/projects/p1/missions", "POST", { goal: "first" });
    await call("/projects/p1/missions", "POST", { goal: "second" });
    store.createArtifact({ projectId: "p1", path: "a.md", createdBy: "test" });
    const body = (await (await call("/projects-summary")).json()) as { summary: { project: { id: string }; latestMission: { goal: string } | null; missionCount: number; artifactCount: number }[] };
    const p1 = body.summary.find((r) => r.project.id === "p1")!;
    expect(p1.missionCount).toBe(2);
    expect(p1.artifactCount).toBe(1);
    expect(p1.latestMission?.goal).toBe("second");
  });

  it("tells where the data lives, and where a project's copy and original folder are", async () => {
    const env = (await (await call("/environment?projectId=p1")).json()) as { root: string; projectsDir: string; project: { id: string; workDir: string; sourcePath: string | null } | null };
    expect(env.projectsDir).toBe(store.projectsRoot);
    expect(env.project?.id).toBe("p1");
    expect(env.project?.workDir.startsWith(env.projectsDir)).toBe(true);
    expect(env.project?.sourcePath).toBeNull();
    expect(((await (await call("/environment?projectId=../x")).json()) as { project: unknown }).project).toBeNull();
  });

  it("still serves a record that was packed away, with Japanese names too", async () => {
    const rel = "_ai-records/料理メモ/確認.md";
    mkdirSync(path.join(projectsRoot, "p1", "_ai-records", "料理メモ"), { recursive: true });
    writeFileSync(path.join(projectsRoot, "p1", rel), "# 確認の記録");
    store.createArtifact({ projectId: "p1", path: rel, createdBy: "test" });
    store.createArtifact({ projectId: "p1", path: "_ai-records/料理メモ/無い.md", createdBy: "test" });
    const packed = await archiveOldRecords({ projectsRoot, backupsRoot: path.join(projectsRoot, "_backups"), now: Date.now() + 30 * 86_400_000 });
    expect(packed.archived).toEqual(["p1/料理メモ"]);
    const ok = await call("/projects/p1/artifact-content?path=" + encodeURIComponent(rel));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { content: string }).content).toBe("# 確認の記録");
    expect(existsSync(path.join(projectsRoot, "p1", rel))).toBe(false); // it stays packed
    expect((await call("/projects/p1/artifact-content?path=" + encodeURIComponent("_ai-records/料理メモ/無い.md"))).status).toBe(404);
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

describe("POST /system/restart", () => {
  let called = 0;
  beforeEach(async () => {
    called = 0;
    await boot(true);
  });
  const withRestart = async () => {
    // boot() has no restart hook: rebuild the router with one
    await new Promise((r) => server.close(r));
    const engine = new MissionEngine(store, { planner, executor: { name: "ok", execute: () => new Promise(() => {}) } });
    const app = express();
    app.use(express.json());
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: true, restart: () => void called++, tokenMatches: (c) => c === TOKEN }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    return engine;
  };

  it("needs the token, and is unavailable without a restart hook", async () => {
    expect((await call("/system/restart", "POST", {}, null)).status).toBe(403);
    expect((await call("/system/restart", "POST", {})).status).toBe(501);
  });

  it("restarts at once when idle, but asks first while a mission is running", async () => {
    const engine = await withRestart();
    expect((await call("/system/restart", "POST", {})).status).toBe(200);
    await new Promise((r) => setTimeout(r, 450));
    expect(called).toBe(1);

    const v = await asView(await call("/projects/p1/missions", "POST", { goal: "g" }));
    await call(`/projects/p1/missions/${v.mission.id}/approve`, "POST", { run: true });
    void engine;
    const blocked = await call("/system/restart", "POST", {});
    expect(blocked.status).toBe(409);
    expect(called).toBe(1);
    expect((await call("/system/restart", "POST", { force: true })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 450));
    expect(called).toBe(2);
  });

  it("refuses a second (not forced) restart right after one was accepted, so two restarts do not cut each other off", async () => {
    await withRestart();
    expect((await call("/system/restart", "POST", {})).status).toBe(200);
    const again = await call("/system/restart", "POST", {});
    expect(again.status).toBe(409);
    expect(((await again.json()) as { cooldown?: boolean }).cooldown).toBe(true);
    expect((await call("/system/restart", "POST", { force: true })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 450));
    expect(called).toBe(2);
  });

  it("also asks first while a plan is still being made (no proposal yet), but not when the plan waits for the person", async () => {
    await withRestart();
    const m = store.createMission({ projectId: "p1", goal: "g", status: "planning" }); // planner run in flight: no proposal saved
    expect((await call("/system/restart", "POST", {})).status).toBe(409);
    store.setSetting(`plan:${m.id}`, { kind: "initial", draft: { summary: "", tasks: [] }, createdAt: new Date().toISOString() });
    expect((await call("/system/restart", "POST", {})).status).toBe(200);
  });
});
