/**
 * `@jarvispieces/piece-jarvis-memory` -- "Memory Write" node (Phase 9).
 * Writes a subject/predicate/object fact into the vault's knowledge graph
 * (see src/vault/facts.ts). `subjectId` must be an existing entity id --
 * look one up with the `jarvis-context` piece's vault search first.
 *
 * Calls back to `/v1/jarvis/memory/write`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { writeAction } from "./lib/actions/write";

export const jarvisMemoryPiece = createPiece({
  displayName: "Jarvis: Memory Write",
  description: "Write a fact (subject/predicate/object) into Jarvis's vault knowledge graph.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [writeAction],
  triggers: [],
});
