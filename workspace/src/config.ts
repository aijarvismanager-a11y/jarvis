import * as path from 'path';

// workspace/src/config.ts -> workspace/ -> repo root (ai-orchestrator/ai-manager)
export const WORKSPACE_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(WORKSPACE_ROOT, '..');
export const CONFIG_DIR = path.join(REPO_ROOT, 'config');

export const WORKFLOW_FILE = path.join(CONFIG_DIR, 'workflow.json');
export const AI_SERVICES_FILE = path.join(CONFIG_DIR, 'ai_services.json');

/**
 * Resolves a file path referenced from workflow.json (input_files/output_files)
 * against the workspace root, rejecting attempts to escape it.
 */
export function resolveWorkspacePath(relativePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  const withSep = WORKSPACE_ROOT.endsWith(path.sep) ? WORKSPACE_ROOT : WORKSPACE_ROOT + path.sep;
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(withSep)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }
  return resolved;
}
