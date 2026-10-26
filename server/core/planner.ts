import { needsShell, spawnRunner, type CommandRunner } from "./commandRunner.ts";
import { explainClaudeFailure } from "./systemCheck.ts";
import { planDraftSchema, validatePlan, type PlanDraft } from "./taskGraph.ts";

// Planner (spec §3: Claude Code is Lead Developer and plans too). The engine
// only depends on the Planner interface, so the implementation can be swapped
// (a scripted planner in tests, another AI later).

export type PlanRequest = {
  goal: string;
  constraints: string[];
  technologyPreferences: string[];
  /** Present on a replan: what is already done / what went wrong / user feedback. */
  completed?: { role: string; objective: string }[];
  failed?: { role: string; objective: string; reason?: string }[];
  feedback?: string;
  /** The project folder: the plan is made from there, so an existing project is read, not the orchestrator itself. */
  cwd?: string;
  /** The project already has files (an import, or earlier missions): look at them before planning. */
  existingProject?: boolean;
};

export interface Planner {
  readonly name: string;
  plan(request: PlanRequest, signal?: AbortSignal): Promise<PlanDraft>;
}

export { needsShell, spawnRunner, type CommandResult, type CommandRunner } from "./commandRunner.ts";

// ---- Claude Code CLI planner ---------------------------------------------

export type CliCapabilities = {
  print: boolean;
  outputFormatJson: boolean;
  jsonSchema: boolean;
  permissionModePlan: boolean;
  noSessionPersistence: boolean;
};

/** Derives which flags exist from `claude --help` text; nothing is assumed. */
export function parseCliCapabilities(helpText: string): CliCapabilities {
  const has = (flag: string) => new RegExp(`(^|[\\s,])${flag.replace(/[-]/g, "\\-")}(\\s|,|$|=)`, "m").test(helpText);
  const permission = /--permission-mode[\s\S]{0,400}?\(choices:[^)]*\)/.exec(helpText)?.[0] ?? "";
  return {
    print: has("--print") || has("-p"),
    outputFormatJson: has("--output-format") && /"json"/.test(helpText),
    jsonSchema: has("--json-schema"),
    permissionModePlan: has("--permission-mode") && /"plan"/.test(permission),
    noSessionPersistence: has("--no-session-persistence"),
  };
}

const PLAN_JSON_SCHEMA = {
  type: "object",
  required: ["tasks"],
  properties: {
    summary: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "role", "objective"],
        properties: {
          key: { type: "string" },
          role: { type: "string" },
          objective: { type: "string" },
          inputs: { type: "array", items: { type: "string" } },
          expectedOutputs: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          dependsOn: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function buildPlannerPrompt(req: PlanRequest): string {
  const lines = [
    "あなたは開発依頼のLead Developerです。次のゴールを達成するためのTask Graph(依存関係つきDAG)をJSONだけで出力してください。",
    "出力形式: {\"summary\": string, \"tasks\": [{\"key\", \"role\", \"objective\", \"inputs\", \"expectedOutputs\", \"constraints\", \"dependsOn\": [key]}]}",
    "role は research / design / coding / review / test / document など。コードを書く作業の role は coding にする。アイデア出し・名前案・文面の案を出す作業の role は ideation にする。作業は最大50件、循環依存は禁止。",
    "各 task の expectedOutputs には、成果物の「ファイルパスだけ」を書く(例: design/auth.md、research/tools.md、review/ui.md、src/app.js)。説明文・括弧書き・「〜を含む」のような補足は書かない。文章や調査結果を残す作業にもパスを付け、ファイルを残さない作業だけ空の配列にする。",
    "有料APIは使わない。ファイルを実際に変更したり、コマンドを実行したりせず、計画だけを返すこと。",
    "質問や確認はせず、足りない情報は妥当な仮定を置いて計画に含めること。説明文や前置きは付けず、JSONだけを出力すること。",
    `ゴール: ${req.goal}`,
  ];
  if (req.existingProject) lines.push("このフォルダは既存のプロジェクトです。docs/status-report.md があれば先に読み、既存のコードを調べたうえで、既存の構成・見た目・書き方を尊重した計画にすること。作り直しは避ける。docs/previous-conversation.md があれば、前の Claude Code での作業の経緯(決定事項・未完了のこと)の要約なので、これも先に読んで踏まえること。");
  if (req.constraints.length) lines.push(`制約: ${req.constraints.join(" / ")}`);
  if (req.technologyPreferences.length) lines.push(`技術の希望: ${req.technologyPreferences.join(", ")}`);
  if (req.completed?.length) lines.push(`完了済み(再計画。重複させない): ${req.completed.map((t) => `[${t.role}] ${t.objective}`).join(" ; ")}`);
  if (req.failed?.length) lines.push(`失敗: ${req.failed.map((t) => `[${t.role}] ${t.objective}${t.reason ? ` (${t.reason})` : ""}`).join(" ; ")}`);
  if (req.feedback) lines.push(`ユーザーからの指摘: ${req.feedback}`);
  return lines.join("\n");
}

/** Pulls the plan JSON out of `--output-format json` output or free text. */
export function extractPlanJson(stdout: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const outer = tryParse(stdout.trim());
  let candidate: unknown = outer;
  if (outer && typeof outer === "object") {
    const o = outer as Record<string, unknown>;
    if (o.structured_output && typeof o.structured_output === "object") return o.structured_output;
    if (typeof o.result === "string") candidate = o.result;
  }
  if (typeof candidate === "string") {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(candidate);
    const body = fenced ? fenced[1] : candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1);
    return tryParse(body.trim());
  }
  return candidate;
}

export class ClaudeCodePlanner implements Planner {
  readonly name = "claude-code";
  private caps: CliCapabilities | null = null;

  constructor(
    private readonly opts: { command?: string; cwd?: string; runner?: CommandRunner; timeoutMs?: number } = {},
  ) {}

  private get command() {
    return this.opts.command ?? "claude";
  }
  private get runner() {
    return this.opts.runner ?? spawnRunner;
  }

  /** Reads `claude --help` once and caches which flags this install supports. */
  async capabilities(): Promise<CliCapabilities> {
    if (this.caps) return this.caps;
    const res = await this.runner(this.command, ["--help"], { cwd: this.opts.cwd, timeoutMs: 30_000 });
    this.caps = parseCliCapabilities(`${res.stdout}\n${res.stderr}`);
    return this.caps;
  }

  buildArgs(caps: CliCapabilities, shell: boolean = needsShell(this.command)): string[] {
    if (!caps.print) throw new Error("このClaude Codeは非対話実行(--print)に対応していないためPlannerとして使えません");
    const args = ["--print"];
    if (caps.outputFormatJson) args.push("--output-format", "json");
    // A JSON argument cannot be quoted safely through cmd.exe; the prompt already demands JSON-only output.
    if (caps.jsonSchema && !shell) args.push("--json-schema", JSON.stringify(PLAN_JSON_SCHEMA));
    if (caps.permissionModePlan) args.push("--permission-mode", "plan"); // planning must not edit files
    if (caps.noSessionPersistence) args.push("--no-session-persistence");
    return args;
  }

  async plan(request: PlanRequest, signal?: AbortSignal): Promise<PlanDraft> {
    const caps = await this.capabilities();
    if (!caps.permissionModePlan) throw new Error("読み取り専用モード(--permission-mode plan)が使えないため、安全にPlannerを実行できません");
    const args = this.buildArgs(caps);
    const cwd = request.cwd ?? this.opts.cwd;
    const ask = async (prompt: string) => {
      const res = await this.runner(this.command, args, { input: prompt, cwd, signal, timeoutMs: this.opts.timeoutMs ?? 5 * 60_000 });
      if (res.code !== 0) throw new Error(explainClaudeFailure(`${res.stdout}
${res.stderr}`) ?? `Claude Codeが異常終了しました(code=${res.code}): ${res.stderr.slice(0, 500)}`);
      return res.stdout;
    };
    const prompt = buildPlannerPrompt(request);
    let stdout = await ask(prompt);
    let parsed = planDraftSchema.safeParse(extractPlanJson(stdout));
    if (!parsed.success) {
      // The model sometimes answers in prose (a question, or a plan in words). Ask once more, for JSON only.
      stdout = await ask(`${prompt}

前回の出力は計画のJSONとして解釈できませんでした。質問や説明は不要です。指定した形式のJSONだけを出力してください。`);
      parsed = planDraftSchema.safeParse(extractPlanJson(stdout));
    }
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `「${issue.path.join(".")}」` : "";
      throw new Error(`Plannerの出力を計画として解釈できません: ${where}${issue?.message ?? "invalid"}(出力の冒頭: ${stdout.replace(/\s+/g, " ").slice(0, 160)})`);
    }
    const problems = validatePlan(parsed.data);
    if (problems.length) throw new Error(`Plannerの計画が不正です: ${problems.join(" / ")}`);
    return parsed.data;
  }
}
