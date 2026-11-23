import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";
import { projectDir } from "./paths.ts";

/**
 * Things only the person can do (build an installer, look at the real screen, log in...). The AI writes them into
 * HUMAN_TODO.md in the project folder, in a fixed shape, and the app shows them with their steps and a "done" button:
 *
 *   ## やること: インストーラーを作る
 *   理由: 画面の確認は人の目でしかできないため
 *   1. プロジェクトのフォルダで `powershell -File installer\build-installer.ps1` を実行する
 *   2. 「OK: ...」と出れば成功
 *
 * A heading that starts with "済" (## 済: ...) is finished and is not shown.
 * Older projects have no such file: the last "**人が...行うこと...**: ..." line of CLAUDE.md is taken instead (marked as such).
 */
export const HUMAN_TODO_FILE = "HUMAN_TODO.md";

export type HumanTodoStep = { text: string; command: string | null };
export type HumanTodo = { id: string; title: string; why: string; steps: HumanTodoStep[]; source: "file" | "legacy"; sourceFile: string };

const idOf = (title: string): string => createHash("sha1").update(title.trim()).digest("hex").slice(0, 10);
// only a step that says to run it has a command to copy (an expected output or a file name in backticks is not one)
const commandOf = (text: string): string | null => (/実行|入力して|打って|貼って走/.test(text) ? text.match(/`([^`]{3,300})`/)?.[1] ?? null : null);
const step = (text: string): HumanTodoStep => ({ text: text.trim(), command: commandOf(text) });

export function parseHumanTodoFile(text: string): HumanTodo[] {
  const out: HumanTodo[] = [];
  for (const block of text.split(/^##\s+/m).slice(1)) {
    const [headLine, ...rest] = block.split(/\r?\n/);
    const head = headLine.trim();
    if (/^(済|完了|\[x\])/i.test(head)) continue;
    const title = head.replace(/^やること\s*[:：]\s*/, "").trim();
    if (!title) continue;
    const why = rest.map((l) => l.match(/^理由\s*[:：]\s*(.+)$/)?.[1]).find(Boolean)?.trim() ?? "";
    const steps = rest.map((l) => l.match(/^\s*(?:\d+[.)．]|[-*])\s+(.+)$/)?.[1]).filter((s): s is string => !!s).map(step);
    if (steps.length === 0) continue;
    out.push({ id: idOf(title), title, why, steps, source: "file", sourceFile: HUMAN_TODO_FILE });
  }
  return out;
}

/** Old records: "**人が1回行うこと(…)**: 手順。手順。" — the newest one only (the older ones were done long ago). */
export function parseLegacyHumanTodo(text: string, file = "CLAUDE.md"): HumanTodo | null {
  const found = [...text.matchAll(/\*\*(人が[^*\n]{0,12}行うこと[^*\n]*)\*\*\s*[:：]\s*([^\n]+)/g)];
  const last = found[found.length - 1];
  if (!last) return null;
  const title = last[1].replace(/（[^）]*ここで止める[^）]*）|\([^)]*ここで止める[^)]*\)/, "").trim();
  const steps = last[2].split(/。(?=[^`]*(?:`[^`]*`[^`]*)*$)/).map((s) => s.trim()).filter((s) => s.length > 3).map(step);
  if (steps.length === 0) return null;
  return { id: idOf(`legacy:${last[1]}`), title, why: "プロジェクトの記録(CLAUDE.md)に、AIが「人が行うこと」として残していた手順です。古い記録の可能性があります。", steps, source: "legacy", sourceFile: file };
}

const readText = (file: string): string | null => {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return null;
  }
};

export const humanTodoDoneKey = (projectId: string) => `humanTodoDone:${projectId}`;

export function listHumanTodos(store: Store, projectId: string): HumanTodo[] {
  const dir = projectDir(store.projectsRoot, projectId);
  const done = new Set(store.getSetting<string[]>(humanTodoDoneKey(projectId), []));
  const fromFile = parseHumanTodoFile(readText(path.join(dir, HUMAN_TODO_FILE)) ?? "");
  const legacy = fromFile.length === 0 ? parseLegacyHumanTodo(readText(path.join(dir, "CLAUDE.md")) ?? "") : null;
  return [...fromFile, ...(legacy ? [legacy] : [])].filter((t) => !done.has(t.id));
}

export function markHumanTodoDone(store: Store, projectId: string, id: string): void {
  const key = humanTodoDoneKey(projectId);
  const done = new Set(store.getSetting<string[]>(key, []));
  done.add(id);
  store.setSetting(key, [...done].slice(-200));
}

/** The instruction the AIs are given so they write such steps in the shape above. */
export const HUMAN_TODO_INSTRUCTION = `自分では実行も確認もできず、人にしかできないこと(インストーラーの作成、実機の画面の目視確認、ログインなど)が残るときは、プロジェクト直下の ${HUMAN_TODO_FILE} に、次の形で追記してください(既存の内容は消さない)。アプリがこれを読んで、人に手順つきで知らせます: 「## やること: 題名」の行、「理由: 一文」の行、「1. 手順(コマンドは \`バッククォート\` で囲む)」を番号つきで。人が済ませたら、アプリが消すので、見出しを書き換える必要はありません。`;
