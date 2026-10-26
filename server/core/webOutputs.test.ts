import { describe, expect, it } from "vitest";
import { cleanFileText, webOutputPaths } from "./webOutputs.ts";

const t = (role: string, objective: string, expectedOutputs: string[]) => ({ role, objective, expectedOutputs });

describe("where a web AI's answer is saved", () => {
  it("uses plain paths as they are", () => {
    expect(webOutputPaths(t("design", "x", ["design/auth.md"]))).toEqual(["design/auth.md"]);
  });
  it("finds the file named at the start of an expected-output sentence", () => {
    expect(webOutputPaths(t("document", "x", ["design/todo-data.md ファイル(テーブル一覧, カラム定義表を含む)"]))).toEqual(["design/todo-data.md"]);
    expect(webOutputPaths(t("document", "x", ["docs/pro-wrestling.md に書き込む想定のMarkdown本文(タイトル+3団体)"]))).toEqual(["docs/pro-wrestling.md"]);
    expect(webOutputPaths(t("document", "x", ["「design/a.md」と design/b.md"]))).toEqual(["design/a.md"]);
  });
  it("finds the file the objective says the result is written to", () => {
    expect(webOutputPaths(t("design", "ユーザー登録機能のデータ設計をdesign/users.mdとして作成する", ["usersテーブルの定義"]))).toEqual(["design/users.md"]);
    expect(webOutputPaths(t("document", "内容を docs/pro-wrestling.md に書き込む", []))).toEqual(["docs/pro-wrestling.md"]);
  });
  it("does not treat a file that is merely read as the output", () => {
    expect(webOutputPaths(t("design", "design/todo-data.md の設計内容を踏まえて、画面を決める", ["画面一覧"]))).toEqual([]);
    expect(webOutputPaths(t("research", "src/app.js を調べる", ["調査メモ"]))).toEqual([]);
  });
  it("never lets a review or test overwrite the file it checks", () => {
    expect(webOutputPaths(t("review", "design/todo-data.md としてまとめた内容を確認", ["design/todo-data.md の確認結果"]))).toEqual([]);
    expect(webOutputPaths(t("testing", "x", ["tests/report.md の結果"]))).toEqual([]);
    expect(webOutputPaths(t("review", "x", ["review/ui.md"]))).toEqual(["review/ui.md"]); // an explicit plain path is the planner's decision
  });
  it("refuses paths that leave the project", () => {
    expect(webOutputPaths(t("design", "x", ["../secret.md"]))).toEqual([]);
    expect(webOutputPaths(t("design", "../x.mdとして作成", []))).toEqual([]);
  });
  it("ignores sentences without a file name", () => {
    expect(webOutputPaths(t("research", "調べる", ["選定した3団体の基本情報リスト(設立年、特徴)"]))).toEqual([]);
  });
});

describe("cleaning the text of a saved file", () => {
  it("drops the code-block label a page leaves on its own line", () => {
    expect(cleanFileText("d.md", "\nmarkdown\n# 題\n本文\n")).toBe("# 題\n本文");
  });
  it("drops a few short lines of chatter before the first heading", () => {
    expect(cleanFileText("d.md", "📁 LUM のどちらでもない作業なので省略するね。\n\n# 題\n本文")).toBe("# 題\n本文");
  });
  it("keeps real content before a heading (lists, long text, many lines) and non-text files", () => {
    expect(cleanFileText("d.md", "- 項目1\n- 項目2\n\n# 題")).toBe("- 項目1\n- 項目2\n\n# 題");
    expect(cleanFileText("d.md", "a\nb\nc\nd\n# 題")).toBe("a\nb\nc\nd\n# 題");
    expect(cleanFileText("d.md", `${"あ".repeat(130)}\n# 題`)).toContain("あ");
    expect(cleanFileText("app.js", "markdown\nconsole.log(1)")).toBe("markdown\nconsole.log(1)");
  });
});
