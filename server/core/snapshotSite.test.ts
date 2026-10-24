import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import type { Planner } from "./planner.ts";
import { SnapshotManager } from "./snapshotManager.ts";
import { createOrchestratorRouter } from "./api.ts";

const roots: string[] = [];
let server: http.Server | undefined;
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(null)));
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("before/after snapshot site", () => {
  it("serves a snapshot's files, lists snapshots, and redirects to a nested index.html", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "snapsite-"));
    roots.push(root);
    const projectsRoot = path.join(root, "projects");
    const dir = path.join(projectsRoot, "p1");
    mkdirSync(path.join(dir, "web"), { recursive: true });
    const db = openDatabase(":memory:");
    const store = new Store(db, projectsRoot);
    store.createProject({ id: "p1", name: "p" });
    const planner: Planner = { name: "s", plan: async () => ({ summary: "", tasks: [] }) };
    const engine = new MissionEngine(store, { planner, executor: { name: "ok", execute: async () => ({ ok: true }) } });
    const snapshots = new SnapshotManager(projectsRoot);
    writeFileSync(path.join(dir, "web", "index.html"), "<h1>v1</h1>");
    writeFileSync(path.join(dir, "web", "style.css"), "body{}");
    await snapshots.capture("p1", "snap-before");
    writeFileSync(path.join(dir, "web", "index.html"), "<h1>v2</h1>");
    await snapshots.capture("p1", "snap-after");
    store.appendEvent({ projectId: "p1", taskId: "t1", type: "TASK_SNAPSHOT", payload: { name: "snap" } });

    const app = express();
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: false, tokenMatches: () => true, snapshots }));
    server = http.createServer(app);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/projects/p1`;

    // root has no index.html, so the page redirects to the nested one (fetch follows it)
    const before = await fetch(`${base}/snapshot-site/snap/before/`);
    expect(await before.text()).toBe("<h1>v1</h1>");
    expect(before.headers.get("content-type")).toContain("text/html");
    expect(before.headers.get("content-security-policy")).toContain("sandbox");
    expect(await (await fetch(`${base}/snapshot-site/snap/after/web/`)).text()).toBe("<h1>v2</h1>");
    expect((await fetch(`${base}/snapshot-site/snap/before/web/style.css`)).headers.get("content-type")).toContain("text/css");
    expect((await fetch(`${base}/snapshot-site/snap/before/web/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/snapshot-site/snap/before/%2e%2e/%2e%2e/secret`)).status).toBe(404);

    const list = (await (await fetch(`${base}/snapshots`)).json()) as { snapshots: { name: string; taskId: string }[] };
    expect(list.snapshots.map((s) => s.name)).toEqual(["snap"]);
    db.close();
  });
});
