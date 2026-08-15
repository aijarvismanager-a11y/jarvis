/**
 * `@jarvispieces/piece-jarvis-manager` -- "AI Task" and "Agent Assignment"
 * nodes (Phase 9). `runProject` drives the full Planner -> Router ->
 * Assignment -> Execution -> Handoff pass (ManagerAgent); `assignAgent` is
 * the pure routing decision alone, useful when a flow wants to know which
 * tier a task would go to before committing to running it.
 *
 * Calls back to `/v1/jarvis/manager/run-project` and `/v1/jarvis/manager/assign-agent`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { runProjectAction } from "./lib/actions/run-project";
import { assignAgentAction } from "./lib/actions/assign-agent";

export const jarvisManagerPiece = createPiece({
  displayName: "Jarvis: AI Manager",
  description:
    "Run a request through Jarvis's AI Manager: plan it into a dependency graph of subtasks, assign each to a tier, execute, and file handoffs -- or just check which tier a task would be assigned to.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [runProjectAction, assignAgentAction],
  triggers: [],
});
