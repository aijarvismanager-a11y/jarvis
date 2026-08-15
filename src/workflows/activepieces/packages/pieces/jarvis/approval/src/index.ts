/**
 * `@jarvispieces/piece-jarvis-approval` -- "Approval" node (Phase 9). A
 * generic human-in-the-loop gate: creates an ApprovalRequest through the
 * same mechanism the in-process authority gate uses (so it shows up
 * alongside agent-originated approvals on the dashboard/channels) and
 * blocks the flow until it resolves or times out.
 *
 * Calls back to `/v1/jarvis/approval/request`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { requestAction } from "./lib/actions/request";

export const jarvisApprovalPiece = createPiece({
  displayName: "Jarvis: Approval",
  description:
    "Pause the flow and ask the user to approve or deny before continuing. Shows up on the dashboard/channels like any other Jarvis approval.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [requestAction],
  triggers: [],
});
