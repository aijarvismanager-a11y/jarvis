import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseCliCapabilities, spawnRunner, type CommandRunner } from "./planner.ts";
import { isolationArgs } from "./isolation.ts";
import { needsShell } from "./commandRunner.ts";
import { HISTORY_NOTES_PATH } from "./projectImport.ts";

// Carrying the talk with Claude Code over to an imported project.
// Claude Code keeps every session of a folder as a .jsonl file under ~/.claude/projects/<folder path with every
// non-alphanumeric character replaced by "-">/. Each line is one record; only the plain text of the person's and the
// assistant's messages is used here (no tool calls, tool output or thinking). The text is condensed, summarized by
// Claude Code itself (read-only, no tools) and saved in the project as HISTORY_NOTES_PATH, which the planner and
// every task are told to read.

export type HistorySession = { file: string; sessionId: string; modifiedAt: number; bytes: number };
export type HistoryInfo = { found: boolean; sessions: number; lastAt: string | null };
export type Turn = { at: string; role: "user" | "assistant"; text: string };

const MAX_SESSIONS = 8;
const MAX_TURN_CHARS = 1500;
const HISTORY_BUDGET_CHARS = 60_000;

export const encodeProjectDir = (folder: string) => path.resolve(folder).replace(/[^A-Za-z0-9]/g, "-");
const projectsDir = (home: string) => path.join(home, ".claude", "projects");

/** The cwd recorded at the start of a session file (used when the folder-name encoding does not match). */
async function recordedCwd(file: string): Promise<string | null> {
  const head = await readFile(file).then((b) => b.subarray(0, 65536).toString("utf8"), () => "");
  const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

const sameFolder = (a: string, b: string) => path.resolve(a).replace(/[\\/]+$/, "").toLowerCase() === path.resolve(b).replace(/[\\/]+$/, "").toLowerCase();

async function sessionFiles(dir: string): Promise<HistorySession[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: HistorySession[] = [];
  for (const n of names) {
    if (!n.endsWith(".jsonl")) continue;
    const st = await stat(path.join(dir, n)).catch(() => null);
    if (st?.isFile() && st.size > 0) out.push({ file: path.join(dir, n), sessionId: n.replace(/\.jsonl$/, ""), modifiedAt: st.mtimeMs, bytes: st.size });
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Sessions Claude Code recorded for this folder, newest first. */
export async function findSessions(sourceFolder: string, home: string = os.homedir()): Promise<HistorySession[]> {
  const root = projectsDir(home);
  const direct = await sessionFiles(path.join(root, encodeProjectDir(sourceFolder)));
  if (direct.length > 0) return direct;
  // the folder name may have been encoded differently by another version: look for the folder in the sessions themselves
  for (const d of await readdir(root).catch(() => [] as string[])) {
    const files = await sessionFiles(path.join(root, d));
    if (files.length === 0) continue;
    const cwd = await recordedCwd(files[0].file);
    if (cwd && sameFolder(cwd, sourceFolder)) return files;
  }
  return [];
}

export async function historyInfo(sourceFolder: string, home?: string): Promise<HistoryInfo> {
  const sessions = await findSessions(sourceFolder, home);
  return { found: sessions.length > 0, sessions: sessions.length, lastAt: sessions[0] ? new Date(sessions[0].modifiedAt).toISOString() : null };
}

/** Text parts of a message; empty for tool calls/results, thinking and the harness's own reminders. */
function textOf(content: unknown): string {
  const parts = typeof content === "string" ? [content] : Array.isArray(content) ? content.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text as string) : [];
  return parts
    .join("\n")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>/g, "")
    .trim();
}

/** The person's and the assistant's spoken text of one session, in order. */
export async function readConversation(file: string): Promise<Turn[]> {
  const turns: Turn[] = [];
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith("{")) continue;
    let o: { type?: string; isSidechain?: boolean; isMeta?: boolean; timestamp?: string; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if ((o.type !== "user" && o.type !== "assistant") || o.isSidechain || o.isMeta) continue;
    const text = textOf(o.message?.content);
    if (!text) continue;
    turns.push({ at: o.timestamp ?? "", role: o.type, text: text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS)} …(省略)` : text });
  }
  return turns;
}

const day = (iso: string) => (iso ? iso.slice(0, 10) : "日付不明");

/** The newest sessions as one text of at most `budget` characters; a session that does not fit keeps its beginning and its end. */
export async function condenseHistory(sessions: HistorySession[], budget: number = HISTORY_BUDGET_CHARS): Promise<{ text: string; sessions: number; turns: number }> {
  const blocks: string[] = [];
  let left = budget;
  let used = 0;
  let turnCount = 0;
  for (const s of sessions.slice(0, MAX_SESSIONS)) {
    if (left < 2000) break;
    const turns = await readConversation(s.file);
    if (turns.length === 0) continue;
    const lines = turns.map((t) => `${t.role === "user" ? "ユーザー" : "AI"}: ${t.text}`);
    let body = lines.join("\n\n");
    if (body.length > left) {
      const head = Math.floor(left * 0.2);
      body = `${body.slice(0, head)}\n\n…(途中を省略)…\n\n${body.slice(body.length - (left - head))}`;
    }
    blocks.unshift(`### セッション ${day(turns[0].at)}(${turns.length}発言)\n\n${body}`);
    left -= body.length;
    used += 1;
    turnCount += turns.length;
  }
  return { text: blocks.join("\n\n---\n\n"), sessions: used, turns: turnCount };
}

export function buildSummaryPrompt(conversation: string): string {
  return [
    "次は、あるプロジェクトのフォルダで、ユーザーと Claude Code が行ってきた会話の記録です(古い順)。",
    "この記録を、別の AI が作業を引き継ぐための「引き継ぎメモ」に日本語のMarkdownで要約してください。",
    "含める項目: 1) 何を作っているか・目的 2) 決まった方針・設計上の判断(理由つき) 3) ここまでにできたこと・現在の状態 4) 未完了・次にやる予定のこと 5) 失敗や注意点(ハマったこと、やってはいけないこと) 6) ユーザーの好み・ルール・口調。",
    "事実だけを書き、記録にないことは推測で補わないこと。パスワード・APIキー・トークン等の秘密情報は書かないこと。",
    "ファイルの読み書きやコマンド実行はせず、メモ本文のMarkdownだけを出力すること(前置き・後書きは不要)。",
    "",
    "=== 会話の記録 ===",
    conversation,
  ].join("\n");
}

export type CarryResult = { ok: true; sessions: number; turns: number; path: string } | { ok: false; error: string };

/** Summarizes the folder's Claude Code conversations into `<projectDir>/docs/previous-conversation.md`. Never throws. */
export async function carryHistory(opts: { sourceFolder: string; projectDir: string; home?: string; runner?: CommandRunner; command?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<CarryResult> {
  try {
    const sessions = await findSessions(opts.sourceFolder, opts.home);
    if (sessions.length === 0) return { ok: false, error: "元のフォルダの Claude Code の会話履歴が見つかりませんでした" };
    const { text, sessions: used, turns } = await condenseHistory(sessions);
    if (!text) return { ok: false, error: "会話履歴に読み取れる発言がありませんでした" };
    const command = opts.command ?? "claude";
    const runner = opts.runner ?? spawnRunner;
    const help = await runner(command, ["--help"], { cwd: opts.projectDir, timeoutMs: 30_000 });
    const caps = parseCliCapabilities(`${help.stdout}\n${help.stderr}`);
    if (!caps.print) throw new Error("このClaude Codeは非対話実行(--print)に対応していません");
    if (!caps.permissionModePlan) throw new Error("読み取り専用モード(--permission-mode plan)が使えないため、安全に要約できません");
    const args = ["--print", "--permission-mode", "plan"]; // read-only: nothing may be edited
    if (caps.noSessionPersistence) args.push("--no-session-persistence");
    args.push(...isolationArgs(caps.saver, needsShell(command)));
    const res = await runner(command, args, { input: buildSummaryPrompt(text), cwd: opts.projectDir, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 5 * 60_000 });
    if (res.code !== 0) throw new Error(`Claude Codeが異常終了しました(code=${res.code}): ${res.stderr.slice(0, 300)}`);
    // the model sometimes wraps the whole note in a code fence
    const fenced = /^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(res.stdout.trim());
    const summary = (fenced ? fenced[1] : res.stdout).trim();
    if (summary.length < 50) throw new Error("要約が空でした");
    const header = `# 前の Claude Code での作業の引き継ぎメモ\n\n> 元のフォルダ「${path.resolve(opts.sourceFolder)}」の会話履歴(${used}セッション・${turns}発言)を、取り込み時に AI が要約したものです。会話そのものではなく要約なので、細部は元の履歴で確認してください。\n\n`;
    const target = path.join(opts.projectDir, HISTORY_NOTES_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${header}${summary}\n`, "utf8");
    return { ok: true, sessions: used, turns, path: HISTORY_NOTES_PATH };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
