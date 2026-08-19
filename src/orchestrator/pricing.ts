/**
 * Pricing table (spec section 19: API料金対策) - per-model token cost
 * estimates, kept external/user-editable like ai-profiles.ts so a price
 * change never needs a code change. JARVIS Core never calls a paid API
 * itself (spec Rule 2/section 21) - this is pure local computation over
 * token counts src/llm/usage.ts already recorded.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ModelPricing = {
  /** Cost per 1,000 input tokens, in `PricingTable.currency`. */
  input_per_1k: number;
  /** Cost per 1,000 output tokens, in `PricingTable.currency`. */
  output_per_1k: number;
};

export type PricingTable = {
  currency: 'JPY' | 'USD';
  /** USD -> currency rate used to derive the bundled defaults below. Not fetched live (Rule 2) - edit it by hand when it drifts. */
  fx_rate_usd: number;
  /** Keyed "provider:model". Entries with no exact match fall back to `default`. */
  models: Record<string, ModelPricing>;
  /** Used for any provider:model pair with no entry above, so an unlisted model estimates as "typical", not 0. */
  default: ModelPricing;
};

const DEFAULT_FX_RATE_USD = 150;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function jpy(usdPer1k: number): number {
  return round4(usdPer1k * DEFAULT_FX_RATE_USD);
}

/**
 * Starting prices (spec section 19's example uses JPY): published USD
 * list prices at authoring time, converted at DEFAULT_FX_RATE_USD. These
 * drift - they exist so the cost dashboard shows *something* meaningful
 * out of the box, not as a billing source of truth. The user edits
 * `${dataDir}/pricing.json` to correct them.
 */
const DEFAULT_MODELS: Record<string, ModelPricing> = {
  'anthropic:claude-opus-4-8': { input_per_1k: jpy(0.015), output_per_1k: jpy(0.075) },
  'anthropic:claude-opus-4-7': { input_per_1k: jpy(0.015), output_per_1k: jpy(0.075) },
  'anthropic:claude-sonnet-5': { input_per_1k: jpy(0.003), output_per_1k: jpy(0.015) },
  'anthropic:claude-sonnet-4-6': { input_per_1k: jpy(0.003), output_per_1k: jpy(0.015) },
  'anthropic:claude-sonnet-4-5-20250929': { input_per_1k: jpy(0.003), output_per_1k: jpy(0.015) },
  'anthropic:claude-haiku-4-5-20251001': { input_per_1k: jpy(0.001), output_per_1k: jpy(0.005) },
  'anthropic:claude-fable-5': { input_per_1k: jpy(0.003), output_per_1k: jpy(0.015) },
  'openai:gpt-4o': { input_per_1k: jpy(0.0025), output_per_1k: jpy(0.01) },
  'openai:gpt-4o-mini': { input_per_1k: jpy(0.00015), output_per_1k: jpy(0.0006) },
  'gemini:gemini-2.5-pro': { input_per_1k: jpy(0.00125), output_per_1k: jpy(0.005) },
  'gemini:gemini-2.5-flash': { input_per_1k: jpy(0.0003), output_per_1k: jpy(0.0025) },
  'gemini:gemini-3-flash-preview': { input_per_1k: jpy(0.0003), output_per_1k: jpy(0.0025) },
  'gemini:gemini-3.1-pro-preview': { input_per_1k: jpy(0.00125), output_per_1k: jpy(0.005) },
  'groq:llama-3.3-70b-versatile': { input_per_1k: jpy(0.00059), output_per_1k: jpy(0.00079) },
  'groq:llama-3.1-8b-instant': { input_per_1k: jpy(0.00005), output_per_1k: jpy(0.00008) },
  'nvidia:meta/llama-3.3-70b-instruct': { input_per_1k: jpy(0.0002), output_per_1k: jpy(0.0002) },
  // Locally-hosted, no per-token API charge.
  'ollama:*': { input_per_1k: 0, output_per_1k: 0 },
};

export const DEFAULT_PRICING: PricingTable = {
  currency: 'JPY',
  fx_rate_usd: DEFAULT_FX_RATE_USD,
  models: DEFAULT_MODELS,
  default: { input_per_1k: jpy(0.002), output_per_1k: jpy(0.008) },
};

function pricingPath(dataDir: string): string {
  return join(dataDir, 'pricing.json');
}

/** Falls back to the defaults, merged under any user overrides, if the file is missing or unreadable. */
export function loadPricing(dataDir: string): PricingTable {
  const path = pricingPath(dataDir);
  if (!existsSync(path)) return DEFAULT_PRICING;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PricingTable>;
    return {
      currency: parsed.currency ?? DEFAULT_PRICING.currency,
      fx_rate_usd: parsed.fx_rate_usd ?? DEFAULT_PRICING.fx_rate_usd,
      models: { ...DEFAULT_PRICING.models, ...(parsed.models ?? {}) },
      default: parsed.default ?? DEFAULT_PRICING.default,
    };
  } catch {
    return DEFAULT_PRICING;
  }
}

export function savePricing(dataDir: string, pricing: PricingTable): void {
  const path = pricingPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pricing, null, 2), 'utf8');
}

/** Estimated cost, in `pricing.currency`, for one call's token counts. Unknown provider:model pairs use `pricing.default` rather than reporting 0. */
export function estimateCost(
  pricing: PricingTable,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const entry = pricing.models[`${provider}:${model}`] ?? pricing.default;
  const cost = (inputTokens / 1000) * entry.input_per_1k + (outputTokens / 1000) * entry.output_per_1k;
  return Math.round(cost * 100) / 100;
}
