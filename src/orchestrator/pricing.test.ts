import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PRICING, estimateCost, loadPricing, savePricing } from './pricing.ts';

function withTmpDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-pricing-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('pricing', () => {
  it('loadPricing returns bundled defaults when no file exists', () => {
    withTmpDir((dir) => {
      const pricing = loadPricing(dir);
      expect(pricing).toEqual(DEFAULT_PRICING);
    });
  });

  it('savePricing then loadPricing round-trips and merges over defaults', () => {
    withTmpDir((dir) => {
      const custom = {
        ...DEFAULT_PRICING,
        models: { ...DEFAULT_PRICING.models, 'custom:model': { input_per_1k: 1, output_per_1k: 2 } },
      };
      savePricing(dir, custom);
      const loaded = loadPricing(dir);
      expect(loaded.models['custom:model']).toEqual({ input_per_1k: 1, output_per_1k: 2 });
      // Bundled defaults are still present alongside the user addition.
      expect(loaded.models['anthropic:claude-sonnet-5']).toBeDefined();
    });
  });

  it('falls back to bundled defaults if the file is corrupt', () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, 'pricing.json'), '{not json', 'utf8');
      expect(loadPricing(dir)).toEqual(DEFAULT_PRICING);
    });
  });

  it('estimateCost uses the exact provider:model entry when present', () => {
    const pricing = DEFAULT_PRICING;
    const cost = estimateCost(pricing, 'anthropic', 'claude-sonnet-5', 1000, 1000);
    const expected =
      pricing.models['anthropic:claude-sonnet-5']!.input_per_1k + pricing.models['anthropic:claude-sonnet-5']!.output_per_1k;
    expect(cost).toBeCloseTo(expected, 2);
  });

  it('estimateCost falls back to `default` for an unlisted provider:model pair', () => {
    const pricing = DEFAULT_PRICING;
    const cost = estimateCost(pricing, 'unknown_provider', 'unknown_model', 1000, 1000);
    const expected = pricing.default.input_per_1k + pricing.default.output_per_1k;
    expect(cost).toBeCloseTo(expected, 2);
  });

  it('estimateCost is 0 for a free local model', () => {
    expect(estimateCost(DEFAULT_PRICING, 'ollama', '*', 5000, 5000)).toBe(0);
  });
});
