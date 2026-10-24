import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectDir } from "./paths.ts";

// SnapshotManager: before/after snapshots of a project folder around each task,
// kept in a shadow git repository (<root>/<projectId>.git, outside the project),
// so the user's own .git is never touched. Gives a per-task diff and rollback.

const EXCLUDES = ["node_modules/", ".git/", "dist/", "build/", "coverage/", ".next/", ".env", ".env.*", "*.log"];
const MAX_PATCH_CHARS = 200_000;

export type TaskDiff = { files: { path: string; status: "added" | "modified" | "deleted" }[]; patch: string; truncated: boolean };

export class SnapshotManager {
  private readonly queues = new Map<string, Promise<unknown>>();

  /** projectsRoot: where projects live; shadow repositories go to <projectsRoot>/../snapshots */
  constructor(private readonly projectsRoot: string, private readonly gitCommand = "git") {}

  private gitDir(projectId: string): string {
    return path.join(path.dirname(path.resolve(this.projectsRoot)), "snapshots", `${projectId}.git`);
  }

  private git(projectId: string, args: string[]): Promise<string> {
    const gitDir = this.gitDir(projectId);
    const workTree = path.resolve(projectDir(this.projectsRoot, projectId));
    const full = ["-c", "core.autocrlf=false", "-c", "core.quotepath=false", "-c", "user.name=orchestrator", "-c", "user.email=orchestrator@localhost", `--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args];
    return new Promise((resolve, reject) => {
      execFile(this.gitCommand, full, { cwd: workTree, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(`git ${args[0]}: ${stderr || err.message}`)) : resolve(stdout)));
    });
  }

  /** Serialises git calls per project (one index). */
  private serial<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(projectId) ?? Promise.resolve()).then(fn, fn);
    this.queues.set(projectId, run.catch(() => undefined));
    return run;
  }

  private async ensureRepo(projectId: string): Promise<void> {
    const dir = this.gitDir(projectId);
    if (existsSync(path.join(dir, "HEAD"))) return;
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.resolve(projectDir(this.projectsRoot, projectId)), { recursive: true });
    await this.git(projectId, ["init", "--quiet"]);
    mkdirSync(path.join(dir, "info"), { recursive: true });
    writeFileSync(path.join(dir, "info", "exclude"), `${EXCLUDES.join("\n")}\n`);
  }

  /** Commits the folder's current state under the ref `name` and returns the commit id. Best effort for the caller. */
  capture(projectId: string, name: string): Promise<string> {
    return this.serial(projectId, async () => {
      await this.ensureRepo(projectId);
      await this.git(projectId, ["add", "-A", "."]);
      await this.git(projectId, ["commit", "--quiet", "--allow-empty", "-m", name]);
      const id = (await this.git(projectId, ["rev-parse", "HEAD"])).trim();
      await this.git(projectId, ["update-ref", `refs/snapshots/${name}`, id]);
      return id;
    });
  }

  has(projectId: string, name: string): Promise<boolean> {
    return this.serial(projectId, async () => {
      if (!existsSync(path.join(this.gitDir(projectId), "HEAD"))) return false;
      try {
        await this.git(projectId, ["rev-parse", "--verify", "--quiet", `refs/snapshots/${name}`]);
        return true;
      } catch {
        return false;
      }
    });
  }

  /** What changed between two captures. */
  diff(projectId: string, from: string, to: string): Promise<TaskDiff> {
    return this.serial(projectId, async () => {
      const a = `refs/snapshots/${from}`;
      const b = `refs/snapshots/${to}`;
      const names = await this.git(projectId, ["diff", "--name-status", "--no-renames", a, b]);
      const files = names
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [code, ...rest] = line.split("\t");
          return { path: rest.join("\t"), status: code === "A" ? ("added" as const) : code === "D" ? ("deleted" as const) : ("modified" as const) };
        });
      const patch = await this.git(projectId, ["diff", "--no-renames", "--no-color", a, b]);
      return { files, patch: patch.slice(0, MAX_PATCH_CHARS), truncated: patch.length > MAX_PATCH_CHARS };
    });
  }

  /**
   * Puts the files that changed between `from` and `to` back to their `from`
   * state (added files are removed). Files the task did not touch are left alone.
   */
  rollback(projectId: string, from: string, to: string): Promise<string[]> {
    return this.serial(projectId, async () => {
      const a = `refs/snapshots/${from}`;
      const b = `refs/snapshots/${to}`;
      const names = (await this.git(projectId, ["diff", "--name-status", "--no-renames", a, b])).split("\n").filter(Boolean);
      const restored: string[] = [];
      for (const line of names) {
        const [code, ...rest] = line.split("\t");
        const file = rest.join("\t");
        if (code === "A") await this.git(projectId, ["rm", "--quiet", "--cached", "--ignore-unmatch", "--", file]).catch(() => undefined);
        if (code === "A") {
          const abs = path.resolve(projectDir(this.projectsRoot, projectId), file);
          const base = path.resolve(projectDir(this.projectsRoot, projectId));
          if (abs.startsWith(base + path.sep)) rmSync(abs, { force: true });
        } else {
          await this.git(projectId, ["checkout", a, "--", file]);
        }
        restored.push(file);
      }
      return restored;
    });
  }
}
