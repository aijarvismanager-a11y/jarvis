import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db.ts";
import { applyPlan, backupLegacy, buildPlan, capabilityForRole, renderReport } from "./legacyImport.ts";
import { Store } from "./store.ts";

let tmp: string;
let db: Db;
let store: Store;

const step = (over: Record<string, unknown>) => ({
  id: "s1",
  index: 1,
  ai_name: "ChatGPT (Web)",
  role: "Ideator（アイデア出し）",
  status: "done",
  input_files: [],
  output_files: ["workspace/demo/docs/ideas.md"],
  prompt_template: "think",
  command_template: null,
  ...over,
});

function writeLegacy() {
  const config = path.join(tmp, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(
    path.join(config, "workflow.json"),
    JSON.stringify({
      current_project_id: "demo",
      projects: [
        {
          id: "demo",
          name: "Demo",
          steps: [
            step({}),
            step({
              id: "s2",
              index: 2,
              ai_name: "Claude Code (CLI)",
              role: "Lead Developer（実装）",
              status: "active",
              input_files: ["workspace/demo/docs/ideas.md"],
              output_files: ["workspace/demo/src/*"],
              command_template: "claude -p x",
            }),
            step({ id: "s3", index: 3, ai_name: "Unknown AI", role: "謎の役割", status: "pending", output_files: [] }),
          ],
        },
        { id: "other", name: "Other", steps: [step({ id: "o1", output_files: ["workspace/other/docs/o.md"] })] },
        { id: "bad id!", name: "Bad", steps: [] },
      ],
    }),
  );
  writeFileSync(
    path.join(config, "ai_services.json"),
    JSON.stringify([
      { id: "chatgpt", name: "ChatGPT (Web)", url: "https://chatgpt.com" },
      { id: "claude-code", name: "Claude Code (CLI)", url: null },
    ]),
  );
  mkdirSync(path.join(tmp, "workspace", "demo", "docs"), { recursive: true });
  mkdirSync(path.join(tmp, "workspace", "demo", "src"), { recursive: true });
  writeFileSync(path.join(tmp, "workspace", "demo", "docs", "ideas.md"), "# ideas");
  writeFileSync(path.join(tmp, "workspace", "demo", "src", "a.ts"), "export {}");
  mkdirSync(path.join(tmp, "workspace", "other", "docs"), { recursive: true });
  writeFileSync(path.join(tmp, "workspace", "other", "docs", "o.md"), "OTHER");
}

const opts = () => ({
  workflowPath: path.join(tmp, "config", "workflow.json"),
  aiServicesPath: path.join(tmp, "config", "ai_services.json"),
  workspaceDir: path.join(tmp, "workspace"),
});
const apply = (plan: ReturnType<typeof buildPlan>) => applyPlan(store, plan, { workspaceDir: path.join(tmp, "workspace") });

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "orch-legacy-"));
  writeLegacy();
  db = openDatabase(":memory:");
  store = new Store(db, path.join(tmp, "projects"));
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("capabilityForRole", () => {
  it.each([
    ["Ideator（アイデア出し）", "research"],
    ["Architect（設計）", "architecture"],
    ["Reviewer（設計レビュー）", "ux_review"],
    ["Lead Developer（実装）", "coding"],
    ["QA（テスト・修正）", "testing"],
    ["謎の役割", "unclassified"],
  ])("%s -> %s", (role, cap) => expect(capabilityForRole(role)).toBe(cap));
});

describe("buildPlan (read-only)", () => {
  it("converts steps to ordered tasks and flags what could not be resolved", () => {
    const plan = buildPlan(opts());
    expect(plan.projects.map((p) => p.legacyId)).toEqual(["demo", "other"]); // "bad id!" skipped
    expect(plan.warnings.some((w) => w.includes("bad id!"))).toBe(true);
    const demo = plan.projects[0];
    expect(demo.tasks.map((t) => [t.capability, t.status, t.aiServiceId])).toEqual([
      ["research", "completed", "chatgpt"],
      ["coding", "ready", "claude-code"],
      ["unclassified", "pending", null],
    ]);
    expect(demo.tasks[1].inputs).toEqual(["docs/ideas.md"]);
    expect(demo.tasks[1].constraints).toContain("legacy_command: claude -p x");
    expect(demo.artifactPaths).toEqual([{ taskIndex: 0, path: "docs/ideas.md" }]);
    expect(demo.warnings.some((w) => w.includes("Unknown AI"))).toBe(true);
  });

  it("does not modify config/ or workspace/", () => {
    const before = readFileSync(path.join(tmp, "config", "workflow.json"), "utf-8");
    buildPlan(opts());
    expect(readFileSync(path.join(tmp, "config", "workflow.json"), "utf-8")).toBe(before);
    expect(existsSync(path.join(tmp, "projects"))).toBe(false);
  });
});

describe("applyPlan", () => {
  it("imports into the new store, copies files, and leaves the old workspace untouched", () => {
    const result = apply(buildPlan(opts()));
    expect(result.imported.map((r) => r.legacyId)).toEqual(["demo", "other"]);
    const tasks = store.listTasks("demo");
    expect(tasks).toHaveLength(3);
    expect(tasks[2].dependsOn).toEqual([tasks[1].id]);
    expect(store.listArtifacts("demo").map((a) => a.path)).toEqual(["docs/ideas.md"]);
    expect(store.listAiServices()).toHaveLength(2);
    expect(store.getSetting("legacy.current_project_id", "")).toBe("demo");

    expect(readFileSync(path.join(tmp, "projects", "demo", "docs", "ideas.md"), "utf-8")).toBe("# ideas");
    expect(existsSync(path.join(tmp, "workspace", "demo", "docs", "ideas.md"))).toBe(true); // copied, not moved
  });

  it("keeps imported projects isolated from each other", () => {
    apply(buildPlan(opts()));
    expect(existsSync(path.join(tmp, "projects", "demo", "docs", "o.md"))).toBe(false);
    expect(existsSync(path.join(tmp, "projects", "other", "docs", "ideas.md"))).toBe(false);
    expect(store.listArtifacts("other").map((a) => a.path)).toEqual(["docs/o.md"]);
    expect(store.listTasks("other")).toHaveLength(1);
  });

  it("is idempotent: a second run skips existing projects and never overwrites", () => {
    const plan = buildPlan(opts());
    apply(plan);
    writeFileSync(path.join(tmp, "projects", "demo", "docs", "ideas.md"), "EDITED AFTER IMPORT");
    const second = apply(plan);
    expect(second.imported).toEqual([]);
    expect(second.skipped.map((s) => s.legacyId).sort()).toEqual(["demo", "other"]);
    expect(readFileSync(path.join(tmp, "projects", "demo", "docs", "ideas.md"), "utf-8")).toBe("EDITED AFTER IMPORT");
    expect(store.listTasks("demo")).toHaveLength(3);
  });

  it("renders a report mentioning warnings and results", () => {
    const plan = buildPlan(opts());
    const text = renderReport(plan, apply(plan));
    expect(text).toContain("Unknown AI");
    expect(text).toContain("取込: demo");
  });
});

describe("backupLegacy", () => {
  it("copies config/ and workspace/ into a timestamped folder", () => {
    const dest = backupLegacy({ configDir: path.join(tmp, "config"), workspaceDir: path.join(tmp, "workspace"), backupsDir: path.join(tmp, "backups") });
    expect(readFileSync(path.join(dest, "config", "workflow.json"), "utf-8")).toBe(readFileSync(path.join(tmp, "config", "workflow.json"), "utf-8"));
    expect(readFileSync(path.join(dest, "workspace", "demo", "docs", "ideas.md"), "utf-8")).toBe("# ideas");
  });
});
