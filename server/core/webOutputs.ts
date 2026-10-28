import path from "node:path";
import type { Task } from "./store.ts";
import { declaredPaths } from "./taskValidator.ts";

// Where the answer of a web AI is saved. The Planner is asked for file paths in `expectedOutputs`, but often writes a
// sentence ("design/users.md ファイル(テーブル一覧を含む)", "docs/x.md に書き込む想定の本文"). Those still name the file, so
// the answer goes there instead of an anonymous web-ai/<role>-<id>.md.

const EXT = "md|markdown|txt|json|csv|html|css|js|mjs|ts|tsx|jsx|yaml|yml|sql|py|sh";
/** A path at the very start of an expected-output sentence: "design/users.md ファイル(...)". */
const LEADING_PATH = new RegExp(`^[\\s\`"'「(（]*((?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\\.(?:${EXT}))(?![A-Za-z0-9_.-])`, "i");
/** A path in the objective that is clearly the OUTPUT ("design/users.mdとして作成", "docs/x.md に書き込む", "…を design/x.md へ"). */
const OBJECTIVE_OUTPUT = new RegExp(`((?:[A-Za-z0-9_-]+/)+[A-Za-z0-9_.-]+\\.(?:${EXT}))(?![A-Za-z0-9_.-])\\s*(?:として|に(?:保存|書き込|出力|記述|作成|まとめ)|へ(?:保存|書き込|出力)|を作成|で作成)`, "gi");
/** Roles whose answer is a judgement about other files: their text must never replace a file that was named only in passing. */
const JUDGING_ROLES = new Set(["review", "ux_review", "final review", "test", "testing", "qa"]);

const safe = (p: string): boolean => !path.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes("..");

/** The files a web AI's answer should be saved as: declared paths first, then paths named inside the sentences. */
export function webOutputPaths(task: Pick<Task, "role" | "objective" | "expectedOutputs">): string[] {
  const declared = declaredPaths(task.expectedOutputs);
  if (declared.length > 0) return declared.filter(safe);
  if (JUDGING_ROLES.has(task.role.trim().toLowerCase())) return [];
  const found: string[] = [];
  for (const out of task.expectedOutputs) {
    const m = LEADING_PATH.exec(out);
    if (m && safe(m[1]!) && !found.includes(m[1]!)) found.push(m[1]!);
  }
  if (found.length === 0) {
    for (const m of task.objective.matchAll(OBJECTIVE_OUTPUT)) if (safe(m[1]!) && !found.includes(m[1]!)) found.push(m[1]!);
  }
  return found.slice(0, 4);
}

/**
 * What a chat page shows is not always the file: a fenced block comes out with its language label on a line of its own
 * ("markdown"), and a few short lines of chatter can stand before the document itself.
 */
export function cleanFileText(rel: string, text: string): string {
  let t = text.replace(/^\s*\n/, "").replace(/\s+$/, "");
  if (!/\.(md|markdown|txt)$/i.test(rel)) return t;
  const lines = t.split("\n");
  if (/^(markdown|md)$/i.test(lines[0]!.trim()) && lines.length > 1) lines.shift(); // the label of a code block the page rendered
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first > 0) lines.splice(0, first);
  // chatter before the first heading: at most 3 short plain lines, only when a heading follows within a few lines
  if (!/^#{1,3}\s/.test(lines[0] ?? "")) {
    const heading = lines.slice(0, 8).findIndex((l) => /^#{1,3}\s/.test(l));
    if (heading > 0) {
      const before = lines.slice(0, heading).filter((l) => l.trim() !== "");
      if (before.length <= 3 && before.every((l) => l.length <= 120 && !/^\s*([-*+>|]|\d+[.)])/.test(l))) lines.splice(0, heading);
    }
  }
  // the answer ends at its 確認状況 line: whatever follows is the site's chatter ("次は何をしますか?" etc.)
  const last = lines.map((l) => /^\W*確認状況\s*[:：]/.test(l)).lastIndexOf(true);
  if (last >= 0 && last < lines.length - 1) lines.length = last + 1;
  t = lines.join("\n");
  return t;
}
