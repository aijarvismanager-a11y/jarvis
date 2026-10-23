import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppSmokeTester, detectApps } from "./appSmokeTest.ts";
import { findBrowserExecutable } from "./browserDriver.ts";
import { ProjectValidator, isIntegrationTask } from "./taskValidator.ts";
import type { Task } from "./store.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "smoke-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));

const write = (rel: string, content: string) => {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

/** A backend answering GET /api/items with `body`, and a "vite" frontend whose page renders items.map(...). */
function fixture(body: string) {
  write("backend/package.json", JSON.stringify({ scripts: { dev: "node server.js" } }));
  write("backend/node_modules/.keep", "");
  write(
    "backend/server.js",
    `require("http").createServer((req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("content-type", "application/json"); res.end(${JSON.stringify(body)}); }).listen(Number(process.env.PORT));`,
  );
  write("frontend/package.json", JSON.stringify({ scripts: { dev: "node server.js" }, devDependencies: { vite: "*" } }));
  write("frontend/node_modules/.keep", "");
  write(
    "frontend/server.js",
    `const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const api = process.env.VITE_API_PROXY_TARGET;
const html = '<!doctype html><div id="root"></div><script>fetch("' + api + '/api/items").then(r => r.json()).then(items => { document.getElementById("root").innerHTML = items.map(i => "<p>" + i + "</p>").join("") || "empty list"; });</script>';
require("http").createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(html); }).listen(port);`,
  );
}

describe("detectApps", () => {
  it("classifies vite packages as frontend and the rest as backend, skipping node_modules", () => {
    fixture("[]");
    write("backend/node_modules/dep/package.json", JSON.stringify({ scripts: { start: "x" } }));
    expect(detectApps(root).map((a) => `${a.kind}:${path.basename(a.dir)}`).sort()).toEqual(["backend:backend", "frontend:frontend"]);
  });
});

describe("isIntegrationTask", () => {
  it("only matches code tasks that wire the pieces together", () => {
    expect(isIntegrationTask({ role: "coding", objective: "フロントエンドとバックエンドAPIを結合し、動作するアプリとして統合する" })).toBe(true);
    expect(isIntegrationTask({ role: "coding", objective: "商品一覧画面を実装する" })).toBe(false);
    expect(isIntegrationTask({ role: "research", objective: "結合方式を調査する" })).toBe(false);
  });
});

describe("ProjectValidator integration gate", () => {
  const task = (objective: string) => ({ id: "t1", projectId: "p1", role: "coding", objective, expectedOutputs: [], constraints: [] }) as unknown as Task;
  const validator = (status: "passed" | "failed" | "skipped") => new ProjectValidator(root, { runTests: false, smoke: { run: async () => ({ status, detail: "d" }) } });
  const result = { ok: true, artifacts: [] as string[] };

  beforeEach(() => write("p1/a.json", "{}"));

  it("fails the integration task at level 4 with the smoke test's findings", async () => {
    const v = await validator("failed").validate({ ...task("フロントとバックを結合する"), expectedOutputs: ["a.json"] }, result);
    expect(v).toMatchObject({ passed: false, level: 4, detail: "d" });
  });

  it("does not run for other tasks, and a skipped check does not fail the task", async () => {
    const plain = await validator("failed").validate({ ...task("画面を実装する"), expectedOutputs: ["a.json"] }, result);
    expect(plain.passed).toBe(true);
    const skipped = await validator("skipped").validate({ ...task("フロントとバックを結合する"), expectedOutputs: ["a.json"] }, result);
    expect(skipped).toMatchObject({ passed: true });
    expect(skipped.detail).toContain("未実施");
  });
});

describe.skipIf(!findBrowserExecutable())("AppSmokeTester (real browser)", () => {
  it("fails with the page's own error when the frontend cannot use the API's response", async () => {
    fixture('{"items":["a"]}');
    const r = await new AppSmokeTester().run(root);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("items.map is not a function");
  }, 120_000);

  it("passes when the frontend and backend agree", async () => {
    fixture('["a","b"]');
    const r = await new AppSmokeTester().run(root);
    expect(r).toMatchObject({ status: "passed" });
  }, 120_000);

  it("is skipped, not failed, when nothing can be shown", async () => {
    write("lib/package.json", JSON.stringify({ scripts: { dev: "node x.js" } }));
    expect((await new AppSmokeTester().run(root)).status).toBe("skipped");
  }, 30_000);
});
