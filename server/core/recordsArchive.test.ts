import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveOldRecords, isAiRecordPath } from "./recordsArchive.ts";

const DAY = 86_400_000;
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "rec-"));
  const projects = path.join(root, "projects");
  const backups = path.join(root, "backups");
  const put = (rel: string, ageDays: number) => {
    const f = path.join(projects, "p1", rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, "メモ");
    const t = new Date(Date.now() - ageDays * DAY);
    utimesSync(f, t, t);
  };
  return { root, projects, backups, put };
}

describe("archiveOldRecords", () => {
  it("packs only old _ai-records folders, keeps recent ones and never touches the rest of the project", async () => {
    const { root, projects, backups, put } = setup();
    put("_ai-records/old-work/design.md", 30);
    put("_ai-records/old-work/research.md", 40);
    put("_ai-records/new-work/design.md", 1);
    put("src/app.cs", 90);
    const r = await archiveOldRecords({ projectsRoot: projects, backupsRoot: backups });
    expect(r.archived).toEqual(["p1/old-work"]);
    expect(existsSync(path.join(projects, "p1/_ai-records/old-work"))).toBe(false);
    expect(existsSync(path.join(projects, "p1/_ai-records/new-work/design.md"))).toBe(true);
    expect(existsSync(path.join(projects, "p1/src/app.cs"))).toBe(true);
    expect(readdirSync(path.join(backups, "records/p1")).some((f) => f.startsWith("old-work-") && f.endsWith(".tar.gz"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
  it("one recent file keeps the whole folder", async () => {
    const { root, projects, backups, put } = setup();
    put("_ai-records/mixed/a.md", 60);
    put("_ai-records/mixed/b.md", 2);
    expect((await archiveOldRecords({ projectsRoot: projects, backupsRoot: backups })).archived).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
  it("recognises record paths for the sync filter", () => {
    expect(isAiRecordPath("_ai-records/x/a.md")).toBe(true);
    expect(isAiRecordPath("src/_ai-records.cs")).toBe(false);
  });
});
