import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnRunner, type CommandRunner } from "./commandRunner.ts";
import { linkKey, type SyncLink } from "./projectSync.ts";
import type { Store } from "./store.ts";

// After a request is reflected into the original folder, a per-project verification script builds, starts and measures the real app
// (what no AI can do from inside its sandbox). The script lives in <app root>/verifiers/<projectId>.ps1, outside every project folder,
// so no AI can change it; and it runs only while its content matches what the person approved.
//
// Exit code: 0 = passed, 2 = postponed (the person is using the PC: asked again in a minute), anything else = failed.
// Environment: VERIFY_SOURCE = the original folder, VERIFY_COPY = the app's working copy.

export type VerifyResult = { at: string; status: "passed" | "failed" | "postponed" | "running"; summary: string; tail: string; durationMs: number; missionId?: string };
export type VerifyInfo = { available: boolean; approved: boolean; changed: boolean; result: VerifyResult | null };

export const verifyScriptPath = (appRoot: string, projectId: string) => path.join(appRoot, "verifiers", `${projectId}.ps1`);
const approvedKey = (projectId: string) => `verifyApproved:${projectId}`;
const resultKey = (projectId: string) => `verifyResult:${projectId}`;
const TAIL_CHARS = 2500;
const TIMEOUT_MS = 15 * 60_000;
const POSTPONE_MS = 60_000;
const MAX_POSTPONES = 15;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const scriptText = (appRoot: string, projectId: string): string | null => {
  try {
    return readFileSync(verifyScriptPath(appRoot, projectId), "utf8");
  } catch {
    return null;
  }
};

export function verifyInfo(store: Store, appRoot: string, projectId: string): VerifyInfo {
  const text = scriptText(appRoot, projectId);
  const approvedHash = store.getSetting<string | null>(approvedKey(projectId), null);
  return {
    available: text !== null,
    approved: text !== null && approvedHash === sha(text),
    changed: text !== null && approvedHash !== null && approvedHash !== sha(text),
    result: store.getSetting<VerifyResult | null>(resultKey(projectId), null),
  };
}

/** The person has read the script and allows it to run (until its content changes). */
export function approveVerifyScript(store: Store, appRoot: string, projectId: string): void {
  const text = scriptText(appRoot, projectId);
  if (text === null) throw new Error("確認の手順(スクリプト)が見つかりません");
  store.setSetting(approvedKey(projectId), sha(text));
  store.appendEvent({ projectId, type: "VERIFY_APPROVED", payload: {} });
}

const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Runs the approved script once (retrying every minute while the person is busy). Never throws; the result is stored and recorded as an event. */
export async function runVerification(store: Store, appRoot: string, projectId: string, missionId?: string, opts: { runner?: CommandRunner; postponeMs?: number; attempt?: number } = {}): Promise<VerifyResult> {
  const info = verifyInfo(store, appRoot, projectId);
  const fail = (summary: string): VerifyResult => finish(store, projectId, { at: new Date().toISOString(), status: "failed", summary, tail: "", durationMs: 0, missionId });
  if (!info.available) return fail("確認の手順がありません");
  if (!info.approved) return fail(info.changed ? "確認の手順の中身が変わっています。読んで、もう一度承認してください" : "確認の手順が、まだ承認されていません");
  const link = store.getSetting<SyncLink | null>(linkKey(projectId), null);
  if (!link) return fail("元のフォルダと結び付いていません");
  if (running.has(projectId)) return store.getSetting<VerifyResult | null>(resultKey(projectId), null) ?? fail("確認はすでに実行中です");
  running.add(projectId);
  const started = Date.now();
  store.setSetting(resultKey(projectId), { at: new Date().toISOString(), status: "running", summary: "確認を実行しています…", tail: "", durationMs: 0, missionId } satisfies VerifyResult);
  try {
    const run = opts.runner ?? spawnRunner;
    const res = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", verifyScriptPath(appRoot, projectId)], {
      cwd: link.sourcePath,
      env: { VERIFY_SOURCE: link.sourcePath, VERIFY_COPY: path.join(store.projectsRoot, projectId) },
      timeoutMs: TIMEOUT_MS,
    });
    const out = `${res.stdout}\n${res.stderr}`.trim();
    const lines = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    const summary = lines.filter((l) => /^(結果|RESULT|判定)[:：]/.test(l)).pop()?.replace(/^(結果|RESULT|判定)[:：]\s*/, "") ?? lines.pop() ?? "";
    if (res.timedOut) return finish(store, projectId, { at: new Date().toISOString(), status: "failed", summary: "確認が時間内に終わりませんでした", tail: out.slice(-TAIL_CHARS), durationMs: Date.now() - started, missionId });
    if (res.code === 2) {
      const attempt = (opts.attempt ?? 0) + 1;
      if (attempt <= MAX_POSTPONES) {
        clearTimeout(timers.get(projectId));
        const t = setTimeout(() => void runVerification(store, appRoot, projectId, missionId, { ...opts, attempt }), opts.postponeMs ?? POSTPONE_MS);
        t.unref?.();
        timers.set(projectId, t);
        return finish(store, projectId, { at: new Date().toISOString(), status: "postponed", summary: `PCを使っているため、あとで確認します(${attempt}/${MAX_POSTPONES}回目)`, tail: out.slice(-TAIL_CHARS), durationMs: Date.now() - started, missionId }, false);
      }
      return finish(store, projectId, { at: new Date().toISOString(), status: "failed", summary: "PCを使い続けていたため、確認を実行できませんでした", tail: out.slice(-TAIL_CHARS), durationMs: Date.now() - started, missionId });
    }
    return finish(store, projectId, { at: new Date().toISOString(), status: res.code === 0 ? "passed" : "failed", summary: summary || (res.code === 0 ? "確認を通過しました" : `確認に失敗しました(終了コード ${res.code})`), tail: out.slice(-TAIL_CHARS), durationMs: Date.now() - started, missionId });
  } catch (err) {
    return finish(store, projectId, { at: new Date().toISOString(), status: "failed", summary: err instanceof Error ? err.message : String(err), tail: "", durationMs: Date.now() - started, missionId });
  } finally {
    running.delete(projectId);
  }
}

function finish(store: Store, projectId: string, result: VerifyResult, record = true): VerifyResult {
  store.setSetting(resultKey(projectId), result);
  if (record) store.appendEvent({ projectId, type: result.status === "passed" ? "VERIFY_PASSED" : "VERIFY_FAILED", payload: { summary: result.summary, missionId: result.missionId ?? null } });
  return result;
}

export const hasScript = (appRoot: string, projectId: string) => existsSync(verifyScriptPath(appRoot, projectId));
