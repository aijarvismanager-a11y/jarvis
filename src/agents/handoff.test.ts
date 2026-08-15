/**
 * Unit tests for handoff.ts (spec sections 14-15). No dedicated test file
 * existed for this module before - it was only exercised indirectly through
 * src/ai-manager/manager-agent.e2e.test.ts (which calls getHandoffsForTask
 * as part of a full project run, but doesn't probe sendHandoff/parseHandoff
 * directly or their edge cases).
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { initDatabase } from '../vault/schema.ts';
import { sendHandoff, parseHandoff, getHandoffsForTask, type Handoff } from './handoff.ts';
import { sendMessage } from './messaging.ts';

function makeHandoff(overrides?: Partial<Handoff>): Handoff {
  return {
    task_id: 'task_1',
    from_agent: 'task_code',
    to_agent: 'manager',
    status: 'completed',
    summary: 'Implemented the feature.',
    instructions: [],
    artifacts: ['task_1'],
    decisions: [],
    warnings: [],
    open_questions: [],
    next_action: 'advance',
    ...overrides,
  };
}

describe('handoff.ts', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('sendHandoff persists a report-type agent_messages row scoped to the task/project', () => {
    const handoff = makeHandoff();
    const message = sendHandoff(handoff, { project_id: 'proj_1' });

    expect(message.type).toBe('report');
    expect(message.from_agent).toBe('task_code');
    expect(message.to_agent).toBe('manager');
    expect(message.task_id).toBe('task_1');
    expect(message.project_id).toBe('proj_1');
    expect(message.requires_response).toBe(false);
  });

  it('defaults priority to normal for a completed handoff and high for a failed one', () => {
    const completed = sendHandoff(makeHandoff({ status: 'completed' }));
    expect(completed.priority).toBe('normal');

    const failed = sendHandoff(makeHandoff({ task_id: 'task_2', status: 'failed', warnings: ['auth error'] }));
    expect(failed.priority).toBe('high');
  });

  it('an explicit priority overrides the status-based default', () => {
    const message = sendHandoff(makeHandoff({ status: 'failed' }), { priority: 'low' });
    expect(message.priority).toBe('low');
  });

  it('parseHandoff round-trips every field through sendHandoff', () => {
    const handoff = makeHandoff({
      instructions: ['Review the diff'],
      decisions: ['Used PostgreSQL over SQLite'],
      warnings: ['Rate limit hit once'],
      open_questions: ['Should this be paginated?'],
      next_action: 'review',
    });
    const message = sendHandoff(handoff);

    const parsed = parseHandoff(message);
    expect(parsed).toEqual(handoff);
  });

  it('parseHandoff returns null for a non-report message type', () => {
    // A 'task' message that happens to contain handoff-shaped JSON should
    // not be misidentified as a handoff - only 'report' messages qualify.
    const fakeMessage = {
      id: 'm1',
      from_agent: 'a',
      to_agent: 'b',
      type: 'task' as const,
      content: JSON.stringify({ ...makeHandoff(), payload_kind: 'handoff' }),
      priority: 'normal' as const,
      requires_response: false,
      deadline: null,
      created_at: Date.now(),
      task_id: null,
      project_id: null,
    };
    expect(parseHandoff(fakeMessage)).toBeNull();
  });

  it('parseHandoff returns null for report messages that are not handoffs (e.g. a plain text report)', () => {
    const fakeMessage = {
      id: 'm2',
      from_agent: 'a',
      to_agent: 'b',
      type: 'report' as const,
      content: 'Just a plain status update, not JSON.',
      priority: 'normal' as const,
      requires_response: false,
      deadline: null,
      created_at: Date.now(),
      task_id: null,
      project_id: null,
    };
    expect(parseHandoff(fakeMessage)).toBeNull();
  });

  it('getHandoffsForTask returns only handoffs for that task, oldest first, ignoring other message types', () => {
    sendHandoff(makeHandoff({ task_id: 'task_A', summary: 'first' }));
    sendHandoff(makeHandoff({ task_id: 'task_B', summary: 'other task' }));
    // A plain report on task_A that isn't a handoff payload must be skipped.
    sendMessage('task_code', 'manager', 'report', 'Just a heads up, still working.', { task_id: 'task_A' });
    sendHandoff(makeHandoff({ task_id: 'task_A', summary: 'second', status: 'needs_input', next_action: 'await_user_input' }));

    const handoffs = getHandoffsForTask('task_A');
    expect(handoffs).toHaveLength(2);
    expect(handoffs[0]!.summary).toBe('first');
    expect(handoffs[1]!.summary).toBe('second');
    expect(handoffs[1]!.status).toBe('needs_input');
  });

  it('getHandoffsForTask returns an empty array for a task with no handoffs', () => {
    expect(getHandoffsForTask('task_none')).toEqual([]);
  });
});
