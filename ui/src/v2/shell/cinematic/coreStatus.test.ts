import { describe, expect, test } from "bun:test";
import { deriveCoreStatus } from "./coreStatus";

describe("deriveCoreStatus", () => {
  test("no pinned project -> IDLE", () => {
    expect(deriveCoreStatus({ hasActiveProject: false, totalTasks: 0, taskCounts: {} })).toBe("IDLE");
  });

  test("pinned project, no tasks yet -> IDLE", () => {
    expect(deriveCoreStatus({ hasActiveProject: true, totalTasks: 0, taskCounts: {} })).toBe("IDLE");
  });

  test("all tasks COMPLETED -> IDLE (nothing left to do)", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 3, taskCounts: { COMPLETED: 3 } }),
    ).toBe("IDLE");
  });

  test("PENDING tasks -> ANALYZING", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { PENDING: 1 } }),
    ).toBe("ANALYZING");
  });

  test("READY tasks -> ANALYZING", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { READY: 1 } }),
    ).toBe("ANALYZING");
  });

  test("PLANNING tasks -> PLANNING", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { PLANNING: 1 } }),
    ).toBe("PLANNING");
  });

  test("RUNNING tasks -> EXECUTING", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { RUNNING: 1 } }),
    ).toBe("EXECUTING");
  });

  test("QA tasks -> VERIFYING", () => {
    expect(deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { QA: 1 } })).toBe(
      "VERIFYING",
    );
  });

  test("REVIEW tasks -> VERIFYING", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { REVIEW: 1 } }),
    ).toBe("VERIFYING");
  });

  test("WAITING tasks -> WAITING", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { WAITING: 1 } }),
    ).toBe("WAITING");
  });

  test("BLOCKED tasks -> BLOCKED", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { BLOCKED: 1 } }),
    ).toBe("BLOCKED");
  });

  test("FAILED tasks -> ERROR", () => {
    expect(
      deriveCoreStatus({ hasActiveProject: true, totalTasks: 1, taskCounts: { FAILED: 1 } }),
    ).toBe("ERROR");
  });

  test("priority: FAILED outranks everything else present at once", () => {
    expect(
      deriveCoreStatus({
        hasActiveProject: true,
        totalTasks: 6,
        taskCounts: { RUNNING: 1, WAITING: 1, BLOCKED: 1, QA: 1, FAILED: 1, COMPLETED: 1 },
      }),
    ).toBe("ERROR");
  });

  test("priority: BLOCKED outranks WAITING/VERIFYING/EXECUTING when no FAILED", () => {
    expect(
      deriveCoreStatus({
        hasActiveProject: true,
        totalTasks: 4,
        taskCounts: { RUNNING: 1, WAITING: 1, BLOCKED: 1, QA: 1 },
      }),
    ).toBe("BLOCKED");
  });

  test("priority: WAITING outranks VERIFYING/EXECUTING when no BLOCKED/FAILED", () => {
    expect(
      deriveCoreStatus({
        hasActiveProject: true,
        totalTasks: 3,
        taskCounts: { RUNNING: 1, WAITING: 1, QA: 1 },
      }),
    ).toBe("WAITING");
  });

  test("priority: VERIFYING outranks EXECUTING when no WAITING/BLOCKED/FAILED", () => {
    expect(
      deriveCoreStatus({
        hasActiveProject: true,
        totalTasks: 2,
        taskCounts: { RUNNING: 1, QA: 1 },
      }),
    ).toBe("VERIFYING");
  });
});
