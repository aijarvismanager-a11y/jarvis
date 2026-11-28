// A short screen-design procedure added to the prompt of tasks that build a screen.
// Compared once without/with it (2026-11-28): the look and the phone width got better, the output roughly doubled,
// so it is only sent where a screen is written.
import type { Task } from "./store.ts";

const SCREEN_WORK = /画面|\bUI\b|サイト|ホームページ|Webページ|ランディングページ|ダッシュボード|フロントエンド|見た目|レイアウト|デザイン|\.(html|css|tsx|jsx|vue|svelte|xaml)\b/i;

export function buildsScreen(task: Pick<Task, "role" | "objective" | "expectedOutputs">): boolean {
  return task.role === "coding" && SCREEN_WORK.test(`${task.objective} ${task.expectedOutputs.join(" ")}`);
}

export const DESIGN_GUIDE_LINES: string[] = [
  "【画面デザインの手順】画面を新しく作る・見た目を変えるときに使ってください。既存の画面があるときはその配色・部品・書き方を最優先し、頼まれていない所の見た目は変えないこと。",
  "1. 書き始める前に、使う人と一番大事な情報を決め、配色(背景・文字・強調の色コード)、文字の大きさの段階、余白の段階を決めてから、その値だけを使う。",
  "2. 一番大事な情報を最も大きく目立たせ、他は控えめにする。全部を同じ大きさの箱に並べない。",
  "3. ありがちな見た目(紫のグラデーション、影つきの角丸カードの繰り返し、絵文字の飾り)を避け、題材に合った個性を1つだけ入れる。",
  "4. 強調色は1色。操作できる部分と大事な数字にだけ使う。",
  "5. 数字は桁がそろうようにし、一覧は流し読みしやすくする。余白で間延びさせず、よく見る情報が下に追いやられないようにする。",
  "6. 広い画面では余った横幅も使う。幅375pxでも崩れず、キーボード操作の枠が見え、文字と背景の差が十分にあること。",
  "7. 空の状態と入力ミスの表示も用意する。",
  "8. 最後に見直し、無くても困らない飾りを削る。",
];
