import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { decide, DOWN_MS, MAX_RESTARTS } = createRequire(import.meta.url)("../../electron/watchdog.cjs") as {
  decide: (s: { downSince: number; restarts: number[] }, up: boolean, now: number) => { state: { downSince: number; restarts: number[] }; restart: boolean };
  DOWN_MS: number;
  MAX_RESTARTS: number;
};
const fresh = () => ({ downSince: 0, restarts: [] as number[] });

describe("desktop server watchdog decision", () => {
  it("does nothing while the server is up", () => {
    expect(decide({ downSince: 5, restarts: [] }, true, 100)).toEqual({ state: { downSince: 0, restarts: [] }, restart: false });
  });
  it("waits before restarting, then restarts once", () => {
    const t0 = 1_000_000;
    const first = decide(fresh(), false, t0);
    expect(first.restart).toBe(false);
    expect(decide(first.state, false, t0 + DOWN_MS - 1).restart).toBe(false);
    const go = decide(first.state, false, t0 + DOWN_MS);
    expect(go.restart).toBe(true);
    expect(go.state.downSince).toBe(0);
  });
  it("gives up after the maximum number of restarts in the window, and resumes later", () => {
    let st = fresh();
    let now = 1_000_000;
    let count = 0;
    for (let i = 0; i < 10; i++) {
      now += 1;
      let r = decide(st, false, now);
      st = r.state;
      now += DOWN_MS;
      r = decide(st, false, now);
      st = r.state;
      if (r.restart) count++;
    }
    expect(count).toBe(MAX_RESTARTS);
    // the server has been down all along, so once the window has passed it is restarted at the next check
    expect(decide(st, false, now + 700_000).restart).toBe(true);
  });
});
