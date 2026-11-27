import { describe, expect, it } from "vitest";
import { dockMode, isSendKey, pastExchanges, replySummary } from "./dock";
import type { Mission, Task } from "./types";

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

describe("pastExchanges", () => {
  const m = (id: string, createdAt: string, status: Mission["status"] = "completed") => ({ id, createdAt, status }) as Mission;
  const t = (missionId: string, position = 0) => ({ missionId, position, status: "completed" }) as Task;
  it("lists only earlier requests, oldest first", () => {
    const missions = [m("c", "3"), m("a", "1"), m("b", "2"), m("d", "4")];
    expect(pastExchanges(missions, [], missions[0]).map((x) => x.mission.id)).toEqual(["a", "b"]);
  });
  it("gives each request its own tasks in order", () => {
    const missions = [m("a", "1"), m("b", "2")];
    const [first] = pastExchanges(missions, [t("a", 1), t("b"), t("a", 0)], missions[1]);
    expect(first.tasks.map((x) => x.position)).toEqual([0, 1]);
  });
  it("leaves out a draft that was never planned, and does not call an unfinished one running", () => {
    const missions = [m("a", "1", "draft"), m("b", "2", "paused"), m("c", "3")];
    const past = pastExchanges(missions, [], missions[2]);
    expect(past.map((x) => x.mission.id)).toEqual(["b"]);
    expect(past[0].result).toBe("終わっていません");
  });
  it("is empty without a current request", () => expect(pastExchanges([m("a", "1")], [], null)).toEqual([]));
});
