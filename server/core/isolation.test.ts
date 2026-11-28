import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isolationArgs, isolationSettings } from "./isolation.ts";
import { parseSaverCapabilities } from "./tokenSaver.ts";

describe("leaving the user's personal instructions out", () => {
  it("names the personal files only", () => {
    expect(isolationSettings("C:\\Users\\a b\\.claude\\")).toEqual({ claudeMdExcludes: ["C:/Users/a b/.claude/CLAUDE.md", "C:/Users/a b/.claude/rules/**"] });
  });

  it("passes them in a settings file, quoted for a shell", () => {
    const caps = parseSaverCapabilities("  --settings <file-or-json>  Path");
    const [flag, file] = isolationArgs(caps, false);
    expect(flag).toBe("--settings");
    expect(JSON.parse(readFileSync(file, "utf8")).claudeMdExcludes[0]).toMatch(/CLAUDE\.md$/);
    expect(isolationArgs(caps, true)[1]).toBe(`"${file}"`);
  });

  it("adds nothing when the CLI has no --settings", () => {
    expect(isolationArgs(parseSaverCapabilities("  --setting-sources <s>"), false)).toEqual([]);
    expect(isolationArgs(undefined, false)).toEqual([]);
  });
});
