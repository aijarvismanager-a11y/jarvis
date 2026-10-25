import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";

// Web handoffs (spec §10 Level 1/2): a task that a web AI must do waits here for
// the user to bring back the answer (or to skip it). State lives in the settings
// table so a pending handoff survives a restart; the in-memory waiters are only
// a wake-up for the executor that is currently blocked on one.

export type HandoffStatus = "pending" | "submitted" | "skipped" | "cancelled";
export type WebHandoff = {
  id: string;
  projectId: string;
  taskId: string;
  aiId: string;
  aiName: string;
  url: string | null;
  /** Interaction level in effect: 1 = user does everything, 2 = prompt is typed for them. */
  level: 1 | 2;
  /** Why this level was used instead of a higher one (e.g. a downgrade or a blocker the user has to clear). */
  note: string | null;
  prompt: string;
  status: HandoffStatus;
  resultText: string | null;
  /** Set when the user asked for another web AI instead: the executor re-runs the task on that AI. */
  reassignTo?: string | null;
  /** True once an executor has taken the result, so a restarted run does not reuse it twice. */
  consumed: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

const KEY = "web_handoffs";
const KEEP = 200;
/** Registry adapter types the web AI executor can run (shared with the API so both agree on what "a web AI" is). */
export const WEB_ADAPTER_TYPES = ["manual", "browser"] as const;
export const MAX_RESULT_CHARS = 400_000;

export class WebHandoffHub {
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly store: Store) {}

  private all(): WebHandoff[] {
    return this.store.getSetting<WebHandoff[]>(KEY, []);
  }
  private save(list: WebHandoff[]): void {
    this.store.setSetting(KEY, list.slice(-KEEP));
  }
  private update(id: string, patch: Partial<WebHandoff>): WebHandoff {
    const list = this.all();
    const i = list.findIndex((h) => h.id === id);
    if (i < 0) throw new Error("ハンドオフが見つかりません");
    list[i] = { ...list[i]!, ...patch };
    this.save(list);
    return list[i]!;
  }
  private wake(id: string): void {
    for (const fn of this.waiters.get(id) ?? []) fn();
    this.waiters.delete(id);
  }

  get(id: string): WebHandoff | null {
    return this.all().find((h) => h.id === id) ?? null;
  }
  list(filter: { projectId?: string; status?: HandoffStatus } = {}): WebHandoff[] {
    return this.all().filter((h) => (!filter.projectId || h.projectId === filter.projectId) && (!filter.status || h.status === filter.status));
  }

  /** Creates the handoff for a task, or returns the one a previous run (before a restart/pause) left behind. */
  request(input: Pick<WebHandoff, "projectId" | "taskId" | "aiId" | "aiName" | "url" | "level" | "prompt" | "note">): WebHandoff {
    const open = this.all().find((h) => h.taskId === input.taskId && h.aiId === input.aiId && !h.consumed && (h.status === "pending" || h.status === "submitted"));
    if (open) return open;
    const handoff: WebHandoff = { ...input, id: `wh_${randomUUID().slice(0, 8)}`, status: "pending", resultText: null, consumed: false, createdAt: new Date().toISOString(), resolvedAt: null };
    this.save([...this.all(), handoff]);
    this.store.appendEvent({ projectId: input.projectId, taskId: input.taskId, type: "WEB_HANDOFF_REQUESTED", payload: { handoffId: handoff.id, aiId: input.aiId, level: input.level, note: input.note } });
    return handoff;
  }

  submit(id: string, text: string): WebHandoff {
    const h = this.get(id);
    if (!h) throw new Error("ハンドオフが見つかりません");
    if (h.status !== "pending") throw new Error("このハンドオフはすでに処理済みです");
    const body = text.trim();
    if (!body) throw new Error("回答が空です");
    if (body.length > MAX_RESULT_CHARS) throw new Error(`回答が長すぎます(${MAX_RESULT_CHARS}文字まで)`);
    const next = this.update(id, { status: "submitted", resultText: body, resolvedAt: new Date().toISOString() });
    this.store.appendEvent({ projectId: h.projectId, taskId: h.taskId, type: "WEB_HANDOFF_SUBMITTED", payload: { handoffId: id, chars: body.length } });
    this.wake(id);
    return next;
  }

  /** The user does not want to hand this one to a web AI: the task falls back to the default executor. */
  skip(id: string, note?: string): WebHandoff {
    return this.close(id, "skipped", "WEB_HANDOFF_SKIPPED", note);
  }
  /** The user wants a different web AI for this task: the handoff is closed and the executor moves the task over. */
  reassign(id: string, aiId: string): WebHandoff {
    const h = this.get(id);
    if (!h) throw new Error("ハンドオフが見つかりません");
    if (h.status !== "pending") throw new Error("このハンドオフはすでに処理済みです");
    this.update(id, { reassignTo: aiId });
    return this.close(id, "skipped", "WEB_HANDOFF_REASSIGNED", `別のAI(${aiId})に切り替えました`);
  }
  cancel(id: string): WebHandoff {
    return this.close(id, "cancelled", "WEB_HANDOFF_CANCELLED");
  }
  private close(id: string, status: "skipped" | "cancelled", type: string, note?: string): WebHandoff {
    const h = this.get(id);
    if (!h) throw new Error("ハンドオフが見つかりません");
    if (h.status !== "pending") throw new Error("このハンドオフはすでに処理済みです");
    const next = this.update(id, { status, note: note ?? h.note, resolvedAt: new Date().toISOString() });
    this.store.appendEvent({ projectId: h.projectId, taskId: h.taskId, type, payload: { handoffId: id } });
    this.wake(id);
    return next;
  }

  /** A fresh automatic run answered the task: handoffs an earlier attempt left waiting for the person are no longer needed. */
  cancelPendingFor(taskId: string): void {
    for (const h of this.all()) {
      if (h.taskId === taskId && h.status === "pending") this.close(h.id, "cancelled", "WEB_HANDOFF_CANCELLED", "自動で回答を取得できたため、手動の操作は不要になりました");
    }
  }

  markConsumed(id: string): void {
    this.update(id, { consumed: true });
  }

  /** Resolves once the handoff leaves `pending`; rejects when `signal` aborts (pause/cancel). */
  wait(id: string, signal: AbortSignal): Promise<WebHandoff> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const h = this.get(id);
        if (!h) return reject(new Error("ハンドオフが見つかりません"));
        if (h.status !== "pending") return resolve(h);
        return false;
      };
      if (check() !== false) return;
      const onAbort = () => {
        this.waiters.get(id)?.delete(wake);
        reject(new Error("中断されました"));
      };
      const wake = () => {
        signal.removeEventListener("abort", onAbort);
        check();
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      const set = this.waiters.get(id) ?? new Set();
      set.add(wake);
      this.waiters.set(id, set);
    });
  }
}
