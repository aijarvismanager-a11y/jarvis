// Agent lifecycle
export { AgentInstance } from './agent.ts';
export type { Agent, AgentStatus, AuthorityBounds } from './agent.ts';

// Inter-agent communication
export { sendMessage, getMessages, getPendingMessages } from './messaging.ts';
export type { AgentMessage, MessageType, MessagePriority } from './messaging.ts';

// Task delegation
export { delegateTask, reportCompletion } from './delegation.ts';
export type { DelegationResult } from './delegation.ts';

// Handoff (AI Manager, Phase 1)
export { sendHandoff, parseHandoff, getHandoffsForTask } from './handoff.ts';
export type { Handoff } from './handoff.ts';

// Hierarchy management
export { AgentHierarchy } from './hierarchy.ts';
export type { AgentTreeNode } from './hierarchy.ts';

// Main orchestrator
export { AgentOrchestrator } from './orchestrator.ts';
export type { LLMManager } from '../llm/manager.ts';
