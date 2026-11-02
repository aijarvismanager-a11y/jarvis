import { spawnRunner, type CommandRunner } from "./commandRunner.ts";

// Is the one thing this app cannot work without (the Claude Code command) installed and signed in?
// Asked on the first screen so a new user is told what to do instead of meeting a cryptic error later.

export type ClaudeCheck =
  | { state: "ready"; version: string }
  | { state: "not_installed"; message: string }
  | { state: "not_logged_in"; version: string; message: string }
  | { state: "unknown"; message: string };

const CACHE_MS = 15_000;

export class SystemCheck {
  private cache: { at: number; value: ClaudeCheck } | null = null;

  constructor(
    private readonly run: CommandRunner = spawnRunner,
    private readonly command = "claude",
  ) {}

  async claude(force = false): Promise<ClaudeCheck> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const value = await this.check();
    // a "ready" answer may be reused for a while; a problem is re-asked every time (the user is probably fixing it right now)
    this.cache = value.state === "ready" ? { at: Date.now(), value } : null;
    return value;
  }

  private async check(): Promise<ClaudeCheck> {
    let version = "";
    try {
      const v = await this.run(this.command, ["--version"], { timeoutMs: 20_000 });
      if (v.code !== 0) throw new Error(v.stderr || "exit " + v.code);
      version = v.stdout.trim().split(/\s+/)[0] ?? "";
    } catch {
      return { state: "not_installed", message: "Claude Code が見つかりません。インストールしてから、このページを再読み込みしてください(https://claude.com/claude-code)。" };
    }
    try {
      const a = await this.run(this.command, ["auth", "status"], { timeoutMs: 20_000 });
      const json = JSON.parse(a.stdout) as { loggedIn?: boolean };
      if (json.loggedIn === true) return { state: "ready", version };
      return { state: "not_logged_in", version, message: "Claude Code にログインしていません。ターミナル(PowerShell など)で claude と入力して、表示に従ってログインしてください。" };
    } catch {
      // an older Claude Code without `auth status`: it is installed, which is all that can be said
      return { state: "unknown", message: "Claude Code は入っていますが、ログイン状態を確認できませんでした。作業が始まらない場合は、ターミナルで claude と入力してログインしてください。" };
    }
  }
}

export const CLAUDE_LIMIT_TEXT = /rate limit|usage limit|limit reached|quota|429|overloaded/;

/** Turns what the Claude Code command printed into a sentence that says what to do (null = nothing recognised). */
export function explainClaudeFailure(text: string): string | null {
  const t = text.toLowerCase();
  if (/not logged in|please run \/login|invalid api key|authenticat|oauth|session expired|unauthorized|401/.test(t)) return "Claude Code のログインが切れています。ターミナル(PowerShell など)で claude auth login と入力し、ブラウザの表示に従ってログインし直してください。終わったら、もう一度やり直せます。";
  if (CLAUDE_LIMIT_TEXT.test(t)) return "Claude Code の利用上限に達したようです。しばらく待ってからやり直してください。";
  if (/enoent|not recognized|command not found/.test(t)) return "Claude Code が見つかりません。インストールされているか確認してください。";
  return null;
}
