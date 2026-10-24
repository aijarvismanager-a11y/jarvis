import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SKIP_DIRS, SKIP_FILE } from "./projectImport.ts";

// Sync between an imported project (the working copy) and the folder it came from.
// The link remembers what the source looked like at import time (a hash per file), so a
// later diff can tell "changed in the copy" from "changed in the original" (a conflict).
// Nothing is written to the original without first saving the files it would overwrite or
// delete into a backup generation, from which they can be restored.

export type SyncLink = { sourcePath: string; importedAt: string; /** project-relative path -> sha1, as it was when last in step with the source */ baseline: Record<string, string> };
export type SyncEntry = { path: string; kind: "added" | "modified" | "deleted"; /** the original was changed too, so applying would overwrite its changes */ conflict: boolean };
export type SyncBackup = { id: string; createdAt: string; files: { path: string; kind: SyncEntry["kind"]; hadOriginal: boolean; prevBaseline: string | null }[] };

export const DEFAULT_KEEP_BACKUPS = 5;
export const linkKey = (projectId: string) => `source:${projectId}`;
export const normalizeSource = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

const sha1 = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");

/** project-relative path -> hash for every file that import/sync cares about (same skip rules as the import). */
export function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs, childRel);
      } else if (e.isFile() && !SKIP_FILE.test(e.name)) out[childRel] = sha1(abs);
    }
  };
  if (existsSync(root)) walk(root, "");
  return out;
}

/** What the working copy changed since the link was last in step, and which of those the original also changed. */
export function computeDiff(link: SyncLink, projectRoot: string): SyncEntry[] {
  if (!existsSync(link.sourcePath) || !statSync(link.sourcePath).isDirectory()) throw new Error("元のフォルダが見つかりません");
  const proj = hashTree(projectRoot);
  const src = hashTree(link.sourcePath);
  const entries: SyncEntry[] = [];
  for (const rel of new Set([...Object.keys(proj), ...Object.keys(link.baseline)])) {
    const b = link.baseline[rel];
    const p = proj[rel];
    const s = src[rel];
    if (p === b) continue; // not changed in the copy
    if (s === p) continue; // the original already has this exact state
    entries.push({ path: rel, kind: p === undefined ? "deleted" : b === undefined ? "added" : "modified", conflict: s !== b });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export type ApplyOptions = { /** also delete, in the original, files deleted in the copy */ deletes?: boolean; /** overwrite files the original changed as well */ overwriteConflicts?: boolean };

const inside = (base: string, target: string) => target === base || target.startsWith(base + path.sep);

/** Writes the diff into the original, after saving what it replaces. Returns the new link and the backup made. */
export function applySync(link: SyncLink, projectRoot: string, backupDir: string, opts: ApplyOptions = {}): { link: SyncLink; backup: SyncBackup | null; skipped: SyncEntry[] } {
  const all = computeDiff(link, projectRoot);
  const todo = all.filter((e) => (opts.deletes || e.kind !== "deleted") && (opts.overwriteConflicts || !e.conflict));
  const skipped = all.filter((e) => !todo.includes(e));
  if (todo.length === 0) return { link, backup: null, skipped };

  const source = path.resolve(link.sourcePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(backupDir, stamp);
  const backup: SyncBackup = { id: stamp, createdAt: new Date().toISOString(), files: [] };
  const abs = (rel: string) => {
    const target = path.resolve(source, rel);
    if (!inside(source, target) || target === source) throw new Error("元のフォルダの外には書き込めません");
    return target;
  };
  // 1) save everything that is about to be overwritten or deleted
  for (const e of todo) {
    const target = abs(e.path);
    const had = existsSync(target) && statSync(target).isFile();
    if (had) {
      const saved = path.join(dir, "files", e.path);
      mkdirSync(path.dirname(saved), { recursive: true });
      cpSync(target, saved);
    }
    backup.files.push({ path: e.path, kind: e.kind, hadOriginal: had, prevBaseline: link.baseline[e.path] ?? null });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(backup, null, 2));
  // 2) write
  const baseline = { ...link.baseline };
  const proj = hashTree(projectRoot);
  for (const e of todo) {
    const target = abs(e.path);
    if (e.kind === "deleted") {
      rmSync(target, { force: true });
      delete baseline[e.path];
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(projectRoot, e.path), target);
      baseline[e.path] = proj[e.path]!;
    }
  }
  return { link: { ...link, baseline }, backup, skipped };
}

export function listBackups(backupDir: string): SyncBackup[] {
  if (!existsSync(backupDir)) return [];
  const out: SyncBackup[] = [];
  for (const name of readdirSync(backupDir)) {
    try {
      out.push(JSON.parse(readFileSync(path.join(backupDir, name, "manifest.json"), "utf-8")) as SyncBackup);
    } catch {
      /* a half-written generation is ignored */
    }
  }
  return out.sort((a, b) => b.id.localeCompare(a.id)); // newest first
}

/** Keeps the newest `keep` generations and removes the older ones (only ever inside backupDir). */
export function pruneBackups(backupDir: string, keep: number): string[] {
  const removed: string[] = [];
  for (const b of listBackups(backupDir).slice(Math.max(1, keep))) {
    rmSync(path.join(backupDir, b.id), { recursive: true, force: true });
    removed.push(b.id);
  }
  return removed;
}

/** Puts the original back as it was before one sync. The working copy is untouched, so the diff shows those changes again. */
export function restoreBackup(link: SyncLink, backupDir: string, backupId: string): SyncLink {
  const backup = listBackups(backupDir).find((b) => b.id === backupId);
  if (!backup) throw new Error("そのバックアップが見つかりません");
  const source = path.resolve(link.sourcePath);
  if (!existsSync(source)) throw new Error("元のフォルダが見つかりません");
  const baseline = { ...link.baseline };
  for (const f of backup.files) {
    const target = path.resolve(source, f.path);
    if (!inside(source, target) || target === source) throw new Error("元のフォルダの外には書き込めません");
    if (f.hadOriginal) {
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(backupDir, backup.id, "files", f.path), target);
    } else {
      rmSync(target, { force: true }); // the sync had created it
    }
    if (f.prevBaseline === null) delete baseline[f.path];
    else baseline[f.path] = f.prevBaseline;
  }
  return { ...link, baseline };
}
