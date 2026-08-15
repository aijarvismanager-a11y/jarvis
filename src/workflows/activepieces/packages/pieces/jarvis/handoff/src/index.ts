/**
 * `@jarvispieces/piece-jarvis-handoff` -- "Handoff" and "Review" nodes
 * (Phase 9). `send` files a structured Handoff record for a task (spec
 * section 14-15: a task isn't complete until a Handoff exists). `list`
 * reads back every Handoff filed for a task, for a downstream review step.
 *
 * Calls back to `/v1/jarvis/handoff/send` and `/v1/jarvis/handoff/list`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { sendAction } from "./lib/actions/send";
import { listAction } from "./lib/actions/list";

export const jarvisHandoffPiece = createPiece({
  displayName: "Jarvis: Handoff",
  description:
    "File a structured handoff report for a task, or review the handoffs already filed for one.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [sendAction, listAction],
  triggers: [],
});
