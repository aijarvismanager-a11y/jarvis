/**
 * Budget config (spec section 19-20) - daily spending cap for direct API
 * usage (src/llm/*), external and user-editable like ai-profiles.ts /
 * pricing.ts. This is data only; enforcement lives in cost-tracker.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type BudgetConfig = {
  daily_budget: number;
  /** Cost at/above which status becomes 'warning'. */
  warning_threshold: number;
  /** Cost at/above which status becomes 'exceeded' and the budget guard blocks further API calls. */
  hard_limit: number;
  currency: 'JPY' | 'USD';
};

/** Spec section 19's own example values. */
export const DEFAULT_BUDGET: BudgetConfig = {
  daily_budget: 300,
  warning_threshold: 200,
  hard_limit: 300,
  currency: 'JPY',
};

function budgetPath(dataDir: string): string {
  return join(dataDir, 'budget.json');
}

export function loadBudget(dataDir: string): BudgetConfig {
  const path = budgetPath(dataDir);
  if (!existsSync(path)) return DEFAULT_BUDGET;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BudgetConfig>;
    return { ...DEFAULT_BUDGET, ...parsed };
  } catch {
    return DEFAULT_BUDGET;
  }
}

export function saveBudget(dataDir: string, budget: BudgetConfig): void {
  const path = budgetPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(budget, null, 2), 'utf8');
}
