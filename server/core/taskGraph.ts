import { z } from "zod";
import { transaction } from "./db.ts";
import type { Store, Task } from "./store.ts";
import { transitionTask } from "./taskStateMachine.ts";

// Dynamic Task Graph (spec §16): a plan is a DAG of tasks addressed by local
// keys; applyPlan turns it into task rows + task_edges.

export const MAX_PLAN_TASKS = 50;

export const plannedTaskSchema = z.object({
  key: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  objective: z.string().max(4000).default(""),
  inputs: z.array(z.string()).default([]),
  expectedOutputs: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
});

export const planDraftSchema = z.object({
  summary: z.string().max(4000).default(""),
  tasks: z.array(plannedTaskSchema).min(1).max(MAX_PLAN_TASKS),
});

export type PlannedTask = z.infer<typeof plannedTaskSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;

/** Returns human-readable problems; an empty array means the plan is valid. */
export function validatePlan(draft: PlanDraft): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const t of draft.tasks) {
    if (keys.has(t.key)) problems.push(`キー重複: ${t.key}`);
    keys.add(t.key);
  }
  for (const t of draft.tasks) {
    for (const d of t.dependsOn) {
      if (d === t.key) problems.push(`自己依存: ${t.key}`);
      else if (!keys.has(d)) problems.push(`存在しない依存先: ${t.key} -> ${d}`);
    }
  }
  if (problems.length === 0) {
    const cycle = findCycle(draft.tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOn })));
    if (cycle) problems.push(`循環依存: ${cycle.join(" -> ")}`);
  }
  return problems;
}

/** Finds a dependency cycle (DFS); returns the node path or null. */
export function findCycle(nodes: { id: string; dependsOn: string[] }[]): string[] | null {
  const deps = new Map(nodes.map((n) => [n.id, n.dependsOn]));
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.has(d)) {
        const c = visit(d);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of nodes) {
    if (!state.has(n.id)) {
      const c = visit(n.id);
      if (c) return c;
    }
  }
  return null;
}

/**
 * Materialises a validated plan as pending tasks in one transaction.
 * `existingIds` lets a replan depend on already-completed tasks by real id.
 */
export function applyPlan(store: Store, projectId: string, missionId: string, draft: PlanDraft, basePosition = 0): Task[] {
  const problems = validatePlan(draft);
  if (problems.length > 0) throw new Error(`計画が不正です: ${problems.join(" / ")}`);
  return transaction(store.db, () => {
    const idByKey = new Map<string, string>();
    draft.tasks.forEach((t, i) => {
      const created = store.createTask({
        projectId,
        missionId,
        role: t.role,
        objective: t.objective,
        inputs: t.inputs,
        expectedOutputs: t.expectedOutputs,
        constraints: t.constraints,
        position: basePosition + i,
      });
      idByKey.set(t.key, created.id);
    });
    for (const t of draft.tasks) {
      for (const d of t.dependsOn) store.addDependency(projectId, idByKey.get(t.key)!, idByKey.get(d)!);
    }
    return draft.tasks.map((t) => store.getTask(projectId, idByKey.get(t.key)!)!);
  });
}

/**
 * Re-evaluates the graph: pending -> ready when every dependency is completed;
 * pending/ready -> blocked when a dependency can never complete (cancelled, or
 * failed with no retries left); blocked -> pending when its dependencies recovered.
 * Returns the ids that changed.
 */
export function refreshReadiness(store: Store, projectId: string, missionId: string, maxRetries: number, noRetry: (t: Task) => boolean = () => false): string[] {
  const changed: string[] = [];
  const tasks = store.listTasks(projectId).filter((t) => t.missionId === missionId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dead = (t: Task) => t.status === "cancelled" || (t.status === "failed" && (t.retryCount >= maxRetries || noRetry(t))) || t.status === "blocked";
  // Iterate to a fixed point so blocking propagates down a chain.
  for (let pass = 0; pass <= tasks.length; pass++) {
    let moved = false;
    for (const t of tasks) {
      const deps = t.dependsOn.map((d) => byId.get(d)).filter((d): d is Task => !!d);
      if (t.status === "pending" || t.status === "ready") {
        if (deps.some(dead)) {
          transitionTask(store, projectId, t.id, "blocked", "dependency cannot complete");
        } else if (t.status === "pending" && deps.every((d) => d.status === "completed")) {
          transitionTask(store, projectId, t.id, "ready", "dependencies completed");
        } else continue;
      } else if (t.status === "blocked" && !deps.some(dead)) {
        transitionTask(store, projectId, t.id, "pending", "dependencies recovered");
      } else continue;
      byId.set(t.id, store.getTask(projectId, t.id)!);
      Object.assign(t, byId.get(t.id));
      changed.push(t.id);
      moved = true;
    }
    if (!moved) break;
  }
  return [...new Set(changed)];
}
