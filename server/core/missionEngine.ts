import { transaction } from "./db.ts";
import type { Mission, Store, Task } from "./store.ts";
import type { MissionStatus } from "./schema.ts";
import type { PlanRequest, Planner } from "./planner.ts";
import type { AIBroker } from "./aiBroker.ts";
import { Scheduler } from "./scheduler.ts";
import { applyPlan, refreshReadiness, validatePlan, type PlanDraft } from "./taskGraph.ts";
import { MAX_RETRIES, TERMINAL_TASK_STATUSES, retryTask, transitionMission, transitionTask } from "./taskStateMachine.ts";

// Mission Engine: plan (Planner) -> user approval gate -> run the Task Graph
// through the Scheduler -> completed / failed. Pause, resume, cancel and replan
// are all expressed as legal state transitions.

export type ExecutionResult = { ok: boolean; summary?: string; /** project-relative files the task created or changed */ artifacts?: string[] };
export interface TaskExecutor {
  readonly name: string;
  /** registry adapter_types this executor can run; lets the Broker pick only AIs that can actually execute */
  readonly adapterTypes?: readonly string[];
  execute(task: Task, ctx: { mission: Mission; signal: AbortSignal }): Promise<ExecutionResult>;
}
export interface TaskValidator {
  validate(task: Task, result: ExecutionResult): Promise<{ passed: boolean; detail?: string; level?: number }>;
}

export type PlanProposal = { kind: "initial" | "replan"; draft: PlanDraft; feedback?: string; createdAt: string };

const proposalKey = (missionId: string) => `plan:${missionId}`;

export class MissionEngine {
  readonly scheduler: Scheduler;
  private readonly inFlight = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly loops = new Map<string, Promise<MissionStatus>>();

  constructor(
    private readonly store: Store,
    private readonly deps: { planner: Planner; executor: TaskExecutor; validator?: TaskValidator; broker?: AIBroker; maxParallel?: number; lockTtlMs?: number },
  ) {
    this.scheduler = new Scheduler(store, { maxParallel: deps.maxParallel, lockTtlMs: deps.lockTtlMs });
  }

  // ---- planning (with the user approval gate) -------------------------------
  /** Creates a mission and asks the Planner for a proposal. Nothing runs until approvePlan. */
  async createMission(input: { projectId: string; goal: string; constraints?: string[]; technologyPreferences?: string[]; budgetPolicy?: "free_only" | "allow_paid" }) {
    const mission = this.store.createMission({ ...input, status: "draft" });
    transitionMission(this.store, input.projectId, mission.id, "planning", "planner requested");
    try {
      const proposal = await this.propose(input.projectId, mission.id, "initial");
      return { mission: this.store.getMission(input.projectId, mission.id)!, proposal };
    } catch (err) {
      transitionMission(this.store, input.projectId, mission.id, "failed", `planner error: ${errMsg(err)}`);
      throw err;
    }
  }

  getProposal(missionId: string): PlanProposal | null {
    return this.store.getSetting<PlanProposal | null>(proposalKey(missionId), null);
  }

  private async propose(projectId: string, missionId: string, kind: PlanProposal["kind"], feedback?: string): Promise<PlanProposal> {
    const mission = this.store.getMission(projectId, missionId)!;
    const tasks = this.store.listTasks(projectId).filter((t) => t.missionId === missionId);
    const request: PlanRequest = {
      goal: mission.goal,
      constraints: mission.constraints,
      technologyPreferences: mission.technologyPreferences,
      feedback,
    };
    if (kind === "replan") {
      request.completed = tasks.filter((t) => t.status === "completed").map((t) => ({ role: t.role, objective: t.objective }));
      request.failed = tasks.filter((t) => t.status === "failed" || t.status === "blocked").map((t) => ({ role: t.role, objective: t.objective }));
    }
    const draft = await this.deps.planner.plan(request);
    const problems = validatePlan(draft);
    if (problems.length) throw new Error(`計画が不正です: ${problems.join(" / ")}`);
    const proposal: PlanProposal = { kind, draft, feedback, createdAt: new Date().toISOString() };
    this.store.setSetting(proposalKey(missionId), proposal);
    this.store.appendEvent({ projectId, type: "PLAN_PROPOSED", payload: { missionId, kind, tasks: draft.tasks.length } });
    return proposal;
  }

  /** User approved: materialise the proposal as tasks and move the mission to running. */
  approvePlan(projectId: string, missionId: string): Task[] {
    const mission = this.requireMission(projectId, missionId);
    const proposal = this.getProposal(missionId);
    if (mission.status !== "planning" || !proposal) throw new Error("承認待ちの計画がありません");
    const existing = this.store.listTasks(projectId).filter((t) => t.missionId === missionId);
    const created = transaction(this.store.db, () => {
      if (proposal.kind === "replan") {
        for (const t of existing) if (!TERMINAL_TASK_STATUSES.includes(t.status)) transitionTask(this.store, projectId, t.id, "cancelled", "replaced by replan");
      }
      const base = existing.reduce((m, t) => Math.max(m, t.position + 1), 0);
      const tasks = applyPlan(this.store, projectId, missionId, proposal.draft, base);
      transitionMission(this.store, projectId, missionId, "running", "plan approved");
      return tasks;
    });
    this.store.setSetting(proposalKey(missionId), null);
    this.store.appendEvent({ projectId, type: "PLAN_APPROVED", payload: { missionId, tasks: created.length } });
    return created;
  }

  /** User asked for changes: discard the proposal and plan again with their feedback. */
  async rejectPlan(projectId: string, missionId: string, feedback: string): Promise<PlanProposal> {
    const mission = this.requireMission(projectId, missionId);
    const prev = this.getProposal(missionId);
    if (mission.status !== "planning" || !prev) throw new Error("承認待ちの計画がありません");
    this.store.appendEvent({ projectId, type: "PLAN_REJECTED", payload: { missionId, feedback } });
    return this.propose(projectId, missionId, prev.kind, feedback);
  }

  /**
   * Replan: ask for a new proposal given what is completed / failed. The old
   * unfinished tasks are only cancelled when the new plan is approved.
   */
  async replan(projectId: string, missionId: string, feedback?: string): Promise<PlanProposal> {
    const mission = this.requireMission(projectId, missionId);
    if (this.hasInFlight(missionId)) throw new Error("実行中のタスクがあります。先に一時停止してください");
    if (mission.status === "completed" || mission.status === "cancelled") throw new Error("終了したミッションは再計画できません");
    if (mission.status !== "planning") transitionMission(this.store, projectId, missionId, "planning", "replan");
    try {
      return await this.propose(projectId, missionId, "replan", feedback);
    } catch (err) {
      // keep the mission recoverable: the old graph is untouched
      transitionMission(this.store, projectId, missionId, "failed", `replan error: ${errMsg(err)}`);
      throw err;
    }
  }

  // ---- pause / resume / cancel ---------------------------------------------
  async pause(projectId: string, missionId: string): Promise<void> {
    this.requireMission(projectId, missionId);
    transitionMission(this.store, projectId, missionId, "paused", "user pause");
    for (const [key, f] of this.inFlight) if (key.startsWith(`${missionId}:`)) f.controller.abort();
    await this.loops.get(missionId)?.catch(() => {});
  }

  /** paused -> running, then runs the graph again. Resolves with the mission's final status of that run. */
  resume(projectId: string, missionId: string): Promise<MissionStatus> {
    this.requireMission(projectId, missionId);
    transitionMission(this.store, projectId, missionId, "running", "user resume");
    return this.run(projectId, missionId);
  }

  async cancel(projectId: string, missionId: string): Promise<void> {
    this.requireMission(projectId, missionId);
    transitionMission(this.store, projectId, missionId, "cancelled", "user cancel");
    for (const [key, f] of this.inFlight) if (key.startsWith(`${missionId}:`)) f.controller.abort();
    await this.loops.get(missionId)?.catch(() => {});
    this.settleCancelled(projectId, missionId);
  }

  // ---- running ------------------------------------------------------------
  /** Drives the mission until it completes, fails, is paused or cancelled. Idempotent while a loop is active. */
  run(projectId: string, missionId: string): Promise<MissionStatus> {
    const active = this.loops.get(missionId);
    if (active) return active;
    const loop = this.loop(projectId, missionId).finally(() => this.loops.delete(missionId));
    this.loops.set(missionId, loop);
    return loop;
  }

  private async loop(projectId: string, missionId: string): Promise<MissionStatus> {
    this.recover(projectId, missionId);
    for (;;) {
      const mission = this.requireMission(projectId, missionId);
      if (mission.status !== "running") {
        await this.settleInFlight(missionId);
        if (mission.status === "cancelled") this.settleCancelled(projectId, missionId);
        return this.requireMission(projectId, missionId).status;
      }
      refreshReadiness(this.store, projectId, missionId, MAX_RETRIES);
      let tasks = this.missionTasks(projectId, missionId);

      // automatic retry, bounded by MAX_RETRIES
      for (const t of tasks.filter((x) => x.status === "failed" && x.retryCount < MAX_RETRIES)) retryTask(this.store, projectId, t.id);
      tasks = this.missionTasks(projectId, missionId);

      const ready = tasks.filter((t) => t.status === "ready");
      for (const task of this.scheduler.select(projectId, ready, this.inFlight.size)) this.start(mission, task);

      if (this.hasInFlight(missionId)) {
        await Promise.race([...this.inFlight.entries()].filter(([k]) => k.startsWith(`${missionId}:`)).map(([, f]) => f.promise));
        continue;
      }
      // nothing of this mission is running and nothing could start
      tasks = this.missionTasks(projectId, missionId);
      if (this.inFlight.size > 0 && tasks.some((t) => t.status === "ready")) {
        // slots are taken by another mission; wait for one to free up
        await Promise.race([...this.inFlight.values()].map((f) => f.promise));
        continue;
      }
      if (tasks.length > 0 && tasks.every((t) => TERMINAL_TASK_STATUSES.includes(t.status)) && tasks.some((t) => t.status === "completed")) {
        transitionMission(this.store, projectId, missionId, "completed", "all tasks completed");
      } else if (tasks.some((t) => t.status === "ready")) {
        // a write task is waiting on a lock held outside this engine; do not spin
        transitionMission(this.store, projectId, missionId, "failed", "write lock unavailable");
      } else {
        transitionMission(this.store, projectId, missionId, "failed", "no runnable tasks (retries exhausted or blocked)");
      }
      return this.requireMission(projectId, missionId).status;
    }
  }

  private start(mission: Mission, task: Task): void {
    const { projectId } = task;
    const key = `${mission.id}:${task.id}`;
    const controller = new AbortController();
    this.assignAi(mission, task);
    transitionTask(this.store, projectId, task.id, "running", "scheduled");
    const promise = this.execute(mission, task, controller)
      .catch((err) => this.store.appendEvent({ projectId, taskId: task.id, type: "ENGINE_ERROR", payload: { message: errMsg(err) } }))
      .finally(() => {
        this.scheduler.release(projectId, task);
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, { controller, promise });
  }

  /** Broker picks the AI for a task that has none yet. Advisory: a Broker failure never stops the task. */
  private assignAi(mission: Mission, task: Task): void {
    const { broker, executor } = this.deps;
    if (!broker || task.selectedAi) return;
    try {
      const decision = broker.select(task, { budgetPolicy: mission.budgetPolicy, executableAdapters: executor.adapterTypes ? [...executor.adapterTypes] : undefined });
      const payload = { capability: decision.capability, confidence: decision.confidence, needsReview: decision.needsReview, selected: decision.selected?.aiId ?? null, excluded: decision.excluded };
      if (!decision.selected) {
        this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AI_SELECTION_NONE", payload });
        return;
      }
      this.store.setTaskSelectedAi(task.projectId, task.id, decision.selected.aiId);
      this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AI_SELECTED", payload });
      this.store.addDecision({
        projectId: task.projectId,
        title: `AI選定: ${task.role} → ${decision.selected.name}`,
        reason: `${decision.reason}(信頼度 ${decision.confidence} / ${decision.confidenceLabel})`,
        alternatives: decision.ranked.slice(1, 4).map((c) => `${c.name} (${c.score10}/10)`),
        rejectedBecause: decision.excluded.length ? decision.excluded.map((e) => `${e.name}: ${e.reason}`).join(" / ") : null,
      });
    } catch (err) {
      this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AI_SELECTION_ERROR", payload: { message: errMsg(err) } });
    }
  }

  private async execute(mission: Mission, task: Task, controller: AbortController): Promise<void> {
    const { projectId } = task;
    let result: ExecutionResult;
    try {
      result = await this.deps.executor.execute(this.store.getTask(projectId, task.id)!, { mission, signal: controller.signal });
    } catch (err) {
      result = { ok: false, summary: errMsg(err) };
    }
    if (controller.signal.aborted) {
      const cancelled = this.store.getMission(projectId, mission.id)?.status === "cancelled";
      this.store.recordAiRun({ projectId, taskId: task.id, executor: this.deps.executor.name, status: "cancelled", summary: result.summary });
      transitionTask(this.store, projectId, task.id, cancelled ? "cancelled" : "paused", cancelled ? "mission cancelled" : "mission paused");
      return;
    }
    this.store.recordAiRun({ projectId, taskId: task.id, executor: this.deps.executor.name, status: result.ok ? "succeeded" : "failed", summary: result.summary });
    if (!result.ok) {
      transitionTask(this.store, projectId, task.id, "failed", result.summary ?? "execution failed");
      return;
    }
    transitionTask(this.store, projectId, task.id, "validation", "executed");
    let verdict: { passed: boolean; detail?: string; level?: number } = { passed: true };
    if (this.deps.validator) {
      try {
        verdict = await this.deps.validator.validate(this.store.getTask(projectId, task.id)!, result);
      } catch (err) {
        verdict = { passed: false, detail: errMsg(err) };
      }
    }
    this.store.addValidation({ projectId, taskId: task.id, level: verdict.level ?? 1, status: verdict.passed ? "passed" : "failed", detail: verdict.detail });
    transitionTask(this.store, projectId, task.id, verdict.passed ? "completed" : "failed", verdict.detail);
  }

  /** After a crash or a pause: tasks left mid-flight go back to ready (resume). */
  recover(projectId: string, missionId: string): void {
    for (const t of this.missionTasks(projectId, missionId)) {
      if (this.inFlight.has(`${missionId}:${t.id}`)) continue;
      if (t.status === "running" || t.status === "waiting" || t.status === "validation" || t.status === "paused") {
        transitionTask(this.store, projectId, t.id, "ready", "recovered");
        this.scheduler.release(projectId, t);
      }
    }
  }

  private settleCancelled(projectId: string, missionId: string): void {
    for (const t of this.missionTasks(projectId, missionId)) {
      if (!TERMINAL_TASK_STATUSES.includes(t.status) && !this.inFlight.has(`${missionId}:${t.id}`)) transitionTask(this.store, projectId, t.id, "cancelled", "mission cancelled");
    }
  }

  private async settleInFlight(missionId: string): Promise<void> {
    await Promise.all([...this.inFlight.entries()].filter(([k]) => k.startsWith(`${missionId}:`)).map(([, f]) => f.promise));
  }

  private hasInFlight(missionId: string): boolean {
    for (const k of this.inFlight.keys()) if (k.startsWith(`${missionId}:`)) return true;
    return false;
  }

  private missionTasks(projectId: string, missionId: string): Task[] {
    return this.store.listTasks(projectId).filter((t) => t.missionId === missionId);
  }

  private requireMission(projectId: string, missionId: string): Mission {
    const m = this.store.getMission(projectId, missionId);
    if (!m) throw new Error("ミッションが見つかりません");
    return m;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
