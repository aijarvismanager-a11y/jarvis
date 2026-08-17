import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { ClaudeCodeWorker } from './claude-code.ts';

/** Minimal fake ChildProcess: emits stdout/stderr data then closes. */
function fakeSpawn(opts: { code: number; stdout?: string; stderr?: string; hang?: boolean }) {
  return () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    if (!opts.hang) {
      queueMicrotask(() => {
        if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
        if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
        child.emit('close', opts.code);
      });
    }
    return child;
  };
}

describe('ClaudeCodeWorker.run', () => {
  it('returns completed with stdout as summary on exit code 0', async () => {
    const worker = new ClaudeCodeWorker({
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn: fakeSpawn({ code: 0, stdout: 'fixed the bug\nmore output' }) as any,
    });

    const result = await worker.run({ task_id: 't1', prompt: 'fix it' });
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('fixed the bug');
    expect(result.output).toContain('fixed the bug');
  });

  it('returns failed with stderr as error on non-zero exit code', async () => {
    const worker = new ClaudeCodeWorker({
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn: fakeSpawn({ code: 1, stderr: 'something broke' }) as any,
    });

    const result = await worker.run({ task_id: 't2', prompt: 'fix it' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('something broke');
  });

  it('falls back to stdout for the error when stderr is empty (e.g. "Not logged in")', async () => {
    const worker = new ClaudeCodeWorker({
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn: fakeSpawn({ code: 1, stdout: 'Not logged in - Please run /login' }) as any,
    });

    const result = await worker.run({ task_id: 't4', prompt: 'fix it' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Not logged in - Please run /login');
  });

  it('short-circuits to failed when the worker is disabled, without spawning', async () => {
    let spawned = false;
    const worker = new ClaudeCodeWorker({
      workspace: '/tmp/ws',
      enabled: false,
      spawnFn: (() => {
        spawned = true;
        throw new Error('should not spawn');
      }) as any,
    });

    const result = await worker.run({ task_id: 't3', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(spawned).toBe(false);
  });
});
