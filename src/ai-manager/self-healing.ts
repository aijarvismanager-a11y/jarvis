/**
 * Self-Healing (spec section 37): when a dispatched subtask fails, run it
 * through
 *
 *   ERROR -> Classify -> Retry -> Alternative strategy -> Alternative Agent -> QA
 *
 * instead of surfacing the failure immediately. Bounded by `maxRetries`
 * (default 3, spec-mandated) so a chronically failing subtask cannot loop
 * forever - each strategy step consumes one attempt, and once the budget is
 * exhausted (or the failure is classified as non-retryable, e.g. an auth
 * error that no retry/strategy change will fix) the runner stops and hands
 * back the last envelope for a human/Manager to review.
 *
 * Layered on top of TaskDispatcher/AIRouter exactly like ManagerAgent does -
 * this module does not call chatTier or the orchestrator directly.
 */

import type { TaskDispatcher } from '../agents/conv/task-dispatcher.ts';
import type { TaskRequest, TaskResultEnvelope, TaskTemplate } from '../agents/conv/task-envelope.ts';
import { AIRouter, type CostMode } from './router.ts';
import { QAAgent, type QAReport } from './qa.ts';

export type FailureClass =
  | 'none'        // task did not fail
  | 'transient'   // rate limit / network / timeout - likely to succeed on a plain retry
  | 'auth'        // credential/permission error - retrying won't help, needs a human
  | 'capability'; // the agent/strategy itself couldn't do the task - needs a different approach

export type HealingStrategy = 'initial' | 'retry' | 'alternative_strategy' | 'alternative_agent';

export type HealingAttempt = {
  attempt: number;
  strategy: HealingStrategy;
  template: TaskTemplate;
  mode: CostMode;
  failure_class: FailureClass;
  envelope: TaskResultEnvelope;
};

export type HealingResult = {
  envelope: TaskResultEnvelope;
  attempts: HealingAttempt[];
  qa_report: QAReport | null;
  /** True if the retry budget ran out (or a non-retryable class was hit) while still failing. */
  exhausted: boolean;
};

/** Non-retryable by definition - no strategy change fixes a bad credential. */
const NON_RETRYABLE: FailureClass[] = ['auth'];

/** Fallback template tried once the original template's strategies are exhausted. */
const ALTERNATIVE_TEMPLATE: Partial<Record<TaskTemplate, TaskTemplate>> = {
  research: 'general',
  code: 'general',
  plan: 'general',
  write: 'general',
  general: 'code',
};

const ESCALATE_MODE: Record<CostMode, CostMode> = {
  cheap: 'balanced',
  balanced: 'quality',
  quality: 'quality',
};

export function classifyFailure(envelope: TaskResultEnvelope): FailureClass {
  if (envelope.status !== 'failed') return 'none';
  const err = (envelope.error ?? '').toLowerCase();
  if (!err) return 'capability';
  if (
    /\b(429|502|503|504)\b/.test(err) ||
    err.includes('rate limit') || err.includes('timeout') || err.includes('temporarily unavailable') ||
    err.includes('econnrefused') || err.includes('enotfound') || err.includes('network')
  ) return 'transient';
  if (
    /\b(401|403)\b/.test(err) ||
    err.includes('unauthorized') || err.includes('api key') || err.includes('invalid_api_key') || err.includes('authentication')
  ) return 'auth';
  return 'capability';
}

export type HealingRunOptions = {
  template: TaskTemplate;
  mode: CostMode;
  intent: string;
  original_message: string;
  /**
   * Gate the final success on a QA pass (see qa.ts). A QA failure is treated
   * as a new failure and re-enters the healing loop, still bounded by the
   * same retry budget. Off by default - QA runs the repo's full check suite
   * and is only meaningful for `code` subtasks by default.
   */
  qaCheck?: boolean;
  qaOptions?: Parameters<QAAgent['run']>[0];
};

export class SelfHealingRunner {
  constructor(
    private readonly router: AIRouter,
    private readonly dispatcher: TaskDispatcher,
    private readonly qa: QAAgent = new QAAgent(),
    private readonly maxRetries: number = 3,
  ) {}

  async run(opts: HealingRunOptions): Promise<HealingResult> {
    const attempts: HealingAttempt[] = [];
    let template = opts.template;
    let mode = opts.mode;
    let envelope: TaskResultEnvelope | null = null;
    let exhausted = false;
    const qaCheck = opts.qaCheck ?? template === 'code';

    // `route()` runs a live queryUsage() scan; template/mode only change via
    // nextStrategy() after a failed attempt, so consecutive attempts with
    // the same inputs would otherwise re-run the identical 24h-window query
    // for no new information. Cache by "template:mode" for this run() call.
    const routeCache = new Map<string, ReturnType<AIRouter['route']>>();
    const routeFor = (t: TaskTemplate, m: CostMode) => {
      const key = `${t}:${m}`;
      let cached = routeCache.get(key);
      if (!cached) {
        cached = this.router.route({ template: t, mode: m });
        routeCache.set(key, cached);
      }
      return cached;
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const routing = routeFor(template, mode);
      const request: TaskRequest = {
        tier: routing.tier,
        template,
        intent: opts.intent,
        original_message: opts.original_message,
      };
      const result = await this.dispatcher.dispatch(request);
      const failureClass = classifyFailure(result);
      const strategy = this.strategyFor(attempt, template, mode, opts);

      attempts.push({ attempt, strategy, template, mode, failure_class: failureClass, envelope: result });
      envelope = result;

      if (result.status !== 'failed') break;
      if (attempt >= this.maxRetries || NON_RETRYABLE.includes(failureClass)) {
        exhausted = true;
        break;
      }

      ({ template, mode } = this.nextStrategy(attempt, template, mode, failureClass, opts));
    }

    let qaReport: QAReport | null = null;
    if (envelope && envelope.status === 'completed' && qaCheck) {
      qaReport = await this.qa.run(opts.qaOptions);
      if (!qaReport.passed) {
        const failedNames = qaReport.checks.filter((c) => c.automated && !c.passed).map((c) => c.name).join(', ');
        envelope = {
          ...envelope,
          status: 'failed',
          error: 'qa_failed',
          summary: `Task completed but failed QA: ${failedNames}.`,
        };
        exhausted = true; // QA gate runs once, after the retry budget's work is already done
      }
    }

    return { envelope: envelope!, attempts, qa_report: qaReport, exhausted };
  }

  /** Attempt 1 is always 'initial'; later attempts reflect whichever knob actually changed. */
  private strategyFor(attempt: number, template: TaskTemplate, mode: CostMode, opts: HealingRunOptions): HealingStrategy {
    if (attempt === 1) return 'initial';
    if (template !== opts.template) return 'alternative_agent';
    if (mode !== opts.mode) return 'alternative_strategy';
    return 'retry';
  }

  /**
   * Escalation order: plain retry once for transient errors, then escalate
   * cost mode (cheap->balanced->quality), then fall back to an alternative
   * template. Capability failures skip straight to mode escalation since a
   * same-everything retry won't fix a strategy that didn't work.
   */
  private nextStrategy(
    attempt: number,
    template: TaskTemplate,
    mode: CostMode,
    failureClass: FailureClass,
    opts: HealingRunOptions,
  ): { template: TaskTemplate; mode: CostMode } {
    if (failureClass === 'transient' && attempt === 1) {
      return { template, mode }; // plain retry, same everything
    }
    const escalated = ESCALATE_MODE[mode];
    if (escalated !== mode) {
      return { template, mode: escalated };
    }
    const alt = ALTERNATIVE_TEMPLATE[template];
    if (alt && alt !== template) {
      return { template: alt, mode: opts.mode };
    }
    return { template, mode }; // no strategies left; next loop check marks it exhausted
  }
}
