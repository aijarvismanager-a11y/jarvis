import { describe, expect, it } from "vitest";
import { deriveProjectName } from "./labels";

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
