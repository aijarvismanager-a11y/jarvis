import { describe, expect, test } from 'bun:test';
import { LLMManager } from './manager.ts';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMStreamEvent } from './provider.ts';

/**
 * Regression coverage for the OmniRoute-primary / direct-provider-fallback
 * pattern (JARVIS spec §7.3, §66): a tier can list fallback providers that
 * LLMManager tries, in order, only after the primary's own retries are
 * exhausted. Exercises chatTier and streamTier, including the streaming
 * "already emitted content" guard that must NOT fall back mid-stream.
 */

function makeFailingProvider(name: string, message = 'boom'): LLMProvider {
  return {
    name,
    async chat(): Promise<LLMResponse> {
      throw new Error(message);
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: 'error', error: message };
    },
    async listModels() {
      return [];
    },
  };
}

function makeSucceedingProvider(name: string, content = 'ok'): LLMProvider {
  return {
    name,
    async chat(): Promise<LLMResponse> {
      return { content, tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: name, finish_reason: 'stop' };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: 'text', text: content };
      yield {
        type: 'done',
        response: { content, tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: name, finish_reason: 'stop' },
      };
    },
    async listModels() {
      return [];
    },
  };
}

/** A provider whose stream() emits some text before failing — the case that must NOT fall back. */
function makePartialThenFailingProvider(name: string): LLMProvider {
  return {
    name,
    async chat(): Promise<LLMResponse> {
      throw new Error('should not be called via chat in this test');
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: 'text', text: 'partial output ' };
      yield { type: 'error', error: 'connection dropped mid-stream' };
    },
    async listModels() {
      return [];
    },
  };
}

describe('LLMManager tier fallback chain', () => {
  test('chatTier falls back to the next provider when the primary is exhausted', async () => {
    const manager = new LLMManager();
    manager.registerProvider(makeFailingProvider('omniroute'));
    manager.registerProvider(makeSucceedingProvider('anthropic', 'from anthropic'));
    manager.setTierMap({
      medium: { provider: 'omniroute', fallback: [{ provider: 'anthropic' }] },
    });

    const response = await manager.chatTier('medium', 'test', [{ role: 'user', content: 'hi' }] as LLMMessage[]);
    expect(response.content).toBe('from anthropic');
  });

  test('chatTier throws an aggregated error when every provider in the chain fails', async () => {
    const manager = new LLMManager();
    manager.registerProvider(makeFailingProvider('omniroute', 'gateway down'));
    manager.registerProvider(makeFailingProvider('anthropic', 'no credits'));
    manager.setTierMap({
      medium: { provider: 'omniroute', fallback: [{ provider: 'anthropic' }] },
    });

    await expect(
      manager.chatTier('medium', 'test', [{ role: 'user', content: 'hi' }] as LLMMessage[]),
    ).rejects.toThrow(/All providers failed for tier 'medium'/);
  });

  test('chatTier with no fallback configured preserves the original single-provider error', async () => {
    const manager = new LLMManager();
    manager.registerProvider(makeFailingProvider('omniroute', 'gateway down'));
    manager.setTierMap({ medium: { provider: 'omniroute' } });

    await expect(
      manager.chatTier('medium', 'test', [{ role: 'user', content: 'hi' }] as LLMMessage[]),
    ).rejects.toThrow(/gateway down/);
  });

  test('streamTier falls back to the next provider when the primary never emits content', async () => {
    const manager = new LLMManager();
    manager.registerProvider(makeFailingProvider('omniroute'));
    manager.registerProvider(makeSucceedingProvider('anthropic', 'streamed from anthropic'));
    manager.setTierMap({
      medium: { provider: 'omniroute', fallback: [{ provider: 'anthropic' }] },
    });

    const events: LLMStreamEvent[] = [];
    for await (const event of manager.streamTier('medium', 'test', [{ role: 'user', content: 'hi' }] as LLMMessage[])) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent?.type).toBe('done');
    expect(doneEvent && 'response' in doneEvent ? doneEvent.response.content : null).toBe('streamed from anthropic');
    // No error events should have leaked through to the caller.
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  test('streamTier does NOT fall back once a provider has already emitted content', async () => {
    const manager = new LLMManager();
    manager.registerProvider(makePartialThenFailingProvider('omniroute'));
    manager.registerProvider(makeSucceedingProvider('anthropic', 'should not appear'));
    manager.setTierMap({
      medium: { provider: 'omniroute', fallback: [{ provider: 'anthropic' }] },
    });

    const events: LLMStreamEvent[] = [];
    for await (const event of manager.streamTier('medium', 'test', [{ role: 'user', content: 'hi' }] as LLMMessage[])) {
      events.push(event);
    }

    // The partial text plus a terminal error — never the fallback's content.
    expect(events.some((e) => e.type === 'text' && e.text === 'partial output ')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'text' && e.text.includes('should not appear'))).toBe(false);
  });

  test('setTierMap drops an unregistered fallback provider but keeps the primary', async () => {
    const manager = new LLMManager();
    manager.registerProvider(makeSucceedingProvider('omniroute', 'primary answer'));
    manager.setTierMap({
      medium: { provider: 'omniroute', fallback: [{ provider: 'never-registered' }] },
    });

    const response = await manager.chatTier('medium', 'test', [{ role: 'user', content: 'hi' }] as LLMMessage[]);
    expect(response.content).toBe('primary answer');
  });
});
