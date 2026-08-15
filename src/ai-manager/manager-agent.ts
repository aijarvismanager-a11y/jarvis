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
 * What this does NOT do (out of scope for this pass): resume a subtask
 * that paused on `needs_input` - that requires surfacing the question to a
 * human and is left as project_status WAITING for a caller to handle via
 * TaskDispatcher.resume() directly.
 */

import type { TaskDispatcher } from '../agents/conv/task-dispatcher.ts';
import type { TaskResultEnvelope } from '../agents/conv/task-envelope.ts';
import { AIRouter } from './router.ts';
import { Planner, type PlanResult, type PlannedSubtask } from './planner.ts';
import { updateProjectStatus, type Project, type ProjectTemplate, type ExecutionMode } from '../vault/projects.ts';
import { setProjectTaskFields, type ProjectTaskStatus } from '../vault/project-tasks.ts';
import { sendHandoff } from '../agents/handoff.ts';
import { createDecision } from '../vault/decisions.ts';
import { SelfHealingRunner, type HealingResult } from './self-healing.ts';
import { QAAgent } from './qa.ts';

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
    maxRetries: number = 3,
  ) {
    this.planner = new Planner(router);
    this.healer = new SelfHealingRunner(router, dispatcher, new QAAgent(), maxRetries);
  }

  /**
   * Plan a project from a raw user request, then run every subtask to
   * completion (or a terminal non-completed state), respecting the
   * dependency graph. Returns once the whole graph has settled.
   */
  async handleRequest(
    name: string,
    userRequest: string,
    opts?: { template?: ProjectTemplate; execution_mode?: ExecutionMode },
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
    const taskIdByIndex = new Map<number, string>();
    const settled = new Map<number, ProjectTaskStatus>();
    const outcomes: SubtaskOutcome[] = [];

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
          // No ready work and nothing to cancel, but the graph isn't fully
          // settled - only possible with a circular dependency the planner
          // should have prevented (indices must reference earlier elements).
          // Bail out rather than looping forever.
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
    const routing = this.router.route({ template: subtask.template });
    const healing: HealingResult = await this.healer.run({
      template: subtask.template,
      mode: routing.mode,
      intent: subtask.title,
      original_message: userRequest,
    });
    const envelope = healing.envelope;
    const finalAttempt = healing.attempts[healing.attempts.length - 1]!;

    taskIdByIndex.set(index, envelope.task_id);
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
    });

    if (healing.exhausted && status === 'FAILED') {
      createDecision(
        `Subtask "${subtask.title}" exhausted self-healing after ${healing.attempts.length} attempt(s): ${envelope.summary}`,
        {
          project_id: project.id,
          reason: `Failure classes seen: ${[...new Set(healing.attempts.map((a) => a.failure_class))].join(', ')}.`,
          made_by: 'manager',
        },
      );
    }

    sendHandoff(
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
