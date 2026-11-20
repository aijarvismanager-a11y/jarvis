import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dotnetBuildCheck, findBuildTarget, findShrunkFiles, restoreFiles, touchesDotnet } from "./autoChecks.ts";
import type { CommandRunner } from "./commandRunner.ts";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

describe("findShrunkFiles", () => {
  it("flags an existing long text file that became less than half as long", async () => {
    const r = await findShrunkFiles(["PLAN.md", "new.md", "small.md", "a.png"], async (p) => (p === "PLAN.md" ? lines(100) : p === "small.md" ? lines(10) : null), (p) => (p === "PLAN.md" ? lines(20) : p === "small.md" ? "x" : "y"));
    expect(r).toEqual([{ path: "PLAN.md", before: 100, after: 20 }]);
  });
  it("accepts appended files", async () => {
    expect(await findShrunkFiles(["PLAN.md"], async () => lines(100), () => lines(130))).toEqual([]);
  });
  it("restores flagged files", () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    writeFileSync(path.join(d, "a.md"), "short");
    restoreFiles(d, [{ path: "a.md", content: "original" }]);
    expect(readFileSync(path.join(d, "a.md"), "utf8")).toBe("original");
  });
});

describe("dotnetBuildCheck", () => {
  const project = () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    writeFileSync(path.join(d, "App.sln"), "");
    mkdirSync(path.join(d, "bin"));
    return d;
  };
  const runner = (buildCode: number): CommandRunner => async (_c, args) => (args[0] === "--version" ? { stdout: "8", stderr: "", code: 0 } : { stdout: "error CS1002", stderr: "", code: buildCode });
  it("finds the solution first", () => {
    expect(findBuildTarget(project())).toBe("App.sln");
    expect(touchesDotnet(["src/A.cs"])).toBe(true);
    expect(touchesDotnet(["README.md"])).toBe(false);
  });
  it("passes, fails with the compiler output, or skips without dotnet", async () => {
    expect((await dotnetBuildCheck(project(), runner(0))).status).toBe("passed");
    const failed = await dotnetBuildCheck(project(), runner(1));
    expect(failed.status).toBe("failed");
    expect(failed.detail).toContain("CS1002");
    const none: CommandRunner = async () => ({ stdout: "", stderr: "", code: 1 });
    expect((await dotnetBuildCheck(project(), none)).status).toBe("skipped");
    expect((await dotnetBuildCheck(mkdtempSync(path.join(os.tmpdir(), "ac-")), runner(0))).status).toBe("skipped");
  });
});

import { ProjectValidator } from "./taskValidator.ts";
import type { SnapshotManager } from "./snapshotManager.ts";

describe("ProjectValidator shrink guard", () => {
  it("puts back a history file that a task rewrote and fails the task", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    const dir = path.join(root, "p");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "PLAN.md"), lines(5));
    const snaps = { readFile: async () => Buffer.from(lines(100)) } as unknown as SnapshotManager;
    const task = { id: "t", projectId: "p", role: "documentation", objective: "追記", expectedOutputs: [], retryCount: 0 } as never;
    const res = await new ProjectValidator(root, { snapshots: snaps, runTests: false }).validate(task, { ok: true, artifacts: ["PLAN.md"] });
    expect(res.passed).toBe(false);
    expect(res.detail).toContain("PLAN.md");
    expect(readFileSync(path.join(dir, "PLAN.md"), "utf8").split("\n").length).toBe(100);
  });
});

describe("ProjectValidator unanswered research", () => {
  const setup = (text: string) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ac-"));
    mkdirSync(path.join(root, "p"));
    writeFileSync(path.join(root, "p", "r.md"), text);
    return root;
  };
  const task = (retryCount: number) => ({ id: "t", projectId: "p", role: "research", objective: "調査", expectedOutputs: [], retryCount }) as never;
  it("sends a deliverable that could not read its target back once, then accepts it", async () => {
    const root = setup("確認状況: 確認できず\n読めなかった");
    const v = new ProjectValidator(root, { runTests: false });
    expect((await v.validate(task(0), { ok: true, artifacts: ["r.md"] })).passed).toBe(false);
    expect((await v.validate(task(1), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
  });
  it("sends a '一部未確認' deliverable back once to settle the open points, then accepts it", async () => {
    const root = setup("# 調査\n結論: A\n\n確認状況: 一部未確認");
    const v = new ProjectValidator(root, { runTests: false });
    const first = await v.validate(task(0), { ok: true, artifacts: ["r.md"] });
    expect(first.passed).toBe(false);
    expect(first.detail).toContain("実際に開いて読み");
    expect((await v.validate(task(1), { ok: true, artifacts: ["r.md"] })).passed).toBe(false); // asked twice
    expect((await v.validate(task(2), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
    expect((await new ProjectValidator(setup("確認状況: 確定"), { runTests: false }).validate(task(0), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
  });
  it("does not send a web-chat task back to read files it cannot open", async () => {
    const root = setup("# 調査\n結論: A\n\n確認状況: 一部未確認");
    const v = new ProjectValidator(root, { runTests: false, runsOnWebChat: () => true });
    expect((await v.validate(task(0), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
  });
  it("does not retry when the AI was simply not allowed to run something", async () => {
    const root = setup("確認状況: 確認できず\n承認が必要でした");
    expect((await new ProjectValidator(root, { runTests: false }).validate(task(0), { ok: true, artifacts: ["r.md"] })).passed).toBe(true);
  });
});

describe("needsCodeExecutor", () => {
  it("keeps code edits and the project's running records off the web chats", async () => {
    const { needsCodeExecutor } = await import("./webAiExecutor.ts");
    expect(needsCodeExecutor({ role: "coding", expectedOutputs: [] })).toBe(true);
    // a screen check starts the app and looks at it: a web AI would invent the result from old records
    expect(needsCodeExecutor({ role: "test", objective: "tools/ui-probe(launch → resize 1000 600 → shot)で各画面を撮影し、ずれを判定する", expectedOutputs: ["docs/screenshots/a.png"] })).toBe(true);
    expect(needsCodeExecutor({ role: "test", objective: "修正後のアプリを再起動し、1000x600の再撮影とずれなしを確認する", expectedOutputs: ["_ai-records/x.md"] })).toBe(true);
    // wordings that were really sent to a web AI (DeepSeek) on 2026-11-14 although they start the app and look at it
    expect(needsCodeExecutor({ role: "test", objective: "capture.ps1 -Action Start で 1000x600 に起動し、プレイヤーのサイトモードで YouTube などのページを読み込ませ、Shot -Name stage-fix-site で撮影する", expectedOutputs: ["_ai-records/x.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "test", objective: "パソコンの動画モードに戻して sample.mp4 を開いて再生する。動画が映ること", expectedOutputs: ["_ai-records/y.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "test", objective: "capture.ps1 -Action Stop と -Action Status を実行して settings.json の復元を確かめる", expectedOutputs: ["_ai-records/z.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "research", objective: "tools/ui-probeの使い方を読んで整理する", expectedOutputs: ["_ai-records/c.md"] })).toBe(false);
    // fixing a few places in an existing file: Muse returned it cut short (50 lines -> 36, first table gone) on 2026-11-18
    expect(needsCodeExecutor({ role: "document", objective: "run-output.md の表(§3)の値は一字も変えず、表より上下にある古い次の5か所だけを実状態に合わせて直す", expectedOutputs: ["_ai-records/run-output.md"] })).toBe(true);
    // reading the project through git: web AIs went round six sites and failed on 2026-11-20 (research tasks of mis_7e327cbb)
    expect(needsCodeExecutor({ role: "research", objective: "2ファイルの直す前の行数と今の行数を並べ、git show と現ファイルの行数で示す(git diff --stat / numstat も使う)", expectedOutputs: ["_ai-records/x/linecount.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "research", objective: "dougasoft が git が追跡しているかを確認する", expectedOutputs: ["_ai-records/x/git-facts.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "research", objective: "git の使い方を一般論として整理する", expectedOutputs: ["_ai-records/x/git.md"] })).toBe(false);
    // searching the project folder with a tool: web chats only see excerpts (mis_57192747, 2026-11-20)
    expect(needsCodeExecutor({ role: "research", objective: "Grep ツールで _ai-records/ 配下を「未取得」で全文検索する", expectedOutputs: ["_ai-records/x/grep-ai.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "research", objective: "Glob ツールで docs/ の一覧を取る", expectedOutputs: ["_ai-records/x/glob.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "research", objective: "grep コマンドの一般的な使い方を整理する", expectedOutputs: ["_ai-records/x/grep.md"] })).toBe(false);
    // adding to a record that already exists must not be a chat answer (it replaces the whole file)
    expect(needsCodeExecutor({ role: "document", objective: "結果を既存の記録へ反映する: docs/report.mdの§1結果表を更新し、追記する", expectedOutputs: ["docs/report.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "document", objective: "新しい利用者向けの説明書を書く", expectedOutputs: ["docs/guide.md"] })).toBe(false);
    expect(needsCodeExecutor({ role: "test", objective: "dotnet build Gage.sln と dotnet test を実行し結果を書く", expectedOutputs: ["docs/test-results.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "document", expectedOutputs: ["TESTLOG.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "document", expectedOutputs: ["PLAN.md", "ARCHITECTURE.md"] })).toBe(true);
    expect(needsCodeExecutor({ role: "test", expectedOutputs: ["test/apiSplit.test.js"] })).toBe(true); // a chat page mangles code (5 broken test files in a row)
    expect(needsCodeExecutor({ role: "document", expectedOutputs: ["docs/new-note.md"] })).toBe(false);
    expect(needsCodeExecutor({ role: "research", expectedOutputs: ["_ai-records/x/t1.md"] })).toBe(false);
    expect(needsCodeExecutor({ role: "document", objective: "この依頼で行った内容(作ったもの)を、更新履歴として残す。", expectedOutputs: [] })).toBe(true); // the history step edits project files: never a chat page
  });
});

describe("decodeSvgText", () => {
  it("turns « and » back into the angle brackets of an SVG a design AI wrote as plain text", async () => {
    const { decodeSvgText } = await import("./webAiExecutor.ts");
    expect(decodeSvgText('«svg width="8" height="8"»«rect x="1" y="1" width="3" height="3"/»«/svg»')).toBe('<svg width="8" height="8"><rect x="1" y="1" width="3" height="3"/></svg>');
    expect(decodeSvgText("＜svg＞＜/svg＞")).toBe("<svg></svg>");
    expect(decodeSvgText("<svg></svg>")).toBe("<svg></svg>"); // an answer that already holds real SVG is left alone
  });
});
