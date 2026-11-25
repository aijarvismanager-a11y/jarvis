import { isWriteTask, runsBuildOrTests } from "./scheduler.ts";
import type { Task } from "./store.ts";

// Permission Policy (spec §24, §25). Five levels; ordinary development gets
// READ + WORKSPACE_WRITE, plus package-manager network access for code tasks.
// Anything above that needs an explicit approval from the ApprovalGate, and
// the Claude Code CLI is always started with the matching deny list so a
// denied level cannot be reached by the model on its own.

export const PERMISSION_LEVELS = ["READ", "WORKSPACE_WRITE", "NETWORK", "DEPLOY", "DESTRUCTIVE"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export type ApprovalRequest = { projectId: string; taskId: string; level: PermissionLevel; reason: string; /** set when the approval is for one specific shell command the run was refused */ command?: string; /** aborts the wait when the task is paused/cancelled */ signal?: AbortSignal };
/** Asks the user. The default gate denies; the UI (Phase 7) supplies a real one. */
export type ApprovalGate = (req: ApprovalRequest) => Promise<boolean>;
export const denyAll: ApprovalGate = async () => false;

// Tool patterns use the `prefix:*` form, which has no spaces and so survives cmd.exe argument joining.
// Build and test commands of the common toolchains: without them an AI cannot check its own work in a .NET / Rust / Go / Python project
// (a headless run has nobody to approve a command, so anything not listed is refused). They run the project's own code, like npm test.
const BUILD_TEST_TOOLS = ["Bash(dotnet build:*)", "Bash(dotnet test:*)", "Bash(dotnet restore:*)", "Bash(dotnet sln:*)", "Bash(dotnet --version:*)", "Bash(dotnet --list-sdks:*)", "Bash(cargo build:*)", "Bash(cargo test:*)", "Bash(cargo check:*)", "Bash(go build:*)", "Bash(go test:*)", "Bash(go vet:*)", "Bash(pytest:*)", "Bash(python -m pytest:*)"];
// Read-only helpers the model chains onto a build ("cd x && dotnet build > out.txt; tail out.txt"): a chained command is checked part by part, so one unlisted part refused the whole line.
const SHELL_HELPER_TOOLS = ["Bash(cd:*)", "Bash(echo:*)", "Bash(tail:*)", "Bash(head:*)", "Bash(grep:*)", "Bash(cat:*)", "Bash(ls:*)", "Bash(wc:*)", "Bash(dir:*)", "Bash(type:*)", "Bash(findstr:*)", "Bash(where:*)", "Bash(mkdir:*)"]; // dir/type/findstr/where: the Windows read-only helpers (a screen check asked for "dir /b" three times in one run); mkdir: makes a folder inside the project (the records step asked for "mkdir -p _ai-records/…")
const PACKAGE_MANAGER_TOOLS = ["Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", ...BUILD_TEST_TOOLS, ...SHELL_HELPER_TOOLS, "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)"];
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

// Programs that run arbitrary code: allowing the program name would allow anything, so a refused call of one of these is never offered for approval.
const INTERPRETERS = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe", "cmd", "cmd.exe", "bash", "sh", "zsh", "wsl", "python", "python3", "py", "node", "npx", "eval", "start", "sudo"]);

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function patternBody(pattern: string): string | null {
  const m = /^Bash\((.*):\*\)$/.exec(pattern);
  return m ? m[1] : null;
}

/**
 * The programs in a refused shell line that an approval could allow, with the line part each came from.
 * A program is skipped when it is already allowed, would need a higher level (delete / deploy / network), or can run arbitrary code.
 */
/**
 * Splits a shell line into its commands at && || ; | and line breaks, but NOT inside quotes or a here-document body.
 * (A plain split cut `node -e "a; b"` and `cat > f <<'EOF' … EOF` into code fragments, and each fragment asked for its own approval.)
 */
export function splitShellLine(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  const heredocs: string[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote && !(quote === '"' && line[i - 1] === "\\")) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
      const m = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line.slice(i));
      if (m) { heredocs.push(m[2]!); cur += m[0]; i += m[0].length - 1; continue; }
    }
    if (ch === "\n") {
      if (heredocs.length) {
        // the body runs to a line that is just the delimiter; it belongs to this command
        const delim = heredocs.shift()!;
        const rest = line.slice(i + 1);
        const end = new RegExp(`^[ \\t]*${delim}[ \\t]*(?=\\r?\\n|$)`, "m").exec(rest);
        const stop = end ? i + 1 + end.index + end[0].length : line.length;
        cur += line.slice(i, stop);
        i = stop - 1;
        continue;
      }
      parts.push(cur); cur = "";
      continue;
    }
    if (ch === ";" || (ch === "&" && line[i + 1] === "&") || (ch === "|" && line[i + 1] === "|")) {
      parts.push(cur); cur = "";
      if (ch !== ";") i++;
      continue;
    }
    if (ch === "|") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

export function approvableCommands(commandLine: string, alreadyAllowed: string[]): { pattern: string; part: string }[] {
  const out: { pattern: string; part: string }[] = [];
  for (const raw of splitShellLine(commandLine)) {
    const part = raw.trim();
    if (!part) continue;
    const program = unquote(part.split(/\s+/)[0]);
    if (!program || /[()",`$<>&]/.test(program)) continue;
    // a piece of a shell loop/branch ("for f in a b", "do ...", "done"): it means nothing alone, so it is never approved
    if (/^(for|while|until|if|then|else|elif|fi|do|done|case|esac|select|function|\{|\})$/i.test(program)) continue;
    if (alreadyAllowed.some((p) => { const b = patternBody(p); return b !== null && part.toLowerCase().startsWith(b.toLowerCase()); })) continue;
    const level = classifyCommand(part);
    if (level !== "WORKSPACE_WRITE" && level !== "READ") continue;
    let pattern: string;
    if (INTERPRETERS.has(program.toLowerCase())) {
      // Allowing the program would allow anything it can run, so only this exact line is allowed, and only when it runs a file
      // (no inline code). The person sees the whole line on the approval card.
      if (/\s-(c|command|e|ec|encodedcommand)\b/i.test(part) || /\s\/[ck]\b/i.test(part)) continue;
      if (/[`$<>&]/.test(part)) continue;
      // "powershell ... -File x.ps1 <args>": the person approves running THAT script file, so one approval covers its other arguments too
      // (a screen-check script runs as Start / Shot / Keys / Stop...: one approval per exact line stopped such a task after four rounds).
      const script = /^(\S+(?:\s+-\w+(?:\s+(?!-)[^\s"'`$<>&,()]+)?)*?\s+-File\s+[^\s"'`$<>&,()]+\.ps1)(?:\s|$)/i.exec(part);
      if (script && /^(powershell|powershell\.exe|pwsh|pwsh\.exe)$/i.test(program)) pattern = `Bash(${script[1]}:*)`;
      else if (/[,()"]/.test(part)) continue;
      else pattern = `Bash(${part})`;
    } else {
      pattern = `Bash(${program}:*)`;
    }
    if (!out.some((o) => o.pattern === pattern)) out.push({ pattern, part });
  }
  return out;
}

/** Levels above the default that the task's own wording asks for (deploy / delete). */
export function requestedElevatedLevels(task: Pick<Task, "objective" | "constraints">): PermissionLevel[] {
  // A clause that forbids the action ("既存ファイルの変更・削除・移動は禁止") is the opposite of asking for it.
  const forbids = /禁止|しない|しないで|してはいけ|不可|\bdo not\b|\bdon't\b|\bnever\b|\bmust not\b|\bno\s+(deploy|delet)/;
  const text = [task.objective, ...task.constraints]
    .flatMap((s) => s.split(/[。\n]/))
    .filter((clause) => !forbids.test(clause.toLowerCase()))
    .join(" ")
    .toLowerCase();
  const levels: PermissionLevel[] = [];
  if (/デプロイ|公開する|本番|\bdeploy\b|\bpublish\b|\brelease\b/.test(text)) levels.push("DEPLOY");
  // Only deleting files / repos / databases counts. A bare "削除" is usually the app's own delete
  // feature ("商品一覧・登録・編集・削除"), which must not need an approval.
  if (/(ファイル|フォルダ|ディレクトリ|リポジトリ|データベース|ブランチ)[^。\n]{0,8}(削除|消去)|全消し|\brm\s+-rf?\b|\bdelete\s+(all\s+|the\s+)?(files?|folders?|directories|repos?|repository|database)\b|\bwipe\b|\bdrop\s+(table|database)\b/.test(text)) levels.push("DESTRUCTIVE");
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

  /** Levels approved for one specific task only: an approval never widens what other tasks may do. */
  private readonly taskGrants = new Map<string, Set<PermissionLevel>>();

  isGranted(level: PermissionLevel, taskId?: string): boolean {
    return this.granted.has(level) || (!!taskId && !!this.taskGrants.get(taskId)?.has(level));
  }

  /** Grants the level to this task (and only this task) if the gate approves. */
  async ensure(req: ApprovalRequest): Promise<boolean> {
    if (this.isGranted(req.level, req.taskId)) return true;
    if (!(await this.gate(req))) return false;
    const set = this.taskGrants.get(req.taskId) ?? new Set<PermissionLevel>();
    set.add(req.level);
    this.taskGrants.set(req.taskId, set);
    return true;
  }

  /** Programs the user approved for one specific task (`Bash(prog:*)`): like level grants, they never reach other tasks. */
  private readonly commandGrants = new Map<string, Set<string>>();

  /** Asks the user whether this task may run a command its run was refused. Approving allows `pattern` (a program, or one exact line) for this task only. */
  async ensureCommand(req: ApprovalRequest, pattern: string): Promise<boolean> {
    if (this.commandGrants.get(req.taskId)?.has(pattern)) return true;
    if (!(await this.gate({ ...req, level: "WORKSPACE_WRITE" }))) return false;
    const set = this.commandGrants.get(req.taskId) ?? new Set<string>();
    set.add(pattern);
    this.commandGrants.set(req.taskId, set);
    return true;
  }

  /** CLI tool allow/deny lists for a task given the currently granted levels. */
  restrictionsFor(task: Pick<Task, "role"> & Partial<Pick<Task, "objective">> & { id?: string }): ToolRestrictions {
    const writes = isWriteTask(task);
    const has = (level: PermissionLevel) => this.isGranted(level, task.id);
    const allowedTools = (writes || runsBuildOrTests(task)) && has("WORKSPACE_WRITE") ? [...PACKAGE_MANAGER_TOOLS] : [];
    if (task.id) allowedTools.push(...(this.commandGrants.get(task.id) ?? []));
    const disallowedTools: string[] = [];
    if (!has("NETWORK")) disallowedTools.push(...NETWORK_DENY);
    if (!has("DEPLOY")) disallowedTools.push(...DEPLOY_DENY);
    if (!has("DESTRUCTIVE")) disallowedTools.push(...DESTRUCTIVE_DENY);
    return { allowedTools, disallowedTools };
  }
}
