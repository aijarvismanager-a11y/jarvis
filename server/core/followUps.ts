import { spawnRunner, type CommandRunner } from "./commandRunner.ts";
import { extractPlanJson, parseCliCapabilities, type CliCapabilities } from "./planner.ts";
import { saverArgs } from "./tokenSaver.ts";
import { explainClaudeFailure } from "./systemCheck.ts";

// After an AI has answered (a comparison table, a proposal), the person is asked what only they can decide.
// One short, light-model Claude Code run reads the answer and returns a few questions; it never touches files.

export function buildFollowUpPrompt(answer: string): string {
  return [
    "次は、AIがある依頼に対して出した回答です。この回答を読んで、依頼した人に「確認しておくとよいこと」を3〜5個、日本語の短い質問にしてください。",
    "質問は、その人だけが決められること(好み・優先順位・予算・対象の範囲・足りない観点・回答の中で仮定を置いた点)に限る。回答を読めば分かることは聞かない。",
    "1つの質問は1文、専門用語は避け、「はい/いいえ」か一言で答えられる形にする。",
    'JSONだけを出力する: {"questions": ["質問1", "質問2", ...]}。説明や前置きは付けない。ファイルは変更しない。',
    "",
    "【回答】",
    answer.slice(0, 12000),
  ].join("\n");
}

export function parseFollowUps(stdout: string): string[] {
  const data = extractPlanJson(stdout) as { questions?: unknown } | undefined;
  const list = Array.isArray(data?.questions) ? data.questions : [];
  return list.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean).slice(0, 6);
}

export class FollowUpAsker {
  private caps: CliCapabilities | null = null;
  constructor(private readonly opts: { command?: string; cwd?: string; runner?: CommandRunner; timeoutMs?: number } = {}) {}

  private get command() { return this.opts.command ?? "claude"; }
  private get runner() { return this.opts.runner ?? spawnRunner; }

  async ask(answer: string): Promise<string[]> {
    if (!this.caps) {
      const help = await this.runner(this.command, ["--help"], { cwd: this.opts.cwd, timeoutMs: 30_000 });
      this.caps = parseCliCapabilities(`${help.stdout}\n${help.stderr}`);
    }
    const caps = this.caps;
    if (!caps.print) throw new Error("このClaude Codeは非対話実行(--print)に対応していません");
    const args = ["--print"];
    if (caps.outputFormatJson) args.push("--output-format", "json");
    if (caps.permissionModePlan) args.push("--permission-mode", "plan");
    if (caps.noSessionPersistence) args.push("--no-session-persistence");
    args.push(...saverArgs(caps.saver, { model: "haiku", effort: "low" }));
    const res = await this.runner(this.command, args, { input: buildFollowUpPrompt(answer), cwd: this.opts.cwd, timeoutMs: this.opts.timeoutMs ?? 3 * 60_000 });
    if (res.timedOut) throw new Error("質問づくりが3分以内に終わりませんでした。もう一度試してください");
    if (res.code !== 0) throw new Error(explainClaudeFailure(`${res.stdout}\n${res.stderr}`) ?? `Claude Codeが異常終了しました(code=${res.code})`);
    const questions = parseFollowUps(res.stdout);
    if (questions.length === 0) throw new Error("確認の質問を作れませんでした。もう一度試してください");
    return questions;
  }
}
