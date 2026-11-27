import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

// AI-written records (research, design, review, notes) live under _ai-records/<name>/ in a project. They are not part of
// the user's product, so they are left out of the sync with the original folder and, once old, packed away by themselves.

export const RECORDS_DIR = "_ai-records";
export const isAiRecordPath = (rel: string) => rel === RECORDS_DIR || rel.startsWith(`${RECORDS_DIR}/`);

const DAY_MS = 86_400_000;

/** The newest modification time of any file inside a folder (a folder's own time only counts when it holds no file). */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    newest = Math.max(newest, s.isDirectory() ? newestMtime(p) : s.mtimeMs);
  }
  return newest || statSync(dir).mtimeMs;
}

// The archive is named relative to its own folder (cwd): GNU tar reads "C:\x.tar.gz" as a file on a host called C.
function pack(outDir: string, archiveName: string, cwd: string, folder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tar", ["-czf", archiveName, "-C", cwd, folder], { cwd: outDir, windowsHide: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** One file out of an archive, as text; null when the archive does not hold it or it is longer than `maxBytes`. */
function unpackText(archiveDir: string, archiveName: string, member: string, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("tar", ["-xzOf", archiveName, "--", member], { cwd: archiveDir, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) child.kill();
      else chunks.push(c);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && size <= maxBytes ? Buffer.concat(chunks).toString("utf8") : null));
  });
}

/**
 * The text of a record that has been packed away (the screen still shows the answers of old requests), taken from the newest
 * archive that holds it. The folder stays packed. Null when no archive holds it.
 */
export async function readArchivedRecord(backupsRoot: string, projectId: string, rel: string, maxBytes: number): Promise<string | null> {
  const parts = rel.split("/");
  if (parts[0] !== RECORDS_DIR || parts.length < 3 || parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\"))) return null;
  const folder = parts[1]!;
  const dir = path.join(backupsRoot, "records", projectId);
  if (!existsSync(dir)) return null;
  const archives = readdirSync(dir)
    .filter((n) => n.startsWith(`${folder}-`) && /^\d{8}\.tar\.gz$/.test(n.slice(folder.length + 1)))
    .sort()
    .reverse();
  for (const name of archives) {
    const text = await unpackText(dir, name, parts.slice(1).join("/"), maxBytes);
    if (text !== null) return text;
  }
  return null;
}

export type ArchiveResult = { archived: string[]; kept: string[] };

/**
 * Packs every _ai-records/<folder> whose newest file is older than `olderThanDays` into
 * <backupsRoot>/records/<project>/<folder>-<date>.tar.gz, then removes the folder. A folder is removed only after
 * its archive exists and is not empty; any failure leaves it where it is.
 */
export async function archiveOldRecords(opts: { projectsRoot: string; backupsRoot: string; olderThanDays?: number; now?: number }): Promise<ArchiveResult> {
  const result: ArchiveResult = { archived: [], kept: [] };
  const now = opts.now ?? Date.now();
  const limit = now - (opts.olderThanDays ?? 14) * DAY_MS;
  if (!existsSync(opts.projectsRoot)) return result;
  for (const project of readdirSync(opts.projectsRoot)) {
    if (project.endsWith(".git")) continue;
    const recordsRoot = path.join(opts.projectsRoot, project, RECORDS_DIR);
    if (!existsSync(recordsRoot) || !statSync(recordsRoot).isDirectory()) continue;
    for (const folder of readdirSync(recordsRoot)) {
      const dir = path.join(recordsRoot, folder);
      if (!statSync(dir).isDirectory()) continue;
      if (newestMtime(dir) > limit) continue;
      const stamp = new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
      const outDir = path.join(opts.backupsRoot, "records", project);
      mkdirSync(outDir, { recursive: true });
      const archive = path.join(outDir, `${folder}-${stamp}.tar.gz`);
      const ok = await pack(outDir, path.basename(archive), recordsRoot, folder);
      if (ok && existsSync(archive) && statSync(archive).size > 0) {
        rmSync(dir, { recursive: true, force: true });
        result.archived.push(`${project}/${folder}`);
      } else {
        rmSync(archive, { force: true });
        result.kept.push(`${project}/${folder}`);
      }
    }
  }
  return result;
}
