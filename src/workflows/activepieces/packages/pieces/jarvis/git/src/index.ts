/**
 * `@jarvispieces/piece-jarvis-git` -- "Git Commit" and "Git Push" nodes
 * (Phase 9). `commit` is a thin wrapper over `git commit`. `push` is
 * safety-critical: the daemon backend runs it through the same
 * AuthorityEngine/ApprovalManager gate every other git-push path uses
 * (require_approval by default -- see src/daemon/index.ts's seeded
 * context_rules), so this piece never bypasses that gate.
 *
 * Calls back to `/v1/jarvis/git/commit` and `/v1/jarvis/git/push`.
 */

import { createPiece, PieceAuth } from "@activepieces/pieces-framework";
import { commitAction } from "./lib/actions/commit";
import { pushAction } from "./lib/actions/push";

export const jarvisGitPiece = createPiece({
  displayName: "Jarvis: Git",
  description:
    "Commit and push changes in a local git repository. Push is approval-gated by default, matching Jarvis's chat/agent safety rules.",
  auth: PieceAuth.None(),
  minimumSupportedRelease: "0.0.0",
  logoUrl: "",
  authors: ["jarvis"],
  actions: [commitAction, pushAction],
  triggers: [],
});
