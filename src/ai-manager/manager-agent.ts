/**
 * ManagerAgent - the top-level orchestrator named in spec sections 8 and 51.
 * Ties Planner -> AIRouter -> Assignment -> Execution -> Handoff into one
 * pass over a project's dependency graph, reusing existing infrastructure:
 *
 *  - Execution goes through the existing TaskDispatcher (same code path the
 *    conversation tier uses for `delegate` calls), so subtasks get the full
 *    tool registry, role prompt, and authority gating - see
 *    docs/AI_MANAGER_ARCHITECTURE_AUDIT.md section 3 for why this is an
 *    extension point rather than a parallel execution path.
 *  - Each subtask's real TaskRegistry id (minted by dispatch()) is tagged
 *    with the Phase 1 project-management fields via setProjectTaskFields()
 *    once it exists - see planner.ts for why the id can't be known earlier.
 *  - Independent subtasks (no unmet dependency) run in parallel within a
 *    "wave"; each wave completes before the next one is computed (spec
 *    section 39).
 *  - A subtask whose dependency failed is never run - it's marked
 *    CANCELLED and its own dependents cascade the same way.
 *
 * A subtask that pauses on `needs_input` is left as project_status WAITING;
 * resumeSubtask() (Phase 11-A) is the way back to running for it - it calls
 * TaskDispatcher.resume() directly, then continueProject() to pick the rest
 * of the graph back up. continueProject() reconstructs the wave scheduler's
 * state from the persisted `plan` (src/vault/projects.ts) plus each
 * already-dispatched subtask's current `project_status`, rather than
 * requiring the original in-memory PlanResult, since a resume can happen in
 * a different request - or after a daemon restart - than the one that
 * called handleRequest().
 */

import type { TaskDispatcher } from '../agents/conv/task-dispatcher.ts';
import type { TaskResultEnvelope, TaskTemplate } from '../agents/conv/task-envelope.ts';
import { AIRouter } from './router.ts';
import { Planner, type PlanResult, type PlannedSubtask, type PlannedPriority } from './planner.ts';
import {
  updateProjectStatus, getProject, getProjectPlan, setProjectPlan,
  type Project, type ProjectTemplate, type ExecutionMode, type CostMode,
} from '../vault/projects.ts';
import { setProjectTaskFields, getProjectTaskFields, type ProjectTaskStatus } from '../vault/project-tasks.ts';
import { sendHandoff, type Handoff } from '../agents/handoff.ts';
import { createDecision } from '../vault/decisions.ts';
import { SelfHealingRunner, type HealingResult } from './self-healing.ts';
import { QAAgent } from './qa.ts';
import type { ApprovalManager } from '../authority/approval.ts';

/**
 * Templates gated in 'assisted' execution mode (Phase 11-C). Deliberately
 * just `code` for now - it's the one template that already defaults to a
 * QA gate in self-healing.ts (`qaCheck ?? template === 'code'`), so
 * "assisted" and "already treated as higher-risk" line up naturally rather
 * than inventing a second, disconnected risk classification.
 */
const ASSISTED_MODE_GATED_TEMPLATES: readonly TaskTemplate[] = ['code'];

const MANAGER_AGENT_ID = 'manager';

export type SubtaskOutcome = {
  index: number;
  title: string;
  task_id: string;
  status: ProjectTaskStatus;
  summary: string;
};

export type ProjectRunResult = {
  project: Project;
  outcomes: SubtaskOutcome[];
};

function envelopeToProjectStatus(envelope: TaskResultEnvelope): ProjectTaskStatus {
  switch (envelope.status) {
    case 'completed': return 'COMPLETED';
    case 'failed': return 'FAILED';
    case 'cancelled': return 'CANCELLED';
    case 'needs_input': return 'WAITING';
    default: return 'REVIEW';
  }
}

export class ManagerAgent {
  private readonly planner: Planner;
  private readonly healer: SelfHealingRunner;

  constructor(
    private readonly router: AIRouter,
    private readonly dispatcher: TaskDispatcher,
    private readonly approvals: ApprovalManager,
    maxRetries: number = 3,
    /**
     * Phase 33 — fired right after a Handoff is persisted, so a caller with
     * WS access (see `src/ai-manager/api/routes.ts`'s `AIManagerApiContext.
     * getWsService`) can push it live instead of the UI only seeing it on
     * the next 8s poll. Optional and side-effect-only: ManagerAgent's own
     * control flow never depends on whether this is set or what it does.
     */
    private readonly onHandoff?: (handoff: Handoff, messageId: string, projectId?: string) => void,
  ) {
    this.planner = new Planner(router);
    this.healer = new SelfHealingRunner(router, dispatcher, new QAAgent(), maxRetries);
  }

  /** sendHandoff() + the optional live-push side effect, in one place so both call sites stay in sync. */
  private fileHandoff(handoff: Handoff, opts?: { project_id?: string }): void {
    const message = sendHandoff(handoff, opts);
    this.onHandoff?.(handoff, message.id, opts?.project_id);
  }

  /**
   * Plan a project from a raw user request, then run every subtask to
   * completion (or a terminal non-completed state), respecting the
   * dependency graph. Returns once the whole graph has settled.
   */
  async handleRequest(
    name: string,
    userRequest: string,
    opts?: { template?: ProjectTemplate; execution_mode?: ExecutionMode; cost_mode?: CostMode },
  ): Promise<ProjectRunResult> {
    const plan = await this.planner.planProject(name, userRequest, opts);
    return this.runPlan(plan, userRequest);
  }

  /**
   * Run an already-planned graph. Exposed separately from handleRequest so
   * callers that build their own plan (e.g. a future AI Council step) can
   * skip the Planner LLM call.
   */
  async runPlan(plan: PlanResult, userRequest: string): Promise<ProjectRunResult> {
    const { project, subtasks } = plan;
    return this.runWaves(project, subtasks, new Map(), new Map(), [], userRequest);
  }

  /**
   * Resume a project whose subtask graph stalled on a WAITING (needs_input)
   * subtask - or simply re-check a project's graph for newly-runnable work.
   * Reconstructs the wave scheduler's state from the persisted `plan`
   * (src/vault/projects.ts) and each already-dispatched subtask's current
   * `project_status`, rather than requiring the original in-memory
   * PlanResult, since this may run in a different request or after a
   * daemon restart than the one that called handleRequest() (Phase 11-A -
   * see this file's original "what this does NOT do" note above, now
   * addressed).
   */
  async continueProject(projectId: string): Promise<ProjectRunResult> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found.`);
    const plan = getProjectPlan(projectId);
    if (!plan) throw new Error(`Project ${projectId} has no persisted plan (predates Phase 11-A, or was never planned via ManagerAgent).`);

    const subtasks: PlannedSubtask[] = plan.map((p) => ({
      title: p.title,
      template: p.template as TaskTemplate,
      priority: p.priority as PlannedPriority,
      depends_on: p.depends_on,
    }));

    const taskIdByIndex = new Map<number, string>();
    const settled = new Map<number, ProjectTaskStatus>();
    const outcomes: SubtaskOutcome[] = [];
    const TERMINAL: readonly ProjectTaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

    plan.forEach((entry, index) => {
      if (!entry.task_id) return; // never dispatched yet - fresh for this wave loop
      taskIdByIndex.set(index, entry.task_id);
      const fields = getProjectTaskFields(entry.task_id);
      const status = fields?.project_status;
      if (status && TERMINAL.includes(status)) {
        settled.set(index, status);
        outcomes.push({
          index,
          title: entry.title,
          task_id: entry.task_id,
          status,
          summary: `(resumed) previously ${status.toLowerCase()}.`,
        });
      }
      // WAITING (or any other non-terminal status) is left unsettled, same
      // as runPlan's original in-memory semantics - its dependents stay
      // blocked until it resolves.
    });

    return this.runWaves(project, subtasks, taskIdByIndex, settled, outcomes, project.description);
  }

  /**
   * Resume a single WAITING subtask with the user's clarification reply,
   * then continue the rest of the project's graph. This is the only path
   * back to running for a subtask that paused on `needs_input` - see the
   * class-level doc comment.
   */
  async resumeSubtask(projectId: string, taskId: string, userInput: string): Promise<ProjectRunResult> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found.`);
    const taskFields = getProjectTaskFields(taskId);
    if (!taskFields || taskFields.project_id !== projectId) {
      throw new Error(`Task ${taskId} not found in project ${projectId}.`);
    }
    if (taskFields.project_status !== 'WAITING') {
      throw new Error(`Task ${taskId} is not waiting for input (status=${taskFields.project_status}).`);
    }

    const envelope = await this.dispatcher.resume(taskId, userInput);
    const status = envelopeToProjectStatus(envelope);
    setProjectTaskFields(taskId, {
      project_status: status,
      artifacts: envelope.details_ref ? [...taskFields.artifacts, envelope.details_ref] : taskFields.artifacts,
    });

    this.fileHandoff(
      {
        task_id: taskId,
        from_agent: taskFields.assigned_agent ?? MANAGER_AGENT_ID,
        to_agent: MANAGER_AGENT_ID,
        status: envelope.status === 'completed' ? 'completed' : envelope.status === 'needs_input' ? 'needs_input' : 'failed',
        summary: envelope.summary,
        instructions: [],
        artifacts: envelope.details_ref ? [envelope.details_ref] : [],
        decisions: [],
        warnings: envelope.error ? [envelope.error] : [],
        open_questions: envelope.needs_input ? [envelope.needs_input.question] : [],
        next_action: status === 'COMPLETED' ? 'advance' : status === 'WAITING' ? 'await_user_input' : 'review',
      },
      { project_id: projectId },
    );

    return this.continueProject(projectId);
  }

  /**
   * Phase 11-C: whether a subtask needs sign-off before running, per the
   * project's execution_mode. 'auto' never gates (today's default
   * behavior, unchanged); 'manual' gates every subtask; 'assisted' gates
   * only the higher-risk templates in ASSISTED_MODE_GATED_TEMPLATES.
   */
  private requiresApproval(mode: ExecutionMode, template: TaskTemplate): boolean {
    if (mode === 'manual') return true;
    if (mode === 'assisted') return ASSISTED_MODE_GATED_TEMPLATES.includes(template);
    return false;
  }

  /** Blocks until the user approves or denies running this subtask. */
  private async requestSubtaskApproval(project: Project, subtask: PlannedSubtask): Promise<boolean> {
    const request = this.approvals.createRequest({
      agentId: MANAGER_AGENT_ID,
      agentName: 'Manager Agent',
      toolName: 'ai_manager_run_subtask',
      toolArguments: { project_id: project.id, title: subtask.title, template: subtask.template },
      actionCategory: 'spawn_agent',
      urgency: 'normal',
      reason: `Project "${project.name}" is in ${project.execution_mode} mode - subtask "${subtask.title}" (${subtask.template}) requires approval before running.`,
      context: project.description,
      projectId: project.id,
    });
    const resolved = await this.approvals.waitForResolution(request.id);
    return resolved.status === 'approved';
  }

  /** Mark index `i`'s task_id in the persisted plan, once it's first known. */
  private persistTaskId(projectId: string, index: number, taskId: string): void {
    const plan = getProjectPlan(projectId);
    if (!plan || !plan[index]) return; // defensive - shouldn't happen for a ManagerAgent-created project
    plan[index]!.task_id = taskId;
    setProjectPlan(projectId, plan);
  }

  /**
   * The dependency-graph wave scheduler shared by a fresh plan (runPlan) and
   * a reconstructed one (continueProject) - `taskIdByIndex`/`settled`/
   * `outcomes` start empty for the former and pre-populated for the latter.
   */
  private async runWaves(
    project: Project,
    subtasks: PlannedSubtask[],
    taskIdByIndex: Map<number, string>,
    settled: Map<number, ProjectTaskStatus>,
    outcomes: SubtaskOutcome[],
    userRequest: string,
  ): Promise<ProjectRunResult> {
    const isSettled = (i: number) => settled.has(i);
    const dependenciesOk = (subtask: PlannedSubtask) =>
      subtask.depends_on.every((dep) => settled.get(dep) === 'COMPLETED');
    const dependenciesFailed = (subtask: PlannedSubtask) =>
      subtask.depends_on.some((dep) => {
        const s = settled.get(dep);
        return s === 'FAILED' || s === 'CANCELLED';
      });

    while (settled.size < subtasks.length) {
      const readyIndices: number[] = [];
      const cancelIndices: number[] = [];

      subtasks.forEach((subtask, index) => {
        if (isSettled(index)) return;
        if (dependenciesFailed(subtask)) {
          cancelIndices.push(index);
        } else if (dependenciesOk(subtask)) {
          readyIndices.push(index);
        }
      });

      // Cascade-cancel subtasks whose dependency chain already failed.
      for (const index of cancelIndices) {
        settled.set(index, 'CANCELLED');
        outcomes.push({
          index,
          title: subtasks[index]!.title,
          task_id: '',
          status: 'CANCELLED',
          summary: 'Skipped: a dependency failed.',
        });
      }

      if (readyIndices.length === 0) {
        if (cancelIndices.length === 0) {
          // A subtask parked at WAITING (needs human input) is neither
          // dependenciesOk nor dependenciesFailed for its dependents, so it
          // reproduces the same "nothing ready, nothing to cancel" state as
          // a real cycle. Leave those subtasks unsettled instead of
          // force-cancelling them as an "unresolvable dependency graph" -
          // they can resume once the WAITING subtask gets its answer.
          const blockedByWaiting = subtasks.some(
            (subtask, index) =>
              !isSettled(index) && subtask.depends_on.some((dep) => settled.get(dep) === 'WAITING'),
          );
          if (blockedByWaiting) break;

          // No ready work, nothing to cancel, and nothing blocked on a
          // pending human answer, but the graph isn't fully settled - only
          // possible with a circular dependency the planner should have
          // prevented (indices must reference earlier elements). Bail out
          // rather than looping forever.
          subtasks.forEach((subtask, index) => {
            if (!isSettled(index)) {
              settled.set(index, 'CANCELLED');
              outcomes.push({
                index,
                title: subtask.title,
                task_id: '',
                status: 'CANCELLED',
                summary: 'Skipped: unresolvable dependency graph.',
              });
            }
          });
        }
        continue;
      }

      await Promise.all(
        readyIndices.map((index) =>
          this.runSubtask(project, subtasks[index]!, index, userRequest, taskIdByIndex).then((outcome) => {
            settled.set(index, outcome.status);
            outcomes.push(outcome);
          }),
        ),
      );
    }

    const allCompleted = outcomes.every((o) => o.status === 'COMPLETED');
    updateProjectStatus(project.id, allCompleted ? 'completed' : 'active');

    return { project, outcomes: outcomes.sort((a, b) => a.index - b.index) };
  }

  private async runSubtask(
    project: Project,
    subtask: PlannedSubtask,
    index: number,
    userRequest: string,
    taskIdByIndex: Map<number, string>,
  ): Promise<SubtaskOutcome> {
    if (this.requiresApproval(project.execution_mode, subtask.template)) {
      const approved = await this.requestSubtaskApproval(project, subtask);
      if (!approved) {
        return {
          index,
          title: subtask.title,
          task_id: '',
          status: 'CANCELLED',
          summary: `Skipped: not approved to run (project execution_mode=${project.execution_mode}).`,
        };
      }
    }

    // Phase 12-A: project.cost_mode overrides the router's per-template
    // default tier. 'balanced' is deliberately passed through as "no
    // override" (omitted) rather than forced to router.ts's MODE_TO_TIER
    // 'balanced'->medium mapping - that mapping is for an explicit user
    // choice of "balanced", not a stand-in for "unset", and forcing it here
    // would flatten `code`/`plan`'s existing 'quality' template default down
    // to 'medium' for every project that never touched the selector.
    const routing = this.router.route({
      template: subtask.template,
      ...(project.cost_mode !== 'balanced' ? { mode: project.cost_mode } : {}),
    });
    const healing: HealingResult = await this.healer.run({
      template: subtask.template,
      mode: routing.mode,
      intent: subtask.title,
      original_message: userRequest,
      project_id: project.id,
    });
    const envelope = healing.envelope;
    const finalAttempt = healing.attempts[healing.attempts.length - 1]!;

    // Every retry attempt dispatches through TaskDispatcher, which mints a
    // fresh `tasks` row each time (see self-healing.ts) - only the final
    // attempt's task_id gets the full setProjectTaskFields call below. Scope
    // the earlier attempts' rows to this project too (as superseded/
    // cancelled) so they don't end up with project_id=NULL, invisible to
    // getProjectTasks() but still lingering in any unscoped task listing.
    for (const priorAttempt of healing.attempts.slice(0, -1)) {
      if (priorAttempt.envelope.task_id === envelope.task_id) continue;
      setProjectTaskFields(priorAttempt.envelope.task_id, {
        project_id: project.id,
        parent_task_id: envelope.task_id,
        title: subtask.title,
        project_status: 'CANCELLED',
        assigned_agent: `task_${priorAttempt.template}`,
      });
    }

    taskIdByIndex.set(index, envelope.task_id);
    this.persistTaskId(project.id, index, envelope.task_id);
    const status = envelopeToProjectStatus(envelope);
    const dependencies = subtask.depends_on
      .map((i) => taskIdByIndex.get(i))
      .filter((id): id is string => Boolean(id));

    setProjectTaskFields(envelope.task_id, {
      project_id: project.id,
      title: subtask.title,
      priority: subtask.priority,
      project_status: status,
      assigned_agent: `task_${finalAttempt.template}`,
      dependencies,
      artifacts: envelope.details_ref ? [envelope.details_ref] : [],
      retry_count: healing.attempts.length - 1,
      qa_report: healing.qa_report as unknown as Record<string, unknown> | null,
      // Phase 15-C: the count alone (retry_count) doesn't say why a subtask
      // needed retrying - keep the strategy/failure_class sequence too.
      healing_attempts: healing.attempts.map((a) => ({
        attempt: a.attempt,
        strategy: a.strategy,
        template: a.template,
        mode: a.mode,
        failure_class: a.failure_class,
      })),
    });

    if (healing.exhausted && status === 'FAILED') {
      // QA rejection (self-healing.ts's post-loop QA gate) isn't a dispatch
      // failure, so it never gets pushed onto `attempts` - without this, a
      // subtask that failed purely because QA rejected it would report only
      // its execution attempts' failure classes (often 'none'), hiding the
      // real reason it failed.
      const failureClasses = new Set<string>(healing.attempts.map((a) => a.failure_class));
      if (healing.qa_report && !healing.qa_report.passed) failureClasses.add('qa_failed');
      createDecision(
        `Subtask "${subtask.title}" exhausted self-healing after ${healing.attempts.length} attempt(s): ${envelope.summary}`,
        {
          project_id: project.id,
          reason: `Failure classes seen: ${[...failureClasses].join(', ')}.`,
          made_by: 'manager',
        },
      );
    }

    this.fileHandoff(
      {
        task_id: envelope.task_id,
        from_agent: `task_${finalAttempt.template}`,
        to_agent: MANAGER_AGENT_ID,
        status: envelope.status === 'completed' ? 'completed' : envelope.status === 'needs_input' ? 'needs_input' : 'failed',
        summary: envelope.summary,
        instructions: [],
        artifacts: envelope.details_ref ? [envelope.details_ref] : [],
        decisions: [],
        warnings: envelope.error ? [envelope.error] : [],
        open_questions: envelope.needs_input ? [envelope.needs_input.question] : [],
        next_action: status === 'COMPLETED' ? 'advance' : status === 'WAITING' ? 'await_user_input' : 'review',
      },
      { project_id: project.id },
    );

    return { index, title: subtask.title, task_id: envelope.task_id, status, summary: envelope.summary };
  }
}
