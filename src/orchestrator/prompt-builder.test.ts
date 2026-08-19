import { describe, expect, it } from 'bun:test';
import { buildHandoffPrompt } from './prompt-builder.ts';

const base = { task: 'do the thing', objective: 'get it done', context: 'some context', expectedOutput: ['a', 'b'] };

describe('buildHandoffPrompt', () => {
  it('falls back to the generic TASK/OBJECTIVE template for an unrecognized target AI', () => {
    const prompt = buildHandoffPrompt({ ...base, targetAI: 'my_custom_worker' });
    expect(prompt).toContain('TASK\ndo the thing');
    expect(prompt).toContain('OBJECTIVE\nget it done');
    expect(prompt).toContain('CONTEXT\nsome context');
    expect(prompt).toContain('1. a');
    expect(prompt).toContain('TARGET AI\nmy_custom_worker');
  });

  it('falls back to generic for the "未定" (undecided) target', () => {
    const prompt = buildHandoffPrompt({ ...base, targetAI: '未定' });
    expect(prompt).toContain('TARGET AI\n未定');
  });

  it('uses distinct wording per known target AI (case-insensitive match)', () => {
    const claude = buildHandoffPrompt({ ...base, targetAI: 'claude_code' });
    const gemini = buildHandoffPrompt({ ...base, targetAI: 'Gemini' });
    const chatgpt = buildHandoffPrompt({ ...base, targetAI: 'CHATGPT' });
    const ollama = buildHandoffPrompt({ ...base, targetAI: 'ollama' });

    expect(claude).toContain('## Task');
    expect(gemini).toContain('依頼内容: do the thing');
    expect(chatgpt).toContain('次のタスクをお願いします');
    expect(ollama).not.toContain('TASK\n');

    // All four differ from each other and from the generic fallback.
    const generic = buildHandoffPrompt({ ...base, targetAI: 'unknown' });
    const all = [claude, gemini, chatgpt, ollama, generic];
    expect(new Set(all).size).toBe(all.length);
  });

  it('every known-AI template still states which AI it targets', () => {
    for (const targetAI of ['claude_code', 'gemini', 'chatgpt', 'ollama']) {
      const prompt = buildHandoffPrompt({ ...base, targetAI });
      expect(prompt).toContain(targetAI);
    }
  });

  it('omits context/expected-output sections when absent', () => {
    const prompt = buildHandoffPrompt({ task: 't', objective: 'o', targetAI: 'gemini' });
    expect(prompt).not.toContain('背景情報');
    expect(prompt).not.toContain('期待する出力');
  });
});
