import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PlanDraft } from "./taskGraph.ts";

// Importing an existing / half-finished project: the folder is copied into
// projects/<id>/ (the original is never modified), then a read-only analysis
// task writes a "status report" the following missions build on.

export const STATUS_REPORT_PATH = "docs/status-report.md";
/** The AI-written summary of the talk with Claude Code in the original folder (see conversationHistory.ts). Never synced back. */
export const HISTORY_NOTES_PATH = "docs/previous-conversation.md";

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".venv", "venv", "__pycache__", ".cache", ".turbo", "target"]);
export const SKIP_FILE = /^(\.env(\..*)?|.*\.(log|pem|key|pfx|p12)|id_rsa.*|\.npmrc|\.DS_Store|Thumbs\.db)$/i;
export const MAX_IMPORT_FILES = 20_000;
export const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;
/** The scan keeps counting past the limits (to say what is heavy) but gives up here. */
const SCAN_HARD_CAP_FILES = 400_000;
const ROOT_FILES = "(フォルダ直下のファイル)";

export type ImportScan = { files: string[]; bytes: number; skippedSecrets: string[]; excluded: string[] };
export type ImportWeight = { name: string; files: number; bytes: number };

/** Thrown when the folder is over the limits; carries what is heavy so the user can leave those folders out. */
export class ImportTooLargeError extends Error {
  constructor(
    message: string,
    readonly files: number,
    readonly bytes: number,
    readonly folders: ImportWeight[],
  ) {
    super(message);
    this.name = "ImportTooLargeError";
  }
}

/** Lists what would be copied. Throws when the folder is unsuitable or too large. `exclude` = names of top-level folders to leave out. */
export function scanImportSource(source: string, projectsRoot: string, opts: { exclude?: string[]; maxFiles?: number; maxBytes?: number } = {}): ImportScan {
  if (typeof source !== "string" || !path.isAbsolute(source)) throw new Error("フォルダの絶対パスを指定してください(例: C:\\Users\\you\\my-app)");
  const root = path.resolve(source);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error("フォルダが見つかりません");
  if (path.dirname(root) === root) throw new Error("ドライブ全体は取り込めません");
  const projects = path.resolve(projectsRoot);
  if (root === projects || root.startsWith(projects + path.sep) || projects.startsWith(root + path.sep)) throw new Error("このアプリ自身のプロジェクト置き場とは重なるフォルダは取り込めません");

  const exclude = new Set((opts.exclude ?? []).map((n) => n.toLowerCase()));
  const files: string[] = [];
  const skippedSecrets: string[] = [];
  const excluded: string[] = [];
  const weights = new Map<string, ImportWeight>();
  let bytes = 0;
  let capped = false;
  const walk = (dir: string, rel: string, top: string | null) => {
    if (capped) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      const group = top ?? (e.isDirectory() ? e.name : ROOT_FILES);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (top === null && exclude.has(e.name.toLowerCase())) {
          excluded.push(e.name);
          continue;
        }
        walk(abs, childRel, group);
      } else if (e.isFile()) {
        if (SKIP_FILE.test(e.name)) {
          skippedSecrets.push(childRel);
          continue;
        }
        const size = lstatSync(abs).size;
        files.push(childRel);
        bytes += size;
        const w = weights.get(group) ?? { name: group, files: 0, bytes: 0 };
        w.files += 1;
        w.bytes += size;
        weights.set(group, w);
        if (files.length > SCAN_HARD_CAP_FILES) {
          capped = true;
          return;
        }
      }
    }
  };
  walk(root, "", null);
  const maxFiles = opts.maxFiles ?? MAX_IMPORT_FILES;
  const maxBytes = opts.maxBytes ?? MAX_IMPORT_BYTES;
  if (files.length > maxFiles || bytes > maxBytes) {
    const heavy = [...weights.values()].sort((a, b) => b.bytes - a.bytes || b.files - a.files).slice(0, 8);
    const mb = Math.round(bytes / 1024 / 1024);
    throw new ImportTooLargeError(
      `フォルダが大きすぎます(${capped ? `${SCAN_HARD_CAP_FILES.toLocaleString()}ファイル以上` : `${files.length.toLocaleString()}ファイル`}・${capped ? "" : `${mb.toLocaleString()}MB`})。上限は${maxFiles.toLocaleString()}ファイル・${Math.round(maxBytes / 1024 / 1024)}MBです。重いフォルダを除外して取り込めます`,
      files.length,
      bytes,
      heavy,
    );
  }
  if (files.length === 0) throw new Error("取り込めるファイルがありません");
  return { files, bytes, skippedSecrets, excluded };
}

/** Copies the scanned files into the project folder, one at a time so the server stays responsive meanwhile. */
export async function copyImport(source: string, dest: string, scan: ImportScan, onProgress?: (p: { done: number; bytesDone: number }) => void): Promise<void> {
  await mkdir(dest, { recursive: true });
  let done = 0;
  let bytesDone = 0;
  for (const rel of scan.files) {
    const to = path.join(dest, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(path.join(source, rel), to);
    done += 1;
    bytesDone += (await stat(to)).size;
    onProgress?.({ done, bytesDone });
  }
}

export function analysisPlan(sourceName: string, hasHistory = false): PlanDraft {
  return {
    summary: "取り込んだプロジェクトの現状を調べる",
    tasks: [
      {
        key: "analyze",
        role: "analysis",
        objective: `取り込んだ既存プロジェクト「${sourceName}」の現状を調べ、${STATUS_REPORT_PATH} にまとめてください。既存のコードは一切変更しないでください(作るのはこのレポートだけ)。`,
        inputs: ["プロジェクトフォルダ全体"],
        expectedOutputs: [STATUS_REPORT_PATH],
        constraints: [
          "既存ファイルの変更・削除・移動は禁止。新規に作るのはレポートのみ",
          "レポートの項目: 1) 何のアプリか 2) 使っている技術・フォルダ構成 3) 動かし方(起動・テストのコマンド) 4) 完成している機能 5) 未完成・壊れている・TODOの箇所 6) 気になる点(重複・古い依存・テスト不足など)",
          "推測と事実を区別し、推測には「推測」と書く",
          ...(hasHistory ? [`${HISTORY_NOTES_PATH} は、元のフォルダで行われた Claude Code との会話の要約です。先に読み、レポートに「7) これまでの経緯と引き継ぎ事項」の項目を加えてください(このファイルは変更しない)`] : []),
        ],
        dependsOn: [],
      },
    ],
  };
}
