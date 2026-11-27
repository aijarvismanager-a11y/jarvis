import { describe, expect, it } from "vitest";
import { filesOf, finishOf, missionBrief, purposeOf } from "./missionBrief";
import type { Mission } from "./types";

const m = (id: string, goal: string, createdAt: string): Mission => ({ id, projectId: "p", goal, constraints: [], technologyPreferences: [], budgetPolicy: "free_only", status: "completed", createdAt, updatedAt: createdAt });

describe("missionBrief", () => {
  it("takes the first sentence as the purpose and the 終わりの目安 as the finish line", () => {
    const g = "HyperPlayer で、run-output.md の表を直してください。守ること: 値は推測しない。終わりの目安: 3か所が同一だと示すこと。";
    expect(purposeOf(g)).toBe("run-output.md の表を直してください");
    expect(finishOf(g)).toBe("3か所が同一だと示すこと");
    expect(finishOf("ただ作る")).toBeNull();
  });
  it("finds file names regardless of the folder in front", () => {
    expect(filesOf("_ai-records/x/run-output.md と tests\\a\\file-info.ps1")).toEqual(["run-output.md", "file-info.ps1"]);
  });
  it("says who started the request and warns about a pile of requests on one file", () => {
    const all = [m("a", "run-output.md を直す", "2026-11-18T00:00:00Z"), m("b", "run-output.md を直す", "2026-11-20T00:00:00Z"), m("c", "run-output.md を整える。人が貼る値を使う", "2026-11-23T00:00:00Z")];
    const b = missionBrief(all[2], all, { c: { from: "b", depth: 1 } });
    expect(b.origin).toBe("アプリが自動で作った続き");
    expect(b.notes.join("\n")).toContain("3件目");
    expect(b.notes.join("\n")).toContain("自動で作りました");
    expect(b.notes.join("\n")).toContain("人の操作");
    expect(missionBrief(all[0], all, {}).origin).toBe("自動の続きではない依頼(画面から出された依頼)");
    expect(missionBrief(all[0], all, {}).notes).toEqual([]);
  });
  it("does not say who started a request before that is read", () => {
    const one = [m("a", "ただ作る", "2026-11-27T00:00:00Z")];
    expect(missionBrief(one[0], one, null).origin).toBe("確認しています…");
  });
});
