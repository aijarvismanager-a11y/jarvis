import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VersionWatch } from "./version.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("VersionWatch", () => {
  it("is stale only once a source file is newer than at boot (tests are ignored)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ver-"));
    dirs.push(dir);
    const src = path.join(dir, "a.ts");
    writeFileSync(src, "x");
    const old = new Date(Date.now() - 60_000);
    utimesSync(src, old, old);
    const watch = new VersionWatch(dir, 0);
    expect(watch.status().stale).toBe(false);
    writeFileSync(path.join(dir, "a.test.ts"), "t"); // a new test file does not matter
    expect(watch.status().stale).toBe(false);
    writeFileSync(src, "changed"); // mtime moves to now
    expect(watch.status().stale).toBe(true);
    expect(watch.status().pid).toBe(process.pid);
  });
});
