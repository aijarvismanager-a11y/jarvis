import { describe, expect, it } from "vitest";
import { matchesKeyword, tokenize } from "./tokenize";

describe("tokenize", () => {
  it("splits Japanese text into word-like segments", () => {
    expect(tokenize("サイトを作りたい")).toEqual(["サイト", "を", "作り", "たい"]);
  });
});

describe("matchesKeyword", () => {
  it("matches a bare word keyword against its own token", () => {
    expect(matchesKeyword("検索してほしい", "検索")).toBe(true);
  });

  it("matches a verb-stem keyword against its inflected token", () => {
    // "調べ" is the stem; "調べたい" tokenizes to "調べ" + "たい".
    expect(matchesKeyword("調べたいことがある", "調べ")).toBe(true);
  });

  it("matches a compound-noun keyword the segmenter splits more finely", () => {
    // ICU splits "表計算" into "表" + "計算" as separate tokens, but the
    // keyword still spans them exactly (boundary-aligned start and end).
    expect(matchesKeyword("表計算をしたい", "表計算")).toBe(true);
  });

  it("matches a loanword keyword the segmenter mis-splits", () => {
    // ICU splits "アイコン" into "アイコ" + "ン" (poor dictionary coverage
    // for this loanword), but boundary-alignment still finds it.
    expect(matchesKeyword("アイコンを作って", "アイコン")).toBe(true);
  });

  it("matches a multi-word phrase keyword by substring", () => {
    expect(matchesKeyword("これは文字が読める画像がほしい", "文字が読める画像")).toBe(true);
  });

  it("does not match a keyword that never appears", () => {
    expect(matchesKeyword("音楽を作りたい", "動画")).toBe(false);
  });

  it("does not match a keyword buried inside an unrelated word", () => {
    // "実装" appears as raw characters inside "充実装置" but not as a
    // boundary-aligned match — "充実" + "装置" are the real words here.
    expect(matchesKeyword("充実装置を導入したい", "実装")).toBe(false);
  });
});
