import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWorkspace, WORKSPACE_SUBDIRS } from './workspace.ts';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('ensureWorkspace', () => {
  it('creates every subdirectory under <dataDir>/workspace', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ws-'));
    const paths = ensureWorkspace(dir);

    expect(paths.root).toBe(join(dir, 'workspace'));
    for (const sub of WORKSPACE_SUBDIRS) {
      expect(existsSync(paths[sub])).toBe(true);
      expect(paths[sub]).toBe(join(dir, 'workspace', sub));
    }
  });

  it('is idempotent when called twice', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-ws-'));
    ensureWorkspace(dir);
    const paths = ensureWorkspace(dir);
    expect(existsSync(paths.handoff)).toBe(true);
  });
});
