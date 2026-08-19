/**
 * Worker - an external AI environment JARVIS delegates work to (spec
 * "JARVIS AI統合司令塔" section 10). JARVIS does not own or run these
 * models; a Worker is a thin adapter over an AI the user already has
 * access to (Claude Code CLI, Gemini CLI, ChatGPT, ...).
 *
 * Keep this dependency-free (no LLM provider imports) - Workers are
 * deliberately a separate axis from src/llm/* (direct API providers).
 */

export type WorkerType = 'claude_code' | 'gemini' | 'chatgpt' | 'ollama' | 'custom';

export type WorkerStatus = 'ready' | 'working' | 'waiting' | 'handoff' | 'error' | 'done' | 'disabled';

export type WorkerCapability =
  | 'code'      // writing/editing/refactoring code, git operations
  | 'research'  // information gathering, web/doc lookup
  | 'write'     // prose drafting (docs, emails, summaries)
  | 'plan'      // decomposition, multi-step planning
  | 'image'     // image generation/editing
  | 'general';

export type WorkerInputMethod = 'cli' | 'browser' | 'mcp' | 'file';
export type WorkerOutputMethod = 'stdout' | 'file' | 'browser' | 'mcp';

export type WorkerDefinition = {
  name: string;
  type: WorkerType;
  status: WorkerStatus;
  capabilities: WorkerCapability[];
  input_method: WorkerInputMethod;
  output_method: WorkerOutputMethod;
  /** Absolute path to the workspace the worker reads/writes files in. */
  workspace: string;
  timeout_ms: number;
  retry: number;
  enabled: boolean;
};

export type WorkerRunRequest = {
  task_id: string;
  /** One-line instruction plus any context the worker needs, verbatim. */
  prompt: string;
  /** Files the worker should be aware of (paths relative to workspace). */
  files?: string[];
  cwd?: string;
};

export type WorkerRunResult = {
  status: 'completed' | 'failed' | 'needs_input';
  summary: string;
  output: string;
  files: string[];
  error?: string;
};

export interface Worker {
  readonly definition: WorkerDefinition;
  run(request: WorkerRunRequest): Promise<WorkerRunResult>;
  /**
   * Cheap presence check ("is the underlying binary/command actually on
   * this machine"), distinct from `run()` - no task is executed. Optional:
   * browser-based Workers (ChatGPTWorker) have no equivalent non-invasive
   * check and omit it. CLI/MCP Workers implement it so the dashboard can
   * show "not connected" as soon as a Worker is enabled, rather than only
   * discovering a missing binary the first time a task is run against it
   * (spec's "Adapterは初期版ではダミーでよい" / `STATUS: NOT_CONNECTED`).
   */
  checkAvailable?(): Promise<boolean>;
}
