import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { MissionEngine } from "./missionEngine.ts";
import type { Store } from "./store.ts";
import { PROJECT_ID_RE } from "./paths.ts";
import { AIBroker, capabilityForTaskRole } from "./aiBroker.ts";
import type { AiHealthChecker } from "./aiHealth.ts";
import type { AiDiscovery } from "./aiDiscovery.ts";

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
  /** Adapter types the wired executor can run, so /broker/preview matches what a mission would really pick. */
  executableAdapters?: string[];
};

const createSchema = z.object({
  goal: z.string().trim().min(1).max(4000),
  constraints: z.array(z.string().max(500)).max(50).default([]),
  technologyPreferences: z.array(z.string().max(200)).max(50).default([]),
});
const feedbackSchema = z.object({ feedback: z.string().trim().max(4000).default("") });

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
  // Dry run of the Broker: which AI would be chosen for a role, and why. Changes nothing.
  router.get("/broker/preview", (req, res) => {
    const query = z.object({ role: z.string().trim().min(1).max(100), budget: z.enum(["free_only", "allow_paid"]).default("free_only") }).safeParse(req.query);
    if (!query.success) return void res.status(400).json({ error: "role を指定してください" });
    const decision = new AIBroker(store).select({ role: query.data.role }, { budgetPolicy: query.data.budget, executableAdapters: deps.executableAdapters });
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
