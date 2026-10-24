import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DepsInstaller, missingInstalls } from "./depsInstaller.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function projects() {
  const root = mkdtempSync(path.join(os.tmpdir(), "deps-"));
  roots.push(root);
  const proj = path.join(root, "p1");
  mkdirSync(path.join(proj, "web"), { recursive: true });
  mkdirSync(path.join(proj, "api"), { recursive: true });
  mkdirSync(path.join(proj, "api", "node_modules"));
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "root" })); // no dependencies: nothing to install
  writeFileSync(path.join(proj, "web", "package.json"), JSON.stringify({ devDependencies: { vite: "^5" } }));
  writeFileSync(path.join(proj, "api", "package.json"), JSON.stringify({ dependencies: { express: "^4" } })); // already installed
  return { root, proj };
}

const settle = async (installer: DepsInstaller) => {
  for (let i = 0; i < 100 && installer.status("p1").state === "installing"; i++) await new Promise((r) => setTimeout(r, 10));
};

describe("dependency install", () => {
  it("finds the folders that have dependencies but no node_modules", () => {
    const { proj } = projects();
    expect(missingInstalls(proj)).toEqual(["web"]);
  });

  it("installs in the background, reports progress, and failures", async () => {
    const { root, proj } = projects();
    const calls: string[] = [];
    let code: number | null = 0;
    const installer = new DepsInstaller(root, async (cmd, args, opts) => {
      calls.push(`${cmd} ${args[0]} @ ${path.basename(opts.cwd ?? "")}`);
      mkdirSync(path.join(opts.cwd!, "node_modules"), { recursive: true });
      return { stdout: "added 3 packages", stderr: "", code };
    });
    expect(installer.start("p1").state).toBe("installing");
    await settle(installer);
    expect(installer.status("p1").state).toBe("done");
    expect(calls).toEqual(["npm install @ web"]);
    expect(missingInstalls(proj)).toEqual([]);
    expect(() => installer.start("p1")).toThrow(); // nothing left to install

    rmSync(path.join(proj, "web", "node_modules"), { recursive: true });
    code = 1;
    installer.start("p1");
    await settle(installer);
    expect(installer.status("p1").state).toBe("error");
    expect(installer.status("p1").message).toContain("失敗");
  });
});
