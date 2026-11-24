import { describe, expect, it } from "vitest";
import { delegateGoal, humanOnlyKind, humanTurnLine, nextOpenStep, stepHeadline } from "./humanTodoView";
import type { HumanTodoView } from "./types";

const step = (text: string, command: string | null = null) => ({ text, command });
const todo = (title: string): HumanTodoView => ({ id: title, title, why: "", steps: [], source: "file", sourceFile: "HUMAN_TODO.md" });

describe("humanTodoView", () => {
  it("shortens a step to one readable line and replaces commands", () => {
    const cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File installer\\build-installer.ps1 -Dest installer";
    const h = stepHeadline(step(`プロジェクトのフォルダで ${cmd} を1回実行し、OK: ...HyperPlayer-Setup-1.3.1.exe と出るか確認する`, cmd));
    expect(h).toBe("プロジェクトのフォルダで コマンド を1回実行し");
    expect(h.length).toBeLessThanOrEqual(48);
    expect(stepHeadline(step("結果を docs/manual-verification.md の表に書く。基準を満たすまで公開しない"))).toBe("結果を docs/manual-verification.md の表に書く");
    expect(stepHeadline(step("あ".repeat(100))).length).toBeLessThanOrEqual(48);
  });
  it("finds the next unticked step", () => {
    expect(nextOpenStep([true, true, false, true], 4)).toBe(2);
    expect(nextOpenStep([true, true], 2)).toBeNull();
    expect(nextOpenStep([], 3)).toBe(0);
  });
  it("tells work only a person can do from work the AI could take over", () => {
    const t = (title: string, why: string, text: string): HumanTodoView => ({ ...todo(title), why, steps: [step(text)] });
    expect(humanOnlyKind(t("ログイン", "", "サイトにログインする")).onlyHuman).toBe(true);
    expect(humanOnlyKind(t("確認", "画面の確認は人の目でしかできない", "実機で目視確認する")).label).toContain("人にしかできない理由");
    expect(humanOnlyKind(t("ビルド", "", "`npm run build` を実行する")).onlyHuman).toBe(false);
    expect(delegateGoal(t("ビルド", "", "`npm run build` を実行する"))).toContain("1. `npm run build` を実行する");
  });
  it("says whose turn it is", () => {
    expect(humanTurnLine([])).toBeNull();
    expect(humanTurnLine([todo("インストーラーの作成と実機確認"), todo("B")])?.title).toBe("あなたの番です: インストーラーの作成と実機確認");
    expect(humanTurnLine([todo("A"), todo("B")])?.detail).toContain("2件");
  });
});
