import { describe, expect, it } from "vitest";
import { buildNextIdeasPrompt, parseNextIdeas, todoSection } from "./nextIdeas.ts";

const json = (ideas: unknown[]) => JSON.stringify({ ideas });

describe("parseNextIdeas", () => {
  it("keeps exactly one recommendation and puts it first", () => {
    const out = parseNextIdeas(
      json([
        { title: "A", why: "a", request: "Aを頼みます。何をどこまで。", effort: "small", recommended: false },
        { title: "B", why: "b", request: "Bを頼みます。何をどこまで。", effort: "medium", recommended: true },
        { title: "C", why: "c", request: "Cを頼みます。何をどこまで。", effort: "large", recommended: true },
      ]),
      "m1",
    );
    expect(out.ideas.map((i) => i.title)).toEqual(["B", "A", "C"]);
    expect(out.ideas.filter((i) => i.recommended)).toHaveLength(1);
    expect(out.ideas[0]!.recommended).toBe(true);
  });

  it("recommends the first idea when none is marked, and drops unusable ideas", () => {
    const out = parseNextIdeas(
      json([
        { title: "", why: "x", request: "題がない依頼は捨てる、十分に長い文", effort: "small" },
        { title: "短い", why: "x", request: "短", effort: "small" },
        { title: "使える", why: "y", request: "使える依頼の文です。十分な長さ。", effort: "weird" },
      ]),
      "m2",
    );
    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0]).toMatchObject({ title: "使える", recommended: true, effort: "medium" });
  });

  it("returns no ideas for output without any", () => {
    expect(parseNextIdeas("すみません、できません", "m3").ideas).toEqual([]);
  });
});

describe("todoSection", () => {
  it("takes the lines under the known-TODO heading up to the next heading", () => {
    const text = "# A\nx\n## 既知のTODO\n- 一つ目\n- 二つ目\n## 次の節\n- 別";
    expect(todoSection(text)).toBe("- 一つ目\n- 二つ目");
    expect(todoSection("# A\nなし")).toBe("");
    expect(todoSection(null)).toBe("");
  });
});

describe("buildNextIdeasPrompt", () => {
  it("includes the goal, the gaps found, earlier requests and the project's own TODO notes", () => {
    const p = buildNextIdeasPrompt({
      projectName: "動画ソフト",
      goal: "変換機能を作る",
      tasks: [{ objective: "変換を実装する", status: "completed" }],
      unmet: [{ requirement: "ダウンロードが画面から使える", fix: "ボタンをつなぐ" }],
      earlierGoals: ["最初の依頼"],
      todoNotes: "- 実機確認が未実施",
    });
    for (const s of ["動画ソフト", "変換機能を作る", "ダウンロードが画面から使える", "ボタンをつなぐ", "最初の依頼", "実機確認が未実施", "recommended"]) expect(p).toContain(s);
  });
});
