// AI Manager Core (Phase 2): AIRouter, Planner, ManagerAgent

export { AIRouter } from './router.ts';
export type { CostMode, TaskTier, RoutingDecision, ReliabilitySample } from './router.ts';

export { Planner, parsePlanResponse } from './planner.ts';
export type { PlanResult, PlannedSubtask, PlannedPriority } from './planner.ts';

export { ManagerAgent } from './manager-agent.ts';
export type { ProjectRunResult, SubtaskOutcome } from './manager-agent.ts';

// AI Council (Phase 5): multi-provider fan-out + consensus.
export { AICouncil, parseChairResponse } from './council.ts';
export type { CouncilSeat, CouncilOpinion, CouncilVerdict } from './council.ts';

// QA / Self-Healing (Phase 6): deterministic QA checks + bounded retry loop.
export { QAAgent } from './qa.ts';
export type { QACheckName, QACheckResult, QAReport, QAOptions } from './qa.ts';

export { SelfHealingRunner, classifyFailure } from './self-healing.ts';
export type { FailureClass, HealingStrategy, HealingAttempt, HealingResult, HealingRunOptions } from './self-healing.ts';
