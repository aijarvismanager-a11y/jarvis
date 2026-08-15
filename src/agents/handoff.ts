/**
 * Handoff - the structured record an agent leaves behind when it finishes
 * its part of a task and passes work to the next agent (spec section 14).
 *
 * A task is not "complete" just because an agent stopped: the agent files a
 * Handoff, the Manager evaluates it, and only then does the task move to
 * its next agent or a terminal state (spec section 15).
 *
 * Persisted as an `agent_messages` row with type='report' and a
 * `payload_kind: 'handoff'` marker in the JSON-encoded `content` field -
 * the `type` CHECK constraint ('task'|'report'|'question'|'escalation') is
 * left untouched rather than adding a 'handoff' variant, since altering a
 * CHECK constraint requires rebuilding the table. `task_id`/`project_id`
 * (added to agent_messages in Phase 1) give it structured linkage on top of
 * that.
 */

import { getDb } from '../vault/schema.ts';
import { sendMessage, type AgentMessage, type MessagePriority } from './messaging.ts';

export type Handoff = {
  task_id: string;
  from_agent: string;
  to_agent: string;
  status: 'completed' | 'failed' | 'needs_input';
  summary: string;
  instructions: string[];
  artifacts: string[];
  decisions: string[];
  warnings: string[];
  open_questions: string[];
  next_action: string;
};

type HandoffPayload = Handoff & { payload_kind: 'handoff' };

/**
 * File a handoff. Returns the underlying AgentMessage id.
 */
export function sendHandoff(
  handoff: Handoff,
  opts?: { project_id?: string; priority?: MessagePriority }
): AgentMessage {
  const payload: HandoffPayload = { ...handoff, payload_kind: 'handoff' };

  return sendMessage(handoff.from_agent, handoff.to_agent, 'report', JSON.stringify(payload), {
    priority: opts?.priority ?? (handoff.status === 'failed' ? 'high' : 'normal'),
    requires_response: false,
    task_id: handoff.task_id,
    project_id: opts?.project_id,
  });
}

/**
 * Try to parse an AgentMessage's content as a Handoff. Returns null if the
 * message isn't a handoff (wrong type, or content isn't the expected JSON
 * shape) so callers can safely filter a mixed `getMessages()` result.
 */
export function parseHandoff(message: AgentMessage): Handoff | null {
  if (message.type !== 'report') return null;
  try {
    const parsed = JSON.parse(message.content) as Partial<HandoffPayload>;
    if (parsed.payload_kind !== 'handoff') return null;
    const { payload_kind: _drop, ...handoff } = parsed as HandoffPayload;
    return handoff;
  } catch {
    return null;
  }
}

/** All handoffs filed for a given task, oldest first. */
export function getHandoffsForTask(taskId: string): Handoff[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, from_agent, to_agent, type, content, priority, requires_response, deadline, created_at, task_id, project_id
       FROM agent_messages WHERE task_id = ? AND type = 'report' ORDER BY created_at ASC`
    )
    .all(taskId) as Array<{
    id: string;
    from_agent: string;
    to_agent: string;
    type: 'task' | 'report' | 'question' | 'escalation';
    content: string;
    priority: MessagePriority;
    requires_response: number;
    deadline: number | null;
    created_at: number;
    task_id: string | null;
    project_id: string | null;
  }>;

  const handoffs: Handoff[] = [];
  for (const row of rows) {
    const parsed = parseHandoff({
      ...row,
      requires_response: row.requires_response === 1,
    });
    if (parsed) handoffs.push(parsed);
  }
  return handoffs;
}
