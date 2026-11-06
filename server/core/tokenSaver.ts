// Token saver: every `claude --print` run costs plan quota. Work that is easy runs on a lighter model with less thinking;
// a task that failed once is retried one step higher, so the heavy model is only paid for where the light one was not enough.
// Tool lists (MCP servers) and skills are not loaded either: they are sent with every request and no task uses them.

export type ModelTier = "haiku" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high";
export type ModelChoice = { model: ModelTier; effort: Effort };

export type SaverCapabilities = { model: boolean; effort: boolean; strictMcp: boolean; noSlash: boolean; stableCache?: boolean };

export function parseSaverCapabilities(helpText: string): SaverCapabilities {
  const has = (flag: string) => new RegExp(`(^|[\\s,])${flag.replace(/-/g, "\\-")}(\\s|,|$|=)`, "m").test(helpText);
  return { model: has("--model"), effort: has("--effort"), strictMcp: has("--strict-mcp-config"), noSlash: has("--disable-slash-commands"), stableCache: has("--exclude-dynamic-system-prompt-sections") };
}

const BASE: Record<string, ModelChoice> = {
  // writing code: the middle model does most of it well
  coding: { model: "sonnet", effort: "medium" },
  // text only, from facts the earlier tasks already produced
  document: { model: "haiku", effort: "low" },
  ideation: { model: "haiku", effort: "low" },
  test: { model: "haiku", effort: "low" },
  // reading and judging needs more care than writing it down
  research: { model: "sonnet", effort: "low" },
  analysis: { model: "sonnet", effort: "medium" },
  design: { model: "sonnet", effort: "medium" },
  review: { model: "sonnet", effort: "medium" },
};
const DEFAULT: ModelChoice = { model: "sonnet", effort: "medium" };
const STEP: ModelTier[] = ["haiku", "sonnet", "opus"];

/** The model and effort for a task: its role's base, one step up per earlier failed attempt (at most to opus / high). */
export function chooseModel(role: string, retryCount = 0): ModelChoice {
  const base = BASE[role] ?? DEFAULT;
  if (retryCount <= 0) return base;
  const model = STEP[Math.min(STEP.length - 1, STEP.indexOf(base.model) + retryCount)];
  return { model, effort: model === "opus" || retryCount >= 2 ? "high" : base.effort === "low" ? "medium" : "high" };
}

/** Set AI_ORCH_FULL_POWER=1 to run everything on the CLI's own default model (no saving). */
const disabled = () => process.env.AI_ORCH_FULL_POWER === "1";

export function saverArgs(caps: SaverCapabilities | undefined, choice: ModelChoice | null): string[] {
  if (!caps || disabled()) return [];
  const args: string[] = [];
  if (caps.noSlash) args.push("--disable-slash-commands");
  if (caps.strictMcp) args.push("--strict-mcp-config");
  if (caps.stableCache) args.push("--exclude-dynamic-system-prompt-sections"); // same system prompt across runs -> the prompt cache is reused
  if (choice && caps.model) args.push("--model", choice.model);
  if (choice && caps.effort) args.push("--effort", choice.effort);
  return args;
}
