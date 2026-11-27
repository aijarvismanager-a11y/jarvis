import { describe, expect, it } from "vitest";
import { NO_RECORDS_NOTE, NO_RECORDS_RULE, keepsOtherFiles } from "./fileScope.ts";
import { HISTORY_TASK_KEY, buildPlannerPrompt, finishPlan } from "./planner.ts";
import { singleTaskDraft } from "./smallRequest.ts";
import { planDraftSchema, validatePlan, type PlanDraft } from "./taskGraph.ts";

describe("keepsOtherFiles", () => {
  it.each([
    "README.md に2行追記してください。ほかのファイルは変えないでください。",
    "他のファイルは一切触らないこと",
    "その他のファイルは変更せず、a.js だけ直して",
    "README.md 以外は変更しないで",
    "src/a.js 以外のファイルは書き換えないでください",
    "指定したファイル以外は編集しない",
  ])("takes %s", (text) => expect(keepsOtherFiles([text])).toBe(true));
  it.each([
    "README.md に2行追記してください",
    "a.js を直して。それ以外の動作は変えないで",
    "ほかのファイルは必要なら変更してよい",
    "ほかのファイルは大きく変えないで",
    "ほかのファイルを壊さないように直して",
    "既存のファイルは変更しないで、新しいファイルを作って",
  ])("leaves %s", (text) => expect(keepsOtherFiles([text])).toBe(false));
  it("reads the conditions and the feedback too", () => {
    expect(keepsOtherFiles(["a.js を直して", "他のファイルは変えない", undefined])).toBe(true);
  });
});

const task = (key: string, role: string, expectedOutputs: string[], dependsOn: string[] = []) => ({ key, role, objective: key, inputs: [], expectedOutputs, constraints: [], dependsOn });
const plan: PlanDraft = { summary: "2つに分ける。", tasks: [task("add", "coding", ["README.md"]), task("check", "review", ["_ai-records/x/verify.md"], ["add"])] };
const request = (goal: string) => ({ goal, constraints: [], technologyPreferences: [], existingProject: true });

describe("a plan for a request that keeps other files", () => {
  it("gets no history task and no record file, and says so", () => {
    const out = finishPlan(plan, request("README.md に2行追記して。ほかのファイルは変えないで"));
    expect(out.tasks.map((t) => t.key)).toEqual(["add", "check"]);
    expect(out.tasks.map((t) => t.expectedOutputs)).toEqual([["README.md"], []]);
    expect(out.tasks.every((t) => t.constraints.includes(NO_RECORDS_RULE))).toBe(true);
    expect(out.summary).toContain(NO_RECORDS_NOTE);
    expect(validatePlan(out)).toEqual([]);
  });
  it("keeps a record file the request itself names", () => {
    const out = finishPlan(plan, request("README.md を直して _ai-records/x/verify.md に結果を書いて。他のファイルは変えないで"));
    expect(out.tasks[1]!.expectedOutputs).toEqual(["_ai-records/x/verify.md"]);
  });
  it("is as before otherwise", () => {
    const out = finishPlan(plan, request("README.md に2行追記して"));
    expect(out.tasks.map((t) => t.key)).toEqual(["add", "check", HISTORY_TASK_KEY]);
    expect(out.tasks[1]!.expectedOutputs).toEqual(["_ai-records/x/verify.md"]);
  });
  it("tells the planner, after its general record rules", () => {
    const prompt = buildPlannerPrompt(request("ほかのファイルは変えないで a.js を直して"));
    expect(prompt.indexOf(NO_RECORDS_RULE)).toBeGreaterThan(prompt.indexOf("記録の書き方"));
    expect(buildPlannerPrompt(request("a.js を直して"))).not.toContain(NO_RECORDS_RULE);
  });
  it("a small request is not told to add to the change log", () => {
    const only = singleTaskDraft("a.js を直して。ほかのファイルは変えないで");
    expect(only.tasks[0]!.objective).not.toContain("CHANGELOG など)が既にあれば追記");
    expect(planDraftSchema.safeParse(only).success).toBe(true);
    expect(singleTaskDraft("a.js を直して").tasks[0]!.objective).toContain("CHANGELOG など)が既にあれば追記");
  });
});
