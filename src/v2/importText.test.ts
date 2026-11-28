import { describe, expect, it } from "vitest";
import { importNote, nextLeaveOut } from "./importText";

describe("leaving heavy folders out", () => {
  it("keeps the earlier choice when the folder is still too large", () => {
    expect([...nextLeaveOut(["assets-a"], [{ name: "assets-b", bytes: 10 }])]).toEqual(["assets-a"]);
    expect([...nextLeaveOut(["assets-a"], [{ name: "media", bytes: 30 * 1024 ** 2 }])]).toEqual(["assets-a", "media"]);
  });
});

describe("the result of an import", () => {
  it("names what was not taken", () => {
    const n = importNote({ project: { id: "p", name: "p" } as never, missionId: null, files: 2, bytes: 1, skippedSecrets: [".env"], skippedDirs: ["build"], skippedOther: ["debug.log"], excluded: [] });
    expect(n.summary).toBe("2ファイルを取り込みました");
    expect(n.left.join()).toContain("build");
    expect(n.left.join()).toContain("debug.log");
    expect(n.left).toHaveLength(3);
  });
});
