import { describe, expect, test } from "bun:test";
import { pickDefaultFocusTask, taskUrgencyRank } from "./taskFocus";
import type { ProjectTask } from "../../rooms/aiManager/useAIManagerData";

function task(id: string, status: ProjectTask["project_status"]): ProjectTask {
  return {
    id,
    project_id: "p1",
    parent_task_id: null,
    title: id,
    priority: "normal",
    project_status: status,
    assigned_agent: null,
    assigned_provider: null,
    assigned_model: null,
    dependencies: [],
    artifacts: [],
    next_agent: null,
    approval_required: false,
    retry_count: 0,
    max_retries: 3,
    qa_report: null,
    healing_attempts: [],
  };
}

describe("taskUrgencyRank", () => {
  test("FAILED ranks most urgent", () => {
    expect(taskUrgencyRank("FAILED")).toBeLessThan(taskUrgencyRank("BLOCKED"));
  });
  test("null status ranks alongside PENDING/READY", () => {
    expect(taskUrgencyRank(null)).toBe(taskUrgencyRank("PENDING"));
  });
  test("COMPLETED and CANCELLED rank least urgent", () => {
    expect(taskUrgencyRank("COMPLETED")).toBeGreaterThan(taskUrgencyRank("RUNNING"));
    expect(taskUrgencyRank("CANCELLED")).toBe(taskUrgencyRank("COMPLETED"));
  });
});

describe("pickDefaultFocusTask", () => {
  test("empty list -> null", () => {
    expect(pickDefaultFocusTask([])).toBeNull();
  });

  test("picks the single task when there's only one", () => {
    const t = task("a", "RUNNING");
    expect(pickDefaultFocusTask([t])).toBe(t);
  });

  test("FAILED outranks everything else present at once", () => {
    const tasks = [task("running", "RUNNING"), task("failed", "FAILED"), task("waiting", "WAITING")];
    expect(pickDefaultFocusTask(tasks)!.id).toBe("failed");
  });

  test("BLOCKED outranks WAITING/RUNNING when no FAILED", () => {
    const tasks = [task("running", "RUNNING"), task("blocked", "BLOCKED"), task("waiting", "WAITING")];
    expect(pickDefaultFocusTask(tasks)!.id).toBe("blocked");
  });

  test("first match wins on a tie", () => {
    const tasks = [task("first", "RUNNING"), task("second", "RUNNING")];
    expect(pickDefaultFocusTask(tasks)!.id).toBe("first");
  });

  test("all COMPLETED -> still returns one, not null", () => {
    const tasks = [task("a", "COMPLETED"), task("b", "COMPLETED")];
    expect(pickDefaultFocusTask(tasks)!.id).toBe("a");
  });
});
