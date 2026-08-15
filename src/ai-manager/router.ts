/**
 * AIRouter - thin routing-policy layer on top of LLMManager (spec sections
 * 10-11, 40-41). Deliberately does NOT reimplement provider selection,
 * retries, or fall-up: LLMManager.chatTier already does that per tier.
 *
 * What this adds:
 *  - The user-facing Cheap/Balanced/Quality mode (spec section 40-41),
 *    mapped onto the existing low/medium/high tiers instead of a second
 *    model-selection mechanism.
 *  - A per-tier reliability read (recent error rate from llm_usage) the
 *    Manager Agent can consult before assigning a task, without this
 *    router silently re-routing on its own - that decision stays visible
 *    to the caller.
 */

import type { LLMManager } from '../llm/manager.ts';
import type { Tier } from '../llm/tiers.ts';
import type { LLMMessage, LLMOptions, LLMResponse } from '../llm/provider.ts';
import { queryUsage } from '../llm/usage.ts';
import type { TaskTemplate } from '../agents/conv/task-envelope.ts';

export type CostMode = 'cheap' | 'balanced' | 'quality';

/** Task-executing tiers only - routing decisions never resolve to 'conversation'. */
export type TaskTier = Exclude<Tier, 'conversation'>;

/**
 * Cheap/Balanced/Quality -> tier. Kept as a single small map (spec section
 * 41 explicitly warns against hardcoding model names in the UI/core - this
 * maps to a TIER, never to a model name).
 */
const MODE_TO_TIER: Record<CostMode, TaskTier> = {
  cheap: 'low',
  balanced: 'medium',
  quality: 'high',
};

/**
 * Template -> tier hint, used when the caller only knows the task template
 * and not an explicit cost mode (e.g. the Planner assigning a freshly
 * decomposed subtask). `code`/`plan` lean toward higher-reasoning tiers by
 * default; `write`/`general` default to balanced.
 */
const TEMPLATE_DEFAULT_MODE: Record<TaskTemplate, CostMode> = {
  research: 'balanced',
  code: 'quality',
  plan: 'quality',
  write: 'balanced',
  general: 'balanced',
};

export type RoutingDecision = {
  tier: TaskTier;
  mode: CostMode;
  /** Recent error rate (0-1) for this tier over the sampled window, or null if no data yet. */
  recent_error_rate: number | null;
};

export type ReliabilitySample = {
  tier: TaskTier;
  calls: number;
  errors: number;
  error_rate: number;
};

export class AIRouter {
  constructor(private readonly llm: LLMManager) {}

  /**
   * Resolve a cost mode (or template default) to a concrete tier, plus a
   * reliability snapshot the caller can use to decide whether to escalate.
   * Does not call the LLM - pure routing decision.
   */
  route(opts: { template: TaskTemplate; mode?: CostMode }): RoutingDecision {
    const mode = opts.mode ?? TEMPLATE_DEFAULT_MODE[opts.template];
    const tier = MODE_TO_TIER[mode];
    const reliability = this.getRecentReliability(tier);
    return {
      tier,
      mode,
      recent_error_rate: reliability ? reliability.error_rate : null,
    };
  }

  /**
   * Convenience wrapper: route by mode/template, then call chatTier on the
   * resolved tier. Subsystem label is required (same convention as
   * LLMManager.chatTier) so usage stays attributable.
   */
  async chat(
    opts: { template: TaskTemplate; mode?: CostMode; subsystem: string },
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMResponse & { routing: RoutingDecision }> {
    const routing = this.route(opts);
    const response = await this.llm.chatTier(routing.tier, opts.subsystem, messages, options);
    return { ...response, routing };
  }

  /**
   * Error rate over the most recent calls on a tier (last 24h, capped
   * sample). Returns null when there's no usage history yet - callers
   * should treat that as "unknown", not "reliable".
   */
  getRecentReliability(tier: TaskTier, windowMs: number = 24 * 60 * 60 * 1000): ReliabilitySample | null {
    const result = queryUsage({ fromMs: Date.now() - windowMs, tiers: [tier] }, 'tier');
    if (result.total.calls === 0) return null;
    return {
      tier,
      calls: result.total.calls,
      errors: result.total.errors,
      error_rate: result.total.errors / result.total.calls,
    };
  }
}
