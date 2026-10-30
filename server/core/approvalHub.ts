import { randomUUID } from "node:crypto";
import type { ApprovalGate, ApprovalRequest } from "./permissionPolicy.ts";
import type { Store } from "./store.ts";

// Approval requests (spec §24): when a task needs a level above the default, the
// executor waits here until the user answers in the UI. Pending requests live in
// memory only: after a restart the task is recovered and simply asks again.

export type PendingApproval = Omit<ApprovalRequest, "signal"> & { id: string; createdAt: string };

// 0 = wait until the user answers. A request used to be refused after 30 minutes, which failed the task (and the
// tasks depending on it) for a user who simply had not looked yet.
export const DEFAULT_APPROVAL_TIMEOUT_MS = 0;

export class ApprovalHub {
  private readonly pending = new Map<string, { approval: PendingApproval; settle: (approved: boolean, why: string) => void }>();

  constructor(
    private readonly store: Store,
    private readonly timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
  ) {}

  /** Pass to `new PermissionPolicy(granted, hub.gate)`. Resolves false on deny, when the task is aborted, or (only if a timeout is set) on timeout. */
  readonly gate: ApprovalGate = (req) =>
    new Promise<boolean>((resolve) => {
      const { signal, ...rest } = req;
      const approval: PendingApproval = { ...rest, id: `ap_${randomUUID().slice(0, 8)}`, createdAt: new Date().toISOString() };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => settle(false, "aborted");
      const settle = (approved: boolean, why: string) => {
        if (!this.pending.delete(approval.id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.store.appendEvent({ projectId: approval.projectId, taskId: approval.taskId, type: approved ? "APPROVAL_GRANTED" : "APPROVAL_REFUSED", payload: { approvalId: approval.id, level: approval.level, why } });
        resolve(approved);
      };
      if (signal?.aborted) return resolve(false);
      this.pending.set(approval.id, { approval, settle });
      if (this.timeoutMs > 0) {
        timer = setTimeout(() => settle(false, "timeout"), this.timeoutMs);
        timer.unref?.();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.store.appendEvent({ projectId: approval.projectId, taskId: approval.taskId, type: "APPROVAL_REQUESTED", payload: { approvalId: approval.id, level: approval.level, reason: approval.reason } });
    });

  list(projectId?: string): PendingApproval[] {
    return [...this.pending.values()].map((p) => p.approval).filter((a) => !projectId || a.projectId === projectId);
  }

  resolve(id: string, approved: boolean): void {
    const entry = this.pending.get(id);
    if (!entry) throw new Error("この承認依頼はすでに処理済みか、期限切れです");
    entry.settle(approved, approved ? "user approved" : "user denied");
  }
}
