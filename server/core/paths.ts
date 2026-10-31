import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

export function assertProjectId(id: string): void {
  if (!PROJECT_ID_RE.test(id)) throw new Error(`不正なプロジェクトIDです: ${id}`);
}

/** projects/<id>/ under the given projects root. */
export function projectDir(projectsRoot: string, projectId: string): string {
  assertProjectId(projectId);
  return path.join(projectsRoot, projectId);
}

/**
 * Resolves a project-relative path (as stored in artifacts.path) to an absolute
 * path that is guaranteed to stay inside the project's directory. Rejects
 * absolute paths, drive letters, "..", NUL bytes, and — when the target already
 * exists — symlinks/junctions that resolve outside the project.
 */
export function resolveInProject(projectsRoot: string, projectId: string, relPath: string): string {
  const base = path.resolve(projectDir(projectsRoot, projectId));
  if (typeof relPath !== "string" || relPath === "" || relPath.includes("\0")) throw new Error("不正なパスです");
  const normalized = relPath.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith("/")) {
    throw new Error("絶対パスは使えません");
  }
  if (normalized.split("/").some((seg) => seg === "..")) throw new Error("親ディレクトリへの参照は使えません");
  // Windows treats some names specially: device names (CON, NUL, COM1...), "file:stream" (a hidden data stream) and trailing dots/spaces (silently dropped).
  for (const seg of normalized.split("/")) {
    if (seg === "") continue;
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(seg)) throw new Error(`Windowsの予約名は使えません: ${seg}`);
    if (seg.includes(":")) throw new Error(`パスに「:」は使えません: ${seg}`);
    if (/[. ]$/.test(seg) && seg !== ".") throw new Error(`名前の最後に「.」や空白は使えません: ${seg}`);
  }

  const target = path.resolve(base, normalized);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error("プロジェクトの外には出られません");

  // Symlinks/junctions: resolve the deepest existing ancestor and re-check.
  let probe = target;
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (existsSync(probe) && existsSync(base)) {
    const realBase = realpathSync(base);
    const realProbe = realpathSync(probe);
    if (realProbe !== realBase && !realProbe.startsWith(realBase + path.sep)) {
      throw new Error("リンク経由でプロジェクトの外に出ようとしています");
    }
  }
  return target;
}

/** Folder-name prefix for a new project: the ASCII part of its name (so `projects/` is readable), else "project". */
export function projectSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || "project";
}
