import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// the screen's table, read as text: the server's type check does not take in the screen's files
const labels = readFileSync("src/v2/labels.ts", "utf-8");
const table = labels.slice(labels.indexOf("export const EVENT_LABEL"), labels.indexOf("export const eventLabel"));
const EVENT_LABEL = new Set([...table.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]));

describe("the history screen", () => {
  it("has words for every event the server records", () => {
    const names = new Set<string>();
    for (const file of readdirSync("server/core")) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      for (const line of readFileSync(`server/core/${file}`, "utf-8").split("\n")) {
        const at = line.indexOf("appendEvent(");
        if (at < 0) continue;
        const type = /type: ([^,}]+(?:\? "[A-Z_]+" : "[A-Z_]+")?)/.exec(line.slice(at))?.[1] ?? "";
        for (const m of type.matchAll(/"([A-Z]+(?:_[A-Z]+)+)"/g)) names.add(m[1]);
      }
    }
    expect(names.size).toBeGreaterThan(40);
    expect([...names].filter((n) => !EVENT_LABEL.has(n))).toEqual([]);
  });
});
