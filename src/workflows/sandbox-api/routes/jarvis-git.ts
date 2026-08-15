/**
 * `/v1/jarvis/git/*` -- Phase 9 "Git Commit" and "Git Push" nodes. Backs
 * `commit()`/`push()` (src/github/git.ts).
 *
 * `push` is safety-critical: per spec section 29 (and audit section 6),
 * push must be APPROVAL-gated through the same `AuthorityEngine`/
 * `ApprovalManager` every other git-push path uses (see
 * src/actions/tools/github.ts + the `git-push-requires-approval` /
 * `git-force-push-blocked` context rules seeded in src/daemon/index.ts) --
 * NOT a bespoke check here. The gate itself runs in the injected
 * `gitPush` backend (src/workflows/runtime/service-backends.ts), not in
 * this route; this file only validates the request envelope.
 */

import { json, err, parseJsonObject, type RouteContext, type RouteHandler } from "./shared";

export interface GitCommitRequest {
  repoPath: string;
  message: string;
  all?: boolean;
}

export interface GitResultLike {
  ok: boolean;
  output: string;
  error?: string;
}

export type GitCommitFn = (
  req: GitCommitRequest,
  ctx: { runId: string; projectId: string },
) => Promise<GitResultLike>;

export interface GitPushRequest {
  repoPath: string;
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
}

export type GitPushFn = (
  req: GitPushRequest,
  ctx: { runId: string; projectId: string },
) => Promise<GitResultLike>;

export interface JarvisGitRouteDeps {
  gitCommit?: GitCommitFn;
  gitPush?: GitPushFn;
}

export function createJarvisGitCommitRoute(deps: JarvisGitRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.gitCommit) {
      return err("jarvis git.commit not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.repoPath !== "string" || raw.repoPath.length === 0) {
      return err("repoPath must be a non-empty string", 400);
    }
    if (typeof raw.message !== "string" || raw.message.length === 0) {
      return err("message must be a non-empty string", 400);
    }
    const out: GitCommitRequest = { repoPath: raw.repoPath, message: raw.message };
    if (raw.all !== undefined) {
      if (typeof raw.all !== "boolean") return err("all must be a boolean", 400);
      out.all = raw.all;
    }

    const reply = await deps.gitCommit(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}

export function createJarvisGitPushRoute(deps: JarvisGitRouteDeps): RouteHandler {
  return async (ctx: RouteContext) => {
    if (!deps.gitPush) {
      return err("jarvis git.push not configured", 503);
    }
    const raw = await parseJsonObject(ctx);
    if (raw instanceof Response) return raw;
    if (typeof raw.repoPath !== "string" || raw.repoPath.length === 0) {
      return err("repoPath must be a non-empty string", 400);
    }
    const out: GitPushRequest = { repoPath: raw.repoPath };
    if (typeof raw.remote === "string" && raw.remote.length > 0) out.remote = raw.remote;
    if (typeof raw.branch === "string" && raw.branch.length > 0) out.branch = raw.branch;
    if (raw.setUpstream !== undefined) {
      if (typeof raw.setUpstream !== "boolean") return err("setUpstream must be a boolean", 400);
      out.setUpstream = raw.setUpstream;
    }

    const reply = await deps.gitPush(out, {
      runId: ctx.claims.runId,
      projectId: ctx.claims.projectId,
    });
    return json(reply);
  };
}
