import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { killTree } from "./commandRunner.ts";
import { assemblyNameOf, captureWindow, findDesktopProject, removeDir, startDesktopApp } from "./desktopPreview.ts";
import { projectDir } from "./paths.ts";
import type { SnapshotManager } from "./snapshotManager.ts";

// Before / after for a desktop app: the app cannot be shown inside a web page, so each side is built, opened, photographed
// (a picture of its window) and closed again. The pictures are then shown side by side. The "before" is the project folder
// as it was when the chosen task started (taken from the snapshot store); the "after" is the folder as it is now.

export type CompareState = "idle" | "working" | "done" | "error";
export type CompareStatus = { supported: boolean; state: CompareState; message: string; startedAt: string | null; baseline: string | null; before: boolean; after: boolean; log: string };

type Entry = { state: CompareState; message: string; startedAt: string | null; baseline: string | null; dir: string; token: number; log: string; pids: number[]; temps: string[] };

export class DesktopCompare {
  private readonly entries = new Map<string, Entry>();
  private seq = 0;

  constructor(
    private readonly projectsRoot: string,
    private readonly snapshots: SnapshotManager,
  ) {}

  supported(projectId: string): boolean {
    try {
      const root = projectDir(this.projectsRoot, projectId);
      return process.platform === "win32" && existsSync(root) && findDesktopProject(root) !== null;
    } catch {
      return false;
    }
  }

  status(projectId: string): CompareStatus {
    const e = this.entries.get(projectId);
    const supported = this.supported(projectId);
    if (!e) return { supported, state: "idle", message: "", startedAt: null, baseline: null, before: false, after: false, log: "" };
    return { supported, state: e.state, message: e.message, startedAt: e.startedAt, baseline: e.baseline, before: existsSync(path.join(e.dir, "before.png")), after: existsSync(path.join(e.dir, "after.png")), log: e.log };
  }

  /** The picture of one side, or null while it does not exist. */
  image(projectId: string, which: "before" | "after"): Buffer | null {
    const e = this.entries.get(projectId);
    const file = e && path.join(e.dir, `${which}.png`);
    try {
      return file && existsSync(file) ? readFileSync(file) : null;
    } catch {
      return null;
    }
  }

  /** `baseline` is the snapshot name the "before" side is taken from (the folder right before that task started). */
  start(projectId: string, baseline: string): CompareStatus {
    const current = this.entries.get(projectId);
    if (current?.state === "working") return this.status(projectId);
    if (!this.supported(projectId)) throw new Error("このプロジェクトは、ウィンドウのあるデスクトップアプリではないため、並べて比べられません");
    this.stop(projectId);
    mkdirSync(path.join(os.tmpdir()), { recursive: true });
    const entry: Entry = { state: "working", message: "準備しています…", startedAt: new Date().toISOString(), baseline, dir: mkdtempSync(path.join(os.tmpdir(), "orch-compare-")), token: ++this.seq, log: "", pids: [], temps: [] };
    this.entries.set(projectId, entry);
    void this.run(projectId, entry);
    return this.status(projectId);
  }

  stop(projectId: string): void {
    const e = this.entries.get(projectId);
    if (!e) return;
    this.entries.delete(projectId);
    for (const pid of e.pids) killTree(pid);
    for (const t of [...e.temps, e.dir]) removeDir(t);
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }

  private async run(projectId: string, entry: Entry): Promise<void> {
    const alive = () => this.entries.get(projectId) === entry;
    const fail = (message: string) => {
      if (!alive()) return;
      entry.state = "error";
      entry.message = message;
    };
    const root = projectDir(this.projectsRoot, projectId);
    const side = async (which: "before" | "after", sourceRoot: string, inPlace: boolean): Promise<string | null> => {
      const csproj = findDesktopProject(sourceRoot);
      if (!csproj) return which === "before" ? "この時点には、まだアプリ(ウィンドウのあるプロジェクト)がありませんでした" : "アプリのプロジェクトが見つかりません";
      const procs: { proc: import("node:child_process").ChildProcess; log: () => string; exited: () => boolean }[] = [];
      const res = await startDesktopApp(sourceRoot, csproj, { procs }, { alive, inPlace, settleMs: 6000 });
      for (const p of procs) if (p.proc.pid) entry.pids.push(p.proc.pid);
      entry.temps.push(res.dir);
      entry.log = procs.at(-1)?.log() ?? entry.log;
      if (!alive()) return "停止されました";
      if (!res.ok) return res.reason;
      const shot = await captureWindow(assemblyNameOf(csproj), path.join(entry.dir, `${which}.png`));
      for (const p of procs) killTree(p.proc.pid);
      if (!shot.ok) return shot.reason;
      return null;
    };
    try {
      // before: the folder as it was when the chosen task started
      entry.message = "「作る前」の状態を取り出しています…";
      const beforeDir = mkdtempSync(path.join(os.tmpdir(), "orch-before-"));
      entry.temps.push(beforeDir);
      let beforeProblem: string | null = null;
      try {
        await this.snapshots.exportTo(projectId, `${entry.baseline}-before`, beforeDir);
      } catch (err) {
        beforeProblem = err instanceof Error ? err.message : String(err);
      }
      if (!alive()) return;
      if (!beforeProblem) {
        entry.message = "「作る前」のアプリをビルドして、ウィンドウの画像を撮っています…(1〜数分かかります)";
        beforeProblem = await side("before", beforeDir, true);
      }
      if (!alive()) return;
      entry.message = "「今」のアプリをビルドして、ウィンドウの画像を撮っています…(1〜数分かかります)";
      const afterProblem = await side("after", root, false);
      if (!alive()) return;
      if (afterProblem && beforeProblem) return fail(`どちらも撮れませんでした。作る前: ${beforeProblem} / 今: ${afterProblem}`);
      entry.state = "done";
      entry.message = [beforeProblem && `「作る前」は撮れませんでした: ${beforeProblem}`, afterProblem && `「今」は撮れませんでした: ${afterProblem}`].filter(Boolean).join(" / ") || "撮れました";
    } catch (err) {
      fail(`比べられませんでした: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
