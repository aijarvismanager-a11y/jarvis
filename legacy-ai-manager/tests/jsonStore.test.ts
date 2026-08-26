import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deepMerge, readJson, readJsonWithDefaults, writeJson, fileExists } from '../app/main/store/jsonStore';

describe('deepMerge', () => {
  it('overrides scalar fields while keeping unset defaults', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('merges nested objects recursively instead of replacing them wholesale', () => {
    const result = deepMerge({ nested: { x: 1, y: 2 } }, { nested: { y: 9 } });
    expect(result).toEqual({ nested: { x: 1, y: 9 } });
  });

  it('replaces arrays outright rather than merging element-by-element', () => {
    const result = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    expect(result).toEqual({ list: [9] });
  });

  it('returns the override when the base is not a plain object', () => {
    expect(deepMerge(1 as unknown as object, 2 as unknown as object)).toBe(2);
  });
});

describe('readJson / writeJson / readJsonWithDefaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-orchestrator-test-'));
  const file = path.join(dir, 'sub', 'data.json');

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back when the file does not exist', () => {
    expect(readJson(file, { ok: true })).toEqual({ ok: true });
  });

  it('creates parent directories and round-trips data', () => {
    writeJson(file, { hello: 'world' });
    expect(fileExists(file)).toBe(true);
    expect(readJson(file, {})).toEqual({ hello: 'world' });
  });

  it('merges a partial saved file over full defaults', () => {
    writeJson(file, { appearance: 'dark' });
    const result = readJsonWithDefaults(file, { appearance: 'system', notificationsEnabled: true });
    expect(result).toEqual({ appearance: 'dark', notificationsEnabled: true });
  });

  it('falls back to defaults entirely on malformed JSON', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not valid json', 'utf-8');
    expect(readJson(file, { fallback: true })).toEqual({ fallback: true });
  });
});
