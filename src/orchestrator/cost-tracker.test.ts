import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { initDatabase, closeDb } from '../vault/schema.ts';
import { setUsageDatabase, recordUsage } from '../llm/usage.ts';
import { saveBudget } from './budget.ts';
import { savePricing, DEFAULT_PRICING } from './pricing.ts';
import { budgetGuard, checkBudget, getCostSummary } from './cost-tracker.ts';

function withTmpDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-cost-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let db: Database;

describe('cost-tracker', () => {
  beforeEach(() => {
    closeDb();
    db = initDatabase(':memory:');
    setUsageDatabase(() => db);
  });

  it('getCostSummary is all-zero with no usage recorded', () => {
    withTmpDir((dir) => {
      const summary = getCostSummary(dir);
      expect(summary.daily_cost).toBe(0);
      expect(summary.monthly_cost).toBe(0);
      expect(summary.status).toBe('ok');
      expect(summary.by_provider).toEqual([]);
    });
  });

  it('sums today\'s calls into daily_cost using per-provider:model pricing', () => {
    withTmpDir((dir) => {
      recordUsage({
        tier: 'medium', resolved_tier: 'medium', subsystem: 'test',
        provider: 'anthropic', model: 'claude-sonnet-5',
        input_tokens: 1000, output_tokens: 1000, latency_ms: 100,
      });
      const pricePerCall =
        DEFAULT_PRICING.models['anthropic:claude-sonnet-5']!.input_per_1k +
        DEFAULT_PRICING.models['anthropic:claude-sonnet-5']!.output_per_1k;

      const summary = getCostSummary(dir);
      expect(summary.daily_cost).toBeCloseTo(pricePerCall, 2);
      expect(summary.monthly_cost).toBeCloseTo(pricePerCall, 2);
      expect(summary.by_provider).toEqual([{ provider: 'anthropic', cost: summary.daily_cost, calls: 1 }]);
    });
  });

  it('excludes calls from before the start of today but still counts them for the month', () => {
    withTmpDir((dir) => {
      recordUsage({
        tier: 'medium', resolved_tier: 'medium', subsystem: 'test',
        provider: 'anthropic', model: 'claude-sonnet-5',
        input_tokens: 1000, output_tokens: 1000, latency_ms: 100,
      });
      // Backdate the just-recorded row to 2 days ago - still within this
      // calendar month (barring a run on the 1st/2nd), outside "today".
      db.run(`UPDATE llm_usage SET ts = ? WHERE id = (SELECT MAX(id) FROM llm_usage)`, [Date.now() - 2 * 86400000]);

      const summary = getCostSummary(dir);
      expect(summary.daily_cost).toBe(0);
      expect(summary.monthly_cost).toBeGreaterThan(0);
    });
  });

  it('checkBudget reports warning once daily cost crosses warning_threshold', () => {
    withTmpDir((dir) => {
      saveBudget(dir, { daily_budget: 10, warning_threshold: 0.01, hard_limit: 10, currency: 'JPY' });
      recordUsage({
        tier: 'medium', resolved_tier: 'medium', subsystem: 'test',
        provider: 'anthropic', model: 'claude-sonnet-5',
        input_tokens: 1000, output_tokens: 1000, latency_ms: 100,
      });
      const result = checkBudget(dir);
      expect(result.status).toBe('warning');
    });
  });

  it('checkBudget reports exceeded once daily cost crosses hard_limit, and budgetGuard blocks', () => {
    withTmpDir((dir) => {
      saveBudget(dir, { daily_budget: 0.01, warning_threshold: 0.01, hard_limit: 0.01, currency: 'JPY' });
      recordUsage({
        tier: 'medium', resolved_tier: 'medium', subsystem: 'test',
        provider: 'anthropic', model: 'claude-sonnet-5',
        input_tokens: 1000, output_tokens: 1000, latency_ms: 100,
      });
      expect(checkBudget(dir).status).toBe('exceeded');

      const guard = budgetGuard(dir);
      expect(guard.allowed).toBe(false);
      expect(guard.reason).toBeTruthy();
    });
  });

  it('budgetGuard allows calls when under budget', () => {
    withTmpDir((dir) => {
      saveBudget(dir, { daily_budget: 1000, warning_threshold: 900, hard_limit: 1000, currency: 'JPY' });
      expect(budgetGuard(dir)).toEqual({ allowed: true });
    });
  });

  it('an unlisted provider:model pair still contributes cost via the pricing default, not 0', () => {
    withTmpDir((dir) => {
      savePricing(dir, DEFAULT_PRICING);
      recordUsage({
        tier: 'medium', resolved_tier: 'medium', subsystem: 'test',
        provider: 'some_new_provider', model: 'some_new_model',
        input_tokens: 1000, output_tokens: 1000, latency_ms: 100,
      });
      const summary = getCostSummary(dir);
      expect(summary.daily_cost).toBeGreaterThan(0);
    });
  });
});
