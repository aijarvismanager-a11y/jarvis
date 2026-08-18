import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { MCPWorker } from './mcp.ts';

/** Fake MCP stdio server: replies to `initialize` and `tools/call` with a fixed tool result, newline-delimited JSON-RPC. */
function fakeMcpServer(toolResult: unknown) {
  const writes: string[] = [];
  const spawnFn = (() => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: (data: string) => { writes.push(data); }, end: () => {} };
    child.kill = () => {};
    child.stdin.write = (data: string) => {
      writes.push(data);
      const msg = JSON.parse(data);
      queueMicrotask(() => {
        if (msg.method === 'initialize') {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } }) + '\n'));
        } else if (msg.method === 'tools/call') {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: toolResult }) + '\n'));
        }
      });
      return true;
    };
    return child;
  }) as any;
  return { spawnFn, writes };
}

describe('MCPWorker.run', () => {
  it('initializes then calls the configured tool with the prompt, returning extracted text', async () => {
    const { spawnFn, writes } = fakeMcpServer({ content: [{ type: 'text', text: 'search results here' }] });
    const worker = new MCPWorker({
      name: 'my_mcp',
      command: 'my-mcp-server',
      args: ['--stdio'],
      tool: 'search',
      capabilities: ['research'],
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn,
    });

    const result = await worker.run({ task_id: 't1', prompt: 'find the bug' });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('search results here');

    const calls = writes.map((w) => JSON.parse(w));
    expect(calls.some((c) => c.method === 'initialize')).toBe(true);
    expect(calls.some((c) => c.method === 'notifications/initialized')).toBe(true);
    const toolCall = calls.find((c) => c.method === 'tools/call');
    expect(toolCall.params).toEqual({ name: 'search', arguments: { prompt: 'find the bug' } });
  });

  it('uses a custom promptParam name when configured', async () => {
    const { spawnFn, writes } = fakeMcpServer({ content: [{ type: 'text', text: 'ok' }] });
    const worker = new MCPWorker({
      name: 'my_mcp',
      command: 'my-mcp-server',
      args: [],
      tool: 'ask',
      promptParam: 'query',
      capabilities: ['research'],
      workspace: '/tmp/ws',
      enabled: true,
      spawnFn,
    });

    await worker.run({ task_id: 't1', prompt: 'find the bug' });

    const toolCall = writes.map((w) => JSON.parse(w)).find((c) => c.method === 'tools/call');
    expect(toolCall.params.arguments).toEqual({ query: 'find the bug' });
  });

  it('returns failed when the tool result has isError: true', async () => {
    const { spawnFn } = fakeMcpServer({ content: [{ type: 'text', text: 'boom' }], isError: true });
    const worker = new MCPWorker({
      name: 'my_mcp', command: 'my-mcp-server', args: [], tool: 'search', capabilities: ['research'],
      workspace: '/tmp/ws', enabled: true, spawnFn,
    });

    const result = await worker.run({ task_id: 't1', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });

  it('short-circuits to failed when disabled, without spawning', async () => {
    let spawned = false;
    const worker = new MCPWorker({
      name: 'my_mcp', command: 'my-mcp-server', args: [], tool: 'search', capabilities: ['research'],
      workspace: '/tmp/ws', enabled: false, spawnFn: (() => { spawned = true; throw new Error('should not spawn'); }) as any,
    });
    const result = await worker.run({ task_id: 't1', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(spawned).toBe(false);
  });

  it('fails with a timeout error when the server never responds', async () => {
    const spawnFn = (() => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: () => {}, end: () => {} };
      child.kill = () => {};
      return child;
    }) as any;
    const worker = new MCPWorker({
      name: 'my_mcp', command: 'my-mcp-server', args: [], tool: 'search', capabilities: ['research'],
      workspace: '/tmp/ws', enabled: true, timeout_ms: 5, spawnFn,
    });
    const result = await worker.run({ task_id: 't1', prompt: 'x' });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('timed out');
  });
});
