/**
 * GitHub REST API client (spec section 28's "可能なら" extension: Issue, PR,
 * PR status, Review). Thin fetch wrapper - no octokit dependency, since this
 * repo only needs a handful of endpoints. Auth token lives in the existing
 * encrypted keychain (src/vault/keychain.ts), under the name `github_token`,
 * same convention as every other provider credential in this codebase.
 */

import { getSecret, setSecret } from '../vault/keychain.ts';

const GITHUB_TOKEN_KEY = 'github_token';
const API_BASE = 'https://api.github.com';

export type GitHubResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function getGitHubToken(): string | null {
  return getSecret(GITHUB_TOKEN_KEY);
}

export function setGitHubToken(token: string): void {
  setSecret(GITHUB_TOKEN_KEY, token);
}

async function githubFetch<T>(path: string, init?: RequestInit): Promise<GitHubResult<T>> {
  const token = getGitHubToken();
  if (!token) {
    return { ok: false, error: 'No GitHub token configured. Set one via the credentials UI before using GitHub API features.' };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.text();
    const data = body ? JSON.parse(body) : null;
    if (!res.ok) {
      const message = (data && typeof data === 'object' && 'message' in data) ? String((data as { message: unknown }).message) : `HTTP ${res.status}`;
      return { ok: false, error: message };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type GitHubIssue = { number: number; html_url: string; title: string; state: string };

export async function createIssue(owner: string, repo: string, title: string, body?: string): Promise<GitHubResult<GitHubIssue>> {
  return githubFetch<GitHubIssue>(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

export type GitHubPullRequest = { number: number; html_url: string; title: string; state: string; mergeable: boolean | null };

export async function createPullRequest(
  owner: string,
  repo: string,
  opts: { title: string; head: string; base: string; body?: string },
): Promise<GitHubResult<GitHubPullRequest>> {
  return githubFetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export type GitHubPullRequestStatus = {
  number: number;
  state: string;
  mergeable: boolean | null;
  mergeable_state: string;
  merged: boolean;
};

export async function getPullRequestStatus(owner: string, repo: string, number: number): Promise<GitHubResult<GitHubPullRequestStatus>> {
  return githubFetch<GitHubPullRequestStatus>(`/repos/${owner}/${repo}/pulls/${number}`);
}

export type GitHubReview = { id: number; state: string; body: string; user: { login: string } };

export async function listReviews(owner: string, repo: string, number: number): Promise<GitHubResult<GitHubReview[]>> {
  return githubFetch<GitHubReview[]>(`/repos/${owner}/${repo}/pulls/${number}/reviews`);
}

export async function createReview(
  owner: string,
  repo: string,
  number: number,
  opts: { event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body?: string },
): Promise<GitHubResult<GitHubReview>> {
  return githubFetch<GitHubReview>(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}
