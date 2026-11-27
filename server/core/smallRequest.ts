import { keepsOtherFiles, withoutRecords } from "./fileScope.ts";
import type { PlanDraft } from "./taskGraph.ts";

// A small change to a few named files is done by ONE task, without asking the planner. Measured on benchmark/shop-change: splitting such a
// request into 9-12 tasks gave the same hidden-test result and took 2-3 times as long. The judgement is deliberately narrow: a request
// wrongly left to the planner costs only time, and the person can always ask for the split plan instead.

export const SMALL_GOAL_CHARS = 3500;
export const SMALL_MAX_FILES = 10;

const FILE_NAME = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:mjs|cjs|jsx?|tsx?|py|cs|xaml|go|rs|java|json|html|css|md|txt|ya?ml|toml|ps1|sh)(?![A-Za-z0-9])/g;
/** Work that is better split: other AIs are good at it (pictures, research, ideas), the screen has to be looked at, or it is large or risky. */
const NOT_SMALL = /画像|イラスト|アイコン|ロゴ|バナー|動画|音楽|BGM|音声|ナレーション|デザイン|配色|見た目|画面|ブラウザ|調査|調べ|比較|アイデア|名前の?案|企画|大規模|全体|作り直|作り替|移行|リニューアル|公開|デプロイ|\bdeploy\b/i;

/** The person asked for the work to be split into tasks ("作業は3つに分けて"): that choice is theirs. */
const ASKS_SPLIT = /(?:作業|タスク|工程)[^。\n]{0,40}(?:分け(?!ず|ない)|分割(?!し?ない|せず|不要))|(?:[2-9２-９二三四五六七八九]つ|複数)(?:の(?:作業|タスク|工程))?に(?:分け(?!ず|ない)|分割(?!し?ない|せず))/;

export function isSmallRequest(goal: string, constraints: string[] = []): boolean {
  const text = [goal, ...constraints].join("\n");
  if (text.length > SMALL_GOAL_CHARS || NOT_SMALL.test(text) || ASKS_SPLIT.test(text)) return false;
  const files = new Set(text.match(FILE_NAME) ?? []);
  return files.size >= 1 && files.size <= SMALL_MAX_FILES;
}

export function singleTaskDraft(goal: string, constraints: string[] = []): PlanDraft {
  const only = keepsOtherFiles([goal, ...constraints]);
  const history = only ? "" : "プロジェクトに更新履歴(CHANGELOG など)が既にあれば追記する。";
  const draft: PlanDraft = {
    summary: "小さい依頼と判断したため、分割せず1つの作業で仕上げます(早く終わります)。",
    tasks: [
      {
        key: "all",
        role: "coding",
        objective: `${goal.slice(0, 3600)}\n\n【進め方】この依頼のすべて(実装、頼まれたテストと文書)を、この1回の作業で仕上げる。テストがあれば実行して、全部通ることを確かめる。${history}`,
        inputs: [],
        expectedOutputs: [],
        constraints: [],
        dependsOn: [],
      },
    ],
  };
  return only ? withoutRecords(draft, [goal, ...constraints].join("\n")) : draft;
}
