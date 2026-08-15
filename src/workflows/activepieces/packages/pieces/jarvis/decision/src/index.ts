/**
 * `@jarvispieces/piece-jarvis-decision` -- "Decision Write" node (Phase 9).
 * Records a statement into Decision Memory (spec section 17) via
 * `createDecision()` (src/vault/decisions.ts).
 *
 * Calls back to `/v1/jarvis/decision/write`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { writeAction } from "./lib/actions/write";

export const jarvisDecisionPiece = createPiece({
  displayName: "Jarvis: Decision Write",
  description: "Record a decision to Jarvis's Decision Memory so it doesn't get re-litigated later.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [writeAction],
  triggers: [],
});
