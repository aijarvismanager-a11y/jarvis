import { extractPlanJson } from "./planner.ts";
import { isHistoryFile } from "./missionReport.ts";
import { isGeneratedFile } from "./projectContext.ts";
import type { Store } from "./store.ts";

// Acceptance check: after a request has finished, a second look at "did the result give the person what they asked for?".
// The ordinary checks (build, tests, syntax) say the work RUNS; this one lists what the request asked for, one wish at a time,
// and marks each as met / partly / not met / cannot tell, with the evidence it found. It never edits files.

export type AcceptanceStatus = "met" | "partial" | "unmet" | "unknown";
export type AcceptanceItem = { requirement: string; status: AcceptanceStatus; evidence: string; fix?: string };
export type Acceptance = { missionId: string; at: string; items: AcceptanceItem[]; summary: string; score: number | null };

export type AcceptanceInput = {
  goal: string;
  tasks: { n: number; role: string; objective: string; status: string; summary: string; checks: string | null; files: { path: string; excerpt: string }[] }[];
};

const STATUSES: AcceptanceStatus[] = ["met", "partial", "unmet", "unknown"];
export const acceptanceKey = (missionId: string) => `acceptance:${missionId}`;

const PER_FILE = 6000;
const TOTAL_BUDGET = 48_000;

/** A file's text shortened to `max` characters: a long file keeps its start and its END (a report's conclusion and a log's result are at the bottom). */
export function excerptOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 30) / 2);
  return `${text.slice(0, half)}
…(中略 ${text.length - half * 2} 文字)…
${text.slice(text.length - half)}`;
}

/** What the check gets to read: the request, each task's own words about what it did, the checks that passed, and the start of each deliverable. */
export function gatherAcceptanceInput(store: Store, projectId: string, missionId: string, readArtifact: (rel: string) => string | null): AcceptanceInput {
  const mission = store.getMission(projectId, missionId);
  if (!mission) throw new Error("依頼が見つかりません");
  const tasks = store.listTasks(projectId).filter((t) => t.missionId === missionId).sort((a, b) => a.position - b.position);
  const ids = new Set(tasks.map((t) => t.id));
  const runs = store.listAiRuns(projectId).filter((r) => r.task_id && ids.has(String(r.task_id)) && r.status === "succeeded" && r.executor !== "ai-review");
  const validations = store.listValidations(projectId).filter((v) => ids.has(String(v.task_id)) && v.status === "passed");
  const artifacts = store.listArtifacts(projectId).filter((a) => a.taskId && ids.has(a.taskId));
  let budget = TOTAL_BUDGET;
  return {
    goal: mission.goal,
    tasks: tasks.map((t, i) => {
      const run = [...runs].filter((r) => r.task_id === t.id).pop();
      const check = [...validations].filter((v) => v.task_id === t.id).pop();
      const paths = [...new Set(artifacts.filter((a) => a.taskId === t.id).map((a) => a.path))].filter((p) => !isHistoryFile(p) && !isGeneratedFile(p)).sort((x, y) => Number(/\.(md|txt)$/i.test(y)) - Number(/\.(md|txt)$/i.test(x))).slice(0, 5);
      const files = paths.flatMap((path) => {
        if (budget <= 0) return [];
        const text = readArtifact(path);
        if (!text) return [];
        const excerpt = excerptOf(text, Math.min(PER_FILE, budget));
        budget -= excerpt.length;
        return [{ path, excerpt }];
      });
      return { n: i + 1, role: t.role, objective: t.objective.slice(0, 500), status: t.status, summary: String(run?.summary ?? "").slice(0, 800), checks: check?.detail ? String(check.detail).slice(0, 300) : null, files };
    }),
  };
}

export function buildAcceptancePrompt(input: AcceptanceInput): string {
  const work = input.tasks
    .map((t) => [`■ 作業${t.n}(${t.role}・${t.status}): ${t.objective}`, t.summary && `  実行結果の要約: ${t.summary}`, t.checks && `  自動チェック: ${t.checks}`, ...t.files.map((f) => `  成果物 ${f.path}:\n${f.excerpt.replace(/^/gm, "    ")}`)].filter(Boolean).join("\n"))
    .join("\n\n");
  return [
    "あなたは受け入れ検査の担当です。次の「依頼」を出した人が、完成品を受け取ったとき満足できるかを判定します。",
    "手順: (1)依頼文から、その人が望んでいること(機能・内容・条件・形式)を3〜10個の短い項目に分ける。依頼に書かれていない項目は作らない。(2)各項目が、下の「作業の記録」で満たされているかを判定する。",
    "判定は met(満たしている)/ partial(一部だけ)/ unmet(満たしていない)/ unknown(記録からは判断できない)のどれか。記録に根拠が見つからないものを met にしない。根拠は、作業番号や成果物のファイル名と一緒に1文で書く。",
    "unmet / partial の項目には、直すために頼むとよい一言(fix)も付ける。",
    'JSONだけを出力する: {"summary":"全体の所見を1〜2文","items":[{"requirement":"…","status":"met","evidence":"…","fix":"…"}]}。前置きや説明は付けない。ファイルは変更しない。',
    "",
    "【依頼】",
    input.goal.slice(0, 4000),
    "",
    "【作業の記録】",
    work,
  ].join("\n");
}

export function parseAcceptance(stdout: string, missionId: string, now = new Date()): Acceptance {
  const data = extractPlanJson(stdout) as { summary?: unknown; items?: unknown } | undefined;
  const raw = Array.isArray(data?.items) ? data.items : [];
  const items: AcceptanceItem[] = [];
  for (const r of raw.slice(0, 12)) {
    const o = r as Record<string, unknown>;
    const requirement = typeof o?.requirement === "string" ? o.requirement.trim() : "";
    if (!requirement) continue;
    const status = STATUSES.includes(o.status as AcceptanceStatus) ? (o.status as AcceptanceStatus) : "unknown";
    items.push({ requirement: requirement.slice(0, 200), status, evidence: typeof o.evidence === "string" ? o.evidence.trim().slice(0, 400) : "", ...(typeof o.fix === "string" && o.fix.trim() ? { fix: o.fix.trim().slice(0, 300) } : {}) });
  }
  return { missionId, at: now.toISOString(), items, summary: typeof data?.summary === "string" ? data.summary.trim().slice(0, 400) : "", score: acceptanceScore(items) };
}

/** 0-100: met counts fully, partial half, unknown is left out of the denominator's credit (counts as 0); null when there is nothing to score. */
export function acceptanceScore(items: AcceptanceItem[]): number | null {
  if (items.length === 0) return null;
  const pts = items.reduce((s, i) => s + (i.status === "met" ? 1 : i.status === "partial" ? 0.5 : 0), 0);
  return Math.round((pts / items.length) * 100);
}

export type AcceptanceRunner = { exec(prompt: string, choice: { model: "haiku" | "sonnet" | "opus"; effort: "low" | "medium" | "high" }, timeoutMs: number): Promise<string> };

/** Runs the check and stores the result (settings, keyed by request). Throws when the AI gives nothing usable. */
export async function runAcceptance(store: Store, runner: AcceptanceRunner, projectId: string, missionId: string, readArtifact: (rel: string) => string | null): Promise<Acceptance> {
  const input = gatherAcceptanceInput(store, projectId, missionId, readArtifact);
  if (input.tasks.length === 0) throw new Error("この依頼には、検査する作業がありません");
  const stdout = await runner.exec(buildAcceptancePrompt(input), { model: "sonnet", effort: "low" }, 4 * 60_000);
  const result = parseAcceptance(stdout, missionId);
  if (result.items.length === 0) throw new Error("希望のチェックを作れませんでした。もう一度試してください");
  store.setSetting(acceptanceKey(missionId), result);
  store.appendEvent({ projectId, type: "ACCEPTANCE_CHECKED", payload: { missionId, score: result.score, unmet: result.items.filter((i) => i.status === "unmet").length } });
  return result;
}

export function loadAcceptance(store: Store, missionId: string): Acceptance | null {
  return store.getSetting<Acceptance | null>(acceptanceKey(missionId), null);
}
