import { describe, expect, it } from "vitest";
import { nearbyProbes, parseProbeLog, probeLogLine } from "./explorerWatch.ts";

const T = Date.parse("2026-11-12T11:12:45.000Z");
const iso = (offSec: number) => new Date(T + offSec * 1000).toISOString();

describe("explorer crash watch", () => {
  it("parses the probe log and skips bad lines", () => {
    const log = parseProbeLog(`${probeLogLine({ cmd: "shot", start: iso(-5), end: iso(-3) })}garbage\n{"cmd":1}\n${probeLogLine({ cmd: "launch", start: iso(-9) })}`);
    expect(log.map((p) => p.cmd)).toEqual(["shot", "launch"]);
    expect(log[1]!.endMs).toBeNull();
  });
  it("finds the commands that ran at or shortly before the crash, with seconds relative to it", () => {
    const log = parseProbeLog([
      probeLogLine({ cmd: "shot", start: iso(-30), end: iso(-20) }),
      probeLogLine({ cmd: "keys", start: iso(-2), end: iso(4) }),
      probeLogLine({ cmd: "old", start: iso(-600), end: iso(-590) }),
      probeLogLine({ cmd: "later", start: iso(10), end: iso(12) }),
    ].join(""));
    const near = nearbyProbes(T, log);
    expect(near.map((p) => p.cmd)).toEqual(["shot", "keys"]);
    expect(near[0]).toMatchObject({ startSec: -30, endSec: -20, during: false });
    expect(near[1]).toMatchObject({ startSec: -2, endSec: 4, during: true });
  });
  it("treats a command with no end line as still running", () => {
    expect(nearbyProbes(T, parseProbeLog(probeLogLine({ cmd: "launch", start: iso(-8) })))[0]!.during).toBe(true);
  });
});
