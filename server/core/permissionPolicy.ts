import { isWriteTask } from "./scheduler.ts";
import type { Task } from "./store.ts";

// Permission Policy (spec §24, §25). Five levels; ordinary development gets
// READ + WORKSPACE_WRITE, plus package-manager network access for code tasks.
// Anything above that needs an explicit approval from the ApprovalGate, and
// the Claude Code CLI is always started with the matching deny list so a
// denied level cannot be reached by the model on its own.

export const PERMISSION_LEVELS = ["READ", "WORKSPACE_WRITE", "NETWORK", "DEPLOY", "DESTRUCTIVE"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export type ApprovalRequest = { projectId: string; taskId: string; level: PermissionLevel; reason: string };
/** Asks the user. The default gate denies; the UI (Phase 7) supplies a real one. */
export type ApprovalGate = (req: ApprovalRequest) => Promise<boolean>;
export const denyAll: ApprovalGate = async () => false;

// Tool patterns use the `prefix:*` form, which has no spaces and so survives cmd.exe argument joining.
const PACKAGE_MANAGER_TOOLS = ["Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)"];
const NETWORK_DENY = ["WebFetch", "WebSearch", "Bash(curl:*)", "Bash(wget:*)", "Bash(Invoke-WebRequest:*)", "Bash(iwr:*)"];
const DEPLOY_DENY = ["Bash(git push:*)", "Bash(npm publish:*)", "Bash(npx vercel:*)", "Bash(npx netlify:*)", "Bash(docker push:*)", "Bash(gh release:*)"];
const DESTRUCTIVE_DENY = ["Bash(rm:*)", "Bash(del:*)", "Bash(rmdir:*)", "Bash(rd:*)", "Bash(Remove-Item:*)", "Bash(git reset:*)", "Bash(git clean:*)", "Bash(format:*)"];

export type ToolRestrictions = { allowedTools: string[]; disallowedTools: string[] };

/** The level a shell command line needs. Unknown commands are treated as WORKSPACE_WRITE. */
export function classifyCommand(commandLine: string): PermissionLevel {
  const c = commandLine.trim().toLowerCase();
  if (/^(rm|del|erase|rmdir|rd|remove-item|format)\b/.test(c) || /\bgit\s+(reset|clean)\b/.test(c) || /\bgit\s+push\b.*(--force|-f\b)/.test(c)) return "DESTRUCTIVE";
  if (/\bgit\s+push\b/.test(c) || /\b(npm|pnpm|yarn)\s+publish\b/.test(c) || /\b(vercel|netlify|firebase)\s+deploy\b/.test(c) || /\bdocker\s+push\b/.test(c) || /\bgh\s+release\b/.test(c)) return "DEPLOY";
  if (/^(curl|wget|invoke-webrequest|iwr|invoke-restmethod)\b/.test(c) || /\bgit\s+(clone|fetch|pull)\b/.test(c)) return "NETWORK";
  if (/\b(npm|pnpm|yarn)\s+(install|i|add|ci)\b/.test(c) || /\bpip3?\s+install\b/.test(c)) return "NETWORK";
  if (/^(ls|dir|cat|type|echo|pwd|cd|git\s+(status|diff|log|show))\b/.test(c)) return "READ";
  return "WORKSPACE_WRITE";
}

/** Levels above the default that the task's own wording asks for (deploy / delete). */
export function requestedElevatedLevels(task: Pick<Task, "objective" | "constraints">): PermissionLevel[] {
  const text = `${task.objective} ${task.constraints.join(" ")}`.toLowerCase();
  const levels: PermissionLevel[] = [];
  if (/デプロイ|公開する|本番|\bdeploy\b|\bpublish\b|\brelease\b/.test(text)) levels.push("DEPLOY");
  if (/削除|消去|全消し|\bdelete\b|\bremove all\b|\bwipe\b|\bdrop\b/.test(text)) levels.push("DESTRUCTIVE");
  return levels;
}

export class PermissionPolicy {
  private readonly granted: Set<PermissionLevel>;

  constructor(
    granted: PermissionLevel[] = ["READ", "WORKSPACE_WRITE"],
    private readonly gate: ApprovalGate = denyAll,
  ) {
    this.granted = new Set(granted);
    this.granted.add("READ");
  }

  isGranted(level: PermissionLevel): boolean {
    return this.granted.has(level);
  }

  /** Grants the level for the rest of this policy's life if the gate approves. */
  async ensure(req: ApprovalRequest): Promise<boolean> {
    if (this.granted.has(req.level)) return true;
    if (!(await this.gate(req))) return false;
    this.granted.add(req.level);
    return true;
  }

  /** CLI tool allow/deny lists for a task given the currently granted levels. */
  restrictionsFor(task: Pick<Task, "role">): ToolRestrictions {
    const writes = isWriteTask(task);
    const allowedTools = writes && this.granted.has("WORKSPACE_WRITE") ? [...PACKAGE_MANAGER_TOOLS] : [];
    const disallowedTools: string[] = [];
    if (!this.granted.has("NETWORK")) disallowedTools.push(...NETWORK_DENY);
    if (!this.granted.has("DEPLOY")) disallowedTools.push(...DEPLOY_DENY);
    if (!this.granted.has("DESTRUCTIVE")) disallowedTools.push(...DESTRUCTIVE_DENY);
    return { allowedTools, disallowedTools };
  }
}
