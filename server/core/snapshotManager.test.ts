import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnapshotManager } from "./snapshotManager.ts";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "snap-"));
  roots.push(root);
  const projects = path.join(root, "projects");
  const dir = path.join(projects, "p1");
  mkdirSync(dir, { recursive: true });
  return { snaps: new SnapshotManager(projects), dir };
}

describe("SnapshotManager", () => {
  it("diffs a task's changes and rolls back only those files", async () => {
    const { snaps, dir } = setup();
    writeFileSync(path.join(dir, "keep.txt"), "v1");
    writeFileSync(path.join(dir, "edit.txt"), "old");
    await snaps.capture("p1", "t-before");
    writeFileSync(path.join(dir, "edit.txt"), "new");
    writeFileSync(path.join(dir, "added.txt"), "x");
    mkdirSync(path.join(dir, "node_modules"));
    writeFileSync(path.join(dir, "node_modules", "junk.js"), "x");
    await snaps.capture("p1", "t-after");

    const d = await snaps.diff("p1", "t-before", "t-after");
    expect(d.files).toEqual([{ path: "added.txt", status: "added" }, { path: "edit.txt", status: "modified" }]);
    expect(d.patch).toContain("+new");

    writeFileSync(path.join(dir, "keep.txt"), "later work"); // untouched by the task: must survive
    await snaps.rollback("p1", "t-before", "t-after");
    expect(readFileSync(path.join(dir, "edit.txt"), "utf-8")).toBe("old");
    expect(existsSync(path.join(dir, "added.txt"))).toBe(false);
    expect(readFileSync(path.join(dir, "keep.txt"), "utf-8")).toBe("later work");
    expect(existsSync(path.join(dir, ".git"))).toBe(false);
  });

  it("reads files as they were at a capture, and refuses paths outside the project", async () => {
    const { snaps, dir } = setup();
    mkdirSync(path.join(dir, "site"));
    writeFileSync(path.join(dir, "site", "index.html"), "<h1>before</h1>");
    await snaps.capture("p1", "t-before");
    writeFileSync(path.join(dir, "site", "index.html"), "<h1>after</h1>");
    await snaps.capture("p1", "t-after");

    expect((await snaps.readFile("p1", "t-before", "site/index.html"))?.toString()).toBe("<h1>before</h1>");
    expect((await snaps.readFile("p1", "t-after", "site/index.html"))?.toString()).toBe("<h1>after</h1>");
    expect(await snaps.readFile("p1", "t-before", "missing.html")).toBeNull();
    expect(await snaps.readFile("p1", "t-before", "../../etc/passwd")).toBeNull();
    expect(await snaps.listFiles("p1", "t-before")).toEqual(["site/index.html"]);
  });
});

describe("SnapshotManager.exportTo", () => {
  it("writes the folder as it was at a capture into another folder", async () => {
    const { snaps, dir } = setup();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "a.cs"), "old");
    await snaps.capture("p1", "t-before");
    writeFileSync(path.join(dir, "src", "a.cs"), "new");
    writeFileSync(path.join(dir, "later.txt"), "x");
    await snaps.capture("p1", "t-after");
    const out = path.join(path.dirname(dir), "exported");
    await snaps.exportTo("p1", "t-before", out);
    expect(readFileSync(path.join(out, "src", "a.cs"), "utf8")).toBe("old");
    expect(existsSync(path.join(out, "later.txt"))).toBe(false);
  });
});
