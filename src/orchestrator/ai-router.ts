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
import { DEFAULT_AI_PROFILES, type AIProfiles } from './ai-profiles.ts';

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

/**
 * A scored recommendation (spec section 11/13), independent of whether a
 * matching Worker is currently registered/enabled - this is what lets the
 * Router still name a recommended AI, with a reason, when zero Workers
 * are connected (spec section 21: Manual Handoff).
 */
export type RoutingDecision = {
  task_type: WorkerCapability;
  primary: string | null;
  primaryAvailable: boolean;
  fallback: string | null;
  fallbackAvailable: boolean;
  confidence: number;
  reason: string;
};

const MAX_STRENGTH = 5;

export class WorkerRouter {
  constructor(
    private readonly registry: WorkerRegistry,
    private readonly profiles: AIProfiles = DEFAULT_AI_PROFILES
  ) {}

  /**
   * Pick a Worker for a task template. If the caller names a Worker
   * explicitly (spec section 17: "ユーザーが明示的にAIを指定することも可能"),
   * that choice wins as long as the Worker exists and is enabled.
   */
  route(opts: { template: TaskTemplate; explicitWorker?: string }): RoutingResult {
    const capability = TEMPLATE_TO_CAPABILITY[opts.template];

    if (opts.explicitWorker) {
      const worker = this.registry.get(opts.explicitWorker);
      if (worker && worker.definition.enabled && worker.definition.capabilities.includes(capability)) {
        return { ok: true, worker: worker.definition.name, capability };
      }
    }

    const candidates = this.registry.findByCapability(capability);
    const ready = candidates.find((w) => w.definition.status === 'ready') ?? candidates[0];
    if (!ready) return { ok: false, reason: 'no_worker_available', capability };

    return { ok: true, worker: ready.definition.name, capability };
  }

  /**
   * Score every profiled AI for a capability (spec section 11: strength +
   * priority, availability considered only as a tiebreaker) and return a
   * primary/fallback recommendation with a reason - this always returns a
   * recommendation as long as at least one AI Profile declares the
   * capability, even with zero Workers registered or enabled.
   */
  recommend(opts: { template: TaskTemplate; explicitWorker?: string }): RoutingDecision {
    const capability = TEMPLATE_TO_CAPABILITY[opts.template];

    if (opts.explicitWorker) {
      return {
        task_type: capability,
        primary: opts.explicitWorker,
        primaryAvailable: this.isAvailable(opts.explicitWorker, capability),
        fallback: null,
        fallbackAvailable: false,
        confidence: 1,
        reason: 'ユーザーが指定したAIのため',
      };
    }

    const ranked = Object.entries(this.profiles)
      .filter(([, profile]) => profile.enabled)
      .map(([name, profile]) => ({
        name,
        score: (profile.strengths[capability] ?? 0) - profile.priority * 0.1,
        available: this.isAvailable(name, capability),
      }))
      .sort((a, b) => b.score - a.score || Number(b.available) - Number(a.available));

    const primary = ranked[0];
    const fallback = ranked[1];

    return {
      task_type: capability,
      primary: primary?.name ?? null,
      primaryAvailable: primary?.available ?? false,
      fallback: fallback?.name ?? null,
      fallbackAvailable: fallback?.available ?? false,
      confidence: primary ? Math.min(1, Math.max(0, primary.score / MAX_STRENGTH)) : 0,
      reason: primary
        ? `"${capability}" タスクとして分類され、${primary.name} の適性スコアが最も高いため`
        : `"${capability}" に対応するAIプロファイルが見つかりません`,
    };
  }

  private isAvailable(name: string, capability: WorkerCapability): boolean {
    const worker = this.registry.get(name);
    return (
      !!worker &&
      worker.definition.enabled &&
      worker.definition.capabilities.includes(capability) &&
      worker.definition.status !== 'disabled' &&
      worker.definition.status !== 'error'
    );
  }
}
