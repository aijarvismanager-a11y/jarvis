/**
 * Git CLI wrapper (spec section 28, "GitHub連携" minimum feature set):
 * repository detection, branch detection, status, diff, commit, push, pull,
 * branch creation. Deliberately a thin wrapper around the `git` binary via
 * `Bun.spawn` rather than a git-in-JS library - this repo has no such
 * dependency yet and every operation here is a well-known, low-risk `git`
 * subcommand.
 *
 * This module is pure mechanism - it does not know about approvals or
 * authority levels. Safety gating (spec section 29: push=APPROVAL,
 * force-push=BLOCK) happens one layer up, at the tool-call authority gate
 * (see src/actions/tools/github.ts + src/authority/tool-action-map.ts),
 * exactly like every other tool in this codebase - see
 * docs/AI_MANAGER_ARCHITECTURE_AUDIT.md's Technical Risks section on why a
 * bespoke check here instead would create a second source of truth.
 */

export type GitResult = {
  ok: boolean;
  output: string;
  error?: string;
};

async function runGit(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitResult> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      // Without this, a push/pull against a remote with no cached
      // credentials blocks waiting for an interactive prompt on a TTY that
      // doesn't exist here, only failing once `timeoutMs` kills it. Fail
      // fast with a clean auth error instead (matches GitManager.run in
      // src/sites/git-manager.ts).
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const output = (stdout + stderr).trim();
      return exitCode === 0 ? { ok: true, output } : { ok: false, output, error: output || `git ${args[0]} exited ${exitCode}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export type RepositoryInfo = {
  isRepo: boolean;
  root?: string;
  remoteUrl?: string;
  owner?: string;
  repo?: string;
};

/** Parse an owner/repo pair out of a GitHub remote URL (SSH or HTTPS form). */
export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  return null;
}

/** Repository detection - is `cwd` inside a git repo, and what's its GitHub remote? */
export async function detectRepository(cwd: string): Promise<RepositoryInfo> {
  const root = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!root.ok) return { isRepo: false };

  const remote = await runGit(cwd, ['remote', 'get-url', 'origin']);
  const info: RepositoryInfo = { isRepo: true, root: root.output };
  if (remote.ok) {
    info.remoteUrl = remote.output;
    const parsed = parseGitHubRemote(remote.output);
    if (parsed) {
      info.owner = parsed.owner;
      info.repo = parsed.repo;
    }
  }
  return info;
}

export type BranchInfo = {
  current: string | null;
  branches: string[];
};

/** Branch detection - current branch plus the full local branch list. */
export async function detectBranch(cwd: string): Promise<BranchInfo> {
  const current = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const list = await runGit(cwd, ['branch', '--format=%(refname:short)']);
  return {
    current: current.ok ? current.output : null,
    branches: list.ok ? list.output.split('\n').filter(Boolean) : [],
  };
}

/** `git status --porcelain=v1 -b` - machine-readable status including the branch/upstream line. */
export async function getStatus(cwd: string): Promise<GitResult> {
  return runGit(cwd, ['status', '--porcelain=v1', '-b']);
}

/** `git diff` (working tree) or `git diff --staged`, optionally scoped to one path. */
export async function getDiff(cwd: string, opts?: { staged?: boolean; path?: string }): Promise<GitResult> {
  const args = ['diff'];
  if (opts?.staged) args.push('--staged');
  if (opts?.path) args.push('--', opts.path);
  return runGit(cwd, args);
}

/** Stage (optionally all changes) and commit. AUTO by default per spec section 29, configurable at the tool-call authority layer. */
export async function commit(cwd: string, message: string, opts?: { all?: boolean }): Promise<GitResult> {
  if (opts?.all ?? true) {
    const add = await runGit(cwd, ['add', '-A']);
    if (!add.ok) return add;
  }
  return runGit(cwd, ['commit', '-m', message]);
}

export type PushOptions = { remote?: string; branch?: string; setUpstream?: boolean };

/** Plain push - always APPROVAL-gated by default (spec section 29) at the tool-call layer, never here. */
export async function push(cwd: string, opts?: PushOptions): Promise<GitResult> {
  const args = ['push'];
  if (opts?.setUpstream) args.push('-u');
  args.push(opts?.remote ?? 'origin');
  if (opts?.branch) args.push(opts.branch);
  return runGit(cwd, args);
}

/**
 * Force push - kept as its own function (and its own tool name one layer up)
 * so the safety gate can single it out and BLOCK it by default (spec section
 * 29) without also blocking plain push.
 */
export async function forcePush(cwd: string, opts?: PushOptions): Promise<GitResult> {
  const args = ['push', '--force'];
  if (opts?.setUpstream) args.push('-u');
  args.push(opts?.remote ?? 'origin');
  if (opts?.branch) args.push(opts.branch);
  return runGit(cwd, args);
}

export type PullOptions = { remote?: string; branch?: string; rebase?: boolean };

export async function pull(cwd: string, opts?: PullOptions): Promise<GitResult> {
  const args = ['pull'];
  if (opts?.rebase) args.push('--rebase');
  args.push(opts?.remote ?? 'origin');
  if (opts?.branch) args.push(opts.branch);
  return runGit(cwd, args);
}

export async function createBranch(cwd: string, branchName: string, opts?: { from?: string; checkout?: boolean }): Promise<GitResult> {
  const args = opts?.checkout === false ? ['branch', branchName] : ['checkout', '-b', branchName];
  if (opts?.from) args.push(opts.from);
  return runGit(cwd, args);
}
