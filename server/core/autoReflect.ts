import path from "node:path";
import { buildMissionReport } from "./missionReport.ts";
import { projectDir } from "./paths.ts";
import { applySync, computeDiffsAsync, linkKey, pruneBackups, DEFAULT_KEEP_BACKUPS, type SyncEntry, type SyncLink } from "./projectSync.ts";
import { isAiRecordPath } from "./recordsArchive.ts";
import type { Store } from "./store.ts";

// Reflects a finished request into the original folder by itself, so nobody has to press 反映 after every request.
// Opt-in per project (autoReflect:<projectId>). Only what is clearly safe goes: new / modified files with no conflict and no
// suspicious shrink, never deletions and never the AI's own notes. Everything else is left for the person, with the reasons.

export const autoReflectKey = (projectId: string) => `autoReflect:${projectId}`;

const isNote = (rel: string) => isAiRecordPath(rel) || /^web-ai\//.test(rel);

/** Which pending changes may be reflected without asking, and why each of the others is held back. */
export function pickAutoReflect(entries: SyncEntry[]): { paths: string[]; held: { path: string; why: string }[] } {
  const paths: string[] = [];
  const held: { path: string; why: string }[] = [];
  for (const e of entries) {
    if (isNote(e.path)) continue; // notes never travel; not worth listing
    if (e.kind === "deleted") held.push({ path: e.path, why: "削除は、自動では反映しません" });
    else if (e.conflict) held.push({ path: e.path, why: "元のフォルダ側でも変更されています" });
    else if (e.shrinks) held.push({ path: e.path, why: e.shrinkReason ?? "長いファイルが半分以下に減ります" });
    else paths.push(e.path);
  }
  return { paths, held };
}

// one write at a time per project (shared with the 反映 button)
const busy = new Set<string>();
export const isSyncBusy = (projectId: string) => busy.has(projectId);
export async function withSyncLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(projectId)) throw new Error("同期の書き込み中です。終わるまで少し待ってください");
  busy.add(projectId);
  try {
    return await fn();
  } finally {
    busy.delete(projectId);
  }
}

export type AutoReflectResult = { status: "off" | "skipped" | "done"; applied: number; held: { path: string; why: string }[]; reason?: string };

/** Called when a request has finished. Never throws: a failure is recorded as an event and left for the person. */
export async function autoReflectMission(store: Store, syncBackupsRoot: string, projectId: string, missionId: string, readArtifact?: (rel: string) => string | null): Promise<AutoReflectResult> {
  if (!store.getSetting<boolean>(autoReflectKey(projectId), false)) return { status: "off", applied: 0, held: [] };
  const skip = (reason: string): AutoReflectResult => {
    store.appendEvent({ projectId, type: "SYNC_AUTO_SKIPPED", payload: { missionId, reason } });
    return { status: "skipped", applied: 0, held: [], reason };
  };
  try {
    const link = store.getSetting<SyncLink | null>(linkKey(projectId), null);
    if (!link) return skip("元のフォルダと結び付いていません");
    if (store.listMissions(projectId).some((m) => m.status === "running" && m.id !== missionId)) return skip("ほかの依頼が実行中です");
    const report = buildMissionReport(store, projectId, missionId, readArtifact);
    if (report.verdict === "unfinished" || report.tasks.some((t) => t.status !== "completed")) return skip("終わっていない作業があります");
    const must = (report.todos ?? []).filter((t) => t.required && !t.id.startsWith("sync") && t.id !== "deliver"); // "put it in the folder" is exactly what this does
    if (must.length) return skip(`あなたがやることが残っています: ${must.map((t) => t.title).join(" / ")}`);

    const root = projectDir(store.projectsRoot, projectId);
    const { push } = await computeDiffsAsync(link, root);
    const { paths, held } = pickAutoReflect(push);
    if (paths.length === 0) {
      store.appendEvent({ projectId, type: "SYNC_AUTO_SKIPPED", payload: { missionId, reason: "反映する変更はありません", held } });
      return { status: "done", applied: 0, held };
    }
    const backupDir = path.join(syncBackupsRoot, projectId);
    const r = await withSyncLock(projectId, () => applySync(link, root, backupDir, { only: paths }, "push"));
    store.setSetting(linkKey(projectId), r.link);
    pruneBackups(backupDir, store.getSetting<number>("syncBackupKeep", DEFAULT_KEEP_BACKUPS));
    const applied = r.backup?.files.length ?? 0;
    held.push(...(r.failed ?? []));
    store.appendEvent({ projectId, type: "SYNC_AUTO_APPLIED", payload: { missionId, source: link.sourcePath, files: applied, paths, held, backup: r.backup?.id ?? null, repaired: r.repaired ?? [] } });
    return { status: "done", applied, held };
  } catch (err) {
    return skip(err instanceof Error ? err.message : String(err));
  }
}
