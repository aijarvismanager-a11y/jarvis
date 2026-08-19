/**
 * MCPWorker - a generic Model Context Protocol Worker, configurable at
 * runtime like CommandWorker. Backs user-added "mcp" input_method Workers
 * (src/workers/types.ts reserved `WorkerInputMethod = 'mcp'` for this).
 *
 * Speaks raw JSON-RPC 2.0 over the MCP stdio transport (newline-delimited
 * JSON, no Content-Length framing) rather than depending on
 * @modelcontextprotocol/sdk - kept dependency-free like the other Workers
 * (see the note in types.ts), and this only needs `initialize` +
 * `tools/call`, a small enough surface to hand-roll.
 */

import spawn from 'cross-spawn';
import { StringDecoder } from 'node:string_decoder';
import type { Worker, WorkerCapability, WorkerDefinition, WorkerRunRequest, WorkerRunResult } from './types.ts';
import type { SpawnFn } from './claude-code.ts';
import { checkBinaryAvailable, withWorkerRetries } from './exec-cli.ts';

export type MCPWorkerConfig = {
  name: string;
  /** MCP server command on PATH, e.g. "npx", "uvx", "my-mcp-server". */
  command: string;
  /** Argv for launching the server (no prompt substitution - MCP tool args are structured, not templated). */
  args: string[];
  /** Tool to call on the server for every run. */
  tool: string;
  /** Argument name the task prompt is passed under. Defaults to "prompt". */
  promptParam?: string;
  capabilities: WorkerCapability[];
  timeout_ms?: number;
  retry?: number;
  enabled?: boolean;
};

export type MCPWorkerOptions = MCPWorkerConfig & {
  workspace: string;
  spawnFn?: SpawnFn;
};

type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params?: unknown };
type JsonRpcNotification = { jsonrpc: '2.0'; method: string; params?: unknown };
type JsonRpcResponse = { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } };

const PROTOCOL_VERSION = '2024-11-05';

export class MCPWorker implements Worker {
  readonly definition: WorkerDefinition;
  private readonly command: string;
  private readonly argsTemplate: string[];
  private readonly tool: string;
  private readonly promptParam: string;
  private readonly spawnFn: SpawnFn;

  constructor(opts: MCPWorkerOptions) {
    this.command = opts.command;
    this.argsTemplate = opts.args;
    this.tool = opts.tool;
    this.promptParam = opts.promptParam ?? 'prompt';
    this.spawnFn = opts.spawnFn ?? spawn;
    this.definition = {
      name: opts.name,
      type: 'custom',
      status: 'ready',
      capabilities: opts.capabilities,
      input_method: 'mcp',
      output_method: 'mcp',
      workspace: opts.workspace,
      timeout_ms: opts.timeout_ms ?? 10 * 60 * 1000,
      retry: opts.retry ?? 0,
      enabled: opts.enabled ?? false,
    };
  }

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    if (!this.definition.enabled) {
      return { status: 'failed', summary: 'worker disabled', output: '', files: [], error: 'disabled' };
    }
    return withWorkerRetries(this.definition.retry, () => this.runOnce(request), (attempt, result) =>
      console.warn(`[MCPWorker:${this.command}] attempt ${attempt} failed (${result.error}), retrying...`));
  }

  checkAvailable(): Promise<boolean> {
    return checkBinaryAvailable(this.spawnFn, this.command);
  }

  private async runOnce(request: WorkerRunRequest): Promise<WorkerRunResult> {
    const cwd = request.cwd ?? this.definition.workspace;
    const session = new MCPStdioSession(this.spawnFn, this.command, this.argsTemplate, cwd, this.definition.timeout_ms);

    try {
      await session.initialize();
      const result = await session.callTool(this.tool, { [this.promptParam]: request.prompt });
      const output = extractText(result);
      const isError = typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true;

      return isError
        ? { status: 'failed', summary: `${this.tool} returned an error`, output, files: [], error: output || 'tool reported isError' }
        : {
            status: 'completed',
            summary: output.split('\n').find((l) => l.trim().length > 0)?.slice(0, 200) ?? 'done',
            output,
            files: [],
          };
    } catch (err) {
      return {
        status: 'failed',
        summary: `${this.command} mcp worker threw`,
        output: '',
        files: [],
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      session.close();
    }
  }
}

/** Extracts human-readable text from an MCP tools/call result's content blocks. */
function extractText(result: unknown): string {
  if (typeof result !== 'object' || result === null) return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text: string } => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/** One MCP stdio server subprocess and its JSON-RPC request/response bookkeeping for a single Worker run. */
class MCPStdioSession {
  private readonly child: ReturnType<SpawnFn>;
  private nextId = 1;
  private readonly decoder = new StringDecoder('utf-8');
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;
  private readonly deadline: number;

  constructor(spawnFn: SpawnFn, command: string, args: string[], cwd: string, private readonly timeoutMs: number) {
    this.deadline = Date.now() + timeoutMs;
    this.child = spawnFn(command, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.on('error', (err: Error) => this.rejectAll(err));
    this.child.on('close', () => this.rejectAll(new Error(`${command} mcp server exited`)));
  }

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // Not a JSON-RPC message (e.g. server log noise on stdout) - ignore.
    }
    if (typeof msg.id !== 'number') return; // Notification from the server - nothing to resolve.
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  }

  private rejectAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private send(payload: JsonRpcRequest | JsonRpcNotification): void {
    this.child.stdin?.write(JSON.stringify(payload) + '\n');
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const remainingMs = Math.max(0, this.deadline - Date.now());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp request "${method}" timed out after ${this.timeoutMs}ms`));
      }, remainingMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'jarvis', version: '1.0.0' },
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin?.end();
    this.child.kill();
  }
}
