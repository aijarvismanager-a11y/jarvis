import { describe, expect, it } from "vitest";
import { deriveProjectName, goalText } from "./labels";

describe("deriveProjectName", () => {
  it("uses the first phrase of the request", () => {
    expect(deriveProjectName("「こんにちは」と表示するだけの、とても小さな1ページのWebページを作って")).toBe("「こんにちは」と表示するだけの");
    expect(deriveProjectName("商品管理ができるシンプルなWebアプリを作って。在庫も見たい")).toBe("商品管理ができるシンプルなWebアプリを…");
  });
  it("shortens a long first phrase and handles empty or tiny input", () => {
    expect(deriveProjectName("あ".repeat(40))).toBe(`${"あ".repeat(20)}…`);
    expect(deriveProjectName("   ")).toBe("新しいプロジェクト");
    expect(deriveProjectName("電卓、作って")).toBe("電卓、作って"); // a very short first phrase is kept with what follows
  });
});

describe("goalText", () => {
  it("drops the marker that the old-app migration put in front of a request", () => {
    expect(goalText("(旧プロジェクトから移行)カラフルな動画作りたい")).toBe("旧アプリから引き継いだプロジェクト「カラフルな動画作りたい」");
    expect(goalText("商品管理アプリを作って")).toBe("商品管理アプリを作って");
  });
});
