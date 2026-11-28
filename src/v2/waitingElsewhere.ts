import type { Approval, Handoff, Project } from "./types";
import type { Notice } from "./notify";

// Requests that wait for the person in any project: an approval never refuses itself, so one in a project that is
// not on screen has to be shown, or its work waits for ever.

export type Waiting = { approvals: number; handoffs: number };
export type WaitingElsewhere = Waiting & { projectId: string; name: string };

export function waitingByProject(approvals: Approval[], handoffs: Handoff[]): Record<string, Waiting> {
  const out: Record<string, Waiting> = {};
  const of = (id: string) => (out[id] ??= { approvals: 0, handoffs: 0 });
  for (const a of approvals) of(a.projectId).approvals++;
  for (const h of handoffs) of(h.projectId).handoffs++;
  return out;
}

export const waitingLabel = (w: Waiting) => (w.approvals > 0 ? "あなたの許可待ち" : "あなたの操作待ち");

/** The other projects that wait for the person (a project that no longer exists is left out). */
export function waitingElsewhere(approvals: Approval[], handoffs: Handoff[], projects: Project[], currentId: string | null): WaitingElsewhere[] {
  return Object.entries(waitingByProject(approvals, handoffs)).flatMap(([projectId, w]) => {
    const project = projects.find((p) => p.id === projectId);
    return project && projectId !== currentId ? [{ projectId, name: project.name, ...w }] : [];
  });
}

/**
 * Notifications for what newly started waiting in a project that is not on screen. `seen` (every waiting id so far) is
 * updated in place; null is the first load, when nothing is announced for what already waited.
 */
export function elsewhereNotices(seen: Set<string> | null, approvals: Approval[], handoffs: Handoff[], projects: Project[], currentId: string | null): { seen: Set<string>; notices: Notice[] } {
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? "別のプロジェクト";
  const all = [
    ...approvals.map((a) => ({ id: a.id, projectId: a.projectId, tag: `appr-${a.id}`, title: "承認が必要です", body: a.reason })),
    ...handoffs.map((h) => ({ id: h.id, projectId: h.projectId, tag: `hand-${h.id}`, title: `${h.aiName} の回答待ちです`, body: "ホームを開いて、手順に沿って進めてください" })),
  ];
  const notices = seen ? all.filter((x) => x.projectId !== currentId && !seen.has(x.id)).map((x) => ({ tag: x.tag, title: x.title, body: `「${name(x.projectId)}」: ${x.body.slice(0, 80)}` })) : [];
  return { seen: new Set(all.map((x) => x.id)), notices };
}
