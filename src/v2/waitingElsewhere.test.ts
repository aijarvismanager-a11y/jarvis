import { describe, expect, it } from "vitest";
import { missionFailureReason } from "./labels";
import { elsewhereNotices, waitingElsewhere } from "./waitingElsewhere";
import type { Approval, Project } from "./types";

const approval = (id: string, projectId: string) => ({ id, projectId, taskId: "t", level: "NETWORK", reason: "追加します", createdAt: "" }) as Approval;
const projects = [{ id: "a", name: "A" }, { id: "b", name: "B" }] as Project[];

describe("requests waiting in another project", () => {
  it("are listed, except those of the project on screen", () => {
    expect(waitingElsewhere([approval("1", "a"), approval("2", "b")], [], projects, "a")).toEqual([{ projectId: "b", name: "B", approvals: 1, handoffs: 0 }]);
  });
  it("are announced once, and not on the first load", () => {
    const first = elsewhereNotices(null, [approval("1", "b")], [], projects, "a");
    expect(first.notices).toEqual([]);
    const next = elsewhereNotices(first.seen, [approval("1", "b"), approval("2", "b"), approval("3", "a")], [], projects, "a");
    expect(next.notices.map((n) => n.tag)).toEqual(["appr-2"]);
    expect(next.notices[0].body).toContain("「B」");
  });
});

describe("the history", () => {
  it("gives the newest reason of a request that failed twice", () => {
    const failed = (reason: string) => ({ type: "MISSION_STATUS_CHANGED", payload: { missionId: "m", to: "failed", reason } });
    expect(missionFailureReason([failed("old"), failed("new")], "m")).toBe("new");
  });
});
