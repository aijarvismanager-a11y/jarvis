import { needsShell, spawnRunner, type CommandRunner } from "./commandRunner.ts";
import { explainClaudeFailure } from "./systemCheck.ts";
import { MAX_PLAN_TASKS, planDraftSchema, validatePlan, type PlanDraft } from "./taskGraph.ts";

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
    "role は research / design / coding / review / test / document など。コードを書く作業の role は coding にする。アイデア出し・名前案・文面の案を出す作業の role は ideation にする。絵・アイコン・ロゴ・バナーなど画像を作る作業の role は illustration、動画を作る作業は video、音楽・BGMは music、音声・ナレーションは voice にする(画像・動画・音楽・音声を作る作業を design や coding にしない)。サイトや画面の「見た目のデザイン」(配色・レイアウトのモックアップ)を決める作業の role は visual_design にし、expectedOutputs は .svg にして、実装する coding 作業をその作業に依存させる(見た目はデザインが得意なAIがSVGで作り、Claude Codeはそれを見て実装する)。作業は最大50件、循環依存は禁止。",
    "各 task の expectedOutputs には、成果物の「ファイルパスだけ」を書く(例: _ai-records/auth/design.md、src/app.js)。説明文・括弧書き・「〜を含む」のような補足は書かない。文章や調査結果を残す作業にもパスを付け、ファイルを残さない作業だけ空の配列にする。",
    "作業の数や分け方は、ゴールに必要なだけ自由に計画してよい(記録のために作業を減らしたり、まとめたりしない)。ただし、調査・設計・レビュー・メモなど、AIが残す記録の置き場所だけは決まっている: すべて `_ai-records/<依頼を表す短い英数字の名前>/` の下に置き(design/ や research/ や review/ などの新しいフォルダは作らない)、1つの作業につきファイル1つにする。ユーザーが成果物として頼んだ文書とコードは、これまでどおり通常の場所に置く。",
    "記録の書き方: 長い文章にせず、次の見出しだけで短くまとめる — 「結論」「やったこと(変えたファイルとその理由)」「確認できたこと」「確認できていないこと」。入力として読んだ資料の内容を写さない(どのファイルを読んだかだけ書く)。同じ内容の記録が既にあるときは、新しく書き直さず、そのファイルを読んで使う。プロジェクトに既存の更新履歴・不具合メモ・テスト記録・計画書があるときは、新しいメモを作る代わりに、そこへ追記する。",
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

export const HISTORY_TASK_KEY = "update_project_history";
/** Both wordings of the history task begin like this; a stored Task keeps no plan key, so this is how it is recognised later. */
export const HISTORY_OBJECTIVE_LEAD = "この依頼で行った内容(";
/** The history task edits the project's own files: a web chat can only answer in text, so it must run on the code executor. */
export const isHistoryTask = (task: { objective?: string }): boolean => !!task.objective?.startsWith(HISTORY_OBJECTIVE_LEAD);

/**
 * An existing project already keeps its own history (change log, bug notes, test log, plan, architecture). The work used to
 * leave that untouched and pile up new memos beside it. When a plan changes code, the last step brings the project's own
 * records up to date instead - it is part of the plan the person approves, so it can be seen and removed.
 */
export function withHistoryUpdateTask(draft: PlanDraft, existingProject = true): PlanDraft {
  const changesCode = draft.tasks.some((t) => t.role === "coding");
  if (!changesCode || draft.tasks.some((t) => t.key === HISTORY_TASK_KEY) || draft.tasks.length >= MAX_PLAN_TASKS) return draft;
  const objective = existingProject
    ? "この依頼で行った内容(変えたファイルとその理由、確認できたこと、確認できていないこと)を、プロジェクトに既にある更新履歴・不具合(バグ)メモ・テスト記録・計画書・構成書へ反映する。" +
      "まず、プロジェクトのフォルダを調べ、既存の記録ファイルを全部探す(CHANGELOG・更新履歴・HISTORY・TESTLOG・PROGRESS・PLAN・ARCHITECTURE・README・docs/status-report.md、名前に バグ・不具合・bug・issue を含むメモなど)。" +
      "見つかったそれぞれに、書かれている書式をそのまま真似て、追記するか、該当する箇所を更新する(この依頼と関係のないファイルは触らない。書かれている内容を勝手に消さない)。" +
      "この依頼と関係のある記録が1つも見つからないときだけ、_ai-records/<依頼を表す短い英数字の名前>/summary.md を1つ作る。それ以外で、新しいメモのファイルは作らない。" +
      "最後に、更新したファイルの一覧を答えに書く。"
    : "この依頼で行った内容(作ったもの、変えたファイルとその理由、確認できたこと、確認できていないこと、分かっている不具合)を、このプロジェクトの更新履歴として残す。" +
      "プロジェクトの一番上のフォルダに CHANGELOG.md が無ければ新しく作り、あれば先頭(新しい順)に追記する。書き方: 日付、依頼の要約、変更点、確認できたこと、確認できていないこと、既知の不具合(あれば、再現の手順つき)。" +
      "README.md があれば、使い方や構成が変わった部分だけを直す(無ければ、作らなくてよい)。" +
      "それ以外の新しいメモのファイルは作らない。最後に、作った・更新したファイルの一覧を答えに書く。";
  const task = {
    key: HISTORY_TASK_KEY,
    role: "document",
    objective,
    inputs: [] as string[],
    expectedOutputs: [] as string[],
    constraints: ["コードは変更しない(文書だけを変更する)", "確認できていないことは「確認できていない」と書き、確認済みとは書かない", "既存の記録の、依頼と関係のない部分は変えない"],
    dependsOn: draft.tasks.map((t) => t.key),
  };
  return { ...draft, tasks: [...draft.tasks, task] };
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
      // an existing project is read before it is planned: Gage took 11 minutes (measured 2026-10-29), a new idea 1-2
      const limitMs = this.opts.timeoutMs ?? (request.existingProject ? 20 : 5) * 60_000;
      const res = await this.runner(this.command, args, { input: prompt, cwd, signal, timeoutMs: limitMs });
      if (res.timedOut) throw new Error(`タイムアウトしました(計画づくりが${Math.round(limitMs / 60_000)}分以内に終わりませんでした。フォルダが大きいか、依頼が広すぎる可能性があります)`);
      if (res.code !== 0) throw new Error(explainClaudeFailure(`${res.stdout}
${res.stderr}`) ?? `Claude Codeが異常終了しました(code=${res.code}): ${(res.stderr.trim() || res.stdout.trim()).slice(-500)}`);
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
    return withHistoryUpdateTask(parsed.data, !!request.existingProject);
  }
}
