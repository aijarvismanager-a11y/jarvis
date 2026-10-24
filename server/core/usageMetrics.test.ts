import { describe, expect, it } from "vitest";
import { parseRunMetrics } from "./claudeCodeExecutor.ts";
import { openDatabase } from "./db.ts";
import { Store } from "./store.ts";
import { MissionEngine } from "./missionEngine.ts";

describe("parseRunMetrics", () => {
  it("reads cost and tokens from a stream-json result event", () => {
    const out = [
      JSON.stringify({ type: "assistant", message: {} }),
      JSON.stringify({ type: "result", result: "ok", total_cost_usd: 0.42, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 } }),
    ].join("\n");
    expect(parseRunMetrics(out)).toEqual({ costUsd: 0.42, inputTokens: 1000, outputTokens: 50 });
  });
  it("reads the single JSON envelope and tolerates plain text", () => {
    expect(parseRunMetrics(JSON.stringify({ result: "x", total_cost_usd: 1, usage: { output_tokens: 5 } }))).toEqual({ costUsd: 1, inputTokens: undefined, outputTokens: 5 });
    expect(parseRunMetrics("just text")).toEqual({});
  });
});

describe("engine records run metrics", () => {
  it("stores duration (measured) and cost (reported) on the ai run", async () => {
    const db = openDatabase(":memory:");
    const store = new Store(db, "unused");
    store.createProject({ id: "p", name: "p" });
    const engine = new MissionEngine(store, {
      planner: { name: "x", plan: async () => ({ summary: "", tasks: [] }) },
      executor: { name: "e", execute: async () => { await new Promise((r) => setTimeout(r, 20)); return { ok: true, costUsd: 0.5, inputTokens: 10, outputTokens: 2 }; } },
    });
    const m = engine.startFixedMission({ projectId: "p", goal: "g", draft: { summary: "", tasks: [{ key: "a", role: "research", objective: "a", inputs: [], expectedOutputs: [], constraints: [], dependsOn: [] }] } });
    await engine.run("p", m.id);
    const run = store.listAiRuns("p")[0] as { duration_ms: number; cost_usd: number; input_tokens: number; output_tokens: number };
    expect(run.duration_ms).toBeGreaterThanOrEqual(15);
    expect(run.cost_usd).toBe(0.5);
    expect([run.input_tokens, run.output_tokens]).toEqual([10, 2]);
    db.close();
  });
});
