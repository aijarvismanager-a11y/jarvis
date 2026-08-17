import { describe, expect, test } from "bun:test";
import { deriveTaskFlow, TASK_FLOW_STEPS, TASK_FLOW_EXCEPTIONS } from "./taskFlow";

describe("deriveTaskFlow", () => {
  test("empty taskCounts -> every step count is 0, no exceptions", () => {
    const { steps, exceptions } = deriveTaskFlow({});
    expect(steps).toHaveLength(TASK_FLOW_STEPS.length);
    for (const step of steps) expect(step.count).toBe(0);
    expect(exceptions).toHaveLength(0);
  });

  test("steps are returned in pipeline order, matching TASK_FLOW_STEPS", () => {
    const { steps } = deriveTaskFlow({});
    expect(steps.map((s) => s.status)).toEqual(TASK_FLOW_STEPS);
  });

  test("real counts pass through unchanged for each step", () => {
    const { steps } = deriveTaskFlow({ PENDING: 2, RUNNING: 1, QA: 3, COMPLETED: 5 });
    const byStatus = Object.fromEntries(steps.map((s) => [s.status, s.count]));
    expect(byStatus.PENDING).toBe(2);
    expect(byStatus.RUNNING).toBe(1);
    expect(byStatus.QA).toBe(3);
    expect(byStatus.COMPLETED).toBe(5);
    expect(byStatus.PLANNING).toBe(0);
  });

  test("parallel tasks in multiple steps at once are all shown, not collapsed to one 'current' step", () => {
    // Regression guard for the Manager Agent's wave scheduler: PENDING,
    // RUNNING, and QA can all be non-zero simultaneously.
    const { steps } = deriveTaskFlow({ PENDING: 1, RUNNING: 2, QA: 1 });
    const nonZero = steps.filter((s) => s.count > 0).map((s) => s.status).sort();
    expect(nonZero).toEqual(["PENDING", "QA", "RUNNING"]); // already alphabetical
  });

  test("exception statuses with zero count are omitted entirely", () => {
    const { exceptions } = deriveTaskFlow({ RUNNING: 1 });
    expect(exceptions).toHaveLength(0);
  });

  test("exception statuses with a real count are surfaced as exceptions, not steps", () => {
    const { steps, exceptions } = deriveTaskFlow({ BLOCKED: 2, FAILED: 1 });
    expect(steps.every((s) => TASK_FLOW_STEPS.includes(s.status))).toBe(true);
    expect(exceptions).toEqual([
      { status: "BLOCKED", count: 2 },
      { status: "FAILED", count: 1 },
    ]);
  });

  test("TASK_FLOW_STEPS and TASK_FLOW_EXCEPTIONS partition the 11-state enum with no overlap", () => {
    const all = [...TASK_FLOW_STEPS, ...TASK_FLOW_EXCEPTIONS];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(11);
  });
});
