/**
 * TaskWorkerRunner - the Execution Manager slice of the Orchestrator
 * (spec section 3, 9). Given a task, it asks the AI Router which Worker
 * should run it, executes the Worker, and files a Handoff both ways:
 * a file in workspace/handoff (for external Workers/other AIs to read)
 * and, when available, an internal DB Handoff (spec section 3's
 * "Handoff Manager", reusing src/agents/handoff.ts rather than
 * duplicating JARVIS's own bookkeeping).
 */

import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import type { WorkerRegistry } from '../workers/registry.ts';
import type { WorkerRunResult } from '../workers/types.ts';
import { WorkerRouter } from './ai-router.ts';
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
  worker: string;
  result: WorkerRunResult;
  handoffFilePath: string;
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
    private readonly recordInternalHandoff?: InternalHandoffRecorder
  ) {
    this.router = new WorkerRouter(registry);
  }

  async run(request: TaskWorkerRequest): Promise<TaskWorkerOutcome> {
    const routing = this.router.route({ template: request.template, explicitWorker: request.explicitWorker });
    if (!routing.ok) {
      throw new Error(`no Worker available for capability "${routing.capability}"`);
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

    return { worker: worker.definition.name, result, handoffFilePath };
  }
}
