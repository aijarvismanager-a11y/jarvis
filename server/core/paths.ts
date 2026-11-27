import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

const NO_TEST_SCRIPT = 'echo "No test script in this project. Run its tests directly, e.g. node --test test/" && exit 1';

/**
 * Writes a stop-here package.json at the top of projects/. A project without its own package.json otherwise inherits the one of the folder
 * above: "npm test" inside it ran this application's whole test suite (measured: coding tasks waited 5-7 minutes for it), and "npm install"
 * would have written there. "type" is copied from the folder above so .js files keep being read the same way. An existing file is left alone.
 */
export function guardProjectsRoot(projectsRoot: string): void {
  const file = path.join(projectsRoot, "package.json");
  if (existsSync(file)) return;
  let type: string | undefined;
  try {
    type = (JSON.parse(readFileSync(path.join(path.dirname(path.resolve(projectsRoot)), "package.json"), "utf8")) as { type?: string }).type;
  } catch {
    // no package.json above: nothing to copy
  }
  mkdirSync(projectsRoot, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ name: "orchestra-projects", private: true, ...(type ? { type } : {}), scripts: { test: NO_TEST_SCRIPT } }, null, 2)}\n`);
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
