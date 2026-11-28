import { readdirSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySync, autoPullPaths, computeDiff, computeDiffsAsync, hashTree, listBackups, pruneBackups, restoreBackup, type SyncLink } from "./projectSync.ts";

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
  it("diffs only what the copy changed, and flags files the original changed too", async () => {
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

  it("applies after backing up what it replaces; conflicts and deletes need opting in", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    rmSync(path.join(proj, "sub", "b.txt"));
    writeFileSync(path.join(src, "a.txt"), "A-original-edit");
    const r = await applySync(link, proj, backups);
    expect(r.backup?.files.map((f) => f.path)).toEqual(["new.txt"]); // a.txt conflicts, b.txt is a delete: both skipped
    expect(r.skipped.map((e) => e.path).sort()).toEqual(["a.txt", "sub/b.txt"]);
    expect(read(src, "new.txt")).toBe("N");
    expect(read(src, "a.txt")).toBe("A-original-edit");
    expect(existsSync(path.join(src, "sub", "b.txt"))).toBe(true);

    const full = await applySync(r.link, proj, backups, { deletes: true, overwriteConflicts: true });
    expect(read(src, "a.txt")).toBe("A2");
    expect(existsSync(path.join(src, "sub", "b.txt"))).toBe(false);
    expect(computeDiff(full.link, proj)).toEqual([]);
    // the overwritten and deleted originals are in the backup
    expect(read(backups, full.backup!.id, "files", "a.txt")).toBe("A-original-edit");
    expect(read(backups, full.backup!.id, "files", "sub", "b.txt")).toBe("B");
  });

  it("restores the original from a backup generation", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    const r = await applySync(link, proj, backups);
    expect(read(src, "a.txt")).toBe("A2");
    const back = (await restoreBackup(r.link, proj, backups, r.backup!.id)).link;
    expect(read(src, "a.txt")).toBe("A");
    expect(existsSync(path.join(src, "new.txt"))).toBe(false);
    expect(computeDiff(back, proj).map((e) => e.path)).toEqual(["a.txt", "new.txt"]); // the copy's changes show up again
    await expect(restoreBackup(r.link, proj, backups, "nope")).rejects.toThrow();
  });

  it("undo leaves alone what was changed after the sync, and saves what it replaces", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    writeFileSync(path.join(proj, "other.txt"), "O");
    const r = await applySync(link, proj, backups);
    writeFileSync(path.join(src, "a.txt"), "my later edit of a");
    writeFileSync(path.join(src, "new.txt"), "my later edit of new");
    const u = await restoreBackup(r.link, proj, backups, r.backup!.id);
    expect(u.kept.sort()).toEqual(["a.txt", "new.txt"]);
    expect(u.restored).toEqual(["other.txt"]);
    expect(read(src, "a.txt")).toBe("my later edit of a");
    expect(read(src, "new.txt")).toBe("my later edit of new");
    expect(existsSync(path.join(src, "other.txt"))).toBe(false);
    const safety = path.join(backups, r.backup!.id, "before-undo");
    expect(read(safety, readdirSync(safety)[0]!, "other.txt")).toBe("O");
  });

  it("undo is as careful with a backup made by an older version (no record of what was written)", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "new.txt"), "N");
    const r = await applySync(link, proj, backups);
    const manifest = path.join(backups, r.backup!.id, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ ...r.backup!, files: r.backup!.files.map(({ wrote: _wrote, ...f }) => f) }));
    writeFileSync(path.join(src, "new.txt"), "later");
    expect((await restoreBackup(r.link, proj, backups, r.backup!.id)).kept).toEqual(["new.txt"]);
    expect(read(src, "new.txt")).toBe("later");
  });

  it("one file that cannot be written does not stop the others, and is reported in plain words", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "z.txt"), "Z");
    mkdirSync(path.join(src, "z.txt"));
    const r = await applySync(link, proj, backups);
    expect(read(src, "a.txt")).toBe("A2");
    expect(r.failed!.map((f) => f.path)).toEqual(["z.txt"]);
    expect(r.failed![0]!.why).toContain("同じ名前のフォルダ");
    expect(r.backup!.files.map((f) => f.path)).toEqual(["a.txt"]);
    expect(computeDiff(r.link, proj).map((e) => e.path)).toEqual(["z.txt"]); // still waiting
    expect((await restoreBackup(r.link, proj, backups, r.backup!.id)).restored).toEqual(["a.txt"]);
    expect(existsSync(path.join(src, "z.txt"))).toBe(true);
  });

  it("keeps only the newest generations", async () => {
    const { proj, backups, link } = setup();
    let cur = link;
    for (let i = 0; i < 4; i++) {
      writeFileSync(path.join(proj, "a.txt"), `v${i}`);
      cur = (await applySync(cur, proj, backups)).link;
      await new Promise((r) => setTimeout(r, 5)); // distinct timestamps
    }
    expect(listBackups(backups)).toHaveLength(4);
    expect(pruneBackups(backups, 2)).toHaveLength(2);
    const left = listBackups(backups);
    expect(left).toHaveLength(2);
    expect(read(backups, left[0]!.id, "files", "a.txt")).toBe("v2"); // newest generation survives
  });

  it("pulls what the original changed into the copy, protecting the copy's own edits", async () => {
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
    const r = await applySync(link, proj, backups, {}, "pull");
    expect(read(proj, "a.txt")).toBe("A-from-original");
    expect(read(proj, "added.txt")).toBe("X");
    expect(read(proj, "sub", "b.txt")).toBe("B-copy-edit"); // conflict + delete: untouched
    expect(read(backups, r.backup!.id, "files", "a.txt")).toBe("A"); // the copy's old file was saved
    expect(r.skipped.map((e) => e.path)).toEqual(["sub/b.txt"]);
    // nothing left to push except the copy's own edit; the pulled files are in step
    expect(computeDiff(r.link, proj).map((e) => e.path)).toEqual(["sub/b.txt"]);
    // and the pull can be undone
    const back = (await restoreBackup(r.link, proj, backups, r.backup!.id, "pull")).link;
    expect(read(proj, "a.txt")).toBe("A");
    expect(existsSync(path.join(proj, "added.txt"))).toBe(false);
    expect(computeDiff(back, proj, "pull").map((e) => e.path)).toContain("a.txt");
  });

  it("writes only the chosen paths; the rest stays pending", async () => {
    const { src, proj, backups, link } = setup();
    mkdirSync(path.join(proj, "docs"), { recursive: true });
    writeFileSync(path.join(proj, "a.txt"), "A2"); // code
    writeFileSync(path.join(proj, "docs", "notes.md"), "notes"); // a note the AI wrote
    const r = await applySync(link, proj, backups, { only: ["a.txt"] });
    expect(read(src, "a.txt")).toBe("A2");
    expect(existsSync(path.join(src, "docs", "notes.md"))).toBe(false);
    expect(r.backup?.files.map((f) => f.path)).toEqual(["a.txt"]);
    expect(r.skipped).toEqual([]); // unchosen is not "skipped"
    expect(computeDiff(r.link, proj).map((e) => e.path)).toEqual(["docs/notes.md"]); // still offered next time
    expect((await applySync(r.link, proj, backups, { only: [] })).backup).toBeNull();
  });

  it("the async diff gives the same answer as the blocking one, in both directions", async () => {
    const { src, proj, link } = setup();
    writeFileSync(path.join(proj, "a.txt"), "A2");
    writeFileSync(path.join(proj, "new.txt"), "N");
    writeFileSync(path.join(src, "sub", "b.txt"), "B-from-original");
    const both = await computeDiffsAsync(link, proj);
    expect(both.push).toEqual(computeDiff(link, proj));
    expect(both.pull).toEqual(computeDiff(link, proj, "pull"));
    await expect(computeDiffsAsync({ ...link, sourcePath: path.join(src, "missing") }, proj)).rejects.toThrow("元のフォルダ");
  });

  it("a changed file is noticed even when earlier hashes are remembered", async () => {
    const { proj, link } = setup();
    const old = new Date(Date.now() - 60_000);
    utimesSync(path.join(proj, "a.txt"), old, old); // old enough to be remembered
    expect((await computeDiffsAsync(link, proj)).push).toEqual([]);
    writeFileSync(path.join(proj, "a.txt"), "A-longer-now");
    expect((await computeDiffsAsync(link, proj)).push).toEqual([{ path: "a.txt", kind: "modified", conflict: false }]);
  });
});


describe("what is taken over from the original automatically", () => {
  it("only files the copy never touched, and never deletions", () => {
    const entry = (p: string, kind: "added" | "modified" | "deleted", conflict: boolean) => ({ path: p, kind, conflict });
    expect(autoPullPaths([entry("a", "modified", false), entry("b", "added", false), entry("c", "modified", true), entry("d", "deleted", false)])).toEqual(["a", "b"]);
  });
});

describe("shrink stopper", () => {
  it("holds back a change that cuts a long file under half, unless overwriting is chosen", async () => {
    const { src, proj, backups, link } = setup();
    const long = Array.from({ length: 100 }, (_, i) => `line number ${i} of the log`).join(String.fromCharCode(10));
    writeFileSync(path.join(src, "LOG.md"), long);
    writeFileSync(path.join(proj, "LOG.md"), long);
    const l2: SyncLink = { ...link, baseline: hashTree(proj) };
    writeFileSync(path.join(proj, "LOG.md"), "short");
    expect(computeDiff(l2, proj).find((e) => e.path === "LOG.md")?.shrinks).toBe(true);
    const held = await applySync(l2, proj, backups, {});
    expect(held.skipped.some((e) => e.path === "LOG.md")).toBe(true);
    expect(read(src, "LOG.md")).toBe(long);
    await applySync(l2, proj, backups, { overwriteConflicts: true });
    expect(read(src, "LOG.md")).toBe("short");
  });
});

describe("shrink verification", () => {
  const NL = String.fromCharCode(10);
  const longDoc = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? `## Section ${i}` : `detail line number ${i} of the history`)).join(NL);
  it("lets a consolidation through when the removed lines live on in another file", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(src, "LOG.md"), longDoc);
    writeFileSync(path.join(proj, "LOG.md"), longDoc);
    const l2: SyncLink = { ...link, baseline: hashTree(proj) };
    writeFileSync(path.join(proj, "LOG.md"), "## Section 0" + NL + "moved to ARCHIVE.md");
    writeFileSync(path.join(proj, "ARCHIVE.md"), longDoc);
    const entry = computeDiff(l2, proj).find((e) => e.path === "LOG.md")!;
    expect(entry.shrinkVerdict).toBe("safe");
    expect(entry.shrinks).toBeUndefined();
    await applySync(l2, proj, backups, { only: ["LOG.md"] });
    expect(read(src, "LOG.md")).toContain("moved to ARCHIVE.md");
  });
  it("does not carry a chat-answer overwrite over: the copy is put back from the original and the damaged file is kept", async () => {
    const { src, proj, backups, link } = setup();
    writeFileSync(path.join(src, "LOG.md"), longDoc);
    writeFileSync(path.join(proj, "LOG.md"), longDoc);
    const l2: SyncLink = { ...link, baseline: hashTree(proj) };
    writeFileSync(path.join(proj, "LOG.md"), "ご指示の通り、以下に追記内容を整理して完了といたします。" + NL + "```" + NL + "x" + NL + "```");
    expect(computeDiff(l2, proj).find((e) => e.path === "LOG.md")?.shrinkVerdict).toBe("unsafe");
    const r = await applySync(l2, proj, backups, { only: ["LOG.md"] });
    expect(r.repaired).toEqual(["LOG.md"]);
    expect(read(src, "LOG.md")).toBe(longDoc);
    expect(read(proj, "LOG.md")).toBe(longDoc);
  });
  it("holds back a cut it cannot explain", () => {
    const { src, proj, link } = setup();
    writeFileSync(path.join(src, "LOG.md"), longDoc);
    writeFileSync(path.join(proj, "LOG.md"), longDoc);
    const l2: SyncLink = { ...link, baseline: hashTree(proj) };
    writeFileSync(path.join(proj, "LOG.md"), longDoc.split(NL).slice(0, 20).join(NL));
    const e = computeDiff(l2, proj).find((x) => x.path === "LOG.md")!;
    expect(e.shrinkVerdict).toBe("unknown");
    expect(e.shrinks).toBe(true);
  });
});

describe("build output", () => {
  it("is left out of the diff in both directions, other bin folders are not", () => {
    const { src, proj, link } = setup();
    for (const d of [src, proj]) mkdirSync(path.join(d, "app", "bin", "Release"), { recursive: true });
    writeFileSync(path.join(src, "app", "bin", "Release", "app.dll"), "built");
    mkdirSync(path.join(src, "bin"), { recursive: true });
    writeFileSync(path.join(src, "bin", "cli.js"), "real source");
    const paths = computeDiff(link, proj, "pull").map((e) => e.path);
    expect(paths).toContain("bin/cli.js");
    expect(paths.some((p) => p.includes("Release"))).toBe(false);
  });
});
