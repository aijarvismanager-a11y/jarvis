import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import { createOrchestratorRouter } from "./api.ts";
import { scanImportSource } from "./projectImport.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), "imp-")); dirs.push(d); return d; };

function makeSource() {
  const src = tmp();
  mkdirSync(path.join(src, "src"));
  mkdirSync(path.join(src, "node_modules", "x"), { recursive: true });
  mkdirSync(path.join(src, ".git"));
  writeFileSync(path.join(src, "src", "app.js"), "console.log(1)");
  writeFileSync(path.join(src, "package.json"), "{}");
  writeFileSync(path.join(src, ".env"), "SECRET=1");
  writeFileSync(path.join(src, "node_modules", "x", "i.js"), "x");
  writeFileSync(path.join(src, ".git", "HEAD"), "x");
  return src;
}

describe("scanImportSource", () => {
  it("skips node_modules/.git and secrets, and rejects bad folders", () => {
    const src = makeSource();
    const scan = scanImportSource(src, path.join(tmp(), "projects"));
    expect(scan.files.sort()).toEqual(["package.json", "src/app.js"]);
    expect(scan.skippedSecrets).toEqual([".env"]);
    expect(() => scanImportSource("relative/dir", "x")).toThrow();
    expect(() => scanImportSource(path.join(src, "nope"), "x")).toThrow();
    const root = tmp();
    expect(() => scanImportSource(path.join(root, "projects"), path.join(root, "projects"))).toThrow();
  });
});

describe("POST /projects/import", () => {
  it("copies the folder, leaves the original alone, and starts the analysis mission", async () => {
    const src = makeSource();
    const root = tmp();
    const projectsRoot = path.join(root, "projects");
    const db = openDatabase(":memory:");
    const store = new Store(db, projectsRoot);
    const ran: string[] = [];
    const engine = new MissionEngine(store, {
      planner: { name: "x", plan: async () => { throw new Error("planner must not be used"); } },
      executor: { name: "ok", execute: async (task) => { ran.push(task.role); return { ok: true }; } },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: true, tokenMatches: (c) => c === "t" }));
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
    try {
      // Windows "Copy as path" wraps the path in quotes
      const res = await fetch(`${base}/projects/import`, { method: "POST", headers: { "content-type": "application/json", "x-orchestrator-token": "t" }, body: JSON.stringify({ path: `"${src}"` }) });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { project: { id: string }; missionId: string; files: number };
      expect(body.files).toBe(2);
      const dest = path.join(projectsRoot, body.project.id);
      expect(readFileSync(path.join(dest, "src", "app.js"), "utf-8")).toBe("console.log(1)");
      expect(existsSync(path.join(dest, ".env"))).toBe(false);
      expect(existsSync(path.join(src, ".env"))).toBe(true);
      await engine.run(body.project.id, body.missionId);
      for (let i = 0; i < 200 && store.getMission(body.project.id, body.missionId)?.status !== "completed"; i++) await new Promise((r) => setTimeout(r, 25));
      expect(ran).toEqual(["analysis"]);
      expect(store.getMission(body.project.id, body.missionId)?.status).toBe("completed");

      const bad = await fetch(`${base}/projects/import`, { method: "POST", headers: { "content-type": "application/json", "x-orchestrator-token": "t" }, body: JSON.stringify({ path: path.join(src, "missing") }) });
      expect(bad.status).toBe(400);
      expect(store.listProjects()).toHaveLength(1);

      // importing the same folder again must not create a second copy
      const again = await fetch(`${base}/projects/import`, { method: "POST", headers: { "content-type": "application/json", "x-orchestrator-token": "t" }, body: JSON.stringify({ path: src.toUpperCase() === src ? src : `${src}${path.sep}` }) });
      expect(again.status).toBe(200);
      expect(((await again.json()) as { existing: boolean; project: { id: string } }).project.id).toBe(body.project.id);
      expect(store.listProjects()).toHaveLength(1);
    } finally {
      await new Promise((r) => server.close(r));
      db.close();
    }
  }, 20_000);
});
