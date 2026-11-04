import { describe, expect, it } from "vitest";
import { idleProjects } from "./idleProjects";
import type { ProjectSummary } from "./types";

const DAY = 86_400_000;
const now = Date.parse("2026-11-04T12:00:00Z");
const row = (id: string, status: string | null, daysAgo: number, archived = false) =>
  ({ project: { id, status: archived ? "archived" : "active" }, latestMission: status ? { id: "m", goal: "g", status } : null, lastActivityAt: new Date(now - daysAgo * DAY).toISOString() }) as unknown as ProjectSummary;

describe("idleProjects", () => {
  it("picks only finished, old, closed, not-yet-archived projects", () => {
    const rows = [row("done-old", "completed", 5), row("cancel-old", "cancelled", 9), row("empty-old", null, 4), row("done-new", "completed", 1), row("running-old", "running", 10), row("paused-old", "paused", 10), row("open", "completed", 8), row("already", "completed", 8, true)];
    expect(idleProjects(rows, "open", now).map((r) => r.project.id)).toEqual(["done-old", "cancel-old", "empty-old"]);
  });
});
