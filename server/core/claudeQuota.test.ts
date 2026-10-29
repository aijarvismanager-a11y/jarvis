import { describe, expect, it } from "vitest";
import { parseRateLimit } from "./claudeQuota.ts";

const line = (info: object) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });

describe("Claude plan usage", () => {
  it("reads both windows from the newest rate_limit_event", () => {
    const out = [
      '{"type":"system"}',
      line({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1793286600 }, seven_day: { utilization: 0.05, resetsAt: 1793754000 } } }),
      line({ status: "allowed_warning", unifiedWindows: { five_hour: { utilization: 0.13, resetsAt: 1793286600 }, seven_day: { utilization: 0.09, resetsAt: 1793754000 } } }),
      '{"type":"result"}',
    ].join("\n");
    const q = parseRateLimit(out, new Date("2026-10-29T12:00:00Z"))!;
    expect(q.status).toBe("allowed_warning");
    expect(q.fiveHour?.utilization).toBe(0.13);
    expect(q.sevenDay?.utilization).toBe(0.09);
    expect(q.fiveHour?.resetsAt).toBe(new Date(1793286600 * 1000).toISOString());
    expect(q.checkedAt).toBe("2026-10-29T12:00:00.000Z");
  });

  it("falls back to the single window an older CLI reports, and ignores output without the event", () => {
    const q = parseRateLimit(line({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1793286600 }))!;
    expect(q.status).toBe("rejected");
    expect(q.fiveHour?.utilization).toBeNull();
    expect(q.fiveHour?.resetsAt).not.toBeNull();
    expect(q.sevenDay).toBeNull();
    expect(parseRateLimit('{"type":"result"}')).toBeNull();
    expect(parseRateLimit("rate_limit_event but not json")).toBeNull();
  });
});
