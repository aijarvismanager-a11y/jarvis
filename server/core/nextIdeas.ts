import { extractPlanJson } from "./planner.ts";
import { loadAcceptance } from "./acceptance.ts";
import type { Store } from "./store.ts";

// "What should I ask for next?": after a request has finished, a short, light run reads what was asked, what was done, what the
// acceptance check found missing and what earlier requests already covered, and proposes a few next requests the person can pick
// from - one of them marked as the recommendation. Each option carries a complete, ready-to-send request text. It never edits files.

export type NextIdea = {
  title: string;
  /** why this one is worth doing now, in one or two plain sentences */
  why: string;
  /** the full request text that "この案件で依頼する" puts into the request box */
  request: string;
  effort: "small" | "medium" | "large";
  recommended: boolean;
};
export type NextIdeas = { missionId: string; at: string; ideas: NextIdea[] };

export const nextIdeasKey = (missionId: string) => `next-ideas:${missionId}`;

export type NextIdeasInput = {
  projectName: string;
  goal: string;
  tasks: { objective: string; status: string }[];
  unmet: { requirement: string; fix?: string }[];
  earlierGoals: string[];
  /** the project's own "known TODO" notes, when it keeps any (CLAUDE.md) */
  todoNotes: string;
};

/** The part of a project's CLAUDE.md that lists known TODOs, if there is one. */
export function todoSection(text: string | null): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,3}\s*(既知のTODO|TODO|未対応|残っていること)/.test(l));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i]!)) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n").trim().slice(0, 3000);
}

export function gatherNextIdeasInput(store: Store, projectId: string, missionId: string, readArtifact: (rel: string) => string | null): NextIdeasInput {
  const mission = store.getMission(projectId, missionId);
  if (!mission) throw new Error("依頼が見つかりません");
  const project = store.listProjects().find((p) => p.id === projectId);
  const tasks = store.listTasks(projectId).filter((t) => t.missionId === missionId).sort((a, b) => a.position - b.position);
  const acceptance = loadAcceptance(store, missionId);
  const earlier = store.listMissions(projectId).filter((m) => m.id !== missionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  return {
    projectName: project?.name ?? "",
    goal: mission.goal.slice(0, 3000),
    tasks: tasks.slice(0, 30).map((t) => ({ objective: t.objective.slice(0, 160), status: t.status })),
    unmet: (acceptance?.items ?? []).filter((i) => i.status === "unmet" || i.status === "partial").slice(0, 8).map((i) => ({ requirement: i.requirement, ...(i.fix ? { fix: i.fix } : {}) })),
    earlierGoals: earlier.map((m) => m.goal.replace(/\s+/g, " ").slice(0, 160)),
    todoNotes: todoSection(readArtifact("CLAUDE.md")),
  };
}

export function buildNextIdeasPrompt(input: NextIdeasInput): string {
  const done = input.tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.objective}`).join("\n");
  return [
    "あなたは、ソフトを作る人の相談役です。いま終わった「依頼」の次に、何を頼むとよいかを提案してください。",
    "提案は3〜5個。それぞれ、そのままAIに頼める「依頼文」として書く。1つだけ recommended を true にする(いま頼むと最も価値が高い順で、効果が大きく、まとまった単位で終わらせられるもの)。",
    "提案の種類は偏らせない。次のような観点から、状況に合うものを選ぶ: ①今回足りなかった点の仕上げ ②実際に動かして確かめる・不具合をつぶす ③次に必要な機能 ④使いやすさ・見やすさの改善 ⑤配布や運用の準備 ⑥別の案件に切り替える(この場合は、プロジェクトが違うと分かる題にする)。",
    "すでに終わった作業や、過去の依頼と重なるものは提案しない。依頼文には、何を・どこまで・守ること・終わりの目安を含め、1つの依頼として1〜2時間で終わる大きさにする。",
    "effort は small(30分以内) / medium(1〜2時間) / large(それ以上。大きい場合は「最初の一歩」だけを依頼文にする) のどれか。",
    "title は20文字以内、why は1〜2文で「なぜいまか」を平易に。専門用語は避ける。",
    'JSONだけを出力する: {"ideas":[{"title":"…","why":"…","request":"…","effort":"medium","recommended":true}]}。前置きや説明は付けない。ファイルは変更しない。',
    "",
    `【プロジェクト】${input.projectName || "(名前なし)"}`,
    "【いま終わった依頼】",
    input.goal,
    "",
    "【行った作業】",
    done || "(なし)",
    "",
    "【達成度チェックで足りないとされた点】",
    input.unmet.length ? input.unmet.map((u) => `- ${u.requirement}${u.fix ? `(${u.fix})` : ""}`).join("\n") : "(なし、または未チェック)",
    "",
    "【これまでの依頼(新しい順)】",
    input.earlierGoals.length ? input.earlierGoals.map((g) => `- ${g}`).join("\n") : "(なし)",
    "",
    "【プロジェクト自身のTODOメモ】",
    input.todoNotes || "(なし)",
  ].join("\n");
}

export function parseNextIdeas(stdout: string, missionId: string, now = new Date()): NextIdeas {
  const data = extractPlanJson(stdout) as { ideas?: unknown } | undefined;
  const raw = Array.isArray(data?.ideas) ? data.ideas : [];
  const ideas: NextIdea[] = [];
  for (const r of raw.slice(0, 6)) {
    const o = r as Record<string, unknown>;
    const title = typeof o?.title === "string" ? o.title.trim().slice(0, 40) : "";
    const request = typeof o?.request === "string" ? o.request.trim().slice(0, 4000) : "";
    if (!title || request.length < 10) continue;
    const effort = o.effort === "small" || o.effort === "large" ? o.effort : "medium";
    ideas.push({ title, why: typeof o.why === "string" ? o.why.trim().slice(0, 300) : "", request, effort, recommended: o.recommended === true });
  }
  // exactly one recommendation: the first marked one, else the first idea
  const first = ideas.findIndex((i) => i.recommended);
  const pick = first >= 0 ? first : 0;
  ideas.forEach((i, n) => (i.recommended = n === pick && ideas.length > 0));
  // the recommendation goes first
  ideas.sort((a, b) => Number(b.recommended) - Number(a.recommended));
  return { missionId, at: now.toISOString(), ideas };
}

export type NextIdeasRunner = { exec(prompt: string, choice: { model: "haiku" | "sonnet" | "opus"; effort: "low" | "medium" | "high" }, timeoutMs: number): Promise<string> };

/** Runs the suggestion and stores it (settings, keyed by request). Throws when the AI gives nothing usable. */
export async function runNextIdeas(store: Store, runner: NextIdeasRunner, projectId: string, missionId: string, readArtifact: (rel: string) => string | null): Promise<NextIdeas> {
  const input = gatherNextIdeasInput(store, projectId, missionId, readArtifact);
  const stdout = await runner.exec(buildNextIdeasPrompt(input), { model: "sonnet", effort: "low" }, 4 * 60_000);
  const result = parseNextIdeas(stdout, missionId);
  if (result.ideas.length === 0) throw new Error("次の案件の提案を作れませんでした。もう一度試してください");
  store.setSetting(nextIdeasKey(missionId), result);
  store.appendEvent({ projectId, type: "NEXT_IDEAS_MADE", payload: { missionId, count: result.ideas.length } });
  return result;
}

export function loadNextIdeas(store: Store, missionId: string): NextIdeas | null {
  return store.getSetting<NextIdeas | null>(nextIdeasKey(missionId), null);
}
