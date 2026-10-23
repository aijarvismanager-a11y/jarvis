import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { Store } from "./store.ts";

let db: Db;
let store: Store;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "orch-store-"));
  db = openDatabase(":memory:");
  store = new Store(db, path.join(tmp, "projects"));
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function seed(id: string) {
  const project = store.createProject({ id, name: `Project ${id}` });
  const mission = store.createMission({ projectId: id, goal: `goal of ${id}` });
  const task = store.createTask({ projectId: id, missionId: mission.id, role: "coding", objective: "build" });
  return { project, mission, task };
}

describe("schema", () => {
  it("creates all 12 spec tables (+ task_edges) and sets user_version", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["projects", "missions", "tasks", "ai_services", "ai_capabilities", "ai_runs", "artifacts", "validations", "decisions", "events", "settings", "locks", "task_edges"]) {
      expect(names).toContain(t);
    }
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
  });

  it("rejects an unsafe project id at the database level", () => {
    expect(() => db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('../x', 'n', 't', 't')").run()).toThrow();
    expect(() => store.createProject({ id: "a/b", name: "x" })).toThrow();
  });

  it("limits retry_count to 5 (no infinite retry, spec §32)", () => {
    const { task, project } = seed("p1");
    expect(() => db.prepare("UPDATE tasks SET retry_count = 6 WHERE id = ? AND project_id = ?").run(task.id, project.id)).toThrow();
    db.prepare("UPDATE tasks SET retry_count = 5 WHERE id = ? AND project_id = ?").run(task.id, project.id);
  });

  it("rejects an invalid task status", () => {
    const { task, project } = seed("p1");
    expect(() => db.prepare("UPDATE tasks SET status = 'nope' WHERE id = ? AND project_id = ?").run(task.id, project.id)).toThrow();
  });
});

describe("project isolation", () => {
  it("never returns one project's rows through another project's id", () => {
    const a = seed("proj_a");
    const b = seed("proj_b");
    store.createArtifact({ projectId: "proj_a", taskId: a.task.id, path: "docs/a.md", createdBy: "test" });
    store.createArtifact({ projectId: "proj_b", taskId: b.task.id, path: "docs/b.md", createdBy: "test" });

    expect(store.listTasks("proj_a").map((t) => t.id)).toEqual([a.task.id]);
    expect(store.listTasks("proj_b").map((t) => t.id)).toEqual([b.task.id]);
    expect(store.listArtifacts("proj_a").map((x) => x.path)).toEqual(["docs/a.md"]);
    expect(store.listArtifacts("proj_b").map((x) => x.path)).toEqual(["docs/b.md"]);
    expect(store.getTask("proj_b", a.task.id)).toBeNull();
    expect(store.getMission("proj_b", a.mission.id)).toBeNull();
    expect(store.listEvents({ projectId: "proj_a" }).every((e) => e.projectId === "proj_a")).toBe(true);
  });

  it("cannot attach a task to another project's mission (composite foreign key)", () => {
    seed("proj_a");
    const b = seed("proj_b");
    expect(() => store.createTask({ projectId: "proj_a", missionId: b.mission.id, role: "coding" })).toThrow();
  });

  it("cannot link a dependency across projects", () => {
    const a = seed("proj_a");
    const b = seed("proj_b");
    expect(() => store.addDependency("proj_a", a.task.id, b.task.id)).toThrow();
  });

  it("cannot attach an artifact, validation or run to another project's task", () => {
    seed("proj_a");
    const b = seed("proj_b");
    expect(() => store.createArtifact({ projectId: "proj_a", taskId: b.task.id, path: "x.md", createdBy: "t" })).toThrow();
    expect(() => store.addValidation({ projectId: "proj_a", taskId: b.task.id, level: 1, status: "passed" })).toThrow();
    expect(() => store.recordAiRun({ projectId: "proj_a", taskId: b.task.id, executor: "manual" })).toThrow();
  });

  it("cannot change another project's task status", () => {
    const a = seed("proj_a");
    seed("proj_b");
    expect(() => store.setTaskStatus("proj_b", a.task.id, "completed")).toThrow();
    expect(store.getTask("proj_a", a.task.id)?.status).toBe("pending");
  });

  it("deleting one project leaves the other intact", () => {
    seed("proj_a");
    const b = seed("proj_b");
    store.createArtifact({ projectId: "proj_b", taskId: b.task.id, path: "docs/b.md", createdBy: "t" });
    expect(store.deleteProject("proj_a")).toBe(true);
    expect(store.getProject("proj_a")).toBeNull();
    expect(store.listTasks("proj_a")).toEqual([]);
    expect(store.listTasks("proj_b")).toHaveLength(1);
    expect(store.listArtifacts("proj_b")).toHaveLength(1);
  });
});

describe("repositories", () => {
  it("auto-increments artifact versions per (project, path)", () => {
    const { task } = seed("p1");
    const v1 = store.createArtifact({ projectId: "p1", taskId: task.id, path: "docs/r.md", createdBy: "x" });
    const v2 = store.createArtifact({ projectId: "p1", taskId: task.id, path: "docs/r.md", createdBy: "x" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
  });

  it("stores task graph edges and reads them back", () => {
    const { mission, task } = seed("p1");
    const t2 = store.createTask({ projectId: "p1", missionId: mission.id, role: "testing", dependsOn: [task.id] });
    expect(t2.dependsOn).toEqual([task.id]);
  });

  it("registers AI services with capabilities and filters by capability", () => {
    store.upsertAiService({ id: "claude-code", name: "Claude Code (CLI)", accessMode: "cli", capabilities: ["coding", "debugging"] });
    store.upsertAiService({ id: "gemini", name: "Gemini (Web)", url: "https://gemini.google.com", capabilities: ["research"] });
    expect(store.listAiServices({ capability: "coding" }).map((s) => s.id)).toEqual(["claude-code"]);
    expect(store.getAiService("gemini")?.freeStatus).toBe("unknown");
    store.upsertAiService({ id: "gemini", name: "Gemini (Web)", capabilities: ["research", "fact_check"] });
    expect(store.getAiService("gemini")?.capabilities).toEqual(["fact_check", "research"]);
  });

  it("round-trips settings and decisions", () => {
    store.setSetting("maxParallel", 2);
    expect(store.getSetting("maxParallel", 0)).toBe(2);
    expect(store.getSetting("missing", "dflt")).toBe("dflt");
    store.addDecision({ title: "React", reason: "reuse", alternatives: ["Vue"], isAssumption: true });
    expect(store.listDecisions(null)).toHaveLength(1);
  });

  it("write lock: a second owner is refused until release or expiry; the same owner can renew", () => {
    seed("p1");
    expect(store.acquireLock({ resource: "code:p1", projectId: "p1", owner: "claude-code", ttlMs: 60_000 })).toBe(true);
    expect(store.acquireLock({ resource: "code:p1", projectId: "p1", owner: "other-ai", ttlMs: 60_000 })).toBe(false);
    expect(store.acquireLock({ resource: "code:p1", projectId: "p1", owner: "claude-code", ttlMs: 60_000 })).toBe(true);
    expect(store.releaseLock("code:p1", "other-ai")).toBe(false);
    expect(store.releaseLock("code:p1", "claude-code")).toBe(true);
    expect(store.acquireLock({ resource: "code:p1", projectId: "p1", owner: "other-ai", ttlMs: 60_000 })).toBe(true);
    store.releaseLock("code:p1", "other-ai");
    store.acquireLock({ resource: "code:p1", projectId: "p1", owner: "expired", ttlMs: -1000 });
    expect(store.acquireLock({ resource: "code:p1", projectId: "p1", owner: "fresh", ttlMs: 1000 })).toBe(true);
  });

  it("logs events in order", () => {
    seed("p1");
    const types = store.listEvents({ projectId: "p1" }).map((e) => e.type);
    expect(types).toEqual(["PROJECT_CREATED", "MISSION_CREATED", "TASK_CREATED"]);
  });
});
