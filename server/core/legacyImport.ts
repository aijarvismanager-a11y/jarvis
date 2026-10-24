import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { WorkflowFile } from "../../src/types/workflow.ts";
import { AiServiceList } from "../../src/types/aiService.ts";
import { transaction } from "./db.ts";
import { PROJECT_ID_RE, projectDir } from "./paths.ts";
import type { TaskStatus } from "./schema.ts";
import type { Store } from "./store.ts";

// Read-only importer for the pre-rebuild data model (config/workflow.json,
// config/ai_services.json, workspace/<id>/). buildPlan() only reads; nothing
// in config/ or workspace/ is ever written or deleted (MIGRATION.md,
// spec §50-51). applyPlan() writes to the new database and projects/ only.

export type PlannedTask = {
  legacyStepId: string;
  index: number;
  role: string;
  capability: string;
  aiName: string;
  aiServiceId: string | null;
  status: TaskStatus;
  objective: string;
  inputs: string[];
  expectedOutputs: string[];
  constraints: string[];
};

export type PlannedProject = {
  legacyId: string;
  name: string;
  goal: string;
  tasks: PlannedTask[];
  /** output files of finished steps that actually exist in the old workspace */
  artifactPaths: { taskIndex: number; path: string }[];
  fileCount: number;
  warnings: string[];
};

export type PlannedAiService = { id: string; name: string; url: string | null; accessMode: "web" | "cli"; adapterType: string; capabilities: string[] };

export type LegacyPlan = {
  currentProjectId: string;
  projects: PlannedProject[];
  aiServices: PlannedAiService[];
  warnings: string[];
};

// 【仮定】 role text -> capability (MIGRATION.md). First match wins.
const ROLE_CAPABILITY: [RegExp, string][] = [
  [/アイデア|ideat|research|調査/i, "research"],
  [/レビュー|review/i, "ux_review"], // before architecture: "設計レビュー" must not match "設計"
  [/設計|architect|要件/i, "architecture"],
  [/実装|develop|coding|code/i, "coding"],
  [/qa|テスト|test|修正|debug/i, "testing"],
  [/画像|image|イラスト|ロゴ/i, "image_generation"],
  [/動画|映像|video|アニメ/i, "video_generation"],
  [/音楽|楽曲|bgm|music|作曲/i, "music_generation"],
  [/音声|ナレーション|voice|narrat/i, "voice_generation"],
  [/seo/i, "seo"],
  [/翻訳|translat/i, "translation"],
];

export function capabilityForRole(role: string): string {
  return ROLE_CAPABILITY.find(([re]) => re.test(role))?.[1] ?? "unclassified";
}

const STATUS_MAP: Record<string, TaskStatus> = { pending: "pending", active: "ready", done: "completed" };

function stripPrefix(file: string, projectId: string): string {
  const prefix = `workspace/${projectId}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file.replace(/^workspace\//, "");
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    n += st.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

export function buildPlan(opts: { workflowPath: string; aiServicesPath: string; workspaceDir: string }): LegacyPlan {
  const warnings: string[] = [];
  const workflow = WorkflowFile.parse(JSON.parse(readFileSync(opts.workflowPath, "utf-8")));
  const services = existsSync(opts.aiServicesPath) ? AiServiceList.parse(JSON.parse(readFileSync(opts.aiServicesPath, "utf-8"))) : [];

  const byName = new Map(services.map((s) => [s.name, s.id]));
  const seenNames = new Set<string>();
  const plannedServices: PlannedAiService[] = [];
  for (const s of services) {
    if (seenNames.has(s.name)) {
      warnings.push(`AIサービス名が重複しているためスキップ: ${s.name}`);
      continue;
    }
    seenNames.add(s.name);
    const isCli = s.url === null && /cli/i.test(s.name);
    plannedServices.push({
      id: s.id,
      name: s.name,
      url: s.url,
      accessMode: isCli ? "cli" : "web",
      adapterType: isCli ? "claude-code" : "manual",
      // capabilities of web AIs are unknown until classified (Phase 4)
      capabilities: isCli ? ["coding", "debugging", "testing", "documentation", "architecture"] : [],
    });
  }

  const projects: PlannedProject[] = [];
  for (const p of workflow.projects) {
    const pw: string[] = [];
    if (!PROJECT_ID_RE.test(p.id)) {
      warnings.push(`プロジェクトID「${p.id}」は使用できない文字を含むためスキップ`);
      continue;
    }
    if (p.steps.length === 0) pw.push("ステップが0件(未着手のプロジェクト)");
    const wsDir = path.join(opts.workspaceDir, p.id);
    const tasks: PlannedTask[] = [];
    const artifactPaths: PlannedProject["artifactPaths"] = [];
    const ordered = [...p.steps].sort((a, b) => a.index - b.index);
    ordered.forEach((step, i) => {
      const aiServiceId = byName.get(step.ai_name) ?? null;
      if (!aiServiceId) pw.push(`ステップ${step.index}の担当AI「${step.ai_name}」がAIサービス一覧に無い(selected_aiはnull)`);
      const capability = capabilityForRole(step.role);
      if (capability === "unclassified") pw.push(`ステップ${step.index}の役割「${step.role}」を能力に分類できない`);
      const constraints: string[] = [];
      if (step.command_template) constraints.push(`legacy_command: ${step.command_template}`);
      if (step.attempts?.length) constraints.push(`legacy_attempts: ${step.attempts.map((a) => a.ai_name).join(", ")}`);
      const expectedOutputs = step.output_files.map((f) => stripPrefix(f, p.id));
      tasks.push({
        legacyStepId: step.id,
        index: step.index,
        role: step.role,
        capability,
        aiName: step.ai_name,
        aiServiceId,
        status: STATUS_MAP[step.status] ?? "pending",
        objective: step.prompt_template,
        inputs: step.input_files.map((f) => stripPrefix(f, p.id)),
        expectedOutputs,
        constraints,
      });
      if (step.status === "done") {
        for (const out of expectedOutputs) {
          if (out.includes("*")) {
            pw.push(`ステップ${step.index}の出力「${out}」はワイルドカードのためArtifact登録せず(ファイルはコピーされる)`);
            continue;
          }
          const abs = path.join(wsDir, out);
          if (existsSync(abs) && statSync(abs).isFile()) artifactPaths.push({ taskIndex: i, path: out });
        }
      }
    });
    projects.push({
      legacyId: p.id,
      name: p.name,
      goal: `(旧プロジェクトから移行)${p.name}`, // 【仮定】 old projects had no goal text
      tasks,
      artifactPaths,
      fileCount: countFiles(wsDir),
      warnings: pw,
    });
  }

  if (!workflow.projects.some((p) => p.id === workflow.current_project_id)) {
    warnings.push(`current_project_id「${workflow.current_project_id}」に該当するプロジェクトが無い`);
  }
  return { currentProjectId: workflow.current_project_id, projects, aiServices: plannedServices, warnings };
}

/** Copies config/ and workspace/ into backupsDir/<timestamp>/ before any import. */
export function backupLegacy(opts: { configDir: string; workspaceDir: string; backupsDir: string }): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(opts.backupsDir, stamp);
  mkdirSync(dest, { recursive: true });
  const skipLinks = (src: string) => !lstatSync(src).isSymbolicLink();
  if (existsSync(opts.configDir)) cpSync(opts.configDir, path.join(dest, "config"), { recursive: true, filter: skipLinks });
  if (existsSync(opts.workspaceDir)) cpSync(opts.workspaceDir, path.join(dest, "workspace"), { recursive: true, filter: skipLinks });
  return dest;
}

export type ApplyResult = {
  imported: { legacyId: string; tasks: number; artifacts: number; filesCopied: boolean }[];
  skipped: { legacyId: string; reason: string }[];
  aiServices: number;
};

/** Idempotent: a project whose id already exists is skipped, never overwritten. */
export function applyPlan(store: Store, plan: LegacyPlan, opts: { workspaceDir: string; copyFiles?: boolean }): ApplyResult {
  const result: ApplyResult = { imported: [], skipped: [], aiServices: 0 };
  const copy = opts.copyFiles ?? true;

  for (const s of plan.aiServices) {
    store.upsertAiService({
      id: s.id,
      name: s.name,
      url: s.url,
      accessMode: s.accessMode,
      adapterType: s.adapterType,
      requiresLogin: s.accessMode === "cli",
      legacyName: s.name,
      capabilities: s.capabilities,
    });
    result.aiServices++;
  }

  for (const p of plan.projects) {
    if (store.getProject(p.legacyId)) {
      result.skipped.push({ legacyId: p.legacyId, reason: "同じIDのプロジェクトが既に存在" });
      continue;
    }
    const dest = projectDir(store.projectsRoot, p.legacyId);
    const destExisted = existsSync(dest);
    const src = path.join(opts.workspaceDir, p.legacyId);
    let copied = false;
    try {
      if (copy && existsSync(src)) {
        cpSync(src, dest, { recursive: true, filter: (f) => !lstatSync(f).isSymbolicLink() });
        copied = true;
      } else {
        mkdirSync(dest, { recursive: true });
      }
      let artifactCount = 0;
      transaction(store.db, () => {
        store.createProject({ id: p.legacyId, name: p.name, legacyId: p.legacyId });
        const mission = store.createMission({ projectId: p.legacyId, goal: p.goal, status: "draft" });
        const taskIds: string[] = [];
        p.tasks.forEach((t, i) => {
          const task = store.createTask({
            projectId: p.legacyId,
            missionId: mission.id,
            role: t.capability,
            objective: t.objective,
            inputs: t.inputs,
            expectedOutputs: t.expectedOutputs,
            constraints: [`legacy_role: ${t.role}`, ...t.constraints],
            selectedAi: t.aiServiceId,
            status: t.status,
            position: i,
            dependsOn: i > 0 ? [taskIds[i - 1]] : [],
          });
          taskIds.push(task.id);
        });
        for (const a of p.artifactPaths) {
          store.createArtifact({ projectId: p.legacyId, taskId: taskIds[a.taskIndex], path: a.path, createdBy: "legacy-import", sourceAi: p.tasks[a.taskIndex].aiName });
          artifactCount++;
        }
        store.appendEvent({ projectId: p.legacyId, type: "LEGACY_PROJECT_IMPORTED", payload: { tasks: p.tasks.length, artifacts: artifactCount } });
      });
      result.imported.push({ legacyId: p.legacyId, tasks: p.tasks.length, artifacts: artifactCount, filesCopied: copied });
    } catch (err) {
      // Roll back files we created; never touch a directory that pre-existed.
      if (!destExisted) rmSync(dest, { recursive: true, force: true });
      result.skipped.push({ legacyId: p.legacyId, reason: `失敗: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  store.setSetting("legacy.current_project_id", plan.currentProjectId);
  return result;
}

export function renderReport(plan: LegacyPlan, result?: ApplyResult): string {
  const lines: string[] = [];
  lines.push(`# 旧データ移行レポート(${result ? "適用結果" : "ドライラン"})`, "");
  lines.push(`- 生成: ${new Date().toISOString()}`, `- プロジェクト: ${plan.projects.length}件 / AIサービス: ${plan.aiServices.length}件`, "");
  for (const p of plan.projects) {
    lines.push(`## ${p.name} (\`${p.legacyId}\`)`);
    lines.push(`- 作業 ${p.tasks.length}件、成果物登録 ${p.artifactPaths.length}件、ファイル ${p.fileCount}件`);
    for (const t of p.tasks) lines.push(`  - ${t.index}. [${t.status}] ${t.role} → 能力 \`${t.capability}\` / AI: ${t.aiServiceId ?? "(未解決)"}`);
    for (const w of p.warnings) lines.push(`- ⚠ ${w}`);
    lines.push("");
  }
  if (plan.warnings.length) lines.push("## 全体の警告", ...plan.warnings.map((w) => `- ⚠ ${w}`), "");
  if (result) {
    lines.push("## 適用結果");
    for (const r of result.imported) lines.push(`- 取込: ${r.legacyId} (作業${r.tasks}, 成果物${r.artifacts}, ファイルコピー${r.filesCopied ? "済" : "なし"})`);
    for (const r of result.skipped) lines.push(`- スキップ: ${r.legacyId} — ${r.reason}`);
    lines.push(`- AIサービス登録: ${result.aiServices}件`);
  }
  return lines.join("\n") + "\n";
}
