import { describe, expect, it } from "vitest";
import { parseHumanTodoFile, parseLegacyHumanTodo } from "./humanTodos.ts";

describe("human todos", () => {
  it("reads the fixed shape: title, reason, numbered steps with commands; finished ones are skipped", () => {
    const t = parseHumanTodoFile("# メモ\n\n## やること: インストーラーを作る\n理由: 人の目でしか確認できない\n1. フォルダで `powershell -File a.ps1` を実行する\n2. 「OK」と出れば成功\n\n## 済: 古いこと\n1. 何か\n");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: "インストーラーを作る", why: "人の目でしか確認できない", source: "file" });
    expect(t[0].steps.map((s) => s.command)).toEqual(["powershell -File a.ps1", null]);
    expect(t[0].id).toBe(parseHumanTodoFile("## やること: インストーラーを作る\n1. x")[0].id);
  });
  it("takes the newest old-style line from a project record", () => {
    const text = "  - **人が1回行うこと（古い・ここで止める）**: `old.ps1` を実行する。\n  - **人が1回行うこと（インストーラー作成・ここで止める）**: プロジェクトのフォルダで `powershell -File installer\b.ps1` を実行する。最後に OK と出れば成功。結果を表に書く。";
    const t = parseLegacyHumanTodo(text)!;
    expect(t.source).toBe("legacy");
    expect(t.steps.length).toBe(3);
    expect(t.steps[0].command).toBe("powershell -File installer\b.ps1");
    expect(parseLegacyHumanTodo("人が何かする")).toBeNull();
  });
});
