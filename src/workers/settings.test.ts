import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerRegistry } from './registry.ts';
import {
  loadWorkerSettings,
  saveWorkerSettings,
  applyWorkerSettings,
  setWorkerEnabledPersisted,
  workerSettingsPath,
} from './settings.ts';
import type { Worker, WorkerRunRequest, WorkerRunResult } from './types.ts';

function fakeWorker(name: string, enabled: boolean): Worker {
  return {
    definition: {
      name,
      type: 'custom',
      status: 'ready',
      capabilities: ['code'],
      input_method: 'cli',
      output_method: 'stdout',
      workspace: '/tmp/ws',
      timeout_ms: 1000,
      retry: 0,
      enabled,
    },
    async run(_req: WorkerRunRequest): Promise<WorkerRunResult> {
      return { status: 'completed', summary: 'ok', output: '', files: [] };
    },
  };
}

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('worker settings persistence', () => {
  it('loadWorkerSettings returns empty defaults when no file exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-wset-'));
    expect(loadWorkerSettings(dir)).toEqual({ enabled: {} });
  });

  it('loadWorkerSettings falls back to defaults on a corrupt file instead of throwing', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-wset-'));
    writeFileSync(workerSettingsPath(dir), '{ not valid json', 'utf-8');
    expect(loadWorkerSettings(dir)).toEqual({ enabled: {} });
  });

  it('saveWorkerSettings then loadWorkerSettings round-trips', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-wset-'));
    saveWorkerSettings(dir, { enabled: { claude_code: true, gemini: false } });
    expect(loadWorkerSettings(dir)).toEqual({ enabled: { claude_code: true, gemini: false } });
  });

  it('applyWorkerSettings overrides matching Workers and skips unknown names', () => {
    const registry = new WorkerRegistry();
    registry.register(fakeWorker('claude_code', false));
    applyWorkerSettings(registry, { enabled: { claude_code: true, ghost_worker: true } });
    expect(registry.get('claude_code')?.definition.enabled).toBe(true);
  });

  it('setWorkerEnabledPersisted merges into any existing settings on disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-wset-'));
    saveWorkerSettings(dir, { enabled: { gemini: true } });
    const result = setWorkerEnabledPersisted(dir, 'claude_code', true);
    expect(result).toEqual({ enabled: { gemini: true, claude_code: true } });
    expect(loadWorkerSettings(dir)).toEqual({ enabled: { gemini: true, claude_code: true } });
  });
});
