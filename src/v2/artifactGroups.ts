// The "できたもの" list used to be one flat list of every file. It is split by what a person wants to find:
// what was made (grouped by folder), the AI's own notes, and old / generated files nobody needs to read.

export type ArtifactKind = "made" | "notes" | "old";

const NOTE_PREFIX = /^(_ai-records|web-ai|docs\/ai-notes)\//;
const OLD_PREFIX = /^(_archive|bin|obj|dist|build|node_modules|\.git|snapshots)\//;
const OLD_SEGMENT = /\/(bin|obj|node_modules|_archive)\//;
const OLD_FILE = /\.(dll|exe|pdb|zip|7z|nupkg|cache)$|\.(unused|old)(-[\w-]+)?$/i;

export function classifyArtifact(path: string): ArtifactKind {
  if (NOTE_PREFIX.test(path)) return "notes";
  if (OLD_PREFIX.test(path) || OLD_SEGMENT.test(path) || OLD_FILE.test(path)) return "old";
  return "made";
}

export type FolderGroup<T> = { folder: string; items: T[] };

/** Files in the top folder they live in ("" = loose at the top), the loose ones first, then folders A-Z. */
export function groupByFolder<T extends { path: string }>(items: T[]): FolderGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const i = it.path.indexOf("/");
    const folder = i < 0 ? "" : it.path.slice(0, i);
    map.set(folder, [...(map.get(folder) ?? []), it]);
  }
  return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))).map(([folder, list]) => ({ folder, items: list }));
}
