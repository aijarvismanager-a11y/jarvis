import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { OllamaWorker } from './ollama.ts';

/** Minimal fake ChildProcess: emits stdout/stderr data then closes. */
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

describe('OllamaWorker.run', () => {
  it('runs `ollama run <model> <prompt>` and returns completed on exit code 0', async () => {
    let capturedArgs: string[] | undefined;
    const spawnFn = (_bin: string, args: string[]) => {
      capturedArgs = args;
      return fakeSpawn({ code: 0, stdout: 'local reply\nmore' })();
    };
    const worker = new OllamaWorker({ workspace: '/tmp/ws', model: 'llama3.1', enabled: true, spawnFn: spawnFn as any });

    const result = await worker.run({ task_id: 't1', prompt: 'summarize this' });
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('local reply');
    expect(capturedArgs).toEqual(['run', 'llama3.1', 'summarize this']);
  });

  it('returns failed on non-zero exit code', async () => {
    const worker = new OllamaWorker({
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn: fakeSpawn({ code: 1, stderr: 'model not found' }) as any,
    });
    const result = await worker.run({ task_id: 't2', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('model not found');
  });

  it('short-circuits to failed when disabled, without spawning', async () => {
    let spawned = false;
    const worker = new OllamaWorker({
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

  it('is disabled and free by default (defaults align with pricing.ts\'s ollama:* entry)', () => {
    const worker = new OllamaWorker({ workspace: '/tmp/ws' });
    expect(worker.definition.enabled).toBe(false);
    expect(worker.definition.type).toBe('ollama');
    expect(worker.definition.capabilities).toEqual(['general', 'write', 'research']);
  });
});

describe('OllamaWorker.checkAvailable', () => {
  /** checkBinaryAvailable listens for 'exit', not 'close' - a distinct fake from run()'s tests above. */
  function fakeSpawnExit(code: number) {
    return () => {
      const child: any = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('exit', code));
      return child;
    };
  }

  it('resolves true when the process starts (even a non-zero exit)', async () => {
    const worker = new OllamaWorker({ workspace: '/tmp/ws', spawnFn: fakeSpawnExit(1) as any });
    expect(await worker.checkAvailable()).toBe(true);
  });

  it('resolves false when spawn fails with ENOENT', async () => {
    const spawnFn = () => {
      const err: any = new Error('not found');
      err.code = 'ENOENT';
      throw err;
    };
    const worker = new OllamaWorker({ workspace: '/tmp/ws', spawnFn: spawnFn as any });
    expect(await worker.checkAvailable()).toBe(false);
  });
});
