import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pickAutoReflect } from "./autoReflect.ts";
import { applySync, computeDiffsAsync, hashTree, type SyncEntry, type SyncLink } from "./projectSync.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const entry = (p: string, o: Partial<SyncEntry> = {}): SyncEntry => ({ path: p, kind: "modified", conflict: false, ...o });

describe("pickAutoReflect", () => {
  it("lets clearly safe changes through and holds the rest back with a reason", () => {
    const r = pickAutoReflect([
      entry("src/a.cs"),
      entry("docs/new.md", { kind: "added" }),
      entry("old.cs", { kind: "deleted" }),
      entry("clash.cs", { conflict: true }),
      entry("LOG.md", { shrinks: true, shrinkReason: "見出しが消えています" }),
      entry("_ai-records/x/t1.md", { kind: "added" }),
      entry("web-ai/document-task_1.md", { kind: "added" }),
    ]);
    expect(r.paths).toEqual(["src/a.cs", "docs/new.md"]);
    expect(r.held.map((h) => h.path)).toEqual(["old.cs", "clash.cs", "LOG.md"]);
    expect(r.held.find((h) => h.path === "LOG.md")?.why).toContain("見出し");
  });

  it("carries only the picked files into the original, with a backup", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "ar-"));
    roots.push(base);
    const src = path.join(base, "src");
    const proj = path.join(base, "proj");
    for (const d of [src, proj]) mkdirSync(d, { recursive: true });
    for (const d of [src, proj]) writeFileSync(path.join(d, "a.txt"), "one");
    const link: SyncLink = { sourcePath: src, importedAt: "", baseline: hashTree(proj) };
    writeFileSync(path.join(proj, "a.txt"), "two");
    writeFileSync(path.join(proj, "b.txt"), "new");
    mkdirSync(path.join(proj, "web-ai"), { recursive: true });
    writeFileSync(path.join(proj, "web-ai", "note.md"), "note");
    const { push } = await computeDiffsAsync(link, proj);
    const { paths } = pickAutoReflect(push);
    await applySync(link, proj, path.join(base, "backups"), { only: paths }, "push");
    expect(readFileSync(path.join(src, "a.txt"), "utf8")).toBe("two");
    expect(readFileSync(path.join(src, "b.txt"), "utf8")).toBe("new");
    expect(() => readFileSync(path.join(src, "web-ai", "note.md"))).toThrow();
  });
});

describe("autoReflectMission", () => {
  it("does nothing when the project has not opted in, and reflects when it has", async () => {
    const { openDatabase } = await import("./db.ts");
    const { Store } = await import("./store.ts");
    const { MissionEngine } = await import("./missionEngine.ts");
    const { autoReflectMission, autoReflectKey } = await import("./autoReflect.ts");
    const { linkKey } = await import("./projectSync.ts");
    const base = mkdtempSync(path.join(os.tmpdir(), "ar2-"));
    roots.push(base);
    const src = path.join(base, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "a.txt"), "one");
    const db = openDatabase(":memory:");
    const store = new Store(db, path.join(base, "projects"));
    store.createProject({ id: "p", name: "p" });
    mkdirSync(path.join(base, "projects", "p"), { recursive: true });
    writeFileSync(path.join(base, "projects", "p", "a.txt"), "one");
    store.setSetting(linkKey("p"), { sourcePath: src, importedAt: "", baseline: hashTree(path.join(base, "projects", "p")) });
    writeFileSync(path.join(base, "projects", "p", "a.txt"), "two");
    const engine = new MissionEngine(store, {
      planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) },
      executor: { name: "e", execute: async () => ({ ok: true, artifacts: ["a.txt"] }) },
      validator: { validate: async () => ({ passed: true, level: 2 }) },
    });
    const m = engine.startFixedMission({ projectId: "p", goal: "x", draft: { summary: "", tasks: [{ key: "t", role: "coding", objective: "t", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] } });
    await engine.run("p", m.id);
    expect((await autoReflectMission(store, path.join(base, "backups"), "p", m.id)).status).toBe("off");
    expect(readFileSync(path.join(src, "a.txt"), "utf8")).toBe("one");
    store.setSetting(autoReflectKey("p"), true);
    const r = await autoReflectMission(store, path.join(base, "backups"), "p", m.id);
    expect(r.status).toBe("done");
    expect(r.applied).toBe(1);
    expect(readFileSync(path.join(src, "a.txt"), "utf8")).toBe("two");
    expect(store.listEvents({ projectId: "p", limit: 50 }).some((e) => e.type === "SYNC_AUTO_APPLIED")).toBe(true);
    db.close();
  });
});
