import { describe, expect, it } from "vitest";
import { dockMode, isSendKey, replySummary } from "./dock";
import type { Task } from "./types";

const task = (status: Task["status"]) => ({ status }) as Task;

describe("dockMode", () => {
  it("asks before stopping running work", () => {
    expect(dockMode("running", false).kind).toBe("redirect");
    expect(dockMode("running", false).confirm).toBeTruthy();
  });
  it("sends feedback to a plan that waits", () => expect(dockMode("planning", true).kind).toBe("plan-feedback"));
  it("starts a new request after a finished one", () => {
    expect(dockMode("completed", false).kind).toBe("new");
    expect(dockMode(null, false).confirm).toBeUndefined();
  });
});

describe("isSendKey", () => {
  it("Enter sends", () => expect(isSendKey({ key: "Enter", shiftKey: false })).toBe(true));
  it("Shift+Enter is a new line", () => expect(isSendKey({ key: "Enter", shiftKey: true })).toBe(false));
  it("Enter that confirms a Japanese conversion does not send", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(isSendKey({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
  });
});

describe("replySummary", () => {
  it("puts the person's part first when one is left", () => {
    const s = replySummary([task("completed"), task("completed")], "completed", 2);
    expect(s.did).toContain("2件が終わりました");
    expect(s.next).toContain("あなたの番");
  });
  it("says nothing is needed when nothing is left", () => expect(replySummary([task("completed")], "completed", 0).next).toContain("やることはありません"));
  it("reports failures", () => expect(replySummary([task("completed"), task("failed")], "failed", 0).result).toContain("1件"));
});
