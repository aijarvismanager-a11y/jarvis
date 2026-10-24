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
    else if (m.status === "completed") out.push({ tag: `mis-${m.id}-done`, title: "ミッションが完了しました", body: goal });
    else if (m.status === "failed") out.push({ tag: `mis-${m.id}-fail`, title: "ミッションが止まりました", body: `${goal} — 失敗したタスクを確認してください` });
  }
  return out;
}

const KEY = "orchestrator.notify";
export const notifySupported = () => typeof Notification !== "undefined";
export function notifyEnabled(): boolean {
  try {
    return notifySupported() && Notification.permission === "granted" && localStorage.getItem(KEY) === "on";
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
