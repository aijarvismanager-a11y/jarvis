import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnRunner, type CommandRunner } from "./commandRunner.ts";
import { SKIP_DIRS } from "./projectImport.ts";
import { projectDir } from "./paths.ts";

// Importing a folder leaves node_modules behind, so the preview cannot start. This installs the
// dependencies of every package.json that has some and no node_modules yet. It runs only when the
// user asks (it downloads packages and runs the project's own install scripts).

const MAX_DEPTH = 3;
const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** Project-relative folders ("." = the root) with dependencies in package.json but no node_modules. */
export function missingInstalls(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    const pkgFile = path.join(dir, "package.json");
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, "utf-8")) as { dependencies?: object; devDependencies?: object };
        const has = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length > 0;
        if (has && !existsSync(path.join(dir, "node_modules"))) out.push(path.relative(root, dir).replace(/\\/g, "/") || ".");
      } catch {
        /* an unreadable package.json is not something to install */
      }
    }
    if (depth >= MAX_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
  };
  if (existsSync(root)) walk(root, 0);
  return out;
}

export type InstallStatus = { state: "idle" | "installing" | "done" | "error"; message: string; log: string; startedAt: string | null };
const IDLE: InstallStatus = { state: "idle", message: "", log: "", startedAt: null };

export class DepsInstaller {
  private readonly status_ = new Map<string, InstallStatus>();

  constructor(
    private readonly projectsRoot: string,
    private readonly run: CommandRunner = spawnRunner,
  ) {}

  status(projectId: string): InstallStatus {
    return this.status_.get(projectId) ?? IDLE;
  }

  missing(projectId: string): string[] {
    return missingInstalls(projectDir(this.projectsRoot, projectId));
  }

  /** Starts installing in the background and returns at once; the caller polls status(). */
  start(projectId: string): InstallStatus {
    if (this.status(projectId).state === "installing") return this.status(projectId);
    const dirs = this.missing(projectId);
    if (dirs.length === 0) throw new Error("インストールが必要なフォルダはありません");
    const st: InstallStatus = { state: "installing", message: "インストールしています…", log: "", startedAt: new Date().toISOString() };
    this.status_.set(projectId, st);
    void this.install(projectId, dirs, st);
    return st;
  }

  private async install(projectId: string, dirs: string[], st: InstallStatus): Promise<void> {
    const root = projectDir(this.projectsRoot, projectId);
    try {
      for (const rel of dirs) {
        st.message = `${rel === "." ? "プロジェクト直下" : rel} にインストールしています…`;
        const r = await this.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(root, rel), timeoutMs: INSTALL_TIMEOUT_MS });
        st.log = `${st.log}${st.log ? "\n---\n" : ""}${(r.stdout + r.stderr).slice(-1500)}`.slice(-3000);
        if (r.timedOut) throw new Error(`${rel} のインストールが時間切れになりました`);
        if (r.code !== 0) throw new Error(`${rel} のインストールに失敗しました(npm install が終了コード ${r.code})`);
      }
      st.state = "done";
      st.message = "インストールが完了しました。「起動して見る」を押せます。";
    } catch (err) {
      st.state = "error";
      st.message = err instanceof Error ? err.message : String(err);
    }
  }
}
