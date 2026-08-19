import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { checkBinaryAvailable } from './exec-cli.ts';

function fakeSpawn(behavior: 'exit' | 'enoent-event' | 'enoent-throw', exitCode = 0) {
  return () => {
    if (behavior === 'enoent-throw') {
      const err: any = new Error('spawn ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    const child: any = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (behavior === 'enoent-event') {
        const err: any = new Error('spawn ENOENT');
        err.code = 'ENOENT';
        child.emit('error', err);
      } else {
        child.emit('exit', exitCode);
      }
    });
    return child;
  };
}

describe('checkBinaryAvailable', () => {
  it('resolves true when the process starts and exits, regardless of exit code', async () => {
    expect(await checkBinaryAvailable(fakeSpawn('exit', 0) as any, 'some-tool')).toBe(true);
    expect(await checkBinaryAvailable(fakeSpawn('exit', 1) as any, 'some-tool')).toBe(true);
  });

  it('resolves false when spawn emits an ENOENT error event', async () => {
    expect(await checkBinaryAvailable(fakeSpawn('enoent-event') as any, 'missing-tool')).toBe(false);
  });

  it('resolves false when spawnFn throws synchronously with ENOENT', async () => {
    expect(await checkBinaryAvailable(fakeSpawn('enoent-throw') as any, 'missing-tool')).toBe(false);
  });

  it('treats a non-ENOENT spawn error as available (binary exists, some other issue)', async () => {
    const spawnFn = () => {
      const child: any = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        const err: any = new Error('EACCES');
        err.code = 'EACCES';
        child.emit('error', err);
      });
      return child;
    };
    expect(await checkBinaryAvailable(spawnFn as any, 'no-permission-tool')).toBe(true);
  });

  it('treats a still-running process past the timeout as available', async () => {
    const spawnFn = () => {
      const child: any = new EventEmitter();
      child.kill = () => {};
      return child; // never emits exit/error
    };
    expect(await checkBinaryAvailable(spawnFn as any, 'slow-tool', 20)).toBe(true);
  });
});
