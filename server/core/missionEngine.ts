import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { transaction } from "./db.ts";
import { projectDir } from "./paths.ts";
import type { Mission, Store, Task } from "./store.ts";
import type { MissionStatus } from "./schema.ts";
import type { PlanRequest, Planner } from "./planner.ts";
import { capabilityForTaskRole, type AIBroker } from "./aiBroker.ts";
import { recordOutcome, tuningOf } from "./scoreTuning.ts";
import { reviewTask, type AiReviewer } from "./aiReview.ts";
import { Scheduler } from "./scheduler.ts";
import { applyPlan, refreshReadiness, validatePlan, type PlanDraft } from "./taskGraph.ts";
import { MAX_RETRIES, TERMINAL_TASK_STATUSES, retryTask, transitionMission, transitionTask } from "./taskStateMachine.ts";

// Mission Engine: plan (Planner) -> user approval gate -> run the Task Graph
// through the Scheduler -> completed / failed. Pause, resume, cancel and replan
// are all expressed as legal state transitions.

export type ExecutionResult = {
  ok: boolean;
  summary?: string;
  /** project-relative files the task created or changed */
  artifacts?: string[];
  /** Set by executors that route to several AIs, so ai_runs records who really ran the task and how. */
  executor?: string;
  aiId?: string;
  automationLevel?: number;
  /** false = retrying cannot help (e.g. an approval was denied), so the engine skips the automatic retries. */
  retryable?: boolean;
  /** Measured by the engine when the executor does not report it. */
  durationMs?: number;
  /** API-equivalent cost reported by the AI CLI (a subscription plan is not billed per run). */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
};
export interface TaskExecutor {
  readonly name: string;
  /** registry adapter_types this executor can run; lets the Broker pick only AIs that can actually execute */
  readonly adapterTypes?: readonly string[];
  /** Same, for one specific task, when the executor routes some tasks differently (e.g. code edits never go to a web AI). */
  adapterTypesFor?(task: Task): readonly string[];
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
  private readonly noRetry = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly deps: { planner: Planner; executor: TaskExecutor; validator?: TaskValidator; broker?: AIBroker; /** AI B Review (spec §57): a second AI checks important tasks */ aiReview?: { reviewer: AiReviewer }; maxParallel?: number; lockTtlMs?: number },
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

  /** Starts a mission from a ready-made plan (no Planner, no approval step), e.g. the analysis of an imported project. */
  startFixedMission(input: { projectId: string; goal: string; draft: PlanDraft }): Mission {
    const problems = validatePlan(input.draft);
    if (problems.length) throw new Error(`計画が不正です: ${problems.join(" / ")}`);
    const mission = this.store.createMission({ projectId: input.projectId, goal: input.goal, status: "draft" });
    transaction(this.store.db, () => {
      transitionMission(this.store, input.projectId, mission.id, "planning", "fixed plan");
      applyPlan(this.store, input.projectId, mission.id, input.draft, 0);
      transitionMission(this.store, input.projectId, mission.id, "running", "fixed plan started");
    });
    return this.store.getMission(input.projectId, mission.id)!;
  }

  getProposal(missionId: string): PlanProposal | null {
    return this.store.getSetting<PlanProposal | null>(proposalKey(missionId), null);
  }

  private async propose(projectId: string, missionId: string, kind: PlanProposal["kind"], feedback?: string): Promise<PlanProposal> {
    const mission = this.store.getMission(projectId, missionId)!;
    const tasks = this.store.listTasks(projectId).filter((t) => t.missionId === missionId);
    mkdirSync(projectDir(this.store.projectsRoot, projectId), { recursive: true }); // the planner runs from here
    const request: PlanRequest = {
      goal: mission.goal,
      constraints: mission.constraints,
      technologyPreferences: mission.technologyPreferences,
      feedback,
      cwd: projectDir(this.store.projectsRoot, projectId),
      existingProject: this.store.listArtifacts(projectId).length > 0 || this.store.listMissions(projectId).length > 1 || existsSync(path.join(projectDir(this.store.projectsRoot, projectId), "docs", "status-report.md")),
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
    if (this.hasInFlight(missionId)) throw new Error("実行中の作業があります。先に一時停止してください");
    if (mission.status === "completed" || mission.status === "cancelled") throw new Error("終了した依頼は再計画できません");
    if (mission.status !== "planning") transitionMission(this.store, projectId, missionId, "planning", "replan");
    try {
      return await this.propose(projectId, missionId, "replan", feedback);
    } catch (err) {
      // keep the mission recoverable: the old graph is untouched
      transitionMission(this.store, projectId, missionId, "failed", `replan error: ${errMsg(err)}`);
      throw err;
    }
  }

  /**
   * The user changes direction while the mission is running (or paused/failed):
   * stop what is running, then ask the Planner for a new plan that keeps the
   * completed work and follows the new instruction. Nothing changes until the
   * user approves that proposal; an unfinished task is replaced only then.
   */
  async redirect(projectId: string, missionId: string, instruction: string): Promise<PlanProposal> {
    const text = instruction.trim();
    if (!text) throw new Error("新しい方針を入力してください");
    const mission = this.requireMission(projectId, missionId);
    if (mission.status === "completed" || mission.status === "cancelled") throw new Error("終了した依頼の方針は変えられません");
    if (mission.status === "planning") throw new Error("計画の承認待ちです。計画に対して修正を依頼してください");
    this.store.appendEvent({ projectId, type: "MISSION_REDIRECTED", payload: { missionId, instruction: text } });
    if (mission.status === "running") await this.pause(projectId, missionId);
    return this.replan(projectId, missionId, `【途中での方針変更】${text}`);
  }

  /**
   * The user retries one failed task (optionally with an extra instruction), on
   * top of the automatic retries. Tasks blocked behind it recover on their own,
   * and a failed mission is started again.
   */
  retryFailedTask(projectId: string, missionId: string, taskId: string, instruction?: string): Promise<MissionStatus> {
    const mission = this.requireMission(projectId, missionId);
    const task = this.store.getTask(projectId, taskId);
    if (!task || task.missionId !== missionId) throw new Error("作業が見つかりません");
    if (mission.status === "completed" || mission.status === "cancelled") throw new Error("終了した依頼の作業はやり直せません");
    if (mission.status === "planning") throw new Error("計画の承認待ちの間はやり直せません");
    if (task.status !== "failed") throw new Error("失敗した作業だけやり直せます");
    this.noRetry.delete(taskId);
    this.store.resetTaskForManualRetry(projectId, taskId, instruction?.trim() || undefined);
    this.store.appendEvent({ projectId, taskId, type: "TASK_MANUAL_RETRY", payload: { instruction: instruction?.trim() || null } });
    transitionTask(this.store, projectId, taskId, "ready", "manual retry");
    if (mission.status === "failed" || mission.status === "paused") transitionMission(this.store, projectId, missionId, "running", "task retried by user");
    return this.run(projectId, missionId);
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
      refreshReadiness(this.store, projectId, missionId, MAX_RETRIES, (t) => this.noRetry.has(t.id));
      let tasks = this.missionTasks(projectId, missionId);

      // automatic retry, bounded by MAX_RETRIES
      for (const t of tasks.filter((x) => x.status === "failed" && x.retryCount < MAX_RETRIES && !this.noRetry.has(x.id))) retryTask(this.store, projectId, t.id);
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
    if (!broker) return;
    const failedAis = this.failedAis(task);
    // keep a chosen AI unless it already failed this task: then fall back to the next candidate
    if (task.selectedAi && !failedAis.includes(task.selectedAi)) return;
    try {
      const decision = broker.select(task, { budgetPolicy: mission.budgetPolicy, executableAdapters: executor.adapterTypesFor ? [...executor.adapterTypesFor(task)] : executor.adapterTypes ? [...executor.adapterTypes] : undefined, excludeAiIds: failedAis });
      const byId = new Map(decision.ranked.map((c) => [c.aiId, c]));
      const payload = {
        capability: decision.capability,
        confidence: decision.confidence,
        confidenceLabel: decision.confidenceLabel,
        needsReview: decision.needsReview,
        selected: decision.selected?.aiId ?? null,
        excluded: decision.excluded,
        // what the screen shows as "why this AI": the score, the other candidates, who was equally good and how much each had been used
        reason: decision.reason,
        chosen: decision.selected ? { name: decision.selected.name, score10: decision.selected.score10, ...decision.selected.breakdown, tuning: tuningOf(this.store, decision.selected.aiId, decision.capability) } : null,
        ranked: decision.ranked.slice(0, 6).map((c) => ({ aiId: c.aiId, name: c.name, score10: c.score10 })),
        shared: decision.shared.map((id) => ({ aiId: id, name: byId.get(id)?.name ?? id, fit: byId.get(id)?.breakdown.fit ?? 0, score10: byId.get(id)?.score10 ?? 0, ...(decision.usage[id] ?? { mission: 0, recent: 0 }) })),
      };
      if (!decision.selected) {
        this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AI_SELECTION_NONE", payload });
        return; // no fallback left: the retry runs on the same AI
      }
      if (task.selectedAi) this.store.appendEvent({ projectId: task.projectId, taskId: task.id, type: "AI_FALLBACK", payload: { from: task.selectedAi, to: decision.selected.aiId } });
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

  private failedAis(task: Task): string[] {
    const rows = this.store.db.prepare("SELECT DISTINCT ai_id FROM ai_runs WHERE project_id = ? AND task_id = ? AND status = 'failed' AND ai_id IS NOT NULL").all(task.projectId, task.id) as { ai_id: string }[];
    return rows.map((r) => r.ai_id);
  }

  private async execute(mission: Mission, task: Task, controller: AbortController): Promise<void> {
    const { projectId } = task;
    let result: ExecutionResult;
    const startedMs = Date.now();
    try {
      result = await this.deps.executor.execute(this.store.getTask(projectId, task.id)!, { mission, signal: controller.signal });
    } catch (err) {
      result = { ok: false, summary: errMsg(err) };
    }
    if (controller.signal.aborted) {
      const cancelled = this.store.getMission(projectId, mission.id)?.status === "cancelled";
      this.store.recordAiRun({ projectId, taskId: task.id, aiId: result.aiId, executor: result.executor ?? this.deps.executor.name, automationLevel: result.automationLevel, status: "cancelled", summary: result.summary, ...this.metrics(result, startedMs) });
      transitionTask(this.store, projectId, task.id, cancelled ? "cancelled" : "paused", cancelled ? "mission cancelled" : "mission paused");
      return;
    }
    this.store.recordAiRun({ projectId, taskId: task.id, aiId: result.aiId ?? this.store.getTask(projectId, task.id)?.selectedAi ?? undefined, executor: result.executor ?? this.deps.executor.name, automationLevel: result.automationLevel, status: result.ok ? "succeeded" : "failed", summary: result.summary, ...this.metrics(result, startedMs) });
    // what happened counts for the AI that did the work: its scores are adjusted from the evidence (scoreTuning.ts)
    const author = result.aiId ?? this.store.getTask(projectId, task.id)?.selectedAi ?? null;
    const capability = capabilityForTaskRole(task.role);
    recordOutcome(this.store, author, capability, result.ok ? "exec_ok" : "exec_fail");
    if (!result.ok) {
      if (result.retryable === false) this.noRetry.add(task.id);
      transitionTask(this.store, projectId, task.id, "failed", result.summary ?? "execution failed");
      return;
    }
    transitionTask(this.store, projectId, task.id, "validation", "executed");
    let verdict: { passed: boolean; detail?: string; level?: number; outcome?: "approve" | "revise" } = { passed: true };
    if (this.deps.validator) {
      try {
        verdict = await this.deps.validator.validate(this.store.getTask(projectId, task.id)!, result);
      } catch (err) {
        verdict = { passed: false, detail: errMsg(err) };
      }
    }
    // AI B Review: only after the ordinary checks passed, and only for important tasks (decided inside). It never stops the mission.
    if (verdict.passed && this.deps.aiReview) {
      try {
        const review = await reviewTask({ store: this.store, reviewer: this.deps.aiReview.reviewer, mission, task: this.store.getTask(projectId, task.id)!, result, signal: controller.signal });
        if (review) verdict = review;
      } catch (err) {
        this.store.appendEvent({ projectId, taskId: task.id, type: "AI_REVIEW_SKIPPED", payload: { reason: errMsg(err) } });
      }
      if (controller.signal.aborted) {
        const cancelled = this.store.getMission(projectId, mission.id)?.status === "cancelled";
        transitionTask(this.store, projectId, task.id, cancelled ? "cancelled" : "paused", cancelled ? "mission cancelled" : "mission paused");
        return;
      }
    }
    this.store.addValidation({ projectId, taskId: task.id, level: verdict.level ?? 1, status: verdict.passed ? "passed" : "failed", detail: verdict.detail });
    if (verdict.outcome) recordOutcome(this.store, author, capability, verdict.outcome === "approve" ? "review_approve" : "review_revise");
    else recordOutcome(this.store, author, capability, verdict.passed ? "validation_pass" : "validation_fail");
    transitionTask(this.store, projectId, task.id, verdict.passed ? "completed" : "failed", verdict.detail);
  }

  private metrics(result: ExecutionResult, startedMs: number) {
    return { durationMs: result.durationMs ?? Date.now() - startedMs, costUsd: result.costUsd, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
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
    if (!m) throw new Error("依頼が見つかりません");
    return m;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
