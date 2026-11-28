import { describe, expect, it } from "vitest";
import { buildTaskPrompt } from "./claudeCodeExecutor.ts";
import { DESIGN_GUIDE_LINES, buildsScreen } from "./designGuide.ts";

const task = (objective: string, role = "coding", expectedOutputs: string[] = []) => ({ role, objective, inputs: [], expectedOutputs, constraints: [] });
const prompt = (t: ReturnType<typeof task>, designFiles?: string[]) => buildTaskPrompt({ task: t, mission: { goal: "家計簿アプリ" }, dependencyNotes: [], designFiles });

describe("screen design guide", () => {
  it("is added to coding tasks that build a screen", () => {
    expect(prompt(task("家計簿のメイン画面を作る"))).toContain(DESIGN_GUIDE_LINES[0]);
    expect(buildsScreen(task("一覧を作る", "coding", ["index.html"]))).toBe(true);
    expect(buildsScreen(task("設定のUIを直す"))).toBe(true);
  });

  it("is left out of other work", () => {
    expect(buildsScreen(task("支出を保存するAPIを作る", "coding", ["code/api.ts"]))).toBe(false);
    expect(buildsScreen(task("buildの失敗を直す"))).toBe(false);
    expect(buildsScreen(task("画面を確認する", "test"))).toBe(false);
    expect(prompt(task("集計の関数を作る"))).not.toContain("画面デザインの手順"); // the mission goal alone does not count
  });

  it("gives way to a finished design drawn by another AI", () => {
    expect(prompt(task("画面を作る"), ["design/screen.svg"])).not.toContain("画面デザインの手順");
  });
});
