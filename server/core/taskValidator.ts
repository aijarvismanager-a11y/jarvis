import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnRunner, type CommandRunner } from "./commandRunner.ts";
import type { ExecutionResult, TaskValidator } from "./missionEngine.ts";
import { projectDir, resolveInProject } from "./paths.ts";
import { isWriteTask } from "./scheduler.ts";
import type { Task } from "./store.ts";
import type { SmokeResult } from "./appSmokeTest.ts";
import type { SnapshotManager } from "./snapshotManager.ts";
import { admissionCount, isHistoryFile, statedStatus, INCONCLUSIVE_AT } from "./missionReport.ts";
import { dotnetBuildCheck, findShrunkFiles, readTextIfExists, restoreFiles, shrinkMessage, touchesDotnet } from "./autoChecks.ts";

// Validation L1-L3 (spec §31): files exist, files are well-formed, unit tests
// pass. Each level only runs if the lower one passed; the verdict reports the
// highest level reached so a failure is recorded where it happened. The detail
// text is what the executor feeds back to Claude on the next attempt.

const SYNTAX_CHECKED = new Set([".js", ".mjs", ".cjs"]);
const MAX_SYNTAX_FILES = 50;
const TEST_TIMEOUT_MS = 5 * 60_000;
const TAIL_CHARS = 3000;
const CANNOT_RUN = /承認(プロンプト|が必要)|承認できる主体|DESTRUCTIVE|許可が(出|得)|実行(自体)?ができて?(い)?ない|実行できなかった/;

/** Declared outputs that are file paths ("code/app.js"), as opposed to prose ("要件定義書"). */
export function declaredPaths(expectedOutputs: string[]): string[] {
  return expectedOutputs.map((o) => o.trim()).filter((o) => o.length <= 200 && !/\s/.test(o) && /[./\\]/.test(o) && /\.[a-z0-9]{1,8}$/i.test(o));
}

/** The task that connects frontend and backend ("フロントエンドとバックエンドAPIを結合し…"): the point where a mismatch between them first shows. */
export function isIntegrationTask(task: Pick<Task, "role" | "objective">): boolean {
  return isWriteTask(task) && /結合|統合|連携|integrat|wire\s*up/i.test(task.objective);
}

/** The task that runs / judges the tests ("npm test を実行して結果を記録"): not a code-writing role, but its claim "tests pass" must be proven. */
export function isTestRunTask(task: Pick<Task, "role" | "objective">): boolean {
  return /^(test|tests|testing|tester|qa|テスト|検証)$/i.test(task.role.trim()) || /npm\s+(run\s+)?test|テスト(を|の)?(実行|走ら)/i.test(task.objective);
}

export class ProjectValidator implements TaskValidator {
  constructor(
    private readonly projectsRoot: string,
    private readonly opts: { runner?: CommandRunner; runTests?: boolean; smoke?: { run(projectRoot: string, signal?: AbortSignal): Promise<SmokeResult> }; /** before/after copies of the folder: lets the validator notice files that shrank */ snapshots?: SnapshotManager; /** set false to skip the automatic `dotnet build` of .NET projects */ dotnetBuild?: boolean } = {},
  ) {}

  private get runner() {
    return this.opts.runner ?? spawnRunner;
  }

  async validate(task: Task, result: ExecutionResult): Promise<{ passed: boolean; detail?: string; level?: number }> {
    const changed = result.artifacts ?? [];

    // L1: existence
    const wanted = declaredPaths(task.expectedOutputs);
    const missing: string[] = [];
    for (const rel of wanted) {
      try {
        const abs = resolveInProject(this.projectsRoot, task.projectId, rel);
        if (!existsSync(abs) || (statSync(abs).isFile() && statSync(abs).size === 0)) missing.push(rel);
      } catch {
        missing.push(rel);
      }
    }
    if (missing.length) return { passed: false, level: 1, detail: `期待した成果物がありません、または空です: ${missing.join(", ")}` };
    if (isWriteTask(task) && wanted.length === 0 && changed.length === 0) {
      return { passed: false, level: 1, detail: "コード作業の作業ですが、ファイルが1つも作成・変更されていません" };
    }

    // L2: syntax of what was produced
    const toCheck = [...new Set([...wanted, ...changed])].slice(0, MAX_SYNTAX_FILES);
    const syntaxErrors: string[] = [];
    for (const rel of toCheck) {
      const ext = path.extname(rel).toLowerCase();
      let abs: string;
      try {
        abs = resolveInProject(this.projectsRoot, task.projectId, rel);
      } catch {
        continue;
      }
      if (!existsSync(abs)) continue;
      if (ext === ".json") {
        try {
          JSON.parse(readFileSync(abs, "utf8"));
        } catch (err) {
          syntaxErrors.push(`${rel}: JSONとして不正です (${err instanceof Error ? err.message : err})`);
        }
      } else if (SYNTAX_CHECKED.has(ext)) {
        const res = await this.runner(process.execPath, ["--check", abs], { timeoutMs: 30_000 });
        if (res.code !== 0) syntaxErrors.push(`${rel}: ${(res.stderr || res.stdout).trim().slice(-600)}`);
      }
    }
    if (syntaxErrors.length) return { passed: false, level: 2, detail: `構文エラー:\n${syntaxErrors.join("\n")}` };

    // A research / design / review deliverable that says it could not read what it was asked about is sent back once,
    // naming the files to open, so the person is not left with an "unanswered" to-do. (Not when the AI says it was not allowed to run something: asking again cannot fix that.)
    if (!isWriteTask(task) && task.retryCount === 0) {
      const text = (changed.length ? changed : wanted).filter((rel) => !isHistoryFile(rel)).map((rel) => { try { return readTextIfExists(resolveInProject(this.projectsRoot, task.projectId, rel)) ?? ""; } catch { return ""; } }).join("\n");
      if (text && admissionCount(text, task.objective) >= INCONCLUSIVE_AT && !CANNOT_RUN.test(text)) {
        return { passed: false, level: 2, detail: "成果物に「読めなかった/見つけられなかった/確認できていない」と書かれており、頼まれたことの答えが出ていません。プロジェクトフォルダの中のファイルを実際に開いて読み(Read/Glob/Grepで探す)、答えを出し直してください。どうしても読めないものだけを「確認状況: 一部未確認」として挙げ、読めたものについては結論を書いてください。" };
      }
    }

    // "確認状況: 一部未確認": it answered but left points open. Those are not left for the person: the task is sent back once to read the files and settle them.
    if (!isWriteTask(task) && task.retryCount === 0) {
      const text = (changed.length ? changed : wanted).filter((rel) => !isHistoryFile(rel)).map((rel) => { try { return readTextIfExists(resolveInProject(this.projectsRoot, task.projectId, rel)) ?? ""; } catch { return ""; } }).join("\n");
      if (text && statedStatus(text) === "partly" && !CANNOT_RUN.test(text)) {
        return { passed: false, level: 2, detail: "成果物に「確認状況: 一部未確認」と書かれています。「未確認」とした点それぞれについて、プロジェクトフォルダの中のファイルを実際に開いて読み(Read/Glob/Grepで探す)、確かめて答えを出し直してください。確かめられた点は結論を書き、「確認状況: 確定」にしてください。ファイルを調べても本当に分からない点だけを残し、その理由(どのファイルを見たか)を書いてください。" };
      }
    }

    // Guard: an existing file replaced by a much shorter one (a task that rewrote a history file instead of adding to it) is put back and the task fails.
    const snaps = this.opts.snapshots;
    if (snaps && changed.length) {
      const name = `${task.projectId}-${task.id}-${task.retryCount}-before`;
      const root = projectDir(this.projectsRoot, task.projectId);
      const originals = new Map<string, string>();
      const shrunk = await findShrunkFiles(
        changed,
        async (rel) => {
          const buf = await snaps.readFile(task.projectId, name, rel).catch(() => null);
          if (!buf) return null;
          originals.set(rel, buf.toString("utf8"));
          return originals.get(rel)!;
        },
        (rel) => readTextIfExists(path.join(root, rel)),
      );
      if (shrunk.length) {
        restoreFiles(root, shrunk.map((s) => ({ path: s.path, content: originals.get(s.path)! })));
        return { passed: false, level: 2, detail: shrinkMessage(shrunk) };
      }
    }

    // L3: unit tests, only for code tasks in a project that defines a test script
    let level = toCheck.length ? 2 : 1;
    let detail: string | undefined;
    // L3: a .NET project must still build (done here, because the AI has no way to run the build itself)
    if (this.opts.dotnetBuild !== false && isWriteTask(task) && touchesDotnet(changed)) {
      const build = await dotnetBuildCheck(projectDir(this.projectsRoot, task.projectId), this.runner);
      if (build.status === "failed") return { passed: false, level: 3, detail: build.detail };
      detail = build.status === "passed" ? build.detail : `ビルド確認(未実施): ${build.detail}`;
      if (build.status === "passed") level = 3;
    }
    // A test / QA task is checked by running the tests here too: the AI's sandbox often cannot run them ("承認が必要で実行できなかった"), and its hand calculation is no evidence.
    if (this.opts.runTests !== false && (isWriteTask(task) || isTestRunTask(task)) && this.hasTestScript(task.projectId)) {
      const res = await this.runner("npm", ["test"], { cwd: projectDir(this.projectsRoot, task.projectId), timeoutMs: TEST_TIMEOUT_MS, env: { CI: "true" } });
      if (res.timedOut) return { passed: false, level: 3, detail: "テストがタイムアウトしました" };
      if (res.code !== 0) return { passed: false, level: 3, detail: `テスト失敗(npm test, code=${res.code}):\n${`${res.stdout}\n${res.stderr}`.trim().slice(-TAIL_CHARS)}` };
      level = 3;
      detail = [detail, "npm test 合格"].filter(Boolean).join("\n");
    }

    // L4: integration gate. Only for the task that wires the pieces together: run the app and open it.
    if (this.opts.smoke && isIntegrationTask(task)) {
      const smoke = await this.opts.smoke.run(projectDir(this.projectsRoot, task.projectId));
      if (smoke.status === "failed") return { passed: false, level: 4, detail: smoke.detail };
      detail = [detail, `結合ゲート(${smoke.status === "passed" ? "合格" : "未実施"}): ${smoke.detail}`].filter(Boolean).join("\n");
      if (smoke.status === "passed") level = 4;
    }
    return { passed: true, level, ...(detail ? { detail } : {}) };
  }

  private hasTestScript(projectId: string): boolean {
    try {
      const pkg = JSON.parse(readFileSync(path.join(projectDir(this.projectsRoot, projectId), "package.json"), "utf8")) as { scripts?: Record<string, string> };
      const script = pkg.scripts?.test;
      return typeof script === "string" && script.trim() !== "" && !/no test specified/i.test(script);
    } catch {
      return false;
    }
  }
}
