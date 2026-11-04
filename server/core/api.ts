import { readAllResting } from "./allResting.ts";
import { CLAUDE_WARN_AT, claudeLimitUntil, limitStoppedTasks, probeClaudeQuota, readClaudeLimitPolicy, readClaudeQuota, saveClaudeLimitPolicy } from "./claudeQuota.ts";
import { usageLimitUntil } from "./usageLimit.ts";
import { botCheckState } from "./botCheck.ts";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { MissionEngine } from "./missionEngine.ts";
import type { Store } from "./store.ts";
import { readFileSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { PROJECT_ID_RE, projectDir, resolveInProject } from "./paths.ts";
import { AIBroker, capabilityForTaskRole } from "./aiBroker.ts";
import type { AiHealthChecker } from "./aiHealth.ts";
import type { AiDiscovery } from "./aiDiscovery.ts";
import type { AiScout } from "./aiScout.ts";
import type { AiRoster } from "./aiRoster.ts";
import type { TaskLogStore } from "./taskLog.ts";
import type { SystemCheck } from "./systemCheck.ts";
import type { DepsInstaller } from "./depsInstaller.ts";
import { MIME, type PreviewManager } from "./previewManager.ts";
import { ImportTooLargeError, analysisPlan, copyImport, scanImportSource } from "./projectImport.ts";
import { carryHistory, historyInfo } from "./conversationHistory.ts";
import { getAiReviewSettings, pickReviewer, setAiReviewSettings } from "./aiReview.ts";
import { resetTuning, setTuningEnabled, tuningReport } from "./scoreTuning.ts";
import { approveVerifyScript, runVerification, scriptText, verifyInfo } from "./postVerify.ts";
import { autoReflectKey, isSyncBusy, withSyncLock } from "./autoReflect.ts";
import { DEFAULT_KEEP_BACKUPS, applySync, autoPullPaths, computeDiffsAsync, hashTreeAsync, linkKey, listBackups, normalizeSource, pruneBackups, restoreBackup, type SyncLink } from "./projectSync.ts";
import path from "node:path";
import { buildMissionReport } from "./missionReport.ts";
import { createDeliveryFolder } from "./deliveryFolder.ts";
import type { SnapshotManager } from "./snapshotManager.ts";
import type { ApprovalHub } from "./approvalHub.ts";
import { WEB_ADAPTER_TYPES, type WebHandoffHub } from "./webHandoff.ts";
import { BUNDLED_SITE_PROFILES, NOT_AUTOMATABLE, getWebAiSettings, resolveSiteProfile, setWebAiSettings } from "./webAiSites.ts";

// HTTP surface for the new orchestrator (mounted under /api/v2). Reads are open
// to the (already loopback/Origin-checked) app; every state change needs the
// per-launch token, like the legacy /execute endpoint.

export type OrchestratorApiDeps = {
  store: Store;
  engine: MissionEngine;
  /** False when no real TaskExecutor is wired: run/resume then answer 501. */
  canExecute: boolean;
  tokenMatches: (candidate: unknown) => boolean;
  /** Enables POST /ai-services/health-check; without it that endpoint answers 501. */
  healthChecker?: AiHealthChecker;
  /** Enables POST /ai-discovery; without it that endpoint answers 501. */
  discovery?: AiDiscovery;
  /** Enables /ai-scout (weekly search for new Google-sign-in AIs, proposals the person accepts or drops). */
  scout?: AiScout;
  /** Enables /ai-roster (weekly check of the manual AIs: raise to automatic, take out what is gone, put back). */
  roster?: AiRoster;
  /** Adapter types the wired executor can run, so /broker/preview matches what a mission would really pick. Read per request: the web AI switch changes it. */
  executableAdapters?: string[] | (() => string[]);
  /** Live log of what the AI does in a task (GET /projects/:id/tasks/:taskId/log). */
  logs?: TaskLogStore;
  /** Enables the preview endpoints (run the project's app while it is being built). */
  previews?: PreviewManager;
  /** Enables installing the dependencies of an imported project (so its preview can start). */
  deps?: DepsInstaller;
  /** Enables the per-task changes (diff) and rollback endpoints. */
  snapshots?: SnapshotManager;
  /** Enables answering approval requests (POST /approvals/:id/approve|deny). */
  approvals?: ApprovalHub;
  /** Is Claude Code installed and signed in? (GET /system/status); without it the answer is "unknown". */
  system?: SystemCheck;
  /** Opens a folder dialog on this PC and returns the chosen path (null = cancelled); without it POST /system/pick-folder answers 501. */
  pickFolder?: () => Promise<string | null>;
  /** Restarts the whole server (Windows launcher script); without it POST /system/restart answers 501. */
  restart?: () => void;
  /** Where sync backups are kept (backups/sync); without it the sync endpoints answer 501. */
  syncBackupsRoot?: string;
  /** where verifiers/<projectId>.ps1 live (the app root) */
  appRoot?: string;
  /** Where the folders of projects started in the app are made (their "original folder", filled by the sync); without it none is made. */
  newProjectRoot?: () => string;
  /** Enables the Web AI endpoints (handoffs, settings, site profiles); without it they answer 501. */
  webAi?: { hub: WebHandoffHub; browserAvailable: () => boolean; /** Is a sign-in window of the person's using the dedicated browser profile, and how many tasks wait for it to be closed. */ status?: () => Promise<{ loginWindowOpen: boolean; waiting: number }>; /** Tries one tiny prompt on the AI in the dedicated browser. */ probe?: (aiId: string) => Promise<{ ok: true } | { ok: false; reason: string }>; /** Opens the AI's page in the dedicated browser profile for a manual sign-in. */ openLogin?: (url: string) => void; /** Copies the everyday browser's sign-ins into the automation profile. */ importSignIn?: () => Promise<{ profile: string; copied: string[] }> };
};

const createSchema = z.object({
  goal: z.string().trim().min(1).max(4000),
  constraints: z.array(z.string().max(500)).max(50).default([]),
  technologyPreferences: z.array(z.string().max(200)).max(50).default([]),
});
const MAX_ARTIFACT_BYTES = 1_000_000;
// `run` is only read by /approve: approve and start in one request, so a failure in between cannot leave an approved plan idle.
const feedbackSchema = z.object({ feedback: z.string().trim().max(4000).default(""), run: z.boolean().default(false) });

/** Why a task is failed / blocked, for the UI: the last failure reason, or which task it is waiting on. */
function taskNotes(store: Store, projectId: string, tasks: ReturnType<Store["listTasks"]>): Record<string, string> {
  const notes: Record<string, string> = {};
  const reasons = new Map<string, string>();
  for (const e of store.listEvents({ projectId, type: "TASK_TRANSITION", limit: 1000 })) {
    const p = e.payload as { to?: string; reason?: string };
    if (e.taskId && p.to === "failed" && p.reason) reasons.set(e.taskId, p.reason);
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    if (t.status === "failed") notes[t.id] = reasons.get(t.id) ?? "失敗しました";
    else if (t.status === "blocked") {
      const dep = t.dependsOn.map((id) => byId.get(id)).find((d) => d && (d.status === "failed" || d.status === "blocked"));
      if (dep) notes[t.id] = `「${dep.objective}」が先に進めないため止まっています`;
    }
  }
  return notes;
}

export function createOrchestratorRouter(deps: OrchestratorApiDeps): Router {
  const { store, engine } = deps;
  const router = express.Router();

  const fail = (res: Response, err: unknown, status = 400) => res.status(status).json({ error: err instanceof Error ? err.message : String(err) });

  router.param("projectId", (_req, res, next, id: string) => {
    if (!PROJECT_ID_RE.test(id) || !store.getProject(id)) return void res.status(404).json({ error: "プロジェクトが見つかりません" });
    next();
  });
  router.param("missionId", (req, res, next, id: string) => {
    if (!store.getMission(String(req.params.projectId), id)) return void res.status(404).json({ error: "依頼が見つかりません" });
    next();
  });

  const guarded = (handler: (req: Request, res: Response) => Promise<void> | void) => async (req: Request, res: Response) => {
    if (!deps.tokenMatches(req.headers["x-orchestrator-token"])) return void res.status(403).json({ error: "実行トークンが無効です。ページを再読み込みしてください" });
    try {
      await handler(req, res);
    } catch (err) {
      fail(res, err);
    }
  };

  const view = (projectId: string, missionId: string) => ({
    mission: store.getMission(projectId, missionId),
    tasks: store.listTasks(projectId).filter((t) => t.missionId === missionId),
    proposal: engine.getProposal(missionId),
  });

  // ---- Restart from the UI: picks up new code without a terminal. Missions that are running resume by themselves after the start. ----
  router.post(
    "/system/restart",
    guarded((req, res) => {
      if (!deps.restart) return void res.status(501).json({ error: "この環境では画面からの再起動に対応していません。ターミナルで npm run server:restart を実行してください" });
      const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
      const running = store.listProjects().flatMap((p) => store.listMissions(p.id)).filter((m) => m.status === "running").length;
      if (running > 0 && !force) return void res.status(409).json({ error: `実行中の依頼が${running}件あります。再起動すると作業が一度止まります(再起動後に自動で再開します)`, running });
      const restart = deps.restart;
      setTimeout(restart, 300); // let this answer go out first
      res.json({ ok: true, running });
    }),
  );

  router.get("/system/status", async (req, res) => {
    const force = req.query.force === "1";
    res.json({ claude: deps.system ? await deps.system.claude(force) : { state: "unknown", message: "確認機能が接続されていません" } });
  });
  router.post(
    "/system/pick-folder",
    guarded(async (_req, res) => {
      if (!deps.pickFolder) return void res.status(501).json({ error: "この環境ではフォルダ選択に対応していません。パスを入力してください" });
      res.json({ path: await deps.pickFolder() });
    }),
  );

  // ---- Projects / artifacts (Phase 7 UI) ---------------------------------------
  router.get("/projects", (_req, res) => {
    res.json({ projects: store.listProjects() });
  });
  // One line per project for the "all projects" screen: the newest request, how many requests and files, and the last activity.
  router.get("/projects-summary", (_req, res) => {
    const summary = store.listProjects().map((p) => {
      const missions = [...store.listMissions(p.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const artifacts = store.listArtifacts(p.id);
      const latest = missions[0] ?? null;
      const last = [p.createdAt, ...missions.map((m) => m.updatedAt), ...artifacts.map((x) => x.createdAt)].sort().pop() ?? p.createdAt;
      // requests still "running" or "planning": they block putting the project away, and an old one is usually stuck
      const openMissions = missions.filter((m) => m.status === "running" || m.status === "planning").map((m) => ({ id: m.id, goal: m.goal, status: m.status, updatedAt: m.updatedAt }));
      return { project: p, latestMission: latest ? { id: latest.id, goal: latest.goal, status: latest.status } : null, openMissions, missionCount: missions.length, artifactCount: artifacts.length, lastActivityAt: last };
    });
    res.json({ summary: summary.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)) });
  });
  router.post(
    "/projects",
    guarded((req, res) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body ?? {});
      const project = store.createProject({ name });
      if (deps.newProjectRoot && deps.syncBackupsRoot) createDeliveryFolder(store, project.id, project.name, deps.newProjectRoot());
      res.status(201).json({ project });
    }),
  );
  // Removes a project for good: its rows, its working copy, the history repository, the sync record and the sync backups.
  // The folder it was imported from is never touched.
  router.delete(
    "/projects/:projectId",
    guarded((req, res) => {
      const projectId = String(req.params.projectId);
      const busy = store.listMissions(projectId).filter((m) => m.status === "running").length;
      if (busy > 0) return void res.status(409).json({ error: `実行中の依頼が${busy}件あります。止めてから削除してください` });
      deps.previews?.stop(projectId);
      // manual steps waiting for the person (copy & paste, a login...) belong to the project and go with it
      for (const h of deps.webAi?.hub.list({ projectId, status: "pending" }) ?? []) deps.webAi!.hub.cancel(h.id);
      store.deleteProject(projectId);
      store.deleteSetting(linkKey(projectId));
      rmSync(path.join(store.projectsRoot, `${projectId}.git`), { recursive: true, force: true });
      if (deps.syncBackupsRoot) rmSync(path.join(deps.syncBackupsRoot, projectId), { recursive: true, force: true });
      res.json({ ok: true });
    }),
  );
  // Archiving only hides the project from the lists; its files and history stay, and it can be brought back.
  router.post(
    "/projects/:projectId/archive",
    guarded((req, res) => {
      const projectId = String(req.params.projectId);
      const { archived } = z.object({ archived: z.boolean() }).parse(req.body ?? {});
      if (!store.getProject(projectId)) return void res.status(404).json({ error: "プロジェクトが見つかりません" });
      const busy = store.listMissions(projectId).filter((m) => m.status === "running" || m.status === "planning").length;
      if (archived && busy > 0) return void res.status(409).json({ error: `実行中の依頼が${busy}件あります。止めてからしまってください` });
      store.setProjectStatus(projectId, archived ? "archived" : "active");
      res.json({ project: store.getProject(projectId) });
    }),
  );
  // What the import that is running right now is doing, so the screen can show progress while its request is still open.
  type ImportProgress = { phase: "scanning" | "copying" | "snapshot" | "fingerprint" | "history" | "starting"; files: number; filesTotal: number; bytes: number; bytesTotal: number; startedAt: string };
  let importProgress: ImportProgress | null = null;
  router.get("/projects/import/progress", (_req, res) => {
    res.json({ progress: importProgress });
  });
  // Does Claude Code have a recorded conversation for this folder? (asked by the import form before it offers to carry it over)
  router.get("/projects/import/history", async (req, res) => {
    const folder = typeof req.query.path === "string" ? req.query.path.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim() : "";
    if (!folder || folder.length > 1000) return void res.json({ found: false, sessions: 0, lastAt: null });
    res.json(await historyInfo(folder));
  });
  // Import an existing folder: copy it (the original is never touched), then analyse it read-only.
  router.post(
    "/projects/import",
    guarded(async (req, res) => {
      if (!deps.canExecute) return void res.status(501).json({ error: "実行基盤が接続されていないため、取り込みの分析ができません" });
      const body = z.object({ path: z.string().trim().transform((s) => s.replace(/^["'“”]+|["'“”]+$/g, "").trim()).pipe(z.string().min(1).max(1000)), name: z.string().trim().max(100).optional(), exclude: z.array(z.string().trim().min(1).max(260)).max(100).default([]), carryHistory: z.boolean().default(false) }).parse(req.body ?? {});
      if (importProgress) throw new Error("ほかのフォルダを取り込み中です。終わるまでお待ちください");
      importProgress = { phase: "scanning", files: 0, filesTotal: 0, bytes: 0, bytesTotal: 0, startedAt: new Date().toISOString() };
      try {
        return await runImport(body, res);
      } finally {
        importProgress = null;
      }
    }),
  );
  const runImport = async (body: { path: string; name?: string; exclude: string[]; carryHistory: boolean }, res: Response): Promise<void> => {
    const progress = importProgress!;
    {
      let scan;
      try {
        scan = scanImportSource(body.path, store.projectsRoot, { exclude: body.exclude });
      } catch (err) {
        // over the limits: tell the UI what is heavy so the user can leave those folders out
        if (err instanceof ImportTooLargeError) return void res.status(413).json({ error: err.message, tooLarge: { files: err.files, bytes: err.bytes, folders: err.folders } });
        throw err;
      }
      // The same folder is one project: importing it again must not make a second copy.
      const wanted = normalizeSource(body.path);
      const known = store.listProjects().find((p) => {
        const link = store.getSetting<SyncLink | null>(linkKey(p.id), null);
        return !!link && normalizeSource(link.sourcePath) === wanted;
      });
      if (known) return void res.status(200).json({ project: known, existing: true, missionId: null, files: scan.files.length, bytes: scan.bytes, skippedSecrets: scan.skippedSecrets });
      progress.filesTotal = scan.files.length;
      progress.bytesTotal = scan.bytes;
      progress.phase = "copying";
      const folderName = path.basename(path.resolve(body.path));
      const project = store.createProject({ name: body.name || folderName });
      let baseline: Record<string, string> = {};
      let history: Awaited<ReturnType<typeof carryHistory>> | null = null;
      try {
        await copyImport(path.resolve(body.path), projectDir(store.projectsRoot, project.id), scan, (p) => {
          progress.files = p.done;
          progress.bytes = p.bytesDone;
        });
        progress.phase = "snapshot";
        await deps.snapshots?.capture(project.id, `${project.id}-import-baseline`).catch(() => undefined);
        progress.phase = "fingerprint";
        baseline = await hashTreeAsync(projectDir(store.projectsRoot, project.id), scan.excluded);
        if (body.carryHistory) {
          // never fatal: the import is complete without the summary
          progress.phase = "history";
          history = await carryHistory({ sourceFolder: path.resolve(body.path), projectDir: projectDir(store.projectsRoot, project.id) });
        }
      } catch (err) {
        store.deleteProject(project.id);
        throw err;
      }
      store.setSetting(linkKey(project.id), { sourcePath: path.resolve(body.path), importedAt: new Date().toISOString(), baseline, exclude: scan.excluded } satisfies SyncLink);
      progress.phase = "starting";
      store.appendEvent({ projectId: project.id, type: "PROJECT_IMPORTED", payload: { source: path.resolve(body.path), files: scan.files.length, bytes: scan.bytes, skippedSecrets: scan.skippedSecrets, excluded: scan.excluded } });
      if (history) store.appendEvent({ projectId: project.id, type: history.ok ? "HISTORY_CARRIED" : "HISTORY_CARRY_FAILED", payload: history.ok ? { sessions: history.sessions, turns: history.turns } : { error: history.error } });
      const mission = engine.startFixedMission({ projectId: project.id, goal: `既存プロジェクト「${project.name}」の現状分析`, draft: analysisPlan(project.name, history?.ok === true) });
      void engine.run(project.id, mission.id).catch(() => undefined);
      res.status(201).json({ project, missionId: mission.id, files: scan.files.length, bytes: scan.bytes, skippedSecrets: scan.skippedSecrets, excluded: scan.excluded, history: history ? (history.ok ? { ok: true, sessions: history.sessions, turns: history.turns } : { ok: false, error: history.error }) : null });
    }
  };
  router.get("/projects/:projectId/overview", (req, res) => {
    const projectId = String(req.params.projectId);
    const tasks = store.listTasks(projectId);
    res.json({
      missions: store.listMissions(projectId),
      tasks,
      taskNotes: taskNotes(store, projectId, tasks),
      artifacts: store.listArtifacts(projectId),
      aiRuns: store.listAiRuns(projectId),
    });
  });
  // ---- Sync with the folder the project was imported from: review the diff, then write it back ----
  const pullDir = (backupDir: string) => path.join(backupDir, "_pull"); // pull backups live beside the push ones
  const syncGuarded = (handler: (req: Request, res: Response, ctx: { projectId: string; link: SyncLink; backupDir: string }) => Promise<void> | void) =>
    guarded((req, res) => {
      if (!deps.syncBackupsRoot) return void res.status(501).json({ error: "同期機能が接続されていません" });
      const projectId = String(req.params.projectId);
      const link = store.getSetting<SyncLink | null>(linkKey(projectId), null);
      if (!link) return void res.status(404).json({ error: "このプロジェクトは取り込んだものではありません" });
      return handler(req, res, { projectId, link, backupDir: path.join(deps.syncBackupsRoot, projectId) });
    });
  router.get("/projects/:projectId/sync", async (req, res) => {
    const projectId = String(req.params.projectId);
    const link = store.getSetting<SyncLink | null>(linkKey(projectId), null);
    if (!link || !deps.syncBackupsRoot) return void res.json({ linked: false });
    const backupDir = path.join(deps.syncBackupsRoot, projectId);
    try {
      const root = projectDir(store.projectsRoot, projectId);
      const { push, pull } = await computeDiffsAsync(link, root);
      res.json({ linked: true, verify: deps.appRoot ? verifyInfo(store, deps.appRoot, projectId) : null, autoReflect: store.getSetting<boolean>(autoReflectKey(projectId), false), createdByApp: !!(link as { createdByApp?: boolean }).createdByApp, sourcePath: link.sourcePath, entries: push, pullEntries: pull, backups: listBackups(backupDir), pullBackups: listBackups(pullDir(backupDir)) });
    } catch (err) {
      res.json({ linked: true, sourcePath: link.sourcePath, entries: [], pullEntries: [], backups: listBackups(backupDir), pullBackups: listBackups(pullDir(backupDir)), problem: err instanceof Error ? err.message : String(err) });
    }
  });
  router.put(
    "/projects/:projectId/auto-reflect",
    syncGuarded((req, res, { projectId }) => {
      const body = z.object({ enabled: z.boolean() }).parse(req.body);
      store.setSetting(autoReflectKey(projectId), body.enabled);
      store.appendEvent({ projectId, type: body.enabled ? "SYNC_AUTO_ON" : "SYNC_AUTO_OFF", payload: {} });
      res.json({ autoReflect: body.enabled });
    }),
  );
  router.get("/projects/:projectId/verify/script", syncGuarded((_req, res, { projectId }) => {
    const text = deps.appRoot ? scriptText(deps.appRoot, projectId) : null;
    if (text === null) return void res.status(404).json({ error: "確認の手順がありません" });
    res.json({ text });
  }));
  router.post("/projects/:projectId/verify/approve", syncGuarded((_req, res, { projectId }) => {
    if (!deps.appRoot) return void res.status(501).json({ error: "接続されていません" });
    approveVerifyScript(store, deps.appRoot, projectId);
    res.json(verifyInfo(store, deps.appRoot, projectId));
  }));
  router.post("/projects/:projectId/verify/run", syncGuarded((_req, res, { projectId }) => {
    if (!deps.appRoot) return void res.status(501).json({ error: "接続されていません" });
    if (store.listMissions(projectId).some((m) => m.status === "running")) return void res.status(409).json({ error: "実行中の依頼があります。終わってから確認してください" });
    void runVerification(store, deps.appRoot, projectId);
    res.status(202).json({ started: true });
  }));
  // Cheap-to-poll counts for the badges. Hashing both folders is not free, so the answer is reused for a few seconds.
  type SyncSummaryValue = { linked: boolean; push: number; pull: number; problem?: string };
  const summaryCache = new Map<string, { at: number; value: SyncSummaryValue }>();
  const SUMMARY_TTL_MS = 60_000;
  const summaryRuns = new Map<string, Promise<SyncSummaryValue>>();
  router.get("/projects/:projectId/sync/summary", async (req, res) => {
    const projectId = String(req.params.projectId);
    const link = store.getSetting<SyncLink | null>(linkKey(projectId), null);
    if (!link || !deps.syncBackupsRoot) return void res.json({ linked: false, push: 0, pull: 0 });
    const hit = summaryCache.get(projectId);
    if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return void res.json(hit.value);
    // several screens may ask at once: share one hashing run
    let run = summaryRuns.get(projectId);
    if (!run) {
      run = computeDiffsAsync(link, projectDir(store.projectsRoot, projectId))
        .then((d): SyncSummaryValue => ({ linked: true, push: d.push.length, pull: d.pull.length }))
        .catch((err): SyncSummaryValue => ({ linked: true, push: 0, pull: 0, problem: err instanceof Error ? err.message : String(err) }))
        .then((value) => {
          summaryCache.set(projectId, { at: Date.now(), value });
          summaryRuns.delete(projectId);
          return value;
        });
      summaryRuns.set(projectId, run);
    }
    res.json(await run);
  });
  // Writing is asynchronous now, so two clicks (or an apply and a restore) must not interleave on the same project.
  router.post(
    "/projects/:projectId/sync/apply",
    syncGuarded(async (req, res, { projectId, link, backupDir }) => {
      if (store.listMissions(projectId).some((m) => m.status === "running")) throw new Error("実行中の依頼があります。先に一時停止してください");
      const opts = z.object({ paths: z.array(z.string().max(1000)).max(20000).optional(), deletes: z.boolean().default(false), overwriteConflicts: z.boolean().default(false), direction: z.enum(["push", "pull"]).default("push") }).parse(req.body ?? {});
      const dir = opts.direction === "pull" ? pullDir(backupDir) : backupDir;
      const r = await withSyncLock(projectId, () => applySync(link, projectDir(store.projectsRoot, projectId), dir, { ...opts, only: opts.paths }, opts.direction));
      store.setSetting(linkKey(projectId), r.link);
      summaryCache.delete(projectId);
      const keep = store.getSetting<number>("syncBackupKeep", DEFAULT_KEEP_BACKUPS);
      pruneBackups(dir, keep);
      store.appendEvent({ projectId, type: opts.direction === "pull" ? "SYNC_PULLED" : "SYNC_APPLIED", payload: { source: link.sourcePath, files: r.backup?.files.length ?? 0, skipped: r.skipped.length, backup: r.backup?.id ?? null } });
      res.json({ applied: r.backup?.files.length ?? 0, skipped: r.skipped, backup: r.backup?.id ?? null, repaired: r.repaired ?? [] });
    }),
  );
  // The original changed in another tool: bring in what the copy never touched, but only while no request is running (a request may be
  // reading those files). Changed-on-both-sides files and deletions stay for the user to decide. Setting autoPullSync = false turns it off.
  const AUTO_PULL_EVERY_MS = 60_000;
  let autoPulling = false;
  const autoPullTimer = setInterval(() => {
    if (autoPulling || !deps.syncBackupsRoot || store.getSetting<boolean>("autoPullSync", true) === false) return;
    autoPulling = true;
    void (async () => {
      for (const project of store.listProjects()) {
        const projectId = project.id;
        const link = store.getSetting<SyncLink | null>(linkKey(projectId), null);
        if (!link || isSyncBusy(projectId) || store.listMissions(projectId).some((m) => m.status === "running")) continue;
        try {
          const root = projectDir(store.projectsRoot, projectId);
          const paths = autoPullPaths((await computeDiffsAsync(link, root)).pull);
          if (paths.length === 0) continue;
          const dir = pullDir(path.join(deps.syncBackupsRoot!, projectId));
          const r = await withSyncLock(projectId, () => applySync(link, root, dir, { only: paths }, "pull"));
          store.setSetting(linkKey(projectId), r.link);
          summaryCache.delete(projectId);
          pruneBackups(dir, store.getSetting<number>("syncBackupKeep", DEFAULT_KEEP_BACKUPS));
          store.appendEvent({ projectId, type: "SYNC_AUTO_PULLED", payload: { source: link.sourcePath, files: r.backup?.files.length ?? 0, backup: r.backup?.id ?? null } });
        } catch {
          /* the original is gone or busy: try again next round */
        }
      }
    })().finally(() => { autoPulling = false; });
  }, AUTO_PULL_EVERY_MS);
  autoPullTimer.unref();
  router.post(
    "/projects/:projectId/sync/restore",
    syncGuarded(async (req, res, { projectId, link, backupDir }) => {
      const { backupId, direction } = z.object({ backupId: z.string().regex(/^[\w.-]{1,64}$/), direction: z.enum(["push", "pull"]).default("push") }).parse(req.body ?? {});
      if (store.listMissions(projectId).some((m) => m.status === "running")) throw new Error("実行中の依頼があります。先に一時停止してください");
      summaryCache.delete(projectId);
      store.setSetting(linkKey(projectId), await withSyncLock(projectId, () => restoreBackup(link, projectDir(store.projectsRoot, projectId), direction === "pull" ? pullDir(backupDir) : backupDir, backupId, direction)));
      store.appendEvent({ projectId, type: "SYNC_RESTORED", payload: { source: link.sourcePath, backup: backupId } });
      res.json({ ok: true });
    }),
  );
  // Body of one registered artifact (text only, capped). Only paths the DB knows about can be read.
  router.get("/projects/:projectId/artifact-content", async (req, res) => {
    const projectId = String(req.params.projectId);
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!store.listArtifacts(projectId).some((a) => a.path === relPath)) return void res.status(404).json({ error: "成果物が見つかりません" });
    try {
      const file = resolveInProject(store.projectsRoot, projectId, relPath);
      const info = await stat(file);
      if (!info.isFile()) throw new Error("ファイルではありません");
      if (info.size > MAX_ARTIFACT_BYTES) return void res.status(413).json({ error: "ファイルが大きすぎて表示できません" });
      res.json({ path: relPath, content: await readFile(file, "utf-8") });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "ファイルを読めません" });
    }
  });

  router.get("/projects/:projectId/missions", (req, res) => {
    res.json({ missions: store.listMissions(String(req.params.projectId)) });
  });
  router.get("/projects/:projectId/missions/:missionId", (req, res) => {
    res.json(view(String(req.params.projectId), String(req.params.missionId)));
  });
  router.get("/projects/:projectId/missions/:missionId/report", (req, res) => {
    res.json({ report: buildMissionReport(store, String(req.params.projectId), String(req.params.missionId), (rel) => {
      try {
        return readFileSync(resolveInProject(store.projectsRoot, String(req.params.projectId), rel), "utf-8").slice(0, MAX_ARTIFACT_BYTES);
      } catch {
        return null;
      }
    }, deps.appRoot ? verifyInfo(store, deps.appRoot, String(req.params.projectId)) : undefined) });
  });
  // Why each task has the AI it has: the selection events of the whole project (the plain events list only keeps the latest 200).
  router.get("/projects/:projectId/ai-selections", (req, res) => {
    const projectId = String(req.params.projectId);
    const types = ["AI_SELECTED", "AI_SELECTION_NONE", "AI_FALLBACK", "AI_REASSIGNED"];
    const events = types.flatMap((type) => store.listEvents({ projectId, type, limit: 1000 })).sort((a, b) => a.id - b.id);
    res.json({ events });
  });
  router.get("/projects/:projectId/events", (req, res) => {
    res.json({ events: store.listEvents({ projectId: String(req.params.projectId), limit: 200 }) });
  });

  // ---- AI Registry / Broker (Phase 4) -----------------------------------------
  // How much each AI was used lately. The sites do not tell their remaining quota, so this is what the app itself ran.
  router.get("/ai-usage", (_req, res) => {
    res.json({ usage: store.aiRunCounts() });
  });
  // Claude plan usage (shared by Claude Code and claude.ai chat), as Claude Code itself reports it; refreshed by every run and by the button.
  router.get("/claude-quota", (_req, res) => {
    res.json({ quota: readClaudeQuota(store) });
  });
  // Every capable AI is resting: what the screen shows while tasks wait for the first one to come back, and "check now".
  router.get("/all-resting", (_req, res) => {
    res.json({ state: readAllResting(store) });
  });
  router.post("/all-resting/recheck", guarded((_req, res) => {
    res.json({ woken: engine.recheckResting() });
  }));
  // The plan is nearly used up (warn) or used up (limit): what the home screen shows, and the person's choice for that case.
  router.get("/claude-limit", (_req, res) => {
    const used = readClaudeQuota(store)?.fiveHour?.utilization ?? null;
    res.json({ warn: used !== null && used >= CLAUDE_WARN_AT, utilization: used, resetsAt: readClaudeQuota(store)?.fiveHour?.resetsAt ?? null, until: claudeLimitUntil(store), policy: readClaudeLimitPolicy(store) });
  });
  router.put(
    "/claude-limit",
    guarded((req, res) => {
      const { policy } = z.object({ policy: z.enum(["wait", "reroute"]).nullable() }).parse(req.body ?? {});
      saveClaudeLimitPolicy(store, policy);
      store.appendEvent({ type: "CLAUDE_LIMIT_POLICY", payload: { policy } });
      // the work that stopped on the limit goes on by itself now (waits for the reset, or goes to another AI)
      const resumed = policy && deps.canExecute ? limitStoppedTasks(store) : [];
      for (const t of resumed) void engine.retryFailedTask(t.projectId, t.missionId, t.taskId).catch(() => {});
      res.json({ policy, resumed: resumed.length });
    }),
  );
  router.post(
    "/claude-quota/refresh",
    guarded(async (_req, res) => {
      const quota = await probeClaudeQuota(store).catch(() => null);
      if (!quota) return void res.status(502).json({ error: "Claude Code から使用量を読み取れませんでした。ログインできているか確認してください" });
      res.json({ quota });
    }),
  );
  // Where everything lives on this computer (for "where is my data?" and for support). Paths only; nothing is read from the folders.
  router.get("/environment", (req, res) => {
    const root = path.dirname(store.projectsRoot);
    const projectId = typeof req.query.projectId === "string" && PROJECT_ID_RE.test(req.query.projectId) ? req.query.projectId : null;
    const link = projectId ? store.getSetting<SyncLink | null>(linkKey(projectId), null) : null;
    res.json({
      root,
      dataDir: path.join(root, "data"),
      projectsDir: store.projectsRoot,
      backupsDir: path.join(root, "backups"),
      snapshotsDir: path.join(root, "snapshots"),
      browserProfileDir: path.join(root, "data", "browser-profile"),
      project: projectId ? { id: projectId, workDir: projectDir(store.projectsRoot, projectId), sourcePath: link?.sourcePath ?? null } : null,
      node: process.version,
      platform: process.platform,
    });
  });
  router.get("/ai-services", (_req, res) => {
    res.json({ services: store.listAiServices() });
  });
  router.post(
    "/ai-services/health-check",
    guarded(async (req, res) => {
      if (!deps.healthChecker) return void res.status(501).json({ error: "ヘルスチェックが接続されていません" });
      const { ids } = z.object({ ids: z.array(z.string().max(100)).max(100).optional() }).parse(req.body ?? {});
      res.json({ results: await deps.healthChecker.checkAll(ids), services: store.listAiServices() });
    }),
  );
  // New-AI scout: proposals wait here until the person accepts or drops them.
  router.get("/ai-scout", (_req, res) => {
    if (!deps.scout) return void res.status(501).json({ error: "新AI探しが接続されていません" });
    res.json(deps.scout.state());
  });
  router.get("/ai-roster", (_req, res) => {
    if (!deps.roster) return void res.status(501).json({ error: "AIの入れ替わりが接続されていません" });
    res.json(deps.roster.state());
  });
  router.post("/ai-roster/run", guarded(async (_req, res) => {
    if (!deps.roster) return void res.status(501).json({ error: "AIの入れ替わりが接続されていません" });
    void deps.roster.run();
    res.json({ ...deps.roster.state(), running: true });
  }));
  router.post("/ai-roster/:id/restore", guarded(async (req, res) => {
    if (!deps.roster) return void res.status(501).json({ error: "AIの入れ替わりが接続されていません" });
    if (!deps.roster.restore(String(req.params.id))) return void res.status(404).json({ error: "外したAIの中にありません" });
    res.json({ state: deps.roster.state() });
  }));
  router.post("/ai-scout/run", guarded(async (_req, res) => {
    if (!deps.scout) return void res.status(501).json({ error: "新AI探しが接続されていません" });
    void deps.scout.run();
    res.json({ ...deps.scout.state(), running: true });
  }));
  router.post("/ai-scout/:id/add", guarded(async (req, res) => {
    if (!deps.scout) return void res.status(501).json({ error: "新AI探しが接続されていません" });
    const p = deps.scout.accept(String(req.params.id));
    if (!p) return void res.status(404).json({ error: "その候補はありません" });
    res.json({ proposal: p, state: deps.scout.state() });
  }));
  router.post("/ai-scout/:id/dismiss", guarded(async (req, res) => {
    if (!deps.scout) return void res.status(501).json({ error: "新AI探しが接続されていません" });
    if (!deps.scout.dismiss(String(req.params.id))) return void res.status(404).json({ error: "その候補はありません" });
    res.json(deps.scout.state());
  }));
  // On-demand discovery (Phase 5): no-op when the registry already covers the request.
  router.post(
    "/ai-discovery",
    guarded(async (req, res) => {
      if (!deps.discovery) return void res.status(501).json({ error: "AI Discoveryが接続されていません" });
      const body = z
        .object({
          requiredCapabilities: z.array(z.string().trim().min(1).max(50)).min(1).max(10),
          language: z.string().trim().max(10).optional(),
          freeRequired: z.boolean().default(true),
          automationRequired: z.number().int().min(1).max(3).optional(),
          force: z.boolean().default(false),
          save: z.boolean().default(false),
        })
        .parse(req.body ?? {});
      res.json(await deps.discovery.discover(body));
    }),
  );
  // ---- Web AI automation (Phase 6) -------------------------------------------
  const siteSchema = z
    .object({
      inputSelector: z.string().trim().min(1).max(300),
      sendSelector: z.string().trim().max(300).optional(),
      responseSelector: z.string().trim().min(1).max(300),
      stopSelector: z.string().trim().max(300).optional(),
    })
    .strict();
  const webGuarded = (handler: (req: Request, res: Response, web: NonNullable<OrchestratorApiDeps["webAi"]>) => Promise<void> | void) =>
    guarded(async (req, res) => {
      if (!deps.webAi) return void res.status(501).json({ error: "Web AI自動化が接続されていません" });
      await handler(req, res, deps.webAi);
    });

  // Adjusting the AI scores from what really happened (see scoreTuning.ts): what changed, on/off, and putting the starting values back.
  router.get("/score-tuning", (_req, res) => {
    res.json(tuningReport(store));
  });
  router.put(
    "/score-tuning",
    guarded((req, res) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
      setTuningEnabled(store, enabled);
      store.appendEvent({ type: "SCORE_TUNING_SWITCHED", payload: { enabled } });
      res.json(tuningReport(store));
    }),
  );
  router.post(
    "/score-tuning/reset",
    guarded((req, res) => {
      const { aiId } = z.object({ aiId: z.string().max(100).optional() }).parse(req.body ?? {});
      resetTuning(store, aiId);
      store.appendEvent({ type: "SCORE_TUNING_RESET", payload: { aiId: aiId ?? "all" } });
      res.json(tuningReport(store));
    }),
  );
  // AI B Review (spec §57): a second AI of another maker checks important tasks. On by default; it needs the web AIs switched on.
  router.get("/ai-review/settings", (_req, res) => {
    const picked = pickReviewer(store, "claude-code", "design");
    res.json({ enabled: getAiReviewSettings(store).enabled, webAiEnabled: getWebAiSettings(store).enabled, reviewer: picked?.svc.name ?? null });
  });
  router.put(
    "/ai-review/settings",
    guarded((req, res) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
      setAiReviewSettings(store, { enabled });
      store.appendEvent({ type: "AI_REVIEW_SWITCHED", payload: { enabled } });
      res.json({ enabled });
    }),
  );
  router.get("/web-ai/browser-status", async (_req, res) => {
    res.json((await deps.webAi?.status?.()) ?? { loginWindowOpen: false, waiting: 0 });
  });
  router.get("/web-ai/settings", (_req, res) => {
    const settings = getWebAiSettings(store);
    res.json({
      enabled: settings.enabled,
      available: !!deps.webAi,
      browserAvailable: deps.webAi?.browserAvailable() ?? false,
      /** effective selector profile per web AI (bundled + overrides); null = Level 2/3 impossible for it */
      sites: Object.fromEntries(store.listAiServices().filter((s) => s.url).map((s) => [s.id, resolveSiteProfile(store, s.id)])),
      bundledSites: Object.keys(BUNDLED_SITE_PROFILES),
      /** AIs that cannot be driven automatically, with why: shown as "自動化待ち" */
      notAutomatable: NOT_AUTOMATABLE,
      loggedIn: settings.loggedIn,
      /** AIs that asked for a bot check: resting for a while ("rest") or no longer used until cleared ("always") */
      /** AIs that said they reached the site's limit, with when they are used again */
      usageLimits: Object.fromEntries(store.listAiServices().flatMap((s) => { const u = usageLimitUntil(store, s.id); return u ? [[s.id, u]] : []; })),
      botChecks: Object.fromEntries(store.listAiServices().flatMap((s) => { const st = botCheckState(store, s.id); return st ? [[s.id, st]] : []; })),
    });
  });
  router.put(
    "/web-ai/settings",
    webGuarded((req, res) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
      setWebAiSettings(store, { enabled });
      store.appendEvent({ type: "WEB_AI_SWITCHED", payload: { enabled } });
      res.json({ enabled });
    }),
  );
  // Selector override for one service (the bundled ones are unverified assumptions, so the user must be able to fix them).
  router.put(
    "/web-ai/sites/:aiId",
    webGuarded((req, res) => {
      const aiId = String(req.params.aiId);
      if (!store.getAiService(aiId)) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      const site = siteSchema.parse(req.body ?? {});
      const settings = getWebAiSettings(store);
      setWebAiSettings(store, { sites: { ...settings.sites, [aiId]: site } });
      res.json({ site: resolveSiteProfile(store, aiId) });
    }),
  );
  // Opens the AI's own page (from the registry, never from the request) in the automation profile so the user can sign in by hand.
  router.post(
    "/ai-services/:aiId/open-login",
    webGuarded((req, res, web) => {
      const svc = store.getAiService(String(req.params.aiId));
      if (!svc) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      if (!svc.url) throw new Error("このAIにはページのURLがありません");
      if (getWebAiSettings(store).loggedIn[svc.id]) return void res.status(409).json({ error: `${svc.name} はログイン済みになっています。ログインし直すときは、先に「ログイン済みを解除」を押してください` });
      if (!web.openLogin || !web.browserAvailable()) throw new Error("Edge・Chrome・Braveのいずれも見つからないため、ログイン用のブラウザを開けません");
      web.openLogin(svc.url);
      res.json({ ok: true, url: svc.url });
    }),
  );
  // Opens the AI's page so the person can pass a bot check by hand (never done by the app). Unlike open-login it works for signed-in AIs.
  router.post(
    "/ai-services/:aiId/open-check",
    webGuarded((req, res, web) => {
      const svc = store.getAiService(String(req.params.aiId));
      if (!svc?.url) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      if (!web.openLogin || !web.browserAvailable()) throw new Error("Edge・Chrome・Braveのいずれも見つからないため、ブラウザを開けません");
      web.openLogin(svc.url);
      res.json({ ok: true, url: svc.url });
    }),
  );
  // "Try it and make it automatic": one tiny prompt; when the AI answers by itself it is marked signed in and raised to Level 3.
  router.post(
    "/ai-services/:aiId/try-automation",
    webGuarded(async (req, res, web) => {
      const aiId = String(req.params.aiId);
      const svc = store.getAiService(aiId);
      if (!svc) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      if (!web.probe || !web.browserAvailable()) throw new Error("Edge・Chrome・Braveのいずれも見つからないため、試せません");
      const r = await web.probe(aiId);
      if (!r.ok) return void res.json({ ok: false, reason: r.reason });
      setWebAiSettings(store, { enabled: true, loggedIn: { ...getWebAiSettings(store).loggedIn, [aiId]: true } }); // an AI that works by itself switches the browser AIs on
      if (svc.automationLevel < 3) {
        store.patchAiService(aiId, { automationLevel: 3 });
        store.appendEvent({ type: "AUTOMATION_LEVEL_SET", payload: { aiId, from: svc.automationLevel, to: 3, reason: "自動の試しに成功" } });
      }
      res.json({ ok: true, service: store.getAiService(aiId) });
    }),
  );
  // Carries the Google (etc.) sign-ins of the everyday browser over, so the user does not sign in again in the automation profile.
  router.post(
    "/web-ai/import-signin",
    webGuarded(async (_req, res, web) => {
      if (!web.importSignIn || !web.browserAvailable()) throw new Error("この環境ではブラウザのログイン状態を引き継げません");
      const r = await web.importSignIn();
      store.appendEvent({ type: "WEB_AI_SIGNIN_IMPORTED", payload: { profile: r.profile } });
      res.json({ ok: true, ...r });
    }),
  );
  // The user says whether they are signed in to a service. While it is set, "open for login" is refused (nothing left to do there).
  router.put(
    "/ai-services/:aiId/logged-in",
    guarded((req, res) => {
      const aiId = String(req.params.aiId);
      if (!store.getAiService(aiId)) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      const { value } = z.object({ value: z.boolean() }).parse(req.body ?? {});
      const loggedIn = { ...getWebAiSettings(store).loggedIn };
      if (value) loggedIn[aiId] = true;
      else delete loggedIn[aiId];
      setWebAiSettings(store, { loggedIn });
      res.json({ aiId, loggedIn: value });
    }),
  );
  // Raising the level is the user's decision (it is never raised automatically); lowering is always allowed.
  router.put(
    "/ai-services/:aiId/automation-level",
    webGuarded((req, res, web) => {
      const aiId = String(req.params.aiId);
      const svc = store.getAiService(aiId);
      if (!svc) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      const { level } = z.object({ level: z.number().int().min(1).max(3) }).parse(req.body ?? {});
      if (level > 1 && (!svc.url || !resolveSiteProfile(store, aiId))) throw new Error("このAIにはサイト設定(入力欄・回答欄のセレクタ)がないため、Level 2/3にできません。先に /web-ai/sites で設定してください");
      if (level > 1 && !web.browserAvailable()) throw new Error("Edge・Chrome・Braveのいずれも見つからないため、Level 2/3にできません");
      store.patchAiService(aiId, { automationLevel: level });
      store.appendEvent({ type: "AUTOMATION_LEVEL_SET", payload: { aiId, from: svc.automationLevel, to: level } });
      res.json({ service: store.getAiService(aiId) });
    }),
  );
  // ---- Live log of a running task ---------------------------------------------------------------
  router.get("/projects/:projectId/tasks/:taskId/log", (req, res) => {
    const projectId = String(req.params.projectId);
    const taskId = String(req.params.taskId);
    const task = store.getTask(projectId, taskId);
    if (!task) return void res.status(404).json({ error: "作業が見つかりません" });
    const after = Number(req.query.after ?? 0);
    res.json({ status: task.status, entries: deps.logs?.read(taskId, Number.isFinite(after) ? after : 0) ?? [] });
  });

  // ---- Changes made by one task: diff and rollback ---------------------------------------------
  const snapshotName = (projectId: string, taskId: string): string | null => {
    const e = store.listEvents({ projectId, type: "TASK_SNAPSHOT", limit: 1000 }).filter((x) => x.taskId === taskId);
    const last = e[e.length - 1]?.payload as { name?: string } | undefined;
    return last?.name ?? null;
  };
  router.get("/projects/:projectId/tasks/:taskId/changes", async (req, res) => {
    const projectId = String(req.params.projectId);
    const taskId = String(req.params.taskId);
    if (!deps.snapshots) return void res.json({ changes: null });
    const name = snapshotName(projectId, taskId);
    if (!name) return void res.json({ changes: null });
    try {
      res.json({ changes: await deps.snapshots.diff(projectId, `${name}-before`, `${name}-after`) });
    } catch (err) {
      fail(res, err, 500);
    }
  });
  router.post(
    "/projects/:projectId/tasks/:taskId/rollback",
    guarded(async (req, res) => {
      const projectId = String(req.params.projectId);
      const taskId = String(req.params.taskId);
      if (!deps.snapshots) return void res.status(501).json({ error: "ロールバック機能が接続されていません" });
      if (store.listMissions(projectId).some((m) => m.status === "running")) throw new Error("実行中の依頼があります。先に一時停止してください");
      const name = snapshotName(projectId, taskId);
      if (!name) throw new Error("この作業の変更履歴がありません");
      const files = await deps.snapshots.rollback(projectId, `${name}-before`, `${name}-after`);
      store.appendEvent({ projectId, taskId, type: "TASK_ROLLBACK", payload: { files } });
      res.json({ restored: files });
    }),
  );

  // ---- Before/after: the project as it was around each task, served as a static site ------------
  // Lists the tasks that have a snapshot (newest last), so the UI can pick what to compare against.
  router.get("/projects/:projectId/snapshots", (req, res) => {
    const projectId = String(req.params.projectId);
    if (!deps.snapshots) return void res.json({ snapshots: [] });
    const tasks = new Map(store.listTasks(projectId).map((t) => [t.id, t]));
    const seen = new Set<string>();
    const snapshots: { name: string; taskId: string; objective: string; at: string }[] = [];
    for (const e of store.listEvents({ projectId, type: "TASK_SNAPSHOT", limit: 1000 })) {
      const name = (e.payload as { name?: string } | null)?.name;
      if (!e.taskId || !name || seen.has(name)) continue;
      seen.add(name);
      snapshots.push({ name, taskId: e.taskId, objective: tasks.get(e.taskId)?.objective ?? "", at: e.createdAt });
    }
    res.json({ snapshots });
  });
  // Files of `<name>-before` / `<name>-after`. The page is shown in a sandboxed iframe; the header sandboxes it again.
  router.get(/^\/projects\/([^/]+)\/snapshot-site\/([\w.-]+)\/(before|after)\/(.*)$/, async (req, res) => {
    const params = req.params as unknown as Record<string, string>;
    const [projectId = "", name = "", which = "", rest = ""] = [params[0], params[1], params[2], params[3]];
    if (!deps.snapshots || !PROJECT_ID_RE.test(projectId)) return void res.status(404).end();
    const ref = `${name}-${which}`;
    let rel = rest; // express has already percent-decoded the captures
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let body = await deps.snapshots.readFile(projectId, ref, rel);
    if (!body && rel === "index.html") {
      // No page at the root: fall back to the shallowest index.html, as the live preview does.
      const hit = (await deps.snapshots.listFiles(projectId, ref)).filter((f) => f.endsWith("/index.html") && !f.includes("node_modules/")).sort((a, b) => a.split("/").length - b.split("/").length)[0];
      if (hit) return void res.redirect(`/api/v2/projects/${encodeURIComponent(projectId)}/snapshot-site/${name}/${which}/${hit.split("/").map(encodeURIComponent).join("/")}`);
    }
    if (!body) return void res.status(404).type("text/plain").send("このスナップショットにそのファイルはありません");
    res.set({ "content-type": MIME[path.extname(rel).toLowerCase()] ?? "application/octet-stream", "content-security-policy": "sandbox allow-scripts", "cache-control": "no-store" }).send(body);
  });

  // ---- Preview: run what has been built so far ----------------------------------------------
  router.get("/projects/:projectId/preview", (req, res) => {
    res.json({ preview: deps.previews?.status(String(req.params.projectId)) ?? null });
  });
  router.post(
    "/projects/:projectId/preview/start",
    guarded((req, res) => {
      if (!deps.previews) return void res.status(501).json({ error: "プレビュー機能が接続されていません" });
      res.json({ preview: deps.previews.start(String(req.params.projectId)) });
    }),
  );
  router.post(
    "/projects/:projectId/preview/stop",
    guarded((req, res) => {
      if (!deps.previews) return void res.status(501).json({ error: "プレビュー機能が接続されていません" });
      deps.previews.stop(String(req.params.projectId));
      res.json({ preview: deps.previews.status(String(req.params.projectId)) });
    }),
  );

  // ---- Dependencies of an imported project: shown when node_modules is missing; installed only on the user's click ----
  router.get("/projects/:projectId/deps", (req, res) => {
    const projectId = String(req.params.projectId);
    if (!deps.deps) return void res.json({ missing: [], install: { state: "idle", message: "", log: "", startedAt: null } });
    res.json({ missing: deps.deps.missing(projectId), install: deps.deps.status(projectId) });
  });
  router.post(
    "/projects/:projectId/deps/install",
    guarded((req, res) => {
      if (!deps.deps) return void res.status(501).json({ error: "インストール機能が接続されていません" });
      res.json({ install: deps.deps.start(String(req.params.projectId)) });
    }),
  );

  // ---- Approvals: a task needing a level above the default waits for the user's answer ----------
  router.get("/approvals", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json({ approvals: deps.approvals?.list(projectId) ?? [] });
  });
  for (const [name, approved] of [["approve", true], ["deny", false]] as const) {
    router.post(
      `/approvals/:id/${name}`,
      guarded((req, res) => {
        if (!deps.approvals) return void res.status(501).json({ error: "承認機能が接続されていません" });
        deps.approvals.resolve(String(req.params.id), approved);
        res.json({ ok: true });
      }),
    );
  }

  router.get("/web-handoffs", (req, res) => {
    if (!deps.webAi) return void res.status(501).json({ error: "Web AI自動化が接続されていません" });
    const query = z.object({ projectId: z.string().max(100).optional(), status: z.enum(["pending", "submitted", "skipped", "cancelled"]).optional() }).safeParse(req.query);
    if (!query.success) return void res.status(400).json({ error: "クエリが不正です" });
    deps.webAi.hub.closeStale();
    // Each handoff also lists the other web AIs the user could hand it to (free ones only, never an API-key one).
    const handoffs = deps.webAi.hub.list(query.data).map((h) => ({
      ...h,
      alternatives: store
        .listAiServices()
        .filter((s) => s.id !== h.aiId && s.status === "active" && !!s.url && !s.requiresApiKey && s.freeStatus !== "paid" && (WEB_ADAPTER_TYPES as readonly string[]).includes(s.adapterType))
        .map((s) => ({ id: s.id, name: s.name, freeStatus: s.freeStatus })),
    }));
    res.json({ handoffs });
  });
  router.post(
    "/web-handoffs/:id/reassign",
    webGuarded((req, res, web) => {
      const { aiId } = z.object({ aiId: z.string().max(100) }).parse(req.body ?? {});
      const target = store.getAiService(aiId);
      if (!target || !target.url || target.requiresApiKey || target.freeStatus === "paid" || !(WEB_ADAPTER_TYPES as readonly string[]).includes(target.adapterType)) {
        return void res.status(400).json({ error: "そのAIには切り替えられません" });
      }
      res.json({ handoff: web.hub.reassign(String(req.params.id), aiId) });
    }),
  );
  router.post(
    "/web-handoffs/:id/result",
    webGuarded((req, res, web) => {
      const { text } = z.object({ text: z.string() }).parse(req.body ?? {});
      res.json({ handoff: web.hub.submit(String(req.params.id), text) });
    }),
  );
  router.post(
    "/web-handoffs/:id/skip",
    webGuarded((req, res, web) => {
      const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
      res.json({ handoff: web.hub.skip(String(req.params.id), note) });
    }),
  );

  // Dry run of the Broker: which AI would be chosen for a role, and why. Changes nothing.
  router.get("/broker/preview", (req, res) => {
    const query = z.object({ role: z.string().trim().min(1).max(100), budget: z.enum(["free_only", "allow_paid"]).default("free_only") }).safeParse(req.query);
    if (!query.success) return void res.status(400).json({ error: "role を指定してください" });
    const decision = new AIBroker(store).select({ role: query.data.role }, { budgetPolicy: query.data.budget, executableAdapters: typeof deps.executableAdapters === "function" ? deps.executableAdapters() : deps.executableAdapters });
    res.json({ role: query.data.role, capability: capabilityForTaskRole(query.data.role), decision });
  });

  router.post(
    "/projects/:projectId/missions",
    guarded(async (req, res) => {
      const body = createSchema.parse(req.body);
      if (/\(ここに[^)]*\)/.test(body.goal)) return void res.status(400).json({ error: "依頼文に「(ここに…)」という書きかけの部分が残っています。書き換えてから、もう一度出してください" });
      const { mission } = await engine.createMission({ projectId: String(req.params.projectId), ...body });
      res.status(201).json(view(mission.projectId, mission.id));
    }),
  );

  const action = (name: string, fn: (projectId: string, missionId: string, body: { feedback: string; run: boolean }) => Promise<unknown> | unknown, needsExecutor = false) =>
    router.post(
      `/projects/:projectId/missions/:missionId/${name}`,
      guarded(async (req, res) => {
        if (needsExecutor && !deps.canExecute) return void res.status(501).json({ error: "実行基盤が接続されていないため、実行できません" });
        const projectId = String(req.params.projectId);
        const missionId = String(req.params.missionId);
        await fn(projectId, missionId, feedbackSchema.parse(req.body ?? {}));
        res.json(view(projectId, missionId));
      }),
    );

  router.post(
    "/projects/:projectId/missions/:missionId/tasks/:taskId/retry",
    guarded(async (req, res) => {
      if (!deps.canExecute) return void res.status(501).json({ error: "実行基盤が接続されていないため、実行できません" });
      const projectId = String(req.params.projectId);
      const missionId = String(req.params.missionId);
      const { feedback } = feedbackSchema.parse(req.body ?? {});
      void engine.retryFailedTask(projectId, missionId, String(req.params.taskId), feedback || undefined).catch(() => {});
      res.json(view(projectId, missionId));
    }),
  );

  action("approve", (p, m, b) => {
    if (b.run && !deps.canExecute) throw new Error("実行基盤が接続されていないため、実行できません");
    engine.approvePlan(p, m);
    if (b.run) void engine.run(p, m).catch(() => {});
  });
  action("reject", (p, m, b) => {
    if (!b.feedback) throw new Error("修正してほしい点(feedback)を入力してください");
    return engine.rejectPlan(p, m, b.feedback);
  });
  action("replan", (p, m, b) => engine.replan(p, m, b.feedback || undefined));
  action("redirect", (p, m, b) => {
    if (!b.feedback) throw new Error("新しい方針を入力してください");
    return engine.redirect(p, m, b.feedback);
  });
  action("pause", (p, m) => engine.pause(p, m));
  action("cancel", (p, m) => engine.cancel(p, m));
  // run/resume return once the loop is started; progress is read via GET.
  action(
    "run",
    (p, m) => {
      void engine.run(p, m).catch(() => {});
    },
    true,
  );
  action(
    "resume",
    (p, m) => {
      void engine.resume(p, m).catch(() => {});
    },
    true,
  );

  return router;
}
