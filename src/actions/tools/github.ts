/**
 * GitHub / Git Tools (spec section 28, "GitHub連携"): repository detection,
 * branch detection, status, diff, commit, push, pull, branch creation, plus
 * best-effort Issue/PR/PR-status/Review coverage.
 *
 * Deliberately NOT a single generic "run any git command" tool: each
 * operation is its own tool NAME so the authority gate (see
 * src/authority/tool-action-map.ts + orchestrator.ts's executeTool) can
 * apply spec section 29's per-operation safety table -
 *   Read: AUTO, Git commit: AUTO/configurable, Git push: APPROVAL,
 *   Force push: BLOCK
 * - which requires distinguishing `git_push` from `git_force_push` by tool
 * name. A single multiplexed "github" tool with an `action` parameter (the
 * pattern content.ts/commitments.ts use) would collapse that distinction at
 * the gate, since the gate only ever sees the tool's literal name.
 *
 * Every tool takes `repo_path` (the working directory of the target repo)
 * rather than assuming a fixed cwd - this daemon can manage more than one
 * project.
 */

import type { ToolDefinition } from './registry.ts';
import {
  detectRepository, detectBranch, getStatus, getDiff, commit, push, forcePush, pull, createBranch,
} from '../../github/git.ts';
import {
  createIssue, createPullRequest, getPullRequestStatus, listReviews, createReview,
} from '../../github/api.ts';

const REPO_PATH_PARAM = {
  type: 'string',
  description: 'Absolute path to the local git repository.',
  required: true,
} as const;

async function withRepo(repoPath: string, fn: (owner: string, repo: string) => Promise<unknown>): Promise<string> {
  const info = await detectRepository(repoPath);
  if (!info.isRepo) return `Error: ${repoPath} is not a git repository.`;
  if (!info.owner || !info.repo) return `Error: ${repoPath}'s remote is not a GitHub URL (or has no remote configured).`;
  const result = await fn(info.owner, info.repo);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Detect the repository/branch and report working-tree status (staged/unstaged/untracked files) for a local git repo. Read-only.',
  category: 'github',
  parameters: { repo_path: REPO_PATH_PARAM },
  execute: async (params) => {
    const repoPath = params.repo_path as string;
    const repo = await detectRepository(repoPath);
    if (!repo.isRepo) return `${repoPath} is not a git repository.`;
    const branch = await detectBranch(repoPath);
    const status = await getStatus(repoPath);
    return [
      `Repository: ${repo.owner && repo.repo ? `${repo.owner}/${repo.repo}` : (repo.remoteUrl ?? '(no remote)')}`,
      `Current branch: ${branch.current ?? '(detached)'}`,
      `Local branches: ${branch.branches.join(', ') || '(none)'}`,
      '',
      'Status:',
      status.output || '(clean working tree)',
    ].join('\n');
  },
};

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: 'Show the diff for a local git repo (working tree by default, or staged changes). Read-only.',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    staged: { type: 'boolean', description: 'Show staged (index) diff instead of working-tree diff.', required: false },
    path: { type: 'string', description: 'Limit the diff to a single file or directory.', required: false },
  },
  execute: async (params) => {
    const result = await getDiff(params.repo_path as string, {
      staged: params.staged as boolean | undefined,
      path: params.path as string | undefined,
    });
    return result.output || '(no changes)';
  },
};

export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: 'Stage all changes and create a git commit. AUTO by default (configurable to require approval - spec section 29).',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    message: { type: 'string', description: 'Commit message.', required: true },
  },
  execute: async (params) => {
    const result = await commit(params.repo_path as string, params.message as string);
    return result.ok ? `Committed: ${result.output || params.message}` : `Commit failed: ${result.error}`;
  },
};

export const gitPushTool: ToolDefinition = {
  name: 'git_push',
  description: 'Push the current branch to its remote. Requires user approval by default (spec section 29) - do not expect this to execute silently.',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    remote: { type: 'string', description: 'Remote name (defaults to origin).', required: false },
    branch: { type: 'string', description: 'Branch to push (defaults to the current branch).', required: false },
    set_upstream: { type: 'boolean', description: 'Set the upstream tracking branch (-u).', required: false },
  },
  execute: async (params) => {
    const result = await push(params.repo_path as string, {
      remote: params.remote as string | undefined,
      branch: params.branch as string | undefined,
      setUpstream: params.set_upstream as boolean | undefined,
    });
    return result.ok ? `Pushed: ${result.output || 'ok'}` : `Push failed: ${result.error}`;
  },
};

export const gitForcePushTool: ToolDefinition = {
  name: 'git_force_push',
  description: 'Force-push the current branch, overwriting remote history. BLOCKED by default (spec section 29) - this is a destructive, hard-to-reverse operation.',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    remote: { type: 'string', description: 'Remote name (defaults to origin).', required: false },
    branch: { type: 'string', description: 'Branch to force-push (defaults to the current branch).', required: false },
  },
  execute: async (params) => {
    const result = await forcePush(params.repo_path as string, {
      remote: params.remote as string | undefined,
      branch: params.branch as string | undefined,
    });
    return result.ok ? `Force-pushed: ${result.output || 'ok'}` : `Force push failed: ${result.error}`;
  },
};

export const gitPullTool: ToolDefinition = {
  name: 'git_pull',
  description: 'Pull the latest changes from the remote for the current branch.',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    remote: { type: 'string', description: 'Remote name (defaults to origin).', required: false },
    branch: { type: 'string', description: 'Branch to pull (defaults to the current branch).', required: false },
    rebase: { type: 'boolean', description: 'Rebase instead of merge.', required: false },
  },
  execute: async (params) => {
    const result = await pull(params.repo_path as string, {
      remote: params.remote as string | undefined,
      branch: params.branch as string | undefined,
      rebase: params.rebase as boolean | undefined,
    });
    return result.ok ? `Pulled: ${result.output || 'up to date'}` : `Pull failed: ${result.error}`;
  },
};

export const gitBranchCreateTool: ToolDefinition = {
  name: 'git_branch_create',
  description: 'Create a new branch (and check it out by default).',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    branch_name: { type: 'string', description: 'Name of the new branch.', required: true },
    from: { type: 'string', description: 'Base ref to branch from (defaults to current HEAD).', required: false },
    checkout: { type: 'boolean', description: 'Check out the new branch immediately (default true).', required: false },
  },
  execute: async (params) => {
    const result = await createBranch(params.repo_path as string, params.branch_name as string, {
      from: params.from as string | undefined,
      checkout: params.checkout as boolean | undefined,
    });
    return result.ok ? `Branch created: ${params.branch_name}` : `Branch creation failed: ${result.error}`;
  },
};

export const githubCreateIssueTool: ToolDefinition = {
  name: 'github_create_issue',
  description: "Create a GitHub issue on the repo's remote. Requires a GitHub token to be configured.",
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    title: { type: 'string', description: 'Issue title.', required: true },
    body: { type: 'string', description: 'Issue body (markdown).', required: false },
  },
  execute: async (params) =>
    withRepo(params.repo_path as string, async (owner, repo) => {
      const result = await createIssue(owner, repo, params.title as string, params.body as string | undefined);
      return result.ok ? `Issue created: ${result.data.html_url}` : `Issue creation failed: ${result.error}`;
    }),
};

export const githubCreatePrTool: ToolDefinition = {
  name: 'github_create_pr',
  description: "Create a GitHub pull request on the repo's remote. Requires a GitHub token to be configured.",
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    title: { type: 'string', description: 'PR title.', required: true },
    head: { type: 'string', description: 'Head branch (the branch with your changes).', required: true },
    base: { type: 'string', description: 'Base branch to merge into.', required: true },
    body: { type: 'string', description: 'PR description (markdown).', required: false },
  },
  execute: async (params) =>
    withRepo(params.repo_path as string, async (owner, repo) => {
      const result = await createPullRequest(owner, repo, {
        title: params.title as string,
        head: params.head as string,
        base: params.base as string,
        body: params.body as string | undefined,
      });
      return result.ok ? `PR created: ${result.data.html_url}` : `PR creation failed: ${result.error}`;
    }),
};

export const githubPrStatusTool: ToolDefinition = {
  name: 'github_pr_status',
  description: 'Get PR status (state, mergeable, merged) and its reviews. Read-only.',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    number: { type: 'number', description: 'Pull request number.', required: true },
  },
  execute: async (params) =>
    withRepo(params.repo_path as string, async (owner, repo) => {
      const number = params.number as number;
      const status = await getPullRequestStatus(owner, repo, number);
      if (!status.ok) return `Failed to fetch PR status: ${status.error}`;
      const reviews = await listReviews(owner, repo, number);
      const reviewSummary = reviews.ok
        ? reviews.data.map((r) => `${r.user.login}: ${r.state}`).join(', ') || '(no reviews yet)'
        : `(could not fetch reviews: ${reviews.error})`;
      return [
        `PR #${status.data.number}: ${status.data.state}${status.data.merged ? ' (merged)' : ''}`,
        `Mergeable: ${status.data.mergeable ?? 'unknown'} (${status.data.mergeable_state})`,
        `Reviews: ${reviewSummary}`,
      ].join('\n');
    }),
};

export const githubReviewTool: ToolDefinition = {
  name: 'github_pr_review',
  description: 'Submit a review on a GitHub PR (approve, request changes, or comment).',
  category: 'github',
  parameters: {
    repo_path: REPO_PATH_PARAM,
    number: { type: 'number', description: 'Pull request number.', required: true },
    event: { type: 'string', description: 'One of APPROVE, REQUEST_CHANGES, COMMENT.', required: true },
    body: { type: 'string', description: 'Review comment body.', required: false },
  },
  execute: async (params) =>
    withRepo(params.repo_path as string, async (owner, repo) => {
      const event = params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      const result = await createReview(owner, repo, params.number as number, { event, body: params.body as string | undefined });
      return result.ok ? `Review submitted (${event}).` : `Review submission failed: ${result.error}`;
    }),
};

export const GITHUB_TOOLS: ToolDefinition[] = [
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitPushTool,
  gitForcePushTool,
  gitPullTool,
  gitBranchCreateTool,
  githubCreateIssueTool,
  githubCreatePrTool,
  githubPrStatusTool,
  githubReviewTool,
];
