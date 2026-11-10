import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describePrevious, readMarker } from "./aliveMarker.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "alive-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("alive marker", () => {
  it("says nothing when there was no previous server or it exited normally", () => {
    expect(describePrevious(null)).toBeNull();
    expect(describePrevious({ pid: 1, startedAt: "a", aliveAt: "b", exited: true })).toBeNull();
  });

  it("says when a previous server that never marked its exit was last seen", () => {
    const line = describePrevious({ pid: 4242, startedAt: "2026-11-10T16:59:56Z", aliveAt: "2026-11-10T17:05:41Z", exited: false });
    expect(line).toContain("4242");
    expect(line).toContain("2026-11-10T17:05:41Z");
    expect(line).toContain("did not exit normally");
  });

  it("reads a marker file and ignores a missing or broken one", () => {
    const f = path.join(dir, "m.json");
    expect(readMarker(f)).toBeNull();
    writeFileSync(f, "{broken");
    expect(readMarker(f)).toBeNull();
    writeFileSync(f, JSON.stringify({ pid: 7, startedAt: "s", aliveAt: "t" }));
    expect(readMarker(f)).toEqual({ pid: 7, startedAt: "s", aliveAt: "t", exited: false });
  });
});
