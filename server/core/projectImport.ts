import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { PlanDraft } from "./taskGraph.ts";

// Importing an existing / half-finished project: the folder is copied into
// projects/<id>/ (the original is never modified), then a read-only analysis
// task writes a "status report" the following missions build on.

export const STATUS_REPORT_PATH = "docs/status-report.md";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".venv", "venv", "__pycache__", ".cache", ".turbo", "target"]);
const SKIP_FILE = /^(\.env(\..*)?|.*\.(log|pem|key|pfx|p12)|id_rsa.*|\.npmrc|\.DS_Store|Thumbs\.db)$/i;
export const MAX_IMPORT_FILES = 5_000;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export type ImportScan = { files: string[]; bytes: number; skippedSecrets: string[] };

/** Lists what would be copied. Throws when the folder is unsuitable or too large. */
export function scanImportSource(source: string, projectsRoot: string): ImportScan {
  if (typeof source !== "string" || !path.isAbsolute(source)) throw new Error("フォルダの絶対パスを指定してください(例: C:\Users\you\my-app)");
  const root = path.resolve(source);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error("フォルダが見つかりません");
  if (path.dirname(root) === root) throw new Error("ドライブ全体は取り込めません");
  const projects = path.resolve(projectsRoot);
  if (root === projects || root.startsWith(projects + path.sep) || projects.startsWith(root + path.sep)) throw new Error("このアプリ自身のプロジェクト置き場とは重なるフォルダは取り込めません");

  const files: string[] = [];
  const skippedSecrets: string[] = [];
  let bytes = 0;
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs, childRel);
      } else if (e.isFile()) {
        if (SKIP_FILE.test(e.name)) {
          skippedSecrets.push(childRel);
          continue;
        }
        files.push(childRel);
        bytes += lstatSync(abs).size;
        if (files.length > MAX_IMPORT_FILES) throw new Error(`ファイルが多すぎます(${MAX_IMPORT_FILES}個まで)。node_modules などを除いたフォルダを指定してください`);
        if (bytes > MAX_IMPORT_BYTES) throw new Error(`サイズが大きすぎます(${MAX_IMPORT_BYTES / 1024 / 1024}MBまで)`);
      }
    }
  };
  walk(root, "");
  if (files.length === 0) throw new Error("取り込めるファイルがありません");
  return { files, bytes, skippedSecrets };
}

/** Copies the scanned files into the project folder. */
export function copyImport(source: string, dest: string, scan: ImportScan): void {
  mkdirSync(dest, { recursive: true });
  for (const rel of scan.files) {
    const to = path.join(dest, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(path.join(source, rel), to);
  }
}

export function analysisPlan(sourceName: string): PlanDraft {
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
        ],
        dependsOn: [],
      },
    ],
  };
}
