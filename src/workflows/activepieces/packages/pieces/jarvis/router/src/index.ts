/**
 * `@jarvispieces/piece-jarvis-router` -- "Provider Failover" node (Phase 9).
 * Ask a question through Jarvis's cost-mode router (cheap/balanced/quality)
 * instead of a fixed model. Inherits per-tier retry + fall-up across
 * providers for free (see src/ai-manager/router.ts).
 *
 * Calls back to `/v1/jarvis/router/chat`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { chatAction } from "./lib/actions/chat";

export const jarvisRouterPiece = createPiece({
  displayName: "Jarvis: Provider Failover",
  description:
    "Ask a question through Jarvis's AI Router. Picks a tier by cost mode (cheap/balanced/quality) and automatically retries/falls up across providers on failure.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [chatAction],
  triggers: [],
});
