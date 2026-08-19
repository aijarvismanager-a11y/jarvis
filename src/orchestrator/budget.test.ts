import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUDGET, loadBudget, saveBudget } from './budget.ts';

function withTmpDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-budget-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('budget', () => {
  it('loadBudget returns spec section 19 defaults when no file exists', () => {
    withTmpDir((dir) => {
      expect(loadBudget(dir)).toEqual(DEFAULT_BUDGET);
      expect(DEFAULT_BUDGET).toEqual({ daily_budget: 300, warning_threshold: 200, hard_limit: 300, currency: 'JPY' });
    });
  });

  it('saveBudget then loadBudget round-trips', () => {
    withTmpDir((dir) => {
      const custom = { daily_budget: 1000, warning_threshold: 700, hard_limit: 1000, currency: 'USD' as const };
      saveBudget(dir, custom);
      expect(loadBudget(dir)).toEqual(custom);
    });
  });

  it('falls back to defaults if the file is corrupt', () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, 'budget.json'), 'not json', 'utf8');
      expect(loadBudget(dir)).toEqual(DEFAULT_BUDGET);
    });
  });
});
