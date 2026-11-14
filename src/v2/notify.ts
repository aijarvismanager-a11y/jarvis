import type { Approval, Handoff, Mission } from "./types";

// Desktop notifications (Web Notifications API): the user is told when the
// orchestrator needs them or has finished, without watching the page.
// Only works while the page is open (a background tab is fine).

export type NotifyState = { approvals: string[]; handoffs: string[]; missions: Record<string, string> };
export type Notice = { tag: string; title: string; body: string };

export const snapshotOf = (approvals: Approval[], handoffs: Handoff[], missions: Mission[]): NotifyState => ({
  approvals: approvals.map((a) => a.id),
  handoffs: handoffs.map((h) => h.id),
  missions: Object.fromEntries(missions.map((m) => [m.id, m.status])),
});

/** What is new since `prev`. `prev === null` is the first load: nothing is announced for what already existed. */
export function diffNotices(prev: NotifyState | null, approvals: Approval[], handoffs: Handoff[], missions: Mission[]): Notice[] {
  if (!prev) return [];
  const out: Notice[] = [];
  for (const a of approvals) if (!prev.approvals.includes(a.id)) out.push({ tag: `appr-${a.id}`, title: "承認が必要です", body: a.reason.slice(0, 100) });
  for (const h of handoffs) if (!prev.handoffs.includes(h.id)) out.push({ tag: `hand-${h.id}`, title: `${h.aiName} の回答待ちです`, body: "プロンプトを貼り付けて、返ってきた回答を戻してください" });
  for (const m of missions) {
    const before = prev.missions[m.id];
    if (before === m.status) continue;
    const goal = m.goal.slice(0, 60);
    if (m.status === "planning" && before === undefined) out.push({ tag: `mis-${m.id}-plan`, title: "計画ができました", body: `${goal} — 内容を確認して承認してください` });
    else if (m.status === "completed") out.push({ tag: `mis-${m.id}-done`, title: "依頼が完了しました", body: goal });
    else if (m.status === "failed") out.push({ tag: `mis-${m.id}-fail`, title: "依頼が止まりました", body: `${goal} — 失敗した作業を確認してください` });
  }
  return out;
}

/** An approval waits this long before the first reminder, then again every REMIND_EVERY_MS (same numbers as the server watchdog). */
export const APPROVAL_STALE_MS = 10 * 60_000;
export const REMIND_EVERY_MS = 30 * 60_000;

/** Reminders for approvals nobody has answered for a while. `reminded` (approval id -> time of the last reminder) is updated in place. */
export function staleApprovalNotices(approvals: Approval[], nowMs: number, reminded: Map<string, number>): Notice[] {
  const out: Notice[] = [];
  for (const a of approvals) {
    const waited = nowMs - Date.parse(a.createdAt);
    if (!(waited >= APPROVAL_STALE_MS)) continue;
    const last = reminded.get(a.id);
    if (last !== undefined && nowMs - last < REMIND_EVERY_MS) continue;
    reminded.set(a.id, nowMs);
    out.push({ tag: `appr-wait-${a.id}-${Math.floor(nowMs / REMIND_EVERY_MS)}`, title: `許可の返事を${Math.round(waited / 60_000)}分待っています`, body: `返事があるまで作業は進みません: ${a.reason.slice(0, 80)}` });
  }
  for (const id of [...reminded.keys()]) if (!approvals.some((a) => a.id === id)) reminded.delete(id);
  return out;
}

/** The "every AI is resting" wait began or ended. `prev` undefined is the first load: nothing is announced for what already was. */
export function restingNotice(prev: boolean | undefined, now: boolean): Notice | null {
  if (prev === undefined || prev === now) return null;
  return now
    ? { tag: "resting-on", title: "いまは使えるAIがありません", body: "作業は止まらず待っています。使えるAIが戻ると自動で再開します(何もしなくて大丈夫です)" }
    : { tag: "resting-off", title: "AIが使えるようになりました", body: "待っていた作業を再開します" };
}

const KEY = "orchestrator.notify";
export const notifySupported = () => typeof Notification !== "undefined";
export function notifyEnabled(): boolean {
  try {
    // on unless the person switched it off: a plan waiting for approval must not depend on a toggle they never found
    return notifySupported() && Notification.permission === "granted" && localStorage.getItem(KEY) !== "off";
  } catch {
    return false;
  }
}
/** Asks for permission (a user gesture is required) and turns notifications on or off. Returns the new state. */
export async function setNotifyEnabled(on: boolean): Promise<boolean> {
  try {
    if (on) {
      if (!notifySupported()) return false;
      const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (perm !== "granted") return false;
      localStorage.setItem(KEY, "on");
      return true;
    }
    localStorage.setItem(KEY, "off");
  } catch {
    // storage unavailable
  }
  return false;
}
export function showNotices(notices: Notice[]): void {
  if (!notifyEnabled()) return;
  for (const n of notices) {
    try {
      new Notification(n.title, { body: n.body, tag: n.tag });
    } catch {
      // some environments forbid the constructor; ignore
    }
  }
}
