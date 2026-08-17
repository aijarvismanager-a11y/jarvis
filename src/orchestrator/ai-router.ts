/**
 * AI Router (spec section 17) - decides which Worker a task goes to.
 * Does NOT execute anything itself, and does not pick an LLM/model - it
 * only picks a Worker name from the registry, by capability. Distinct
 * from src/ai-manager/router.ts, which routes *internal* LLM-tier agents;
 * this one routes to *external* AI environments (spec section 2).
 */

import type { TaskTemplate } from '../agents/conv/task-envelope.ts';
import type { WorkerCapability } from '../workers/types.ts';
import type { WorkerRegistry } from '../workers/registry.ts';

/** Task template -> capability a Worker must declare to take it. */
const TEMPLATE_TO_CAPABILITY: Record<TaskTemplate, WorkerCapability> = {
  code: 'code',
  research: 'research',
  write: 'write',
  plan: 'plan',
  general: 'general',
};

export type RoutingResult =
  | { ok: true; worker: string; capability: WorkerCapability }
  | { ok: false; reason: 'no_worker_available'; capability: WorkerCapability };

export class AIRouter {
  constructor(private readonly registry: WorkerRegistry) {}

  /**
   * Pick a Worker for a task template. If the caller names a Worker
   * explicitly (spec section 17: "ユーザーが明示的にAIを指定することも可能"),
   * that choice wins as long as the Worker exists and is enabled.
   */
  route(opts: { template: TaskTemplate; explicitWorker?: string }): RoutingResult {
    const capability = TEMPLATE_TO_CAPABILITY[opts.template];

    if (opts.explicitWorker) {
      const worker = this.registry.get(opts.explicitWorker);
      if (worker && worker.definition.enabled) {
        return { ok: true, worker: worker.definition.name, capability };
      }
    }

    const candidates = this.registry.findByCapability(capability);
    const ready = candidates.find((w) => w.definition.status === 'ready') ?? candidates[0];
    if (!ready) return { ok: false, reason: 'no_worker_available', capability };

    return { ok: true, worker: ready.definition.name, capability };
  }
}
