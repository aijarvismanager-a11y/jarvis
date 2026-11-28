import type { SyncFailure, SyncSummary } from "./types";

/** The folder a reflect writes to, by the name the screen uses for it. */
export const placeName = (createdByApp?: boolean) => (createdByApp ? "保存先のフォルダ" : "元のフォルダ");

/** What to tell the person after a reflect / an undo: one headline, then the files that need their eyes. */
export type SyncNotice = { tone: "ok" | "warn"; lines: string[] };

const failedLines = (failed: SyncFailure[]) => failed.map((f) => `・${f.path}: ${f.why}`);

export function applyNotice(target: string, r: { applied: number; skipped: { path: string }[]; repaired?: string[]; failed?: SyncFailure[] }): SyncNotice {
  const failed = r.failed ?? [];
  const lines = [r.applied ? `${r.applied}件を${target}に入れました。` : `${target}には、何も入れていません。`];
  if (r.skipped.length) lines.push(`次の${r.skipped.length}件は、一覧を出したあとで状態が変わったため、入れていません。下の一覧の印を確かめて、必要ならもう一度押してください。`, ...r.skipped.map((e) => `・${e.path}`));
  if (failed.length) lines.push(`次の${failed.length}件は、書き込めませんでした。`, ...failedLines(failed));
  if (r.repaired?.length) lines.push(`${r.repaired.join("、")} は、AIの書き込みで中身が失われていたため、入れずに、元の内容に戻しました(壊れた方はバックアップに残してあります)。`);
  return { tone: r.skipped.length || failed.length || r.repaired?.length || !r.applied ? "warn" : "ok", lines };
}

export function restoreNotice(target: string, r: { restored: string[]; kept: string[]; failed: SyncFailure[] }): SyncNotice {
  const lines = [r.restored.length ? `${target}の${r.restored.length}件を、前の状態に戻しました。` : `${target}は、何も戻していません。`];
  if (r.kept.length) lines.push(`次の${r.kept.length}件は、そのあとで中身が変えられているため、消さず・上書きせずに、そのまま残しました。`, ...r.kept.map((p) => `・${p}`));
  if (r.failed.length) lines.push(`次の${r.failed.length}件は、戻せませんでした。`, ...failedLines(r.failed));
  return { tone: r.kept.length || r.failed.length ? "warn" : "ok", lines };
}

/** How many finished changes are still only inside the app. */
export const leftToReflect = (sync?: SyncSummary | null) => (sync?.linked ? (sync.toReflect ?? 0) : 0);

/** "変更N件", saying so when the AI's notes are not in that number (the card counts them too). */
export const leftLabel = (sync?: SyncSummary | null) => `変更${leftToReflect(sync)}件${sync && sync.push > leftToReflect(sync) ? "(AIのメモを除く)" : ""}`;

/** Opens the reflect card on the home screen and scrolls to it. */
export function openSyncCard(): boolean {
  const box = document.querySelector<HTMLDetailsElement>("#sync-card details");
  if (!box) return false;
  box.open = true;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
