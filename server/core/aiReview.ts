import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { botCheckExclusions } from "./botCheck.ts";
import { aiUsage, chooseAi, pickBalanced } from "./aiBroker.ts";
import type { ExecutionResult } from "./missionEngine.ts";
import { resolveInProject } from "./paths.ts";
import { referenceBudget } from "./projectContext.ts";
import { isIntegrationTask } from "./taskValidator.ts";
import type { AiService, Mission, Store, Task } from "./store.ts";
import { WEB_ADAPTER_TYPES } from "./webHandoff.ts";
import { getWebAiSettings, resolveSiteProfile } from "./webAiSites.ts";

// AI B Review (spec §57): "AI A -> Validation -> insufficient -> AI B Review. Only important tasks get an extra review."
// It is the sixth validation level (§31, "AI Review"): after a task passed the ordinary checks, a DIFFERENT AI reads the
// files the task produced and answers "判定: 承認" or "判定: 要修正". A "要修正" fails the validation with the findings as
// the reason, so the existing self-repair (the next attempt is told why the last one failed) applies them - once per task.
// The review only ever uses AIs that run fully automatically (Level 3) and never blocks the mission: when no suitable AI
// is available, or the AI breaks, the review is skipped and the task goes on as if it had passed.

export const AI_REVIEW_LEVEL = 6;
/** How many times a review may send a task back. After that its remaining findings are only recorded. */
export const MAX_REVIEW_REVISIONS = 1;
export const REVIEW_DIR = "_ai-records/reviews";

const SETTING_KEY = "ai_review";
export type AiReviewSettings = { enabled: boolean };
export const getAiReviewSettings = (store: Store): AiReviewSettings => ({ enabled: store.getSetting<Partial<AiReviewSettings>>(SETTING_KEY, {}).enabled !== false });
export const setAiReviewSettings = (store: Store, patch: Partial<AiReviewSettings>): AiReviewSettings => {
  const next = { ...getAiReviewSettings(store), ...patch };
  store.setSetting(SETTING_KEY, next);
  return next;
};

/** Anything that can put a prompt to a web AI by itself and bring the answer back (WebAiExecutor does). */
export interface AiReviewer {
  ask(input: { svc: AiService; prompt: string; task: Task; signal: AbortSignal }): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
}

/** Which maker an AI belongs to: a review by the same maker is not a second opinion. */
export function aiFamily(aiId: string): string {
  const id = aiId.toLowerCase();
  if (id.startsWith("claude")) return "claude";
  if (/^(chatgpt|openai|gpt)/.test(id)) return "openai";
  if (/^(gemini|google)/.test(id)) return "google";
  return id;
}

const DESIGN_ROLES = new Set(["design", "architecture", "security", "deploy", "ui design"]);
const CODE_ROLES = new Set(["coding", "code", "implementation", "implement", "frontend", "backend", "database", "refactor", "refactoring", "integration", "fix", "bugfix"]);
/** Code tasks with at least this many files count as big. */
const BIG_TASK_FILES = 5;

/** Why a task is important enough for a second AI's review; null when it is not. Reviews, research, documents and tests never are. */
export function importanceOf(task: Pick<Task, "role" | "objective" | "retryCount">, changedFiles: number): string | null {
  const role = task.role.trim().toLowerCase();
  if (DESIGN_ROLES.has(role)) return "設計・安全性・公開に関わる作業";
  if (!CODE_ROLES.has(role)) return null;
  if (isIntegrationTask(task)) return "画面と処理をつなぐ結合の作業";
  if (task.retryCount > 0) return "やり直しが必要だった作業";
  if (changedFiles >= BIG_TASK_FILES) return "変更するファイルが多い作業";
  return null;
}

/** What a reviewer should be good at: code is judged by AIs that are good at code, everything else as a second opinion on a text. */
export const reviewCapabilityFor = (role: string): string => (CODE_ROLES.has(role.trim().toLowerCase()) ? "coding" : "ux_review");

/**
 * The AI of ANOTHER maker that reviews: of those that run fully automatically right now, the best ones for this kind of work take
 * turns (the least used lately goes first); null when there is none.
 */
export function pickReviewer(store: Store, authorAiId: string | null, role: string, seed?: string): { svc: AiService; ranked: string[] } | null {
  const web = getWebAiSettings(store);
  if (!web.enabled) return null;
  const author = aiFamily(authorAiId ?? "claude-code");
  const services = store.listAiServices();
  const sameMaker = services.filter((s) => aiFamily(s.id) === author).map((s) => s.id);
  const decision = chooseAi(services, reviewCapabilityFor(role), { budgetPolicy: "free_only", executableAdapters: [...WEB_ADAPTER_TYPES], excludeAiIds: sameMaker, restingAis: botCheckExclusions(store, services.map((s) => s.id)) });
  const usable = decision.ranked.filter((c) => {
    const s = services.find((x) => x.id === c.aiId);
    return !!s && s.automationLevel >= 3 && web.loggedIn[s.id] === true && !!s.url && resolveSiteProfile(store, s.id) !== null;
  });
  const { pick } = pickBalanced(usable, aiUsage(store), seed);
  const svc = pick ? services.find((s) => s.id === pick.aiId) : undefined;
  return svc ? { svc, ranked: [svc.id, ...usable.map((c) => c.aiId).filter((id) => id !== svc.id)] } : null;
}

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".yaml", ".yml", ".py", ".sql", ".sh"]);
// What a chat page takes in one prompt comfortably (the free tiers handle far more, but typing it in takes time).
const MAX_FILE_CHARS = 10_000;
const MAX_TOTAL_CHARS = 24_000;

/** The text of the files a task produced, shortened to what a chat page can take. */
export function readTaskFiles(store: Store, task: Task): { path: string; text: string; cut: boolean }[] {
  const out: { path: string; text: string; cut: boolean }[] = [];
  let total = 0;
  const paths = [...new Set(store.listArtifacts(task.projectId).filter((a) => a.taskId === task.id && !a.path.startsWith(`${REVIEW_DIR}/`)).map((a) => a.path))];
  for (const rel of paths) {
    if (total >= MAX_TOTAL_CHARS) break;
    if (!TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    try {
      const abs = resolveInProject(store.projectsRoot, task.projectId, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) continue;
      const raw = readFileSync(abs, "utf8");
      const room = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - total);
      out.push({ path: rel, text: raw.slice(0, room), cut: raw.length > room });
      total += Math.min(raw.length, room);
    } catch {
      /* unreadable: leave it out */
    }
  }
  return out;
}

export function buildReviewPrompt(input: { task: Task; mission: Mission; author: string; files: { path: string; text: string; cut: boolean }[] }): string {
  const { task, mission, author, files } = input;
  const lines = [
    "あなたは、別のAIが作った成果物を点検する「第二のレビュアー」です。",
    `【依頼の全体】${mission.goal}`,
    `【点検する作業】(${task.role}) ${task.objective}`,
    `【担当したAI】${author}`,
  ];
  if (task.expectedOutputs.length) lines.push(`【期待された成果物】${task.expectedOutputs.join(" / ")}`);
  if (task.constraints.length) lines.push(`【守るべき条件】${task.constraints.join(" / ")}`);
  lines.push("", "【成果物】");
  for (const f of files) lines.push(`=== ${f.path} ===`, f.text, f.cut ? "…(長いため、ここまでを載せています)" : "", "");
  // A file that was cut must not become a finding of its own ("the code is incomplete"): the reviewer judges what it can see.
  if (files.some((f) => f.cut)) lines.push("【注意】長いファイルは、途中までしか載せていません。省略されていること自体は指摘せず、載っている範囲の内容だけで判断してください。", "");
  lines.push(
    "【お願い】",
    "・1行目に必ず「判定: 承認」または「判定: 要修正」と書いてください。",
    "・要修正のときは、事実の誤り、依頼や条件への不適合、バグ、安全性の問題など「直さないと困る点」だけを、重要な順に最大5件、箇条書き(どこが・なぜ問題か・どう直すか)で書いてください。好みや軽微な改善は書かないでください。",
    "・問題がなければ「判定: 承認」と、短い理由だけを書いてください。",
    "・Markdownで、簡潔に答えてください。",
  );
  return lines.join("\n");
}

export type Verdict = { verdict: "approve" | "revise" | "unknown"; findings: string };

export function parseVerdict(text: string): Verdict {
  const findings = text.trim().slice(0, 3000);
  const marked = /判定\s*[:：]\s*\**\s*(承認|要修正)/.exec(text);
  if (marked) return { verdict: marked[1] === "承認" ? "approve" : "revise", findings };
  if (/要修正/.test(text) && !/承認/.test(text)) return { verdict: "revise", findings };
  if (/承認/.test(text) && !/要修正/.test(text)) return { verdict: "approve", findings };
  return { verdict: "unknown", findings };
}

type ReviewVerdict = { passed: boolean; detail?: string; level?: number; /** what the reviewer decided, for the score tally */ outcome?: "approve" | "revise" };

/**
 * The AI B Review of one task that has just passed its ordinary validation.
 * Returns null when there is no review (not important, nobody to ask, the AI broke); otherwise the verdict to use.
 */
export async function reviewTask(input: { store: Store; reviewer: AiReviewer; mission: Mission; task: Task; result: ExecutionResult; signal: AbortSignal }): Promise<ReviewVerdict | null> {
  const { store, reviewer, mission, signal } = input;
  if (!getAiReviewSettings(store).enabled) return null;
  const task = store.getTask(input.task.projectId, input.task.id) ?? input.task;
  const projectId = task.projectId;
  const files = readTaskFiles(store, task);
  const reason = importanceOf(task, store.listArtifacts(projectId).filter((a) => a.taskId === task.id).length);
  if (!reason || files.length === 0) return null;

  const skip = (why: string) => {
    store.appendEvent({ projectId, taskId: task.id, type: "AI_REVIEW_SKIPPED", payload: { reason: why } });
    return null;
  };
  const picked = pickReviewer(store, task.selectedAi, task.role, task.id);
  if (!picked) return skip("別のメーカーの、全自動で使えるAIがありません");
  const { svc } = picked;
  // what this site takes in one prompt (ChatGPT refuses a long one): the files are cut to fit before they are sent
  let room = Math.min(MAX_TOTAL_CHARS, referenceBudget(svc.id));
  const fitted = files
    .map((f) => {
      const text = f.text.slice(0, Math.max(0, room));
      room -= text.length;
      return { ...f, text, cut: f.cut || text.length < f.text.length };
    })
    .filter((f) => f.text.length > 0);
  const author = (task.selectedAi && store.getAiService(task.selectedAi)?.name) || "Claude Code";

  store.appendEvent({ projectId, taskId: task.id, type: "AI_REVIEW_REQUESTED", payload: { reviewer: svc.id, why: reason } });
  const started = Date.now();
  const answer = await reviewer.ask({ svc, prompt: buildReviewPrompt({ task, mission, author, files: fitted }), task, signal });
  if (signal.aborted) return null;
  if (!answer.ok) {
    store.recordAiRun({ projectId, taskId: task.id, aiId: svc.id, executor: "ai-review", automationLevel: 3, status: "failed", summary: `追加レビューに失敗: ${answer.error}`, durationMs: Date.now() - started });
    return skip(`${svc.name}のレビューを取得できませんでした: ${answer.error}`);
  }

  const { verdict, findings } = parseVerdict(answer.text);
  const reviewPath = `${REVIEW_DIR}/${task.id}.md`;
  const abs = resolveInProject(store.projectsRoot, projectId, reviewPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `# 別のAIによる追加レビュー\n\n- 対象の作業: (${task.role}) ${task.objective}\n- 担当したAI: ${author}\n- レビューしたAI: ${svc.name}\n- 理由: ${reason}\n\n---\n\n${answer.text.trim()}\n`, "utf8");
  store.createArtifact({ projectId, taskId: task.id, path: reviewPath, createdBy: svc.id, sourceAi: svc.id, sourceUrl: svc.url });

  const earlier = store.listValidations(projectId).filter((v) => v.task_id === task.id && v.level === AI_REVIEW_LEVEL && v.status === "failed").length;
  const label = verdict === "approve" ? "承認" : verdict === "revise" ? "要修正" : "判定を読み取れず(承認扱い)";
  store.recordAiRun({ projectId, taskId: task.id, aiId: svc.id, executor: "ai-review", automationLevel: 3, status: "succeeded", summary: `追加レビュー(${svc.name}): ${label}`, durationMs: Date.now() - started });
  store.appendEvent({ projectId, taskId: task.id, type: "AI_REVIEW_DONE", payload: { reviewer: svc.id, verdict, revisions: earlier } });

  if (verdict === "revise" && earlier < MAX_REVIEW_REVISIONS) {
    return { passed: false, level: AI_REVIEW_LEVEL, outcome: "revise", detail: `別のAI(${svc.name})のレビューで「要修正」と判定されました。次の指摘を反映して直してください:\n${findings}` };
  }
  if (verdict === "revise") return { passed: true, level: AI_REVIEW_LEVEL, outcome: "revise", detail: `別のAI(${svc.name})のレビューにまだ指摘がありますが、修正は${MAX_REVIEW_REVISIONS}回までのため、そのまま進めました。内容は ${reviewPath} にあります` };
  return { passed: true, level: AI_REVIEW_LEVEL, ...(verdict === "approve" ? { outcome: "approve" as const } : {}), detail: `別のAI(${svc.name})のレビュー: ${label}` };
}
