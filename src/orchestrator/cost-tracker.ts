/**
 * Cost management (spec section 19-20: コスト管理 / APIを使いすぎないための
 * ルール). Turns already-recorded llm_usage rows (src/llm/usage.ts) into an
 * estimated cost against a budget, and answers "is a paid API call still
 * allowed right now". Pure local computation over data src/llm/* already
 * collected - this module never makes a network call itself (Rule 2:
 * "Routerのためだけに毎回有料APIを呼ばない").
 */

import { queryUsage, type UsageRawRow } from '../llm/usage.ts';
import { loadPricing, estimateCost, type PricingTable } from './pricing.ts';
import { loadBudget, type BudgetConfig } from './budget.ts';

export type BudgetStatus = 'ok' | 'warning' | 'exceeded';

export type ProviderCost = { provider: string; cost: number; calls: number };

export type CostSummary = {
  currency: 'JPY' | 'USD';
  daily_cost: number;
  monthly_cost: number;
  budget: BudgetConfig;
  status: BudgetStatus;
  by_provider: ProviderCost[];
  /** True if the underlying row cap (see queryUsage) means monthly_cost/by_provider undercounts a very high-volume period. */
  monthly_partial: boolean;
};

function startOfDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonthMs(now: number): number {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Sums estimated cost across raw usage rows since `fromMs`, grouped by
 * provider. Uses queryUsage's raw (per-call) rows rather than a SQL-side
 * sum because pricing varies by (provider, model) pair, not provider
 * alone - a provider can serve multiple tiers on different models at
 * different prices, so tokens must be priced per row before summing.
 */
function costSince(pricing: PricingTable, fromMs: number): { total: number; byProvider: ProviderCost[]; partial: boolean } {
  const result = queryUsage({ fromMs }, 'none');
  const rows: UsageRawRow[] = result.raw ?? [];
  const totals = new Map<string, { cost: number; calls: number }>();
  let total = 0;
  for (const row of rows) {
    const cost = estimateCost(pricing, row.provider, row.model, row.input_tokens, row.output_tokens);
    total += cost;
    const entry = totals.get(row.provider) ?? { cost: 0, calls: 0 };
    entry.cost += cost;
    entry.calls += 1;
    totals.set(row.provider, entry);
  }
  return {
    total: Math.round(total * 100) / 100,
    byProvider: [...totals.entries()]
      .map(([provider, v]) => ({ provider, cost: Math.round(v.cost * 100) / 100, calls: v.calls }))
      .sort((a, b) => b.cost - a.cost),
    partial: result.raw_truncated ?? false,
  };
}

export function getCostSummary(dataDir: string): CostSummary {
  const pricing = loadPricing(dataDir);
  const budget = loadBudget(dataDir);
  const now = Date.now();
  const daily = costSince(pricing, startOfDayMs(now));
  const monthly = costSince(pricing, startOfMonthMs(now));

  const status: BudgetStatus =
    daily.total >= budget.hard_limit ? 'exceeded' : daily.total >= budget.warning_threshold ? 'warning' : 'ok';

  return {
    currency: pricing.currency,
    daily_cost: daily.total,
    monthly_cost: monthly.total,
    budget,
    status,
    by_provider: daily.byProvider,
    monthly_partial: monthly.partial,
  };
}

export function checkBudget(dataDir: string): { status: BudgetStatus; dailyCost: number; budget: BudgetConfig } {
  const pricing = loadPricing(dataDir);
  const budget = loadBudget(dataDir);
  const { total: dailyCost } = costSince(pricing, startOfDayMs(Date.now()));
  const status: BudgetStatus =
    dailyCost >= budget.hard_limit ? 'exceeded' : dailyCost >= budget.warning_threshold ? 'warning' : 'ok';
  return { status, dailyCost, budget };
}

/**
 * Spec section 20: "予算超過 -> API実行を止める". Callers gate a direct
 * (paid) API request on this before dispatching; `allowed: false` means
 * today's estimated spend has hit the hard limit. Injected into
 * src/llm/manager.ts as an optional guard (LLMManager.setBudgetGuard) -
 * that module stays budget-agnostic when no guard is wired, so tests and
 * other embedders of LLMManager are unaffected.
 */
export function budgetGuard(dataDir: string): { allowed: boolean; reason?: string } {
  const { status, dailyCost, budget } = checkBudget(dataDir);
  if (status === 'exceeded') {
    return {
      allowed: false,
      reason: `本日の推定API利用額が日次予算を超えたため停止しました(推定 ${dailyCost}${budget.currency} / 上限 ${budget.hard_limit}${budget.currency})。Manual Handoffをご利用ください。`,
    };
  }
  return { allowed: true };
}
