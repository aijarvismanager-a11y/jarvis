/**
 * `@jarvispieces/piece-jarvis-qa` -- "QA" node (Phase 9). Runs the
 * deterministic QA suite (typecheck/lint/build/tests/static checks --
 * see src/ai-manager/qa.ts) and returns a structured pass/fail report.
 *
 * Calls back to `/v1/jarvis/qa/run`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { runAction } from "./lib/actions/run";

export const jarvisQAPiece = createPiece({
  displayName: "Jarvis: QA",
  description:
    "Run Jarvis's deterministic QA suite (typecheck, lint, build, tests, static checks) and get a structured pass/fail report.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [runAction],
  triggers: [],
});
