import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// CLAUDE.md of a project grows by one entry for nearly every task ("## 作業履歴"), and Claude Code reads the whole file at the
// start of each task. Old history entries are moved, word for word, to <backups>/claude-md/<project>/ and a single pointer line
// stays in their place. Nothing is deleted or rewritten: the entries that are kept, and every other section, are untouched.

export const CLAUDE_MD = "CLAUDE.md";
export const HISTORY_HEADING = "## 作業履歴";
export const POINTER_MARK = "（古い作業履歴";
/** Newest entries that always stay in CLAUDE.md. */
export const KEEP_ENTRIES = 40;
/** The file is left alone until it is bigger than this (bytes). */
export const COMPACT_ABOVE_BYTES = 80_000;

export type HistoryParts = { before: string[]; preface: string[]; entries: string[][]; after: string[]; pointer: string | null };

/** Splits CLAUDE.md into: lines before the history section, the history entries (top-level "- " bullets), and the rest. */
export function splitHistory(text: string): HistoryParts | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === HISTORY_HEADING);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  const preface: string[] = [];
  const entries: string[][] = [];
  let pointer: string | null = null;
  for (const l of body) {
    if (l.startsWith("- ")) {
      if (l.startsWith(`- ${POINTER_MARK}`)) {
        pointer = l;
        continue;
      }
      entries.push([l]);
    } else if (entries.length === 0) preface.push(l);
    else entries[entries.length - 1].push(l);
  }
  return { before: lines.slice(0, start + 1), preface, entries, after: lines.slice(end), pointer };
}

const pointerLine = (total: number, keep: number, where: string) =>
  `- ${POINTER_MARK}${total}件は、記録として、アプリが別の場所に移しました(消してはいません)。ここには最近の${keep}件を残しています。全文: ${where}）`;

const archivedBefore = (pointer: string | null): number => Number(pointer?.match(/作業履歴(\d+)件/)?.[1] ?? 0);

export type Compacted = { text: string; archived: string; count: number; total: number };

/** The new CLAUDE.md text and the text to archive, or null when nothing needs to move. */
export function compactHistory(text: string, where: string, keep = KEEP_ENTRIES, above = COMPACT_ABOVE_BYTES): Compacted | null {
  if (Buffer.byteLength(text) <= above) return null;
  const parts = splitHistory(text);
  if (!parts || parts.entries.length <= keep) return null;
  const moved = parts.entries.slice(0, parts.entries.length - keep);
  const kept = parts.entries.slice(parts.entries.length - keep);
  const total = archivedBefore(parts.pointer) + moved.length;
  const body = [...parts.preface, pointerLine(total, keep, where), ...kept.flat()];
  const next = [...parts.before, ...body, ...parts.after].join("\n");
  return { text: next, archived: moved.map((e) => e.join("\n")).join("\n") + "\n", count: moved.length, total };
}

const stamp = (now: number) => new Date(now).toISOString().replace(/[-:]/g, "").slice(0, 13);

export type CompactResult = { project: string; count: number; bytesBefore: number; bytesAfter: number; file: string };

/**
 * For every project: when CLAUDE.md is big and its history has more than KEEP_ENTRIES entries, moves the old ones out.
 * `isBusy(projectId)` must say true while a task of that project may be writing the file; those projects are skipped.
 * The archive is written and read back first, and the whole old file is copied next to it; only then is CLAUDE.md replaced.
 */
export function compactClaudeMd(opts: { projectsRoot: string; backupsRoot: string; isBusy?: (projectId: string) => boolean; now?: number; keep?: number; above?: number }): CompactResult[] {
  const out: CompactResult[] = [];
  const now = opts.now ?? Date.now();
  if (!existsSync(opts.projectsRoot)) return out;
  for (const project of readdirSync(opts.projectsRoot)) {
    if (project.endsWith(".git")) continue;
    const file = path.join(opts.projectsRoot, project, CLAUDE_MD);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    if (opts.isBusy?.(project)) continue;
    if (now - statSync(file).mtimeMs < 120_000) continue; // just written: leave it a while
    const original = readFileSync(file, "utf-8");
    const dir = path.join(opts.backupsRoot, "claude-md", project);
    const result = compactHistory(original, dir, opts.keep, opts.above);
    if (!result) continue;
    mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, `history-${stamp(now)}.md`);
    const header = `# ${project} の CLAUDE.md から移した古い作業履歴(${result.count}件・${new Date(now).toISOString()})\n\n`;
    writeFileSync(archive, header + result.archived, "utf-8");
    if (!readFileSync(archive, "utf-8").endsWith(result.archived)) continue; // could not be written back whole: leave CLAUDE.md as it is
    copyFileSync(file, path.join(dir, `CLAUDE-before-${stamp(now)}.md`));
    const tmp = `${file}.tmp-compact`;
    writeFileSync(tmp, result.text, "utf-8");
    renameSync(tmp, file);
    out.push({ project, count: result.count, bytesBefore: Buffer.byteLength(original), bytesAfter: Buffer.byteLength(result.text), file: archive });
  }
  return out;
}
