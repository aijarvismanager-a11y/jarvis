import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { SKIP_DIRS, SKIP_FILE } from "./projectImport.ts";

// Sync between an imported project (the working copy) and the folder it came from.
// The link remembers what the source looked like at import time (a hash per file), so a
// later diff can tell "changed in the copy" from "changed in the original" (a conflict).
// Nothing is written to the original without first saving the files it would overwrite or
// delete into a backup generation, from which they can be restored.

export type SyncLink = { sourcePath: string; importedAt: string; /** top-level folders left out of the import; never compared or copied */ exclude?: string[]; /** project-relative path -> sha1, as it was when last in step with the source */ baseline: Record<string, string> };
export type SyncEntry = { path: string; kind: "added" | "modified" | "deleted"; /** the original was changed too, so applying would overwrite its changes */ conflict: boolean };
export type SyncBackup = { id: string; createdAt: string; files: { path: string; kind: SyncEntry["kind"]; hadOriginal: boolean; prevBaseline: string | null }[] };

export const DEFAULT_KEEP_BACKUPS = 5;
export const linkKey = (projectId: string) => `source:${projectId}`;
export const normalizeSource = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

const sha1 = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");

/** project-relative path -> hash for every file that import/sync cares about (same skip rules as the import). */
export function hashTree(root: string, exclude: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const left = new Set(exclude.map((n) => n.toLowerCase()));
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (rel === "" && e.isDirectory() && left.has(e.name.toLowerCase())) continue;
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

/**
 * Hashes remembered by path + size + modified time, so a re-check only reads files that changed.
 * A file touched within the last 2 seconds is never remembered (same size and time could still hide an edit).
 */
const hashMemo = new Map<string, { size: number; mtimeMs: number; hash: string }>();
const MEMO_LIMIT = 200_000;
const MEMO_SETTLE_MS = 2000;
async function fileHash(abs: string): Promise<string> {
  const st = await stat(abs);
  const hit = hashMemo.get(abs);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.hash;
  const hash = createHash("sha1").update(await readFile(abs)).digest("hex");
  if (Date.now() - st.mtimeMs > MEMO_SETTLE_MS) {
    if (hashMemo.size >= MEMO_LIMIT) hashMemo.clear();
    hashMemo.set(abs, { size: st.size, mtimeMs: st.mtimeMs, hash });
  }
  return hash;
}

/** Same result as hashTree, but reads without blocking the server (a big project takes seconds); `onFile` is told after each file. */
export async function hashTreeAsync(root: string, exclude: string[] = [], onFile?: (count: number) => void): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const left = new Set(exclude.map((n) => n.toLowerCase()));
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (rel === "" && e.isDirectory() && left.has(e.name.toLowerCase())) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(abs, childRel);
      } else if (e.isFile() && !SKIP_FILE.test(e.name)) {
        out[childRel] = await fileHash(abs);
        onFile?.(Object.keys(out).length);
      }
    }
  };
  if (existsSync(root)) await walk(root, "");
  return out;
}

export type SyncDirection = "push" | "pull";
const rootsOf = (link: SyncLink, projectRoot: string, dir: SyncDirection) => (dir === "push" ? { from: projectRoot, to: link.sourcePath } : { from: link.sourcePath, to: projectRoot });

/**
 * What the `from` side changed since the link was last in step, and which of those the `to` side also changed.
 * push: working copy -> original. pull: original -> working copy.
 */
export function computeDiff(link: SyncLink, projectRoot: string, dir: SyncDirection = "push"): SyncEntry[] {
  assertSourceExists(link);
  const roots = rootsOf(link, projectRoot, dir);
  return diffOf(link, hashTree(roots.from, link.exclude), hashTree(roots.to, link.exclude));
}

function assertSourceExists(link: SyncLink) {
  if (!existsSync(link.sourcePath) || !statSync(link.sourcePath).isDirectory()) throw new Error("元のフォルダが見つかりません");
}

function diffOf(link: SyncLink, from: Record<string, string>, to: Record<string, string>): SyncEntry[] {
  const entries: SyncEntry[] = [];
  for (const rel of new Set([...Object.keys(from), ...Object.keys(link.baseline)])) {
    const b = link.baseline[rel];
    const f = from[rel];
    const t = to[rel];
    if (f === b) continue; // not changed on the from side
    if (t === f) continue; // the to side already has this exact state
    entries.push({ path: rel, kind: f === undefined ? "deleted" : b === undefined ? "added" : "modified", conflict: t !== b });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Both directions at once without blocking the server: each folder is hashed once (asynchronously, so other requests are
 * served in between) and the two diffs are derived from the same hashes.
 */
export async function computeDiffsAsync(link: SyncLink, projectRoot: string): Promise<{ push: SyncEntry[]; pull: SyncEntry[] }> {
  assertSourceExists(link);
  const [copy, source] = await Promise.all([hashTreeAsync(projectRoot, link.exclude), hashTreeAsync(link.sourcePath, link.exclude)]);
  return { push: diffOf(link, copy, source), pull: diffOf(link, source, copy) };
}

export type ApplyOptions = { /** only these project-relative paths (default: every pending change) */ only?: string[]; /** also delete, in the original, files deleted in the copy */ deletes?: boolean; /** overwrite files the original changed as well */ overwriteConflicts?: boolean };

const inside = (base: string, target: string) => target === base || target.startsWith(base + path.sep);

/** Writes the diff into the original, after saving what it replaces. Returns the new link and the backup made. */
export function applySync(link: SyncLink, projectRoot: string, backupDir: string, opts: ApplyOptions = {}, direction: SyncDirection = "push"): { link: SyncLink; backup: SyncBackup | null; skipped: SyncEntry[] } {
  const roots = rootsOf(link, projectRoot, direction);
  const all = computeDiff(link, projectRoot, direction);
  const only = opts.only ? new Set(opts.only) : null;
  const todo = all.filter((e) => (!only || only.has(e.path)) && (opts.deletes || e.kind !== "deleted") && (opts.overwriteConflicts || !e.conflict));
  // not offered to the user (or not chosen) is not "skipped": only what was wanted but held back is reported
  const skipped = all.filter((e) => !todo.includes(e) && (!only || only.has(e.path)));
  if (todo.length === 0) return { link, backup: null, skipped };

  const source = path.resolve(roots.to); // the side that gets written
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(backupDir, stamp);
  const backup: SyncBackup = { id: stamp, createdAt: new Date().toISOString(), files: [] };
  const abs = (rel: string) => {
    const target = path.resolve(source, rel);
    if (!inside(source, target) || target === source) throw new Error("書き込み先の外には書き込めません");
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
  const written = hashTree(roots.from, link.exclude);
  for (const e of todo) {
    const target = abs(e.path);
    if (e.kind === "deleted") {
      rmSync(target, { force: true });
      delete baseline[e.path];
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(roots.from, e.path), target);
      baseline[e.path] = written[e.path]!;
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

/** Puts the written side back as it was before one sync (the original for a push, the working copy for a pull). The other side is untouched, so the diff shows those changes again. */
export function restoreBackup(link: SyncLink, projectRoot: string, backupDir: string, backupId: string, direction: SyncDirection = "push"): SyncLink {
  const backup = listBackups(backupDir).find((b) => b.id === backupId);
  if (!backup) throw new Error("そのバックアップが見つかりません");
  const source = path.resolve(rootsOf(link, projectRoot, direction).to);
  if (!existsSync(source)) throw new Error("復元先のフォルダが見つかりません");
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
