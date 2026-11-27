import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnRunner } from "./commandRunner.ts";
import { guardProjectsRoot } from "./paths.ts";

describe("guardProjectsRoot", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const setup = () => {
    const app = mkdtempSync(path.join(os.tmpdir(), "orch-guard-"));
    dirs.push(app);
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ type: "module", scripts: { test: "echo PARENT-SUITE-RAN" } }));
    return { app, projects: path.join(app, "projects") };
  };

  it("makes npm test in a project without package.json stop at projects/, not run the suite above", async () => {
    const { projects } = setup();
    guardProjectsRoot(projects);
    const project = path.join(projects, "p1");
    mkdirSync(project);
    const res = await spawnRunner("npm", ["test"], { cwd: project, timeoutMs: 60_000 });
    const out = `${res.stdout}\n${res.stderr}`;
    expect(out).not.toContain("PARENT-SUITE-RAN");
    expect(out).toContain("No test script in this project");
    expect(res.code).not.toBe(0);
  }, 90_000);

  it("copies the module type from above and leaves an existing file alone", () => {
    const { projects } = setup();
    guardProjectsRoot(projects);
    const file = path.join(projects, "package.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ type: "module", private: true });
    writeFileSync(file, "{}");
    guardProjectsRoot(projects);
    expect(readFileSync(file, "utf8")).toBe("{}");
  });
});
