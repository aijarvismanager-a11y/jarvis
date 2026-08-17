import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { CommandWorker } from './command-worker.ts';

function fakeSpawn(opts: { code: number; stdout?: string; stderr?: string }) {
  return () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.code);
    });
    return child;
  };
}

describe('CommandWorker.run', () => {
  it('substitutes {prompt} into the configured args template', async () => {
    let capturedArgs: string[] | undefined;
    const spawnFn = ((binary: string, args: string[]) => {
      capturedArgs = args;
      return fakeSpawn({ code: 0, stdout: 'done' })();
    }) as any;

    const worker = new CommandWorker({
      name: 'my_tool',
      binary: 'my-tool',
      args: ['run', '--prompt', '{prompt}', '--quiet'],
      capabilities: ['code'],
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn,
    });

    await worker.run({ task_id: 't1', prompt: 'fix it' });
    expect(capturedArgs).toEqual(['run', '--prompt', 'fix it', '--quiet']);
  });

  it('appends the prompt as the last arg when the template has no {prompt} placeholder', async () => {
    let capturedArgs: string[] | undefined;
    const spawnFn = ((binary: string, args: string[]) => {
      capturedArgs = args;
      return fakeSpawn({ code: 0, stdout: 'done' })();
    }) as any;

    const worker = new CommandWorker({
      name: 'my_tool',
      binary: 'my-tool',
      args: ['-p'],
      capabilities: ['code'],
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn,
    });

    await worker.run({ task_id: 't1', prompt: 'fix it' });
    expect(capturedArgs).toEqual(['-p', 'fix it']);
  });

  it('returns completed on exit code 0 and failed with stderr on nonzero', async () => {
    const ok = new CommandWorker({
      name: 'my_tool', binary: 'my-tool', args: ['{prompt}'], capabilities: ['code'], workspace: '/tmp/ws',
      enabled: true, spawnFn: fakeSpawn({ code: 0, stdout: 'all good' }) as any,
    });
    expect((await ok.run({ task_id: 't1', prompt: 'x' })).status).toBe('completed');

    const bad = new CommandWorker({
      name: 'my_tool', binary: 'my-tool', args: ['{prompt}'], capabilities: ['code'], workspace: '/tmp/ws',
      enabled: true, spawnFn: fakeSpawn({ code: 1, stderr: 'boom' }) as any,
    });
    const result = await bad.run({ task_id: 't2', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });

  it('short-circuits to failed when disabled, without spawning', async () => {
    let spawned = false;
    const worker = new CommandWorker({
      name: 'my_tool', binary: 'my-tool', args: ['{prompt}'], capabilities: ['code'], workspace: '/tmp/ws',
      enabled: false, spawnFn: (() => { spawned = true; throw new Error('should not spawn'); }) as any,
    });
    const result = await worker.run({ task_id: 't3', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(spawned).toBe(false);
  });
});
