import { describe, expect, it } from "vitest";
import type { Ctx } from "./context";
import { replySummary } from "./dock";
import { failedCauses, taskStatusLabel, troubleText } from "./labels";
import { summaryLine } from "./screens/summaryLine";
import type { MissionStatus, Task, TaskStatus } from "./types";

const tasks = (...s: TaskStatus[]) => s.map((status, i) => ({ id: `t${i}`, role: "testing", status, selectedAi: null }) as Task);
const ctx = (status: MissionStatus) => ({ mission: { status }, approvals: [], services: [] }) as unknown as Ctx;
const refused = { t0: "コマンド「npm install」の実行が許可されなかったため、この作業は進められませんでした" };

describe("tasks that went wrong", () => {
  it("counts the failed task apart from the one stuck behind it", () => {
    expect(troubleText(tasks("failed", "blocked"))).toBe("うまくいかなかった作業 1件、その後ろで進めなかった作業 1件");
    expect(replySummary(tasks("failed", "blocked"), "failed", 0).result).toBe("途中で止まりました(うまくいかなかった作業 1件、その後ろで進めなかった作業 1件)");
  });
  it("does not call a refused task a failure", () => {
    expect(replySummary(tasks("failed", "blocked"), "failed", 0, refused).result).toBe("途中で止まりました(許可しなかった作業 1件、その後ろで進めなかった作業 1件)");
    expect(taskStatusLabel("failed", "failed", refused.t0)).toBe("許可しなかった");
    expect(taskStatusLabel("failed", "failed", "試験の失敗")).toBe("失敗");
  });
  it("gives each failed task's own reason", () => {
    expect(failedCauses(tasks("failed", "blocked"), { t0: "原因A", t1: "後ろ" })).toEqual(["「テスト」の作業: 原因A"]);
  });
});

describe("a request whose direction was changed", () => {
  it("says it waits for the new plan, not for the next task", () => {
    expect(summaryLine(tasks("paused", "pending"), ctx("planning"))).toContain("計画の段階です");
  });
  it("does not count replaced tasks as work to do", () => {
    expect(replySummary(tasks("cancelled", "cancelled", "completed"), "completed", 0).did).toBe("1件の作業のうち、1件が終わりました");
    expect(replySummary(tasks("cancelled", "completed"), "cancelled", 0).did).toBe("2件の作業のうち、1件が終わりました");
  });
  it("does not report replaced tasks as left undone once the request is finished", () => {
    expect(summaryLine(tasks("cancelled", "cancelled", "completed"), ctx("completed"))).toContain("すべての作業が終わりました");
    expect(taskStatusLabel("cancelled", "completed")).toBe("置き換え済み");
    expect(taskStatusLabel("cancelled", "cancelled")).toBe("中止");
  });
});
