import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner } from "./commandRunner.ts";

// Checks the app runs by itself after a task, so nobody has to look: (1) an existing text file was not replaced by a much
// shorter one, (2) a .NET project still builds (in a throw-away copy, so the project folder gets no bin/obj).

const TEXT_EXT = new Set([".md", ".txt", ".csv", ".json", ".cs", ".xaml", ".ts", ".tsx", ".js", ".css", ".html", ".ps1", ".csproj"]);
const MIN_LINES = 30;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const TAIL_CHARS = 3000;

const lineCount = (text: string) => text.split("\n").length;

export type Shrunk = { path: string; before: number; after: number };

/**
 * Files that existed before the task and are now less than half as long (only files of 30+ lines count).
 * `readBefore` returns the file's content before the task, or null when it did not exist.
 */
export async function findShrunkFiles(changed: string[], readBefore: (rel: string) => Promise<string | null>, readNow: (rel: string) => string | null): Promise<Shrunk[]> {
  const out: Shrunk[] = [];
  for (const rel of changed) {
    if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
    const before = await readBefore(rel);
    const now = readNow(rel);
    if (before === null || now === null) continue;
    const b = lineCount(before);
    const a = lineCount(now);
    if (b >= MIN_LINES && a < b / 2) out.push({ path: rel, before: b, after: a });
  }
  return out;
}

export function shrinkMessage(shrunk: Shrunk[]): string {
  return `既存のファイルが、丸ごと短いものに置き換わっていたため、作業前の内容に戻しました: ${shrunk.map((s) => `${s.path}(${s.before}行→${s.after}行)`).join(", ")}。既存の内容は消さず、末尾または該当の節に追記してください。`;
}

/** Writes back what findShrunkFiles flagged. */
export function restoreFiles(root: string, files: { path: string; content: string }[]): void {
  for (const f of files) writeFileSync(path.join(root, f.path), f.content, "utf8");
}

const SKIP_DIRS = new Set(["bin", "obj", "publish", "installer", ".git", "node_modules", ".vs", "_ai-records", "research", "web-ai"]);

/** The solution (or, failing that, the project file) to build, relative to the project folder; null when it is not a .NET project. */
export function findBuildTarget(root: string): string | null {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return null;
  }
  const sln = names.find((n) => /\.sln$/i.test(n));
  if (sln) return sln;
  const proj = names.find((n) => /\.csproj$/i.test(n));
  return proj ?? null;
}

export const touchesDotnet = (changed: string[]) => changed.some((c) => /\.(cs|xaml|csproj|props|targets)$/i.test(c));

export type BuildCheck = { status: "passed" | "failed" | "skipped"; detail: string };

/** Builds a copy of the project with `dotnet build`. Skips (and says so) when there is nothing to build or dotnet is missing. */
export async function dotnetBuildCheck(root: string, runner: CommandRunner): Promise<BuildCheck> {
  const target = findBuildTarget(root);
  if (!target) return { status: "skipped", detail: "ビルド対象(.sln/.csproj)がありません" };
  const version = await runner("dotnet", ["--version"], { timeoutMs: 30_000 }).catch(() => null);
  if (!version || version.code !== 0) return { status: "skipped", detail: "dotnet が見つからないため、ビルドは確認していません" };
  const tmp = mkdtempSync(path.join(os.tmpdir(), "orch-build-"));
  try {
    cpSync(root, tmp, { recursive: true, filter: (src) => !SKIP_DIRS.has(path.basename(src)) || src === root });
    const res = await runner("dotnet", ["build", target, "-c", "Release", "--nologo", "-v", "q", "-clp:ErrorsOnly"], { cwd: tmp, timeoutMs: BUILD_TIMEOUT_MS });
    if (res.timedOut) return { status: "failed", detail: "dotnet build がタイムアウトしました" };
    if (res.code !== 0) return { status: "failed", detail: `dotnet build 失敗(code=${res.code}):\n${`${res.stdout}\n${res.stderr}`.trim().slice(-TAIL_CHARS)}` };
    return { status: "passed", detail: `dotnet build 合格(${target})` };
  } catch (err) {
    return { status: "skipped", detail: `ビルドを実行できませんでした: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function readTextIfExists(abs: string): string | null {
  try {
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  } catch {
    return null;
  }
}
