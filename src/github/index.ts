// GitHub integration (Phase 7): git CLI wrapper + GitHub REST API client.
// Safety gating lives at the tool-call layer (src/actions/tools/github.ts),
// not in these modules - see git.ts's header comment for why.

export {
  detectRepository, detectBranch, getStatus, getDiff, commit, push, forcePush, pull, createBranch,
  parseGitHubRemote,
} from './git.ts';
export type { GitResult, RepositoryInfo, BranchInfo, PushOptions, PullOptions } from './git.ts';

export {
  getGitHubToken, setGitHubToken,
  createIssue, createPullRequest, getPullRequestStatus, listReviews, createReview,
} from './api.ts';
export type { GitHubResult, GitHubIssue, GitHubPullRequest, GitHubPullRequestStatus, GitHubReview } from './api.ts';
