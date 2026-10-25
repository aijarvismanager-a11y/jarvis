import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";
import type { Planner } from "./planner.ts";
import { createOrchestratorRouter } from "./api.ts";
import { hashTree, linkKey, type SyncLink } from "./projectSync.ts";
import { projectDir } from "./paths.ts";

// The sync endpoints against real temporary folders: what is written, what is backed up, what comes back on restore.

const TOKEN = "tok";
let tmp: string;
let db: Db;
let server: http.Server;
let base: string;
let store: Store;
let src: string;
let proj: string;

const planner: Planner = { name: "scripted", plan: async () => ({ summary: "", tasks: [] }) };
const call = (p: string, method = "GET", body?: unknown) =>
  fetch(base + p, { method, headers: { "content-type": "application/json", "x-orchestrator-token": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
const read = (...p: string[]) => readFileSync(path.join(...p), "utf-8");

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "syncapi-"));
  src = path.join(tmp, "original");
  mkdirSync(src, { recursive: true });
  db = openDatabase(":memory:");
  store = new Store(db, path.join(tmp, "projects"));
  store.createProject({ id: "p1", name: "p" });
  proj = projectDir(store.projectsRoot, "p1");
  mkdirSync(proj, { recursive: true });
  for (const d of [src, proj]) {
    writeFileSync(path.join(d, "a.txt"), "A");
    writeFileSync(path.join(d, "b.txt"), "B");
  }
  store.setSetting(linkKey("p1"), { sourcePath: src, importedAt: "", baseline: hashTree(proj) } satisfies SyncLink);
  const engine = new MissionEngine(store, { planner, executor: { name: "ok", execute: async () => ({ ok: true }) } });
  const app = express();
  app.use(express.json());
  app.use("/api/v2", createOrchestratorRouter({ store, engine, canExecute: false, tokenMatches: (c) => c === TOKEN, syncBackupsRoot: path.join(tmp, "backups") }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("sync API on real folders", () => {
  it("shows the diff, writes only the chosen file, then restores the original", async () => {
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    const before = (await (await call("/projects/p1/sync")).json()) as { entries: { path: string }[] };
    expect(before.entries.map((e) => e.path)).toEqual(["a.txt", "new.txt"]);
    expect(((await (await call("/projects/p1/sync/summary")).json()) as { push: number }).push).toBe(2);

    const applied = await call("/projects/p1/sync/apply", "POST", { paths: ["a.txt"] });
    expect(applied.status).toBe(200);
    const result = (await applied.json()) as { applied: number; backup: string };
    expect(result.applied).toBe(1);
    expect(read(src, "a.txt")).toBe("A2");
    expect(existsSync(path.join(src, "new.txt"))).toBe(false); // not chosen, not written
    expect(read(tmp, "backups", "p1", result.backup, "files", "a.txt")).toBe("A"); // the old content was saved first

    const after = (await (await call("/projects/p1/sync")).json()) as { entries: { path: string }[]; backups: { id: string }[] };
    expect(after.entries.map((e) => e.path)).toEqual(["new.txt"]);
    expect(((await (await call("/projects/p1/sync/summary")).json()) as { push: number }).push).toBe(1); // the cache was dropped

    expect((await call("/projects/p1/sync/restore", "POST", { backupId: result.backup })).status).toBe(200);
    expect(read(src, "a.txt")).toBe("A");
    const again = (await (await call("/projects/p1/sync")).json()) as { entries: { path: string }[] };
    expect(again.entries.map((e) => e.path)).toEqual(["a.txt", "new.txt"]);
  });

  it("pull brings the original's change into the working copy, with its own backup", async () => {
    writeFileSync(path.join(src, "b.txt"), "B-from-original");
    const r = await call("/projects/p1/sync/apply", "POST", { direction: "pull" });
    expect(r.status).toBe(200);
    expect(read(proj, "b.txt")).toBe("B-from-original");
    const back = (await r.json()) as { backup: string };
    expect(read(tmp, "backups", "p1", "_pull", back.backup, "files", "b.txt")).toBe("B");
    expect((await call("/projects/p1/sync/restore", "POST", { backupId: back.backup, direction: "pull" })).status).toBe(200);
    expect(read(proj, "b.txt")).toBe("B");
  });

  it("does not overwrite a file the original changed too, unless asked", async () => {
    writeFileSync(path.join(proj, "a.txt"), "from-copy");
    writeFileSync(path.join(src, "a.txt"), "from-original");
    const held = (await (await call("/projects/p1/sync/apply", "POST", { paths: ["a.txt"] })).json()) as { applied: number; skipped: unknown[] };
    expect(held.applied).toBe(0);
    expect(held.skipped).toHaveLength(1);
    expect(read(src, "a.txt")).toBe("from-original");
    await call("/projects/p1/sync/apply", "POST", { paths: ["a.txt"], overwriteConflicts: true });
    expect(read(src, "a.txt")).toBe("from-copy");
  });

  it("refuses a second write while one is running, and unknown backups", async () => {
    for (let i = 0; i < 40; i++) writeFileSync(path.join(proj, `f${i}.txt`), "x".repeat(50_000));
    const [one, two] = await Promise.all([call("/projects/p1/sync/apply", "POST", {}), call("/projects/p1/sync/apply", "POST", {})]);
    const statuses = [one.status, two.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).not.toBe(200); // the lock rejected the other one
    expect((await call("/projects/p1/sync/restore", "POST", { backupId: "nope" })).status).not.toBe(200);
  });
});
