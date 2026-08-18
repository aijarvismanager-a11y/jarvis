import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMcpWorkers, addMcpWorker, removeMcpWorker } from './mcp-registry.ts';
import { addCustomWorker } from './custom-registry.ts';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function baseConfig(overrides: Partial<Parameters<typeof addMcpWorker>[1]> = {}) {
  return { name: 'my_mcp', command: 'my-mcp-server', args: ['--stdio'], tool: 'search', capabilities: ['research' as const], ...overrides };
}

describe('mcp worker persistence', () => {
  it('loadMcpWorkers returns an empty list when no file exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-'));
    expect(loadMcpWorkers(dir)).toEqual([]);
  });

  it('addMcpWorker persists a valid config and it round-trips', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-'));
    const result = addMcpWorker(dir, baseConfig());
    expect(result.ok).toBe(true);
    expect(loadMcpWorkers(dir)).toEqual([baseConfig()]);
  });

  it('rejects a name colliding with a built-in Worker', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-'));
    const result = addMcpWorker(dir, baseConfig({ name: 'chatgpt' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('built-in');
  });

  it('rejects a name colliding with an existing custom (CLI) Worker', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-'));
    addCustomWorker(dir, { name: 'shared_name', binary: 'x', args: [], capabilities: ['code'] });
    const result = addMcpWorker(dir, baseConfig({ name: 'shared_name' }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid name, missing command/tool, or empty capabilities', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-'));
    expect(addMcpWorker(dir, baseConfig({ name: 'has spaces' })).ok).toBe(false);
    expect(addMcpWorker(dir, baseConfig({ command: '' })).ok).toBe(false);
    expect(addMcpWorker(dir, baseConfig({ tool: '' })).ok).toBe(false);
    expect(addMcpWorker(dir, baseConfig({ capabilities: [] })).ok).toBe(false);
  });

  it('removeMcpWorker deletes a config and reports false for an unknown name', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-mcp-'));
    addMcpWorker(dir, baseConfig());
    expect(removeMcpWorker(dir, 'my_mcp')).toBe(true);
    expect(loadMcpWorkers(dir)).toEqual([]);
    expect(removeMcpWorker(dir, 'my_mcp')).toBe(false);
  });
});
