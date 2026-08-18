import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCustomWorkers, addCustomWorker, removeCustomWorker } from './custom-registry.ts';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function baseConfig(overrides: Partial<Parameters<typeof addCustomWorker>[1]> = {}) {
  return { name: 'my_tool', binary: 'my-tool', args: ['{prompt}'], capabilities: ['code' as const], ...overrides };
}

describe('custom worker persistence', () => {
  it('loadCustomWorkers returns an empty list when no file exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    expect(loadCustomWorkers(dir)).toEqual([]);
  });

  it('addCustomWorker persists a valid config and it round-trips', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    const result = await addCustomWorker(dir, baseConfig());
    expect(result.ok).toBe(true);
    expect(loadCustomWorkers(dir)).toEqual([baseConfig()]);
  });

  it('rejects a name colliding with a built-in Worker', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    const result = await addCustomWorker(dir, baseConfig({ name: 'gemini' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('built-in');
  });

  it('rejects a name colliding with a built-in Worker regardless of case', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    const result = await addCustomWorker(dir, baseConfig({ name: 'GEMINI' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('built-in');
  });

  it('rejects a duplicate custom Worker name', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    await addCustomWorker(dir, baseConfig());
    const result = await addCustomWorker(dir, baseConfig());
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid name, missing binary, or empty capabilities', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    expect((await addCustomWorker(dir, baseConfig({ name: 'has spaces' }))).ok).toBe(false);
    expect((await addCustomWorker(dir, baseConfig({ binary: '' }))).ok).toBe(false);
    expect((await addCustomWorker(dir, baseConfig({ capabilities: [] }))).ok).toBe(false);
  });

  it('removeCustomWorker deletes a config and reports false for an unknown name', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-cw-'));
    await addCustomWorker(dir, baseConfig());
    expect(await removeCustomWorker(dir, 'my_tool')).toBe(true);
    expect(loadCustomWorkers(dir)).toEqual([]);
    expect(await removeCustomWorker(dir, 'my_tool')).toBe(false);
  });
});
