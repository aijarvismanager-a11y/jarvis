import { describe, expect, it } from "vitest";
import { acceptanceScore, buildAcceptancePrompt, parseAcceptance } from "./acceptance.ts";

describe("acceptance check", () => {
  const out = JSON.stringify({
    result: JSON.stringify({
      summary: "ほぼ満たしています",
      items: [
        { requirement: "在庫を一覧で見られる", status: "met", evidence: "作業2のinventory.tsx" },
        { requirement: "CSVで書き出せる", status: "unmet", evidence: "記録に出てこない", fix: "CSV書き出しを追加して" },
        { requirement: "見た目が見やすい", status: "partial", evidence: "表はあるが色分けなし" },
        { requirement: "", status: "met", evidence: "x" },
        { requirement: "不明な値", status: "weird", evidence: "" },
      ],
    }),
  });
  it("reads the items, keeps only known statuses, and scores them", () => {
    const a = parseAcceptance(out, "m1", new Date("2026-11-08T00:00:00Z"));
    expect(a.items.map((i) => i.status)).toEqual(["met", "unmet", "partial", "unknown"]);
    expect(a.items[1]?.fix).toBe("CSV書き出しを追加して");
    expect(a.summary).toBe("ほぼ満たしています");
    expect(a.score).toBe(Math.round((1.5 / 4) * 100));
  });
  it("gives no score for nothing, and nothing for garbage", () => {
    expect(acceptanceScore([])).toBeNull();
    expect(parseAcceptance("not json", "m1").items).toEqual([]);
  });
  it("puts the request and each task's record into the prompt", () => {
    const p = buildAcceptancePrompt({ goal: "在庫管理アプリ", tasks: [{ n: 1, role: "coding", objective: "画面を作る", status: "completed", summary: "作った", checks: "L2 OK", files: [{ path: "src/App.tsx", excerpt: "export default" }] }] });
    expect(p).toContain("在庫管理アプリ");
    expect(p).toContain("作業1");
    expect(p).toContain("src/App.tsx");
    expect(p).toContain("L2 OK");
  });
});

describe("what the check reads", () => {
  it("keeps the start and the end of a long file, and leaves a short one whole", async () => {
    const { excerptOf } = await import("./acceptance.ts");
    expect(excerptOf("short", 100)).toBe("short");
    const long = `HEAD${"x".repeat(5000)}TAIL`;
    const cut = excerptOf(long, 600);
    expect(cut.startsWith("HEAD")).toBe(true);
    expect(cut.endsWith("TAIL")).toBe(true);
    expect(cut.length).toBeLessThan(700);
  });

  it("does not treat build output as a deliverable", async () => {
    const { isGeneratedFile } = await import("./projectContext.ts");
    expect(isGeneratedFile("src/Fence.App/bin/Debug/net8.0/Gage.deps.json")).toBe(true);
    expect(isGeneratedFile("package-lock.json")).toBe(true);
    expect(isGeneratedFile("docs/test-results.md")).toBe(false);
    expect(isGeneratedFile("src/App.cs")).toBe(false);
  });
});
