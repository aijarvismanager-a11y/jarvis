/**
 * TaskWorkerRunner - the Execution Manager slice of the Orchestrator
 * (spec section 3, 9). Given a task, it asks the AI Router which Worker
 * should run it, executes the Worker, and files a Handoff both ways:
 * a file in workspace/handoff (for external Workers/other AIs to read)
 * and, when available, an internal DB Handoff (spec section 3's
 * "Handoff Manager", reusing src/agents/handoff.ts rather than
 * duplicating JARVIS's own bookkeeping).
 *
 * When the Router can't hand the task to a running Worker (none
 * registered/enabled/ready), it does not fail the task - it degrades to
 * Manual Handoff (spec section 17/21): a recommended AI, a reason, and a
 * copyable prompt package the user pastes in themselves. This is what
 * lets JARVIS work with zero Workers connected.
 */

import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import type { WorkerCapability } from '../workers/types.ts';
import type { WorkerRegistry } from '../workers/registry.ts';
import type { WorkerRunResult } from '../workers/types.ts';
import { WorkerRouter } from './ai-router.ts';
import { DEFAULT_AI_PROFILES, type AIProfiles } from './ai-profiles.ts';
import { buildHandoffPrompt } from './prompt-builder.ts';
import { writeHandoffFile, type FileHandoff } from './handoff-file.ts';
import type { WorkspacePaths } from './workspace.ts';

export type TaskWorkerRequest = {
  task_id: string;
  template: TaskTemplate;
  prompt: string;
  explicitWorker?: string;
  files?: string[];
};

export type TaskWorkerOutcome = {
  mode: 'worker_run';
  worker: string;
  result: WorkerRunResult;
  handoffFilePath: string;
};

export type ManualHandoffOutcome = {
  mode: 'manual_handoff';
  task_type: WorkerCapability;
  primary: string | null;
  primaryAvailable: boolean;
  fallback: string | null;
  fallbackAvailable: boolean;
  confidence: number;
  reason: string;
  prompt: string;
};

/** Injected so callers can record internal (DB-backed) handoffs without this module depending on the vault. */
export type InternalHandoffRecorder = (args: {
  task_id: string;
  from_agent: string;
  to_agent: string;
  status: 'completed' | 'failed' | 'needs_input';
  summary: string;
  files: string[];
}) => void;

export class TaskWorkerRunner {
  private readonly router: WorkerRouter;

  constructor(
    private readonly registry: WorkerRegistry,
    private readonly workspace: WorkspacePaths,
    private readonly recordInternalHandoff?: InternalHandoffRecorder,
    profiles: AIProfiles = DEFAULT_AI_PROFILES
  ) {
    this.router = new WorkerRouter(registry, profiles);
  }

  async run(request: TaskWorkerRequest): Promise<TaskWorkerOutcome | ManualHandoffOutcome> {
    const routing = this.router.route({ template: request.template, explicitWorker: request.explicitWorker });
    if (!routing.ok) {
      const decision = this.router.recommend({ template: request.template, explicitWorker: request.explicitWorker });
      return {
        mode: 'manual_handoff',
        task_type: decision.task_type,
        primary: decision.primary,
        primaryAvailable: decision.primaryAvailable,
        fallback: decision.fallback,
        fallbackAvailable: decision.fallbackAvailable,
        confidence: decision.confidence,
        reason: decision.reason,
        prompt: buildHandoffPrompt({
          task: request.prompt,
          objective: request.prompt,
          targetAI: decision.primary ?? '未定',
        }),
      };
    }

    const worker = this.registry.get(routing.worker);
    if (!worker) throw new Error(`Worker "${routing.worker}" vanished from the registry`);

    this.registry.setStatus(worker.definition.name, 'working');
    let result: WorkerRunResult;
    try {
      result = await worker.run({ task_id: request.task_id, prompt: request.prompt, files: request.files });
    } catch (err) {
      this.registry.setStatus(worker.definition.name, 'error');
      throw err;
    }
    this.registry.setStatus(
      worker.definition.name,
      result.status === 'completed' ? 'done' : result.status === 'needs_input' ? 'waiting' : 'error'
    );

    const fileHandoff: FileHandoff = {
      task_id: request.task_id,
      from: worker.definition.name,
      to: 'jarvis',
      status: result.status,
      summary: result.summary,
      instructions: '',
      files: result.files,
      research: [],
      next_action: result.status === 'completed' ? 'review' : 'retry_or_escalate',
    };
    const handoffFilePath = writeHandoffFile(this.workspace.handoff, fileHandoff);

    this.recordInternalHandoff?.({
      task_id: request.task_id,
      from_agent: worker.definition.name,
      to_agent: 'jarvis',
      status: result.status,
      summary: result.summary,
      files: result.files,
    });

    return { mode: 'worker_run', worker: worker.definition.name, result, handoffFilePath };
  }
}
