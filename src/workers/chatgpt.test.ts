import { describe, expect, it } from 'bun:test';
import { ChatGPTWorker, type BrowserDriver, type PageSnapshot } from './chatgpt.ts';

const COMPOSER_SNAPSHOT: PageSnapshot = {
  title: 'ChatGPT',
  url: 'https://chatgpt.com/',
  text: 'Ask anything',
  elements: [{ id: 1, tag: 'div', text: '', attrs: { id: 'prompt-textarea', contenteditable: 'true' } }],
};

function fakeDriver(opts: {
  navigateSnap?: PageSnapshot;
  snapshots: PageSnapshot[];
  onType?: (elementId: number, text: string, submit?: boolean, append?: boolean) => void;
}): BrowserDriver {
  let snapIndex = 0;
  return {
    async navigate(_url) {
      return opts.navigateSnap ?? COMPOSER_SNAPSHOT;
    },
    async snapshot() {
      const snap = opts.snapshots[Math.min(snapIndex, opts.snapshots.length - 1)];
      snapIndex++;
      return snap!;
    },
    async type(elementId, text, submit, append) {
      opts.onType?.(elementId, text, submit, append);
      return 'typed';
    },
  };
}

describe('ChatGPTWorker.run', () => {
  it('types into the composer, waits for the reply to stabilize, and extracts the text after the prompt', async () => {
    const typed: unknown[] = [];
    const worker = new ChatGPTWorker({
      workspace: '/tmp/ws',
      enabled: true,
      pollIntervalMs: 1,
      driver: fakeDriver({
        snapshots: [
          { title: 'ChatGPT', url: 'x', text: 'Ask anythingfix the bugWorking on it...', elements: [] },
          { title: 'ChatGPT', url: 'x', text: 'Ask anythingfix the bugHere is the fix.', elements: [] },
          { title: 'ChatGPT', url: 'x', text: 'Ask anythingfix the bugHere is the fix.', elements: [] },
        ],
        onType: (id, text, submit) => typed.push({ id, text, submit }),
      }),
    });

    const result = await worker.run({ task_id: 't1', prompt: 'fix the bug' });

    expect(typed).toEqual([{ id: 1, text: 'fix the bug', submit: true }]);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('Here is the fix.');
    expect(result.summary).toBe('Here is the fix.');
  });

  it('returns completed-but-unfinished when the reply never stabilizes before the timeout', async () => {
    const worker = new ChatGPTWorker({
      workspace: '/tmp/ws',
      enabled: true,
      timeout_ms: 5,
      pollIntervalMs: 3,
      driver: fakeDriver({
        snapshots: [
          { title: 'ChatGPT', url: 'x', text: 'a', elements: [] },
          { title: 'ChatGPT', url: 'x', text: 'ab', elements: [] },
          { title: 'ChatGPT', url: 'x', text: 'abc', elements: [] },
        ],
      }),
    });

    const result = await worker.run({ task_id: 't2', prompt: 'x' });
    expect(result.status).toBe('completed');
    expect(result.output).toBe('');
    expect(result.summary).toContain('had not finished streaming');
  });

  it('fails when no composer element is found even after the retry snapshot', async () => {
    const worker = new ChatGPTWorker({
      workspace: '/tmp/ws',
      enabled: true,
      pollIntervalMs: 1,
      driver: fakeDriver({
        navigateSnap: { title: 'ChatGPT', url: 'x', text: 'Log in', elements: [] },
        snapshots: [{ title: 'ChatGPT', url: 'x', text: 'Log in', elements: [] }],
      }),
    });

    const result = await worker.run({ task_id: 't3', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('logged into chatgpt.com');
  });

  it('short-circuits to failed when disabled, without navigating', async () => {
    let navigated = false;
    const worker = new ChatGPTWorker({
      workspace: '/tmp/ws',
      enabled: false,
      driver: {
        async navigate() { navigated = true; return COMPOSER_SNAPSHOT; },
        async snapshot() { return COMPOSER_SNAPSHOT; },
        async type() { return 'typed'; },
      },
    });

    const result = await worker.run({ task_id: 't4', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(navigated).toBe(false);
  });
});
