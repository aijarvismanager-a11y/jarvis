/**
 * `@jarvispieces/piece-jarvis-council` -- "AI Council" node (Phase 9). Fans
 * a question out to several cost-mode seats in parallel, has a chair pass
 * synthesize a verdict, and (by default) records it as a Decision.
 *
 * Calls back to `/v1/jarvis/council/convene`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { conveneAction } from "./lib/actions/convene";

export const jarvisCouncilPiece = createPiece({
  displayName: "Jarvis: AI Council",
  description:
    "Ask multiple AI seats (cheap/balanced/quality) the same question independently, then synthesize their answers into one verdict.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [conveneAction],
  triggers: [],
});
