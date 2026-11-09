import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreviewManager, findStaticRoot } from "./previewManager.ts";
import { findBrowserExecutable } from "./browserDriver.ts";

let projectsRoot: string;
let manager: PreviewManager;
beforeEach(() => {
  projectsRoot = mkdtempSync(path.join(os.tmpdir(), "preview-test-"));
  manager = new PreviewManager(projectsRoot, { browserExecutable: null });
});
afterEach(() => {
  manager.stopAll();
  rmSync(projectsRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

const write = (project: string, rel: string, content: string) => {
  const file = path.join(projectsRoot, project, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};
async function until(project: string, pred: (s: ReturnType<PreviewManager["status"]>) => boolean) {
  for (let i = 0; i < 400; i++) {
    const s = manager.status(project);
    if (pred(s)) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${JSON.stringify(manager.status(project))}`);
}

describe("PreviewManager", () => {
  it("serves a plain index.html on a local port and stops cleanly", async () => {
    write("p1", "site/index.html", "<h1>こんにちは</h1>");
    write("p1", "site/style.css", "h1{}");
    expect(manager.status("p1").state).toBe("stopped");
    manager.start("p1");
    const s = await until("p1", (x) => x.state === "running");
    expect(s.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(await (await fetch(s.url!)).text()).toContain("こんにちは");
    expect((await fetch(`${s.url}style.css`)).headers.get("content-type")).toContain("text/css");
    expect((await fetch(`${s.url}nope.html`)).status).toBe(404);
    manager.stop("p1");
    expect(manager.status("p1").state).toBe("stopped");
    await expect(fetch(s.url!)).rejects.toThrow();
  });

  it("does not serve files outside the folder", async () => {
    write("p1", "site/index.html", "ok");
    write("p1", "secret.txt", "secret");
    manager.start("p1");
    const s = await until("p1", (x) => x.state === "running");
    const res = await fetch(`${s.url}..%2Fsecret.txt`);
    expect([403, 404]).toContain(res.status);
    expect(await res.text()).not.toContain("secret");
  });

  it("reports an error, not a hang, when there is nothing to run or dependencies are missing", async () => {
    mkdirSync(path.join(projectsRoot, "empty"), { recursive: true });
    manager.start("empty");
    expect((await until("empty", (x) => x.state === "error")).message).toContain("起動できるものが見つかりません");

    write("nodeps", "package.json", JSON.stringify({ scripts: { dev: "node x.js" }, dependencies: { "left-pad": "*" } })); // declared but not installed
    manager.start("nodeps");
    expect((await until("nodeps", (x) => x.state === "error")).message).toContain("node_modules");
  });

  it("limits how many previews run at once", async () => {
    for (const id of ["a", "b", "c"]) write(id, "index.html", id);
    const limited = new PreviewManager(projectsRoot, { browserExecutable: null, maxPreviews: 2 });
    try {
      limited.start("a");
      limited.start("b");
      expect(() => limited.start("c")).toThrow("同時に動かせる");
      limited.stop("a");
      expect(() => limited.start("c")).not.toThrow();
    } finally {
      limited.stopAll();
    }
  });

  it("starting twice does not start a second copy", async () => {
    write("p1", "index.html", "x");
    const a = manager.start("p1");
    const b = manager.start("p1");
    expect(b.state).toBe(a.state);
    await until("p1", (x) => x.state === "running");
  });
});

describe("findStaticRoot", () => {
  it("prefers the project root, then looks one or two folders down, skipping node_modules", () => {
    write("p", "node_modules/x/index.html", "no");
    expect(findStaticRoot(path.join(projectsRoot, "p"))).toBeNull();
    write("p", "web/public/index.html", "yes");
    expect(findStaticRoot(path.join(projectsRoot, "p"))).toBe(path.join(projectsRoot, "p", "web", "public"));
    write("p", "index.html", "root");
    expect(findStaticRoot(path.join(projectsRoot, "p"))).toBe(path.join(projectsRoot, "p"));
  });
});

describe.skipIf(!findBrowserExecutable())("PreviewManager with dev servers (real browser)", () => {
  it("starts a backend and a vite-style frontend, and reports a blank page from the opened page", async () => {
    write("app", "backend/package.json", JSON.stringify({ scripts: { dev: "node server.js" } }));
    write("app", "backend/node_modules/.keep", "");
    write("app", "backend/server.js", `require("http").createServer((q, r) => { r.setHeader("Access-Control-Allow-Origin", "*"); r.setHeader("content-type", "application/json"); r.end('{"items":[1]}'); }).listen(Number(process.env.PORT));`);
    write("app", "frontend/package.json", JSON.stringify({ scripts: { dev: "node server.js" }, devDependencies: { vite: "*" } }));
    write("app", "frontend/node_modules/.keep", "");
    write(
      "app",
      "frontend/server.js",
      `const port = Number(process.argv[process.argv.indexOf("--port") + 1]); const api = process.env.VITE_API_PROXY_TARGET;
const html = '<!doctype html><div id="root"></div><script>fetch("' + api + '/api/x").then(r => r.json()).then(d => { document.getElementById("root").innerHTML = d.map(i => "<p>" + i + "</p>").join(""); });</script>';
require("http").createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(html); }).listen(port);`,
    );
    const withBrowser = new PreviewManager(projectsRoot);
    try {
      withBrowser.start("app");
      for (let i = 0; i < 600 && !withBrowser.status("app").check; i++) await new Promise((r) => setTimeout(r, 100));
      const s = withBrowser.status("app");
      expect(s.state).toBe("running");
      expect(s.check?.ok).toBe(false);
      expect(s.check?.problems.join("\n")).toContain("d.map is not a function");
    } finally {
      withBrowser.stopAll();
    }
  }, 120_000);
});

describe("desktop app preview", () => {
  it("finds the windowed app's project, not a test or library project", async () => {
    const { findDesktopProject } = await import("./desktopPreview.ts");
    write("d", "src/App/App.csproj", "<Project><PropertyGroup><OutputType>WinExe</OutputType><UseWPF>true</UseWPF></PropertyGroup></Project>");
    write("d", "src/Lib/Lib.csproj", "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>");
    write("d", "tests/App.Tests/App.Tests.csproj", "<Project><PropertyGroup><OutputType>WinExe</OutputType></PropertyGroup></Project>");
    write("d", "src/App/bin/Debug/Old.csproj", "<Project><PropertyGroup><OutputType>WinExe</OutputType></PropertyGroup></Project>");
    const hit = findDesktopProject(path.join(projectsRoot, "d"));
    expect(hit && path.relative(path.join(projectsRoot, "d"), hit).split(path.sep).join("/")).toBe("src/App/App.csproj");
    write("web", "package.json", "{}");
    expect(findDesktopProject(path.join(projectsRoot, "web"))).toBeNull();
  });
});

describe("desktop before/after", () => {
  it("is offered only for a windowed desktop app", async () => {
    const { DesktopCompare } = await import("./desktopCompare.ts");
    const { SnapshotManager } = await import("./snapshotManager.ts");
    const dc = new DesktopCompare(projectsRoot, new SnapshotManager(projectsRoot));
    write("web2", "package.json", "{}");
    write("win2", "src/App/App.csproj", "<Project><PropertyGroup><OutputType>WinExe</OutputType></PropertyGroup></Project>");
    expect(dc.supported("web2")).toBe(false);
    expect(dc.supported("win2")).toBe(process.platform === "win32");
    expect(dc.status("web2").state).toBe("idle");
    expect(() => dc.start("web2", "x-1")).toThrow(/デスクトップアプリではない/);
  });
});
