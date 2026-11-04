import type { ProjectSummary } from "./types";

const IDLE_DAYS = 3;

/** Projects that can be put away in one go: not open, not already put away, nothing running or waiting, and untouched for a few days. */
export function idleProjects(rows: ProjectSummary[], currentId: string | null, now = Date.now()): ProjectSummary[] {
  return rows.filter((r) => {
    if (r.project.id === currentId || r.project.status === "archived") return false;
    if (r.openMissions?.length) return false; // an unfinished request would make the server refuse
    const st = r.latestMission?.status;
    if (st && !["completed", "failed", "cancelled", "draft"].includes(st)) return false;
    return now - Date.parse(r.lastActivityAt) >= IDLE_DAYS * 86_400_000;
  });
}

export { IDLE_DAYS };
