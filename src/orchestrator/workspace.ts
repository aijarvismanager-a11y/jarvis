/**
 * Shared Workspace (spec section 14) - the common folder AI Workers read
 * from and write to. Lives under the daemon's data_dir so it follows the
 * same install as the rest of JARVIS's state (~/.jarvis/workspace by
 * default).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const WORKSPACE_SUBDIRS = [
  'tasks',
  'input',
  'output',
  'handoff',
  'artifacts',
  'research',
  'code',
  'images',
  'logs',
  'state',
] as const;

export type WorkspaceSubdir = (typeof WORKSPACE_SUBDIRS)[number];

export type WorkspacePaths = { root: string } & Record<WorkspaceSubdir, string>;

/**
 * Create (if missing) and return the Shared Workspace directory tree
 * rooted at `${dataDir}/workspace`.
 */
export function ensureWorkspace(dataDir: string): WorkspacePaths {
  const root = join(dataDir, 'workspace');
  mkdirSync(root, { recursive: true });

  const paths = { root } as WorkspacePaths;
  for (const sub of WORKSPACE_SUBDIRS) {
    const dir = join(root, sub);
    mkdirSync(dir, { recursive: true });
    paths[sub] = dir;
  }
  return paths;
}
