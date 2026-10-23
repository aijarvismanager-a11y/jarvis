import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { MissionEngine } from "./missionEngine.ts";
import type { Store } from "./store.ts";
import { readFile, stat } from "node:fs/promises";
import { PROJECT_ID_RE, resolveInProject } from "./paths.ts";
import { AIBroker, capabilityForTaskRole } from "./aiBroker.ts";
import type { AiHealthChecker } from "./aiHealth.ts";
import type { AiDiscovery } from "./aiDiscovery.ts";
import type { ApprovalHub } from "./approvalHub.ts";
import type { WebHandoffHub } from "./webHandoff.ts";
import { BUNDLED_SITE_PROFILES, getWebAiSettings, resolveSiteProfile, setWebAiSettings } from "./webAiSites.ts";

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
  /** Adapter types the wired executor can run, so /broker/preview matches what a mission would really pick. Read per request: the web AI switch changes it. */
  executableAdapters?: string[] | (() => string[]);
  /** Enables answering approval requests (POST /approvals/:id/approve|deny). */
  approvals?: ApprovalHub;
  /** Enables the Web AI endpoints (handoffs, settings, site profiles); without it they answer 501. */
  webAi?: { hub: WebHandoffHub; browserAvailable: () => boolean };
};

const createSchema = z.object({
  goal: z.string().trim().min(1).max(4000),
  constraints: z.array(z.string().max(500)).max(50).default([]),
  technologyPreferences: z.array(z.string().max(200)).max(50).default([]),
});
const MAX_ARTIFACT_BYTES = 1_000_000;
const feedbackSchema = z.object({ feedback: z.string().trim().max(4000).default("") });

/** Why a task is failed / blocked, for the UI: the last failure reason, or which task it is waiting on. */
function taskNotes(store: Store, projectId: string, tasks: ReturnType<Store["listTasks"]>): Record<string, string> {
  const notes: Record<string, string> = {};
  const reasons = new Map<string, string>();
  for (const e of store.listEvents({ projectId, limit: 1000 })) {
    const p = e.payload as { to?: string; reason?: string };
    if (e.type === "TASK_TRANSITION" && e.taskId && p.to === "failed" && p.reason) reasons.set(e.taskId, p.reason);
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
    if (!store.getMission(String(req.params.projectId), id)) return void res.status(404).json({ error: "ミッションが見つかりません" });
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

  // ---- Projects / artifacts (Phase 7 UI) ---------------------------------------
  router.get("/projects", (_req, res) => {
    res.json({ projects: store.listProjects() });
  });
  router.post(
    "/projects",
    guarded((req, res) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body ?? {});
      res.status(201).json({ project: store.createProject({ name }) });
    }),
  );
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
  router.get("/projects/:projectId/events", (req, res) => {
    res.json({ events: store.listEvents({ projectId: String(req.params.projectId), limit: 200 }) });
  });

  // ---- AI Registry / Broker (Phase 4) -----------------------------------------
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

  router.get("/web-ai/settings", (_req, res) => {
    const settings = getWebAiSettings(store);
    res.json({
      enabled: settings.enabled,
      available: !!deps.webAi,
      browserAvailable: deps.webAi?.browserAvailable() ?? false,
      /** effective selector profile per web AI (bundled + overrides); null = Level 2/3 impossible for it */
      sites: Object.fromEntries(store.listAiServices().filter((s) => s.url).map((s) => [s.id, resolveSiteProfile(store, s.id)])),
      bundledSites: Object.keys(BUNDLED_SITE_PROFILES),
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
  // Raising the level is the user's decision (it is never raised automatically); lowering is always allowed.
  router.put(
    "/ai-services/:aiId/automation-level",
    webGuarded((req, res, web) => {
      const aiId = String(req.params.aiId);
      const svc = store.getAiService(aiId);
      if (!svc) return void res.status(404).json({ error: "AIサービスが見つかりません" });
      const { level } = z.object({ level: z.number().int().min(1).max(3) }).parse(req.body ?? {});
      if (level > 1 && (!svc.url || !resolveSiteProfile(store, aiId))) throw new Error("このAIにはサイト設定(入力欄・回答欄のセレクタ)がないため、Level 2/3にできません。先に /web-ai/sites で設定してください");
      if (level > 1 && !web.browserAvailable()) throw new Error("EdgeまたはChromeが見つからないため、Level 2/3にできません");
      store.patchAiService(aiId, { automationLevel: level });
      store.appendEvent({ type: "AUTOMATION_LEVEL_SET", payload: { aiId, from: svc.automationLevel, to: level } });
      res.json({ service: store.getAiService(aiId) });
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
    res.json({ handoffs: deps.webAi.hub.list(query.data) });
  });
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
      const { mission } = await engine.createMission({ projectId: String(req.params.projectId), ...body });
      res.status(201).json(view(mission.projectId, mission.id));
    }),
  );

  const action = (name: string, fn: (projectId: string, missionId: string, body: { feedback: string }) => Promise<unknown> | unknown, needsExecutor = false) =>
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

  action("approve", (p, m) => engine.approvePlan(p, m));
  action("reject", (p, m, b) => {
    if (!b.feedback) throw new Error("修正してほしい点(feedback)を入力してください");
    return engine.rejectPlan(p, m, b.feedback);
  });
  action("replan", (p, m, b) => engine.replan(p, m, b.feedback || undefined));
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
