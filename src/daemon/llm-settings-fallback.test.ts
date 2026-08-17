import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { initDatabase, closeDb } from '../vault/schema.ts';
import { DEFAULT_CONFIG, type JarvisConfig } from '../config/types.ts';
import { getLLMSettings, saveLLMSettings, mergeLLMSettingsIntoConfig } from './llm-settings.ts';
import { configureLLMTiers } from '../llm/config-binding.ts';
import { LLMManager } from '../llm/manager.ts';
import type { LLMProvider, LLMResponse } from '../llm/provider.ts';

function freshConfig(): JarvisConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function stubProvider(name: string): LLMProvider {
  return {
    name,
    async chat(): Promise<LLMResponse> {
      return { content: 'ok', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: name, finish_reason: 'stop' };
    },
    async *stream() {},
    async listModels() { return []; },
  };
}

describe('llm-settings tier fallback persistence', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  test('saveLLMSettings persists a tier_fallback chain and getLLMSettings reflects it', () => {
    const config = freshConfig();
    saveLLMSettings(config, {
      tiers: { medium: 'omniroute:auto' },
      tier_fallback: { medium: ['anthropic:claude-sonnet-4-6', 'openai:gpt-4o'] },
    });

    const settings = getLLMSettings(config);
    expect(settings.tiers.medium).toBe('omniroute:auto');
    expect(settings.tier_fallback.medium).toEqual(['anthropic:claude-sonnet-4-6', 'openai:gpt-4o']);
    expect(settings.tier_fallback.high).toEqual([]);
  });

  test('an empty array clears a previously saved fallback chain', () => {
    const config = freshConfig();
    saveLLMSettings(config, { tier_fallback: { medium: ['anthropic:claude-sonnet-4-6'] } });
    expect(getLLMSettings(config).tier_fallback.medium).toEqual(['anthropic:claude-sonnet-4-6']);

    saveLLMSettings(config, { tier_fallback: { medium: [] } });
    expect(getLLMSettings(config).tier_fallback.medium).toEqual([]);
  });

  test('mergeLLMSettingsIntoConfig survives a fresh config object (simulated daemon restart)', () => {
    const config = freshConfig();
    saveLLMSettings(config, { tier_fallback: { high: ['groq:llama-3.3-70b'] } });

    const reloaded = freshConfig();
    mergeLLMSettingsIntoConfig(reloaded);

    expect(reloaded.llm.tiers?.fallback?.high).toEqual(['groq:llama-3.3-70b']);
  });

  test('configureLLMTiers wires the persisted fallback into a live LLMManager chain', async () => {
    const config = freshConfig();
    saveLLMSettings(config, {
      tiers: { medium: 'omniroute:auto' },
      tier_fallback: { medium: ['anthropic:claude-sonnet-4-6'] },
    });

    const manager = new LLMManager();
    manager.registerProvider(stubProvider('omniroute'));
    manager.registerProvider(stubProvider('anthropic'));
    configureLLMTiers(manager, config.llm);

    expect(manager.getTierMap().medium?.fallback).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });
});
