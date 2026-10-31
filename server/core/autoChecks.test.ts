import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dotnetBuildCheck, findBuildTarget, findShrunkFiles, restoreFiles, touchesDotnet } from "./autoChecks.ts";
import type { CommandRunner } from "./commandRunner.ts";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

describe("findShrunkFiles", () => {
  it("flags an existing long text file that became less than half as long", async () => {
    const r = await findShrunkFiles(["PLAN.md", "new.md", "small.md", "a.png"], async (p) => (p === "PLAN.md" ? lines(100) : p === "small.md" ? lines(10) : null), (p) => (p === "PLAN.md" ? lines(20) : p === "small.md" ? "x" : "y"));
    expect(r).toEqual([{ path: "PLAN.md", before: 100, after: 20 }]);
  });
  it("accepts appended files", async () => {
    expect(await findShrunkFiles(["PLAN.md"], async () => lines(100), () => lines(130))).toEqual([]);
  });
  it("restores flagged files", () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    writeFileSync(path.join(d, "a.md"), "short");
    restoreFiles(d, [{ path: "a.md", content: "original" }]);
    expect(readFileSync(path.join(d, "a.md"), "utf8")).toBe("original");
  });
});

describe("dotnetBuildCheck", () => {
  const project = () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    writeFileSync(path.join(d, "App.sln"), "");
    mkdirSync(path.join(d, "bin"));
    return d;
  };
  const runner = (buildCode: number): CommandRunner => async (_c, args) => (args[0] === "--version" ? { stdout: "8", stderr: "", code: 0 } : { stdout: "error CS1002", stderr: "", code: buildCode });
  it("finds the solution first", () => {
    expect(findBuildTarget(project())).toBe("App.sln");
    expect(touchesDotnet(["src/A.cs"])).toBe(true);
    expect(touchesDotnet(["README.md"])).toBe(false);
  });
  it("passes, fails with the compiler output, or skips without dotnet", async () => {
    expect((await dotnetBuildCheck(project(), runner(0))).status).toBe("passed");
    const failed = await dotnetBuildCheck(project(), runner(1));
    expect(failed.status).toBe("failed");
    expect(failed.detail).toContain("CS1002");
    const none: CommandRunner = async () => ({ stdout: "", stderr: "", code: 1 });
    expect((await dotnetBuildCheck(project(), none)).status).toBe("skipped");
    expect((await dotnetBuildCheck(mkdtempSync(path.join(os.tmpdir(), "ac-")), runner(0))).status).toBe("skipped");
  });
});

import { ProjectValidator } from "./taskValidator.ts";
import type { SnapshotManager } from "./snapshotManager.ts";

describe("ProjectValidator shrink guard", () => {
  it("puts back a history file that a task rewrote and fails the task", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    const dir = path.join(root, "p");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "PLAN.md"), lines(5));
    const snaps = { readFile: async () => Buffer.from(lines(100)) } as unknown as SnapshotManager;
    const task = { id: "t", projectId: "p", role: "documentation", objective: "追記", expectedOutputs: [], retryCount: 0 } as never;
    const res = await new ProjectValidator(root, { snapshots: snaps, runTests: false }).validate(task, { ok: true, artifacts: ["PLAN.md"] });
    expect(res.passed).toBe(false);
    expect(res.detail).toContain("PLAN.md");
    expect(readFileSync(path.join(dir, "PLAN.md"), "utf8").split("\n").length).toBe(100);
  });
});

describe("ProjectValidator unanswered research", () => {
  const setup = (text: string) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    mkdirSync(path.join(root, "p"));
    writeFileSync(path.join(root, "p", "r.md"), text);
    return root;
  };
  const task = (retryCount: number) => ({ id: "t", projectId: "p", role: "research", objective: "調査", expectedOutputs: [], retryCount }) as never;
  it("sends a deliverable that could not read its target back once, then accepts it", async () => {
    const root = setup("確認状況: 確認できず\n読めなかった");
    const v = new ProjectValidator(root, { runTests: false });
    expect((await v.validate(task(0), { ok: true, artifacts: ["r.md"] })).passed).toBe(false);
    expect((await v.validate(task(1), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
  });
  it("does not retry when the AI was simply not allowed to run something", async () => {
    const root = setup("確認状況: 確認できず\n承認が必要でした");
    expect((await new ProjectValidator(root, { runTests: false }).validate(task(0), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
  });
});
