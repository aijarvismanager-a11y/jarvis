// The user's own instruction files (~/.claude/CLAUDE.md and ~/.claude/rules) are written for their own sessions. In the runs
// this app starts they mixed into the reports, so they are left out by name. The project's own CLAUDE.md is still read, and the
// user's settings (permission rules included) stay in force. Checked with Claude Code 2.1.316: `--setting-sources project,local`
// does not do this, because a project under the home folder picks the same file up again as a parent folder's instructions.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SaverCapabilities } from "./tokenSaver.ts";

export function isolationSettings(configDir: string): { claudeMdExcludes: string[] } {
  const dir = configDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return { claudeMdExcludes: [`${dir}/CLAUDE.md`, `${dir}/rules/**`] };
}

/** A file, not inline JSON: JSON cannot be quoted safely through cmd.exe. Rewritten each time, so a cleaned temp folder does no harm. */
function settingsFile(): string {
  const dir = path.join(os.tmpdir(), "ai-orchestrator");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "claude-run-settings.json");
  writeFileSync(file, JSON.stringify(isolationSettings(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"))));
  return file;
}

export function isolationArgs(caps: SaverCapabilities | undefined, shell: boolean): string[] {
  if (!caps?.settings) return [];
  const file = settingsFile();
  return ["--settings", shell ? `"${file.replace(/"/g, "")}"` : file];
}
