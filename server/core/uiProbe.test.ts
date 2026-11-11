import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs tool without types
import { buildProbeArgs } from "../../tools/ui-probe.mjs";
import { SCREEN_CHECK, buildTaskPrompt } from "./claudeCodeExecutor.ts";

const root = path.resolve("C:/work/proj");

describe("ui-probe command lines", () => {
  it("launches only a program inside the project folder", () => {
    expect(buildProbeArgs(["launch", "bin/App.dll"], root)).toEqual(["-Cmd", "launch", "-Target", path.join(root, "bin", "App.dll")]);
    expect(() => buildProbeArgs(["launch", "../other/App.exe"], root)).toThrow("inside the project");
    expect(() => buildProbeArgs(["launch", "C:/Windows/System32/cmd.exe"], root)).toThrow("inside the project");
    expect(() => buildProbeArgs(["launch", "tools/run.ps1"], root)).toThrow(".exe or a .dll");
    expect(() => buildProbeArgs(["launch"], root)).toThrow("needs the program");
  });

  it("saves pictures only as .png inside the project folder", () => {
    expect(buildProbeArgs(["shot", "_ai-records/a.png"], root)[3]).toBe(path.join(root, "_ai-records", "a.png"));
    expect(() => buildProbeArgs(["shot", "../a.png"], root)).toThrow(".png inside");
    expect(() => buildProbeArgs(["shot", "a.ps1"], root)).toThrow(".png inside");
  });

  it("checks the numbers and rejects unknown commands", () => {
    expect(buildProbeArgs(["resize", "1000", "600"], root)).toEqual(["-Cmd", "resize", "-WinW", "1000", "-WinH", "600"]);
    expect(() => buildProbeArgs(["resize", "10", "600"], root)).toThrow("width");
    expect(() => buildProbeArgs(["click", "-1", "5"], root)).toThrow("x must");
    expect(() => buildProbeArgs(["tab-order", "500"], root)).toThrow("count");
    expect(buildProbeArgs(["tab-order"], root)).toEqual(["-Cmd", "tab-order", "-Count", "20"]);
    expect(() => buildProbeArgs(["rm", "-rf"], root)).toThrow("unknown command");
    expect(() => buildProbeArgs([], root)).toThrow("unknown command");
  });
});

describe("offering the screen-check tool to a worker", () => {
  const base = { mission: { goal: "g" }, dependencyNotes: [] as string[] };
  const task = (objective: string) => ({ role: "test" as const, objective, inputs: [], expectedOutputs: [], constraints: [] });

  it("is in the prompt for tasks that must look at the app, and not for the others", () => {
    expect(buildTaskPrompt({ ...base, task: task("1000x600 で各画面の崩れを実機で確認する"), uiProbe: "C:/o/tools/ui-probe.mjs" })).toContain("ui-probe.mjs");
    expect(buildTaskPrompt({ ...base, task: task("単体テストを書く"), uiProbe: "C:/o/tools/ui-probe.mjs" })).not.toContain("ui-probe.mjs");
    expect(buildTaskPrompt({ ...base, task: task("画面を確認する") })).not.toContain("ui-probe.mjs"); // not on this OS: no tool path
    expect(SCREEN_CHECK.test("Tab 順とフォーカス枠")).toBe(true);
  });
});
