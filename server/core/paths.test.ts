import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInProject } from "./paths.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "orch-paths-"));
  mkdirSync(path.join(root, "p1", "docs"), { recursive: true });
  mkdirSync(path.join(root, "p2"), { recursive: true });
  writeFileSync(path.join(root, "p2", "secret.txt"), "secret");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("resolveInProject", () => {
  it("resolves normal relative paths, existing or not", () => {
    expect(resolveInProject(root, "p1", "docs/a.md")).toBe(path.join(root, "p1", "docs", "a.md"));
    expect(resolveInProject(root, "p1", "new/dir/file.md")).toBe(path.join(root, "p1", "new", "dir", "file.md"));
  });

  it.each(["../p2/secret.txt", "docs/../../p2/secret.txt", "..\\p2\\secret.txt", "/etc/passwd", "C:\\Windows\\win.ini", "C:foo", "", "a\0b"])(
    "rejects %j",
    (bad) => {
      expect(() => resolveInProject(root, "p1", bad)).toThrow();
    },
  );

  it("rejects bad project ids", () => {
    expect(() => resolveInProject(root, "../p2", "secret.txt")).toThrow();
    expect(() => resolveInProject(root, "p1/../p2", "secret.txt")).toThrow();
  });

  it("rejects a junction/symlink inside the project that points to another project", () => {
    const link = path.join(root, "p1", "docs", "escape");
    try {
      symlinkSync(path.join(root, "p2"), link, "junction");
    } catch {
      return; // link creation not permitted on this machine; nothing to assert
    }
    expect(() => resolveInProject(root, "p1", "docs/escape/secret.txt")).toThrow();
    expect(() => resolveInProject(root, "p1", "docs/escape")).toThrow();
  });
});

describe("projectSlug", () => {
  it("keeps the ASCII part of a name for a readable folder, with a safe fallback", async () => {
    const { projectSlug, PROJECT_ID_RE } = await import("./paths.ts");
    expect(projectSlug("My App v2")).toBe("my-app-v2");
    expect(projectSlug("商品管理 shop")).toBe("shop");
    expect(projectSlug("カラフルな動画")).toBe("project");
    expect(projectSlug("a".repeat(80)).length).toBe(24);
    expect(PROJECT_ID_RE.test(`${projectSlug("../evil name")}_ab12cd34`)).toBe(true);
  });
});
