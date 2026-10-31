import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import type { CommandRunner } from "./commandRunner.ts";
import { approveVerifyScript, runVerification, verifyInfo } from "./postVerify.ts";
import { linkKey } from "./projectSync.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const base = mkdtempSync(path.join(os.tmpdir(), "pv-"));
  dirs.push(base);
  mkdirSync(path.join(base, "verifiers"), { recursive: true });
  writeFileSync(path.join(base, "verifiers", "p.ps1"), "Write-Output ok");
  const store = new Store(openDatabase(":memory:"), path.join(base, "projects"));
  store.createProject({ id: "p", name: "p" });
  store.setSetting(linkKey("p"), { sourcePath: base, importedAt: "", baseline: {} });
  return { base, store };
}
const runnerOf = (code: number, stdout: string): CommandRunner => async () => ({ code, stdout, stderr: "" });

describe("postVerify", () => {
  it("does not run a script nobody approved, nor one whose content changed after approval", async () => {
    const { base, store } = setup();
    expect(verifyInfo(store, base, "p")).toMatchObject({ available: true, approved: false });
    expect((await runVerification(store, base, "p", "m1", { runner: runnerOf(0, "結果: ok") })).status).toBe("failed");
    approveVerifyScript(store, base, "p");
    expect(verifyInfo(store, base, "p").approved).toBe(true);
    writeFileSync(path.join(base, "verifiers", "p.ps1"), "Remove-Item -Recurse C:\\");
    const info = verifyInfo(store, base, "p");
    expect(info).toMatchObject({ approved: false, changed: true });
    const r = await runVerification(store, base, "p", "m1", { runner: runnerOf(0, "結果: ok") });
    expect(r.status).toBe("failed");
    expect(r.summary).toContain("変わって");
  });

  it("records a pass with the script's own 結果 line, and a failure by exit code", async () => {
    const { base, store } = setup();
    approveVerifyScript(store, base, "p");
    const ok = await runVerification(store, base, "p", "m1", { runner: runnerOf(0, "手順1\n結果: 通過 — 最長 40 ミリ秒\n") });
    expect(ok).toMatchObject({ status: "passed", summary: "通過 — 最長 40 ミリ秒", missionId: "m1" });
    const bad = await runVerification(store, base, "p", "m1", { runner: runnerOf(1, "結果: 最長 300 ミリ秒") });
    expect(bad.status).toBe("failed");
    expect(store.listEvents({ projectId: "p", limit: 20 }).map((e) => e.type)).toEqual(expect.arrayContaining(["VERIFY_PASSED", "VERIFY_FAILED"]));
  });

  it("postpones while the person is busy (exit code 2) and tries again", async () => {
    const { base, store } = setup();
    approveVerifyScript(store, base, "p");
    let calls = 0;
    const runner: CommandRunner = async () => (++calls === 1 ? { code: 2, stdout: "結果: PCを使用中", stderr: "" } : { code: 0, stdout: "結果: 通過", stderr: "" });
    const first = await runVerification(store, base, "p", "m1", { runner, postponeMs: 10 });
    expect(first.status).toBe("postponed");
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(2);
    expect(verifyInfo(store, base, "p").result?.status).toBe("passed");
  });
});
