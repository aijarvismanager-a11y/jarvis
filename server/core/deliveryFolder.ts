import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "./store.ts";
import { linkKey, type SyncLink } from "./projectSync.ts";

// A project started inside the app has no "original folder". It gets one: a real folder (by default on the Desktop, named
// after the project) that the usual sync fills when the person presses "反映". Records such as CHANGELOG.md travel with it.

export const NEW_PROJECT_ROOT_KEY = "new_project_root";

/** Where new projects' folders are made: the setting, else the Desktop, else the home folder. */
export function newProjectRoot(store: Store): string {
  const chosen = store.getSetting<string | null>(NEW_PROJECT_ROOT_KEY, null);
  if (chosen && existsSync(chosen)) return chosen;
  const home = os.homedir();
  const candidates = [path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop"), path.join(home, "デスクトップ")];
  return candidates.find((c) => existsSync(c)) ?? home;
}

const folderNameOf = (name: string) =>
  name
    .replace(/[<>:"/\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 60) || "新しいプロジェクト";

/** A folder that does not exist yet: "name", then "name (2)", "name (3)"... */
export function uniqueFolder(root: string, name: string): string {
  const base = folderNameOf(name);
  let candidate = path.join(root, base);
  for (let n = 2; existsSync(candidate); n++) candidate = path.join(root, `${base} (${n})`);
  return candidate;
}

/** Makes the project's folder and links it for sync. Returns the folder, or null when it could not be made (the project works without it). */
export function createDeliveryFolder(store: Store, projectId: string, projectName: string, root: string): string | null {
  try {
    const folder = uniqueFolder(root, projectName);
    mkdirSync(folder, { recursive: true });
    const link: SyncLink & { createdByApp: true } = { sourcePath: folder, importedAt: new Date().toISOString(), baseline: {}, exclude: [], createdByApp: true };
    store.setSetting(linkKey(projectId), link);
    return folder;
  } catch {
    return null;
  }
}
