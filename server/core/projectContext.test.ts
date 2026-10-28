import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebPrompt } from "./webAiExecutor.ts";
import { listProjectFiles, referenceBudget, referenceContext } from "./projectContext.ts";

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
    writeFileSync(path.join(root, "Big.cs"), "// filler\n".repeat(2000) + "void ShowTitleBarMenu() { }\n" + "// filler\n".repeat(50));
    const lines = referenceContext(root, ["Big.cs"], ["ShowTitleBarMenu を確認する"]).join("\n");
    expect(lines).toContain("2001: void ShowTitleBarMenu() { }");
  });

  it("shows the whole method around a mentioned identifier, not just the lines next to it", () => {
    const root = project();
    const body = Array.from({ length: 12 }, (_, i) => `        step${i}();`).join("\n");
    writeFileSync(path.join(root, "M.cs"), `class M\n{\n    void Other()\n    {\n        a();\n    }\n\n    void ShowMenu()\n    {\n${body}\n        ToggleRollup();\n    }\n\n    void After()\n    {\n        b();\n    }\n}\n` + "// filler\n".repeat(2000));
    const lines = referenceContext(root, ["M.cs"], ["ToggleRollup"]).join("\n");
    expect(lines).toContain("void ShowMenu()");
    expect(lines).toContain("step0();");
    expect(lines).not.toContain("void After()");
  });

  it("shows a long file whole when the site takes more (budget), and cuts it for a small box", () => {
    const root = project();
    writeFileSync(path.join(root, "Long.cs"), "// filler\n".repeat(2500) + "// THE END\n");
    expect(referenceContext(root, ["Long.cs"], [], referenceBudget("claude-web")).join("\n")).toContain("THE END");
    expect(referenceContext(root, ["Long.cs"], [], referenceBudget("copilot")).join("\n")).not.toContain("THE END");
  });

  it("takes a long method whole when the task names the method itself", () => {
    const root = project();
    const body = Array.from({ length: 150 }, (_, i) => `        item${i}.Click += (_, _) => Run${i}();`).join("\n");
    writeFileSync(path.join(root, "W.cs"), `class W\n{\n    void Before()\n    {\n        x();\n    }\n\n    private void ShowTitleBarMenu()\n    {\n${body}\n        menu.IsOpen = true;\n    }\n\n    void After()\n    {\n        y();\n    }\n}\n` + "// filler\n".repeat(2000));
    const lines = referenceContext(root, [], ["ShowTitleBarMenu を調べる"]).join("\n");
    expect(lines).toContain("item0.Click");
    expect(lines).toContain("menu.IsOpen = true;");
    expect(lines).not.toContain("void After()");
  });

  it("does not let the app's own name crowd out the method the task names", () => {
    const root = project();
    const noise = Array.from({ length: 120 }, (_, i) => `    private void FenceHelper${i}()\n    {\n        FenceLog(${i});\n    }\n`).join("\n");
    const menu = Array.from({ length: 150 }, (_, i) => `        menu.Items.Add(entry${i});`).join("\n");
    writeFileSync(path.join(root, "FenceWindow.cs"), `class FenceWindow\n{\n${noise}\n    private void ShowTitleBarMenu()\n    {\n        var rollupItem = new MenuItem();\n${menu}\n    }\n}\n`);
    const out = referenceContext(root, ["FenceWindow.cs"], ["FenceWindow の ShowTitleBarMenu のロールアップ項目を調べる"], 6000).join("\n");
    expect(out).toContain("var rollupItem = new MenuItem();");
  });

  it("keeps room for code when earlier reports (named as inputs) repeat the task's words", () => {
    const root = project();
    mkdirSync(path.join(root, "review"));
    const names = ["r1.md", "r2.md", "r3.md", "r4.md", "r5.md"].map((n) => `review/${n}`);
    for (const n of names) writeFileSync(path.join(root, n), "IsRolledUp is discussed here\n".repeat(40));
    writeFileSync(path.join(root, "Views", "Rollup.cs"), "class R { bool IsRolledUp; }");
    const lines = referenceContext(root, names, ["IsRolledUp を確認する"]).join("\n");
    expect(lines).toContain("--- Views/Rollup.cs ---");
  });

  it("when the blocks do not all fit, keeps the one that declares the named method over many that only mention it", () => {
    const root = project();
    const mention = (i: number) => `    void User${i}()\n    {\n${"        // filler filler filler filler filler filler\n".repeat(20)}        ToggleRollup();\n    }\n`;
    const many = Array.from({ length: 12 }, (_, i) => mention(i)).join("\n");
    const decl = `    void ToggleRollup()\n    {\n        // THE REAL BODY\n    }\n`;
    writeFileSync(path.join(root, "Many.cs"), `class M\n{\n${many}\n${decl}}\n` + "// filler\n".repeat(200));
    const lines = referenceContext(root, ["Many.cs"], ["ToggleRollup を調べる"], 8_000).join("\n");
    expect(lines).toContain("THE REAL BODY");
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
