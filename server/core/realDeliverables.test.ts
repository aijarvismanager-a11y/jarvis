import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { admissionCount, isHistoryFile, statedStatus } from "./missionReport.ts";

// Real deliverables from the Gage project (written by the web AIs), kept byte for byte. Each was once judged "no answer" or
// "unconfirmed" by mistake: they state their own result on a "確認状況" line, and that line is the verdict.
const dir = path.join(__dirname, "__fixtures__", "real-deliverables");
const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

describe("real deliverables are judged by what they state", () => {
  it("has the fixtures", () => expect(files.length).toBeGreaterThanOrEqual(9));
  for (const f of files) {
    it(`${f}: settled, no admissions`, () => {
      const text = readFileSync(path.join(dir, f), "utf-8");
      expect(statedStatus(text)).toBe("settled");
      expect(admissionCount(text, "調査して記録する")).toBe(0);
      expect(admissionCount(text, "コードを調べる")).toBe(0);
    });
  }
  it("project history files are never judged by their old 未確認 lines", () => {
    for (const rel of ["TESTLOG.md", "PLAN.md", "ARCHITECTURE.md", "docs/CHANGELOG.md"]) expect(isHistoryFile(rel)).toBe(true);
    expect(isHistoryFile("_ai-records/windd-fence/t1_research_current_zorder_code.md")).toBe(false);
  });
});
