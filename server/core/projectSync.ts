import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { HISTORY_NOTES_PATH, SKIP_DIRS, SKIP_FILE } from "./projectImport.ts";
import { isAiRecordPath } from "./recordsArchive.ts";

// Sync between an imported project (the working copy) and the folder it came from.
// The link remembers what the source looked like at import time (a hash per file), so a
// later diff can tell "changed in the copy" from "changed in the original" (a conflict).
// Nothing is written to the original without first saving the files it would overwrite or
// delete into a backup generation, from which they can be restored.

export type SyncLink = { sourcePath: string; importedAt: string; /** top-level folders left out of the import; never compared or copied */ exclude?: string[]; /** project-relative path -> sha1, as it was when last in step with the source */ baseline: Record<string, string> };
export type SyncEntry = { path: string; kind: "added" | "modified" | "deleted"; /** the original was changed too, so applying would overwrite its changes */ conflict: boolean; /** the new file is under half as long as the one it replaces (a long file about to be wiped out) */ shrinks?: boolean; /** what the automatic check of a shrinking file concluded: safe = moved elsewhere (let through), unsafe = looks like a chat answer / lost content (repaired), unknown = needs a person */ shrinkVerdict?: "safe" | "unsafe" | "unknown"; shrinkReason?: string };
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
      } else if (e.isFile() && !SKIP_FILE.test(e.name) && childRel !== HISTORY_NOTES_PATH) out[childRel] = sha1(abs);
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
      } else if (e.isFile() && !SKIP_FILE.test(e.name) && childRel !== HISTORY_NOTES_PATH) {
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
  return markShrinks(diffOf(link, hashTree(roots.from, link.exclude), hashTree(roots.to, link.exclude)), roots.from, roots.to, link.exclude);
}

function assertSourceExists(link: SyncLink) {
  if (!existsSync(link.sourcePath) || !statSync(link.sourcePath).isDirectory()) throw new Error("元のフォルダが見つかりません");
}

const TEXT_EXT = new Set([".md", ".txt", ".csv", ".json", ".cs", ".xaml", ".ts", ".tsx", ".js", ".css", ".html", ".ps1", ".csproj"]);
const NL = String.fromCharCode(10);
const readTextOrNull = (abs: string): string | null => {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};
const MAX_SCAN_BYTES = 8_000_000;
const CHAT_ANSWER = /^```|ご指示の通り|以下に[^\n]{0,30}(追記|反映|整理|更新)|完了といたします|Last \d+ chars|print\(/m;
const trimmedLines = (t: string) => t.split(NL).map((l) => l.trim()).filter((l) => l.length >= 8);

/** Every long-enough line of the project's other text files (where a line cut from one file may have been moved to). */
function linesElsewhere(root: string, exclude: string[], skipRel: string): Set<string> {
  const out = new Set<string>();
  let bytes = 0;
  const walk = (dir: string, rel: string) => {
    let names: import("node:fs").Dirent[];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of names) {
      const r = rel ? `${rel}/${n.name}` : n.name;
      if (n.isDirectory()) {
        if (SKIP_DIRS.has(n.name) || n.name === "bin" || n.name === "obj" || (rel === "" && exclude.includes(n.name))) continue;
        walk(path.join(dir, n.name), r);
      } else if (r !== skipRel && TEXT_EXT.has(path.extname(n.name).toLowerCase())) {
        try {
          const text = readFileSync(path.join(dir, n.name), "utf8");
          bytes += text.length;
          if (bytes > MAX_SCAN_BYTES) return;
          for (const l of trimmedLines(text)) out.add(l);
        } catch {
          /* unreadable: ignored */
        }
      }
    }
  };
  walk(root, "");
  return out;
}

/** Decides, from the two versions, whether cutting a long file down is a legitimate consolidation or damage. */
export function judgeShrink(oldText: string, newText: string, elsewhere: Set<string>): { verdict: "safe" | "unsafe" | "unknown"; reason: string } {
  const newSet = new Set(trimmedLines(newText));
  const removed = [...new Set(trimmedLines(oldText))].filter((l) => !newSet.has(l));
  if (removed.length === 0) return { verdict: "safe", reason: "消える行はありません(空行や重複が減っただけです)" };
  const moved = removed.filter((l) => elsewhere.has(l)).length;
  const ratio = moved / removed.length;
  if (ratio >= 0.9) return { verdict: "safe", reason: `消える${removed.length}行の${Math.round(ratio * 100)}%が、プロジェクトのほかのファイルにあります(移した・まとめたと判断しました)` };
  const heads = oldText.split(NL).filter((l) => /^#{1,4} /.test(l)).map((l) => l.trim());
  const keptHeads = heads.filter((h) => newSet.has(h)).length;
  const headLoss = heads.length >= 3 ? 1 - keptHeads / heads.length : 0;
  if (CHAT_ANSWER.test(newText) && headLoss >= 0.8) return { verdict: "unsafe", reason: "新しい中身が、チャットの返事のような文章で、元の見出しの8割以上が消えています(AIが書き込みを間違えた可能性が高いです)" };
  if (headLoss >= 0.8 && ratio < 0.5) return { verdict: "unsafe", reason: `元の見出しの${Math.round(headLoss * 100)}%が消え、消える内容の${Math.round((1 - ratio) * 100)}%がほかのどこにもありません` };
  return { verdict: "unknown", reason: `消える${removed.length}行のうち、ほかのファイルにあるのは${Math.round(ratio * 100)}%です。意図した削減かどうか、人の確認が必要です` };
}

/** Stopper: a modified text file that would replace a long (30+ lines) one with less than half of it is checked for why; only what is not clearly safe is held back. */
function markShrinks(entries: SyncEntry[], fromRoot: string, toRoot: string, exclude: string[] = []): SyncEntry[] {
  let elsewhere: Set<string> | null = null;
  for (const e of entries) {
    if (e.kind !== "modified" || !TEXT_EXT.has(path.extname(e.path).toLowerCase())) continue;
    const oldText = readTextOrNull(path.join(toRoot, e.path));
    const newText = readTextOrNull(path.join(fromRoot, e.path));
    if (oldText === null || newText === null || oldText.split(NL).length < 30 || newText.split(NL).length >= oldText.split(NL).length / 2) continue;
    elsewhere ??= linesElsewhere(fromRoot, exclude, e.path);
    const j = judgeShrink(oldText, newText, elsewhere);
    e.shrinkVerdict = j.verdict;
    e.shrinkReason = j.reason;
    if (j.verdict !== "safe") e.shrinks = true;
  }
  return entries;
}

function diffOf(link: SyncLink, from: Record<string, string>, to: Record<string, string>): SyncEntry[] {
  const entries: SyncEntry[] = [];
  for (const rel of new Set([...Object.keys(from), ...Object.keys(link.baseline)])) {
    if (isAiRecordPath(rel)) continue; // the AI's own notes are never carried into (or out of) the original folder
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
  return { push: markShrinks(diffOf(link, copy, source), projectRoot, link.sourcePath, link.exclude), pull: markShrinks(diffOf(link, source, copy), link.sourcePath, projectRoot, link.exclude) };
}

/** What may be taken over from the original without asking: changed or added there, and not touched in the copy. Deletions always wait for the user. */
export const autoPullPaths = (pull: SyncEntry[]): string[] => pull.filter((e) => !e.conflict && e.kind !== "deleted").map((e) => e.path);

export type ApplyOptions = { /** only these project-relative paths (default: every pending change) */ only?: string[]; /** also delete, in the original, files deleted in the copy */ deletes?: boolean; /** overwrite files the original changed as well */ overwriteConflicts?: boolean };

const inside = (base: string, target: string) => target === base || target.startsWith(base + path.sep);

/** Writes the diff into the original, after saving what it replaces. Returns the new link and the backup made. Never blocks the server: every read and write is asynchronous. */
export async function applySync(link: SyncLink, projectRoot: string, backupDir: string, opts: ApplyOptions = {}, direction: SyncDirection = "push"): Promise<{ link: SyncLink; backup: SyncBackup | null; skipped: SyncEntry[]; /** files whose damaged copy was put back from the original */ repaired?: string[] }> {
  const roots = rootsOf(link, projectRoot, direction);
  assertSourceExists(link);
  const [fromHashes, toHashes] = await Promise.all([hashTreeAsync(roots.from, link.exclude), hashTreeAsync(roots.to, link.exclude)]);
  let all = markShrinks(diffOf(link, fromHashes, toHashes), roots.from, roots.to, link.exclude);
  // Re-verification: a push that would wipe out a long file with something that is clearly damage (a chat answer, lost headings) is not carried over.
  // The working copy's file is put back from the original (the damaged one is kept in the backup folder), and the diff is checked again.
  const repaired: string[] = [];
  if (direction === "push") {
    const only0 = opts.only ? new Set(opts.only) : null;
    for (const e of all.filter((x) => x.shrinkVerdict === "unsafe" && !x.conflict && (!only0 || only0.has(x.path)))) {
      const bad = path.join(roots.from, e.path);
      const keep = path.join(backupDir, "rejected", new Date().toISOString().replace(/[:.]/g, "-"), e.path);
      await mkdir(path.dirname(keep), { recursive: true });
      await cp(bad, keep);
      await cp(path.join(roots.to, e.path), bad);
      repaired.push(e.path);
    }
    if (repaired.length) {
      const again = await hashTreeAsync(roots.from, link.exclude);
      all = markShrinks(diffOf(link, again, toHashes), roots.from, roots.to, link.exclude);
    }
  }
  const only = opts.only ? new Set(opts.only) : null;
  const todo = all.filter((e) => (!only || only.has(e.path)) && (opts.deletes || e.kind !== "deleted") && (opts.overwriteConflicts || (!e.conflict && !e.shrinks)));
  // not offered to the user (or not chosen) is not "skipped": only what was wanted but held back is reported
  const skipped = all.filter((e) => !todo.includes(e) && (!only || only.has(e.path)));
  if (todo.length === 0) return { link, backup: null, skipped, repaired };

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
    const had = await isFile(target);
    if (had) {
      const saved = path.join(dir, "files", e.path);
      await mkdir(path.dirname(saved), { recursive: true });
      await cp(target, saved);
    }
    backup.files.push({ path: e.path, kind: e.kind, hadOriginal: had, prevBaseline: link.baseline[e.path] ?? null });
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(backup, null, 2));
  // 2) write
  const baseline = { ...link.baseline };
  for (const e of todo) {
    const target = abs(e.path);
    if (e.kind === "deleted") {
      await rm(target, { force: true });
      delete baseline[e.path];
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(roots.from, e.path), target);
      baseline[e.path] = fromHashes[e.path]!;
    }
  }
  return { link: { ...link, baseline }, backup, skipped, repaired };
}

const isFile = (p: string) => stat(p).then((st) => st.isFile(), () => false);

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
export async function restoreBackup(link: SyncLink, projectRoot: string, backupDir: string, backupId: string, direction: SyncDirection = "push"): Promise<SyncLink> {
  const backup = listBackups(backupDir).find((b) => b.id === backupId);
  if (!backup) throw new Error("そのバックアップが見つかりません");
  const source = path.resolve(rootsOf(link, projectRoot, direction).to);
  if (!existsSync(source)) throw new Error("復元先のフォルダが見つかりません");
  const baseline = { ...link.baseline };
  for (const f of backup.files) {
    const target = path.resolve(source, f.path);
    if (!inside(source, target) || target === source) throw new Error("元のフォルダの外には書き込めません");
    if (f.hadOriginal) {
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(backupDir, backup.id, "files", f.path), target);
    } else {
      await rm(target, { force: true }); // the sync had created it
    }
    if (f.prevBaseline === null) delete baseline[f.path];
    else baseline[f.path] = f.prevBaseline;
  }
  return { ...link, baseline };
}
