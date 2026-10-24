import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySync, computeDiff, hashTree, listBackups, pruneBackups, restoreBackup, type SyncLink } from "./projectSync.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function setup() {
  const base = mkdtempSync(path.join(os.tmpdir(), "sync-"));
  roots.push(base);
  const src = path.join(base, "src");
  const proj = path.join(base, "proj");
  const backups = path.join(base, "backups");
  for (const d of [src, proj]) mkdirSync(path.join(d, "sub"), { recursive: true });
  for (const d of [src, proj]) {
    writeFileSync(path.join(d, "a.txt"), "A");
    writeFileSync(path.join(d, "sub", "b.txt"), "B");
  }
  const link: SyncLink = { sourcePath: src, importedAt: "", baseline: hashTree(proj) };
  return { src, proj, backups, link };
}
const read = (...p: string[]) => readFileSync(path.join(...p), "utf-8");

describe("project sync", () => {
  it("diffs only what the copy changed, and flags files the original changed too", () => {
    const { src, proj, link } = setup();
    expect(computeDiff(link, proj)).toEqual([]);
    writeFileSync(path.join(proj, "a.txt"), "A2"); // modified
    writeFileSync(path.join(proj, "new.txt"), "N"); // added
    rmSync(path.join(proj, "sub", "b.txt")); // deleted
    writeFileSync(path.join(src, "sub", "b.txt"), "B-changed-in-original"); // original changed too
    expect(computeDiff(link, proj)).toEqual([
      { path: "a.txt", kind: "modified", conflict: false },
      { path: "new.txt", kind: "added", conflict: false },
      { path: "sub/b.txt", kind: "deleted", conflict: true },
    ]);
  });

  it("applies after backing up what it replaces; conflicts and deletes need opting in", () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    rmSync(path.join(proj, "sub", "b.txt"));
    writeFileSync(path.join(src, "a.txt"), "A-original-edit");
    const r = applySync(link, proj, backups);
    expect(r.backup?.files.map((f) => f.path)).toEqual(["new.txt"]); // a.txt conflicts, b.txt is a delete: both skipped
    expect(r.skipped.map((e) => e.path).sort()).toEqual(["a.txt", "sub/b.txt"]);
    expect(read(src, "new.txt")).toBe("N");
    expect(read(src, "a.txt")).toBe("A-original-edit");
    expect(existsSync(path.join(src, "sub", "b.txt"))).toBe(true);

    const full = applySync(r.link, proj, backups, { deletes: true, overwriteConflicts: true });
    expect(read(src, "a.txt")).toBe("A2");
    expect(existsSync(path.join(src, "sub", "b.txt"))).toBe(false);
    expect(computeDiff(full.link, proj)).toEqual([]);
    // the overwritten and deleted originals are in the backup
    expect(read(backups, full.backup!.id, "files", "a.txt")).toBe("A-original-edit");
    expect(read(backups, full.backup!.id, "files", "sub", "b.txt")).toBe("B");
  });

  it("restores the original from a backup generation", () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    const r = applySync(link, proj, backups);
    expect(read(src, "a.txt")).toBe("A2");
    const back = restoreBackup(r.link, proj, backups, r.backup!.id);
    expect(read(src, "a.txt")).toBe("A");
    expect(existsSync(path.join(src, "new.txt"))).toBe(false);
    expect(computeDiff(back, proj).map((e) => e.path)).toEqual(["a.txt", "new.txt"]); // the copy's changes show up again
    expect(() => restoreBackup(r.link, proj, backups, "nope")).toThrow();
  });

  it("keeps only the newest generations", async () => {
    const { proj, backups, link } = setup();
    let cur = link;
    for (let i = 0; i < 4; i++) {
      writeFileSync(path.join(proj, "a.txt"), `v${i}`);
      cur = applySync(cur, proj, backups).link;
      await new Promise((r) => setTimeout(r, 5)); // distinct timestamps
    }
    expect(listBackups(backups)).toHaveLength(4);
    expect(pruneBackups(backups, 2)).toHaveLength(2);
    const left = listBackups(backups);
    expect(left).toHaveLength(2);
    expect(read(backups, left[0]!.id, "files", "a.txt")).toBe("v2"); // newest generation survives
  });

  it("pulls what the original changed into the copy, protecting the copy's own edits", () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(src, "a.txt"), "A-from-original"); // original changed
    writeFileSync(path.join(src, "added.txt"), "X"); // original added
    rmSync(path.join(src, "sub", "b.txt")); // original deleted
    writeFileSync(path.join(proj, "sub", "b.txt"), "B-copy-edit"); // copy edited the file the original deleted
    expect(computeDiff(link, proj, "pull")).toEqual([
      { path: "a.txt", kind: "modified", conflict: false },
      { path: "added.txt", kind: "added", conflict: false },
      { path: "sub/b.txt", kind: "deleted", conflict: true },
    ]);
    const r = applySync(link, proj, backups, {}, "pull");
    expect(read(proj, "a.txt")).toBe("A-from-original");
    expect(read(proj, "added.txt")).toBe("X");
    expect(read(proj, "sub", "b.txt")).toBe("B-copy-edit"); // conflict + delete: untouched
    expect(read(backups, r.backup!.id, "files", "a.txt")).toBe("A"); // the copy's old file was saved
    expect(r.skipped.map((e) => e.path)).toEqual(["sub/b.txt"]);
    // nothing left to push except the copy's own edit; the pulled files are in step
    expect(computeDiff(r.link, proj).map((e) => e.path)).toEqual(["sub/b.txt"]);
    // and the pull can be undone
    const back = restoreBackup(r.link, proj, backups, r.backup!.id, "pull");
    expect(read(proj, "a.txt")).toBe("A");
    expect(existsSync(path.join(proj, "added.txt"))).toBe(false);
    expect(computeDiff(back, proj, "pull").map((e) => e.path)).toContain("a.txt");
  });

  it("writes only the chosen paths; the rest stays pending", () => {
    const { src, proj, backups, link } = setup();
    mkdirSync(path.join(proj, "docs"), { recursive: true });
    writeFileSync(path.join(proj, "a.txt"), "A2"); // code
    writeFileSync(path.join(proj, "docs", "notes.md"), "notes"); // a note the AI wrote
    const r = applySync(link, proj, backups, { only: ["a.txt"] });
    expect(read(src, "a.txt")).toBe("A2");
    expect(existsSync(path.join(src, "docs", "notes.md"))).toBe(false);
    expect(r.backup?.files.map((f) => f.path)).toEqual(["a.txt"]);
    expect(r.skipped).toEqual([]); // unchosen is not "skipped"
    expect(computeDiff(r.link, proj).map((e) => e.path)).toEqual(["docs/notes.md"]); // still offered next time
    expect(applySync(r.link, proj, backups, { only: [] }).backup).toBeNull();
  });
});
