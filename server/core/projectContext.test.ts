import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebPrompt } from "./webAiExecutor.ts";
import { listProjectFiles, referenceContext } from "./projectContext.ts";

const project = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ctx-"));
  mkdirSync(path.join(root, "Views"));
  mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(path.join(root, "Views", "FenceWindow.xaml"), "<Window>fence</Window>");
  writeFileSync(path.join(root, "Settings.cs"), "class Settings { }");
  writeFileSync(path.join(root, ".env"), "TOKEN=secret");
  writeFileSync(path.join(root, "secret-key.json"), "{}");
  writeFileSync(path.join(root, "node_modules", "x", "i.js"), "x");
  return root;
};

describe("what a browser AI is shown of the project", () => {
  it("lists text files, not dependencies or secrets", () => {
    expect(listProjectFiles(project()).sort()).toEqual(["Settings.cs", "Views/FenceWindow.xaml"]);
  });

  it("adds the files the task names (inputs, or a file name in its text) and no others", () => {
    const lines = referenceContext(project(), ["Settings.cs"], ["FenceWindow.xaml の保存を設計する"]).join("\n");
    expect(lines).toContain("--- Settings.cs ---");
    expect(lines).toContain("class Settings");
    expect(lines).toContain("--- Views/FenceWindow.xaml ---");
    expect(lines).not.toContain("TOKEN");
  });

  it("finds unnamed files by the identifiers in the task text, showing the matching lines", () => {
    const root = project();
    writeFileSync(path.join(root, "Vm.cs"), "class Vm {\n  // x\n  public bool IsRolledUp;\n  void ToggleRollup() { }\n}\n" + "// filler\n".repeat(50));
    const lines = referenceContext(root, [], ["IsRolledUp の扱いを確認する"]).join("\n");
    expect(lines).toContain("--- Vm.cs ---");
    expect(lines).toContain("3:   public bool IsRolledUp;");
    expect(lines).not.toContain("--- Settings.cs ---");
  });

  it("shows the lines that mention the task's identifiers when a named file is too long to show whole", () => {
    const root = project();
    writeFileSync(path.join(root, "Big.cs"), "// filler\n".repeat(900) + "void ShowTitleBarMenu() { }\n" + "// filler\n".repeat(50));
    const lines = referenceContext(root, ["Big.cs"], ["ShowTitleBarMenu を確認する"]).join("\n");
    expect(lines).toContain("901: void ShowTitleBarMenu() { }");
  });

  it("never reads a path outside the project", () => {
    expect(referenceContext(project(), ["../../etc/passwd"], []).join("\n")).not.toContain("passwd ---");
  });

  it("ends up in the prompt", () => {
    const refs = referenceContext(project(), ["Settings.cs"], []);
    const prompt = buildWebPrompt({ task: { role: "design", objective: "x", inputs: [], expectedOutputs: [], constraints: [] }, mission: { goal: "g" }, context: [], references: refs, outputPaths: [] });
    expect(prompt).toContain("【参照ファイル(抜粋)】");
  });
});
