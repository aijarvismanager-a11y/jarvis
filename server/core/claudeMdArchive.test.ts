import { mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compactClaudeMd, compactHistory, splitHistory } from "./claudeMdArchive.ts";

const entry = (n: number) => `- **作業${n}**: 内容${n}\n  続きの行${n}`;
const doc = (n: number) => `# P\n\n## 返信ルール\nルール\n\n## 作業履歴\n\n${Array.from({ length: n }, (_, i) => entry(i + 1)).join("\n")}\n\n## 既知のTODO\n- 残っている件\n`;

describe("compactHistory", () => {
  it("moves only the old history entries, word for word, and leaves every other section alone", () => {
    const text = doc(10);
    const r = compactHistory(text, "X:\a", 3, 0)!;
    expect(r.count).toBe(7);
    expect(r.archived).toBe(Array.from({ length: 7 }, (_, i) => entry(i + 1)).join("\n") + "\n");
    expect(r.text).toContain("## 返信ルール\nルール");
    expect(r.text).toContain("## 既知のTODO\n- 残っている件");
    expect(r.text).toContain(entry(10));
    expect(r.text).not.toContain(entry(7));
    expect(r.text).toContain("7件は");
    // nothing is lost: the archive plus the new file hold every entry
    for (let i = 1; i <= 10; i++) expect(r.archived + r.text).toContain(entry(i));
  });
  it("does nothing for a small file or a short history, and keeps a running total in the one pointer line", () => {
    expect(compactHistory(doc(10), "w", 3, 1_000_000)).toBeNull();
    expect(compactHistory(doc(3), "w", 3, 0)).toBeNull();
    const first = compactHistory(doc(10), "w", 5, 0)!;
    const more = first.text.replace(entry(10), `${entry(10)}\n${entry(11)}\n${entry(12)}`);
    const second = compactHistory(more, "w", 5, 0)!;
    expect(second.total).toBe(5 + 2);
    expect(second.text.match(/古い作業履歴/g)).toHaveLength(1);
    expect(splitHistory(second.text)!.entries).toHaveLength(5);
  });
  it("leaves a file without a history section alone", () => {
    expect(compactHistory("# P\n\n## メモ\n- a\n", "w", 0, 0)).toBeNull();
  });
});

describe("compactClaudeMd", () => {
  const setup = (n: number) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cm-"));
    const projects = path.join(root, "projects");
    mkdirSync(path.join(projects, "p1"), { recursive: true });
    const file = path.join(projects, "p1", "CLAUDE.md");
    writeFileSync(file, doc(n));
    utimesSync(file, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    return { projects, backups: path.join(root, "backups"), file };
  };
  it("writes the archive and a copy of the old file, then shrinks CLAUDE.md", () => {
    const { projects, backups, file } = setup(10);
    const r = compactClaudeMd({ projectsRoot: projects, backupsRoot: backups, keep: 3, above: 0 });
    expect(r).toHaveLength(1);
    expect(r[0].bytesAfter).toBeLessThan(r[0].bytesBefore);
    const files = readdirSync(path.join(backups, "claude-md", "p1"));
    expect(files.some((f) => f.startsWith("history-"))).toBe(true);
    expect(readFileSync(path.join(backups, "claude-md", "p1", files.find((f) => f.startsWith("CLAUDE-before-"))!), "utf-8")).toBe(doc(10));
    expect(readFileSync(file, "utf-8")).toContain("7件は");
  });
  it("skips a busy project and a file that was just written", () => {
    const a = setup(10);
    expect(compactClaudeMd({ projectsRoot: a.projects, backupsRoot: a.backups, keep: 3, above: 0, isBusy: () => true })).toEqual([]);
    const b = setup(10);
    utimesSync(b.file, new Date(), new Date());
    expect(compactClaudeMd({ projectsRoot: b.projects, backupsRoot: b.backups, keep: 3, above: 0 })).toEqual([]);
  });
});

import { compactTodoSection, isHistoryStyleEntry, isResolvedEntry } from "./claudeMdArchive.ts";

describe("compactTodoSection", () => {
  const hist = (n: number) => `- **作業${n}（coding・2026-11-${String(10 + n).padStart(2, "0")}）**: 内容${n}\n  続き${n}`;
  const todoDoc = `# P\n\n## 作業履歴\n- **古い**: a\n\n## 既知のTODO\n- （追記・2026-11-09）まだ開いている件\n- （追記・2026-11-10）→ **解消（2026-11-21）**: 済んだ件\n- （追記・2026-11-11）解消しない件です\n${[1, 2, 3, 4, 5].map(hist).join("\n")}\n`;
  it("moves resolved items and old history-style entries; open items stay; nothing is lost", () => {
    const r = compactTodoSection(todoDoc, "W", 2, 0)!;
    expect(r.count).toBe(1 + 3);
    expect(r.text).toContain("まだ開いている件");
    expect(r.text).toContain("解消しない件です");
    expect(r.text).not.toContain("済んだ件");
    expect(r.text).toContain(hist(5));
    expect(r.text).not.toContain(hist(1));
    for (const part of ["済んだ件", hist(1), hist(2), hist(3)]) expect(r.archived).toContain(part);
    expect(r.text).toContain("## 作業履歴\n- **古い**: a");
  });
  it("classifies entries and keeps one pointer line across runs", () => {
    expect(isResolvedEntry(["- （追記）解消しない"])).toBe(false);
    expect(isResolvedEntry(["- （追記）→ **解消（日付）**: x"])).toBe(true);
    expect(isHistoryStyleEntry(["- （追記・2026-11-09）メモ 2026-11-09"])).toBe(false);
    const first = compactTodoSection(todoDoc, "W", 2, 0)!;
    const again = compactTodoSection(first.text.replace(hist(5), `${hist(5)}\n${hist(6)}`), "W", 2, 0)!;
    expect(again.text.match(/TODO欄から移した記録/g)).toHaveLength(1);
    expect(again.total).toBe(first.total + 1);
    expect(compactTodoSection(todoDoc, "W", 20, 1_000_000)).toBeNull();
  });
});
