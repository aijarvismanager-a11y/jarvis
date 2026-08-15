/**
 * Glue layer: wraps existing Jarvis adapters into the function-shape that the
 * SandboxApi service-backend slots expect. Each `/v1/jarvis/*` route takes a
 * function or object on `SandboxApiServices`; the legacy adapters expose
 * different signatures that grew before this engine wiring landed. This
 * module lives here (not in the daemon) so the wiring is testable + reused
 * by the L gmail smoke test.
 *
 * Lives outside `adapters/` so the eventual K3 deletion of the legacy
 * adapters doesn't have to thread through this file.
 */

import type { LLMManager } from "../../llm/manager";
import type { ToolRegistry } from "../../actions/tools/registry";
import type { ChannelService } from "../../daemon/channel-service";
import type { WebSocketService } from "../../daemon/ws-service";
import type { AgentOrchestrator } from "../../agents/orchestrator";
import type { AuthorityEngine } from "../../authority/engine";
import type { AuditTrail } from "../../authority/audit";
import type { EmergencyController } from "../../authority/emergency";
import type { ApprovalManager } from "../../authority/approval";
import type { RoleDefinition } from "../../roles/types";
import type { TaskDispatcher } from "../../agents/conv/task-dispatcher";
import { JarvisLlmClient } from "../adapters/llm-client";
import { JarvisToolRegistryAdapter } from "../adapters/tool-registry";
import { JarvisNotifierAdapter, type NotifierDeps } from "../adapters/notifier";
import { JarvisContextProviderAdapter } from "../adapters/context-provider";
import { LlmOnlyAgentDelegator } from "../adapters/agent-delegator";
import { M7AgentDelegator } from "../adapters/m7-agent-delegator";
import { JarvisWorkflowRunnerAdapter } from "../adapters/workflow-runner";
import type { LlmChatFn } from "../sandbox-api/routes/jarvis-llm";
import type { SystemPromptParts } from "../../roles/prompt-builder";
import type { ToolsInvokeFn } from "../sandbox-api/routes/jarvis-tools";
import type { NotifyFn } from "../sandbox-api/routes/jarvis-notify";
import type { JarvisContextProvider } from "../sandbox-api/routes/jarvis-context";
import type { AgentDelegateFn } from "../sandbox-api/routes/jarvis-agent";
import type { EventsPollFn } from "../sandbox-api/routes/jarvis-events";
import type { WorkflowsStartFn } from "../sandbox-api/routes/jarvis-workflows";
import type { RouterChatFn } from "../sandbox-api/routes/jarvis-router";
import type { ManagerRunProjectFn, ManagerAssignAgentFn } from "../sandbox-api/routes/jarvis-manager";
import type { CouncilConveneFn } from "../sandbox-api/routes/jarvis-council";
import type { HandoffSendFn, HandoffListFn } from "../sandbox-api/routes/jarvis-handoff";
import type { QARunFn } from "../sandbox-api/routes/jarvis-qa";
import type { ApprovalRequestFn } from "../sandbox-api/routes/jarvis-approval";
import type { MemoryWriteFn } from "../sandbox-api/routes/jarvis-memory";
import type { DecisionWriteFn } from "../sandbox-api/routes/jarvis-decision";
import type { GitCommitFn, GitPushFn } from "../sandbox-api/routes/jarvis-git";
import type { SandboxApiServices } from "../sandbox-api/server";
import type { CredentialResolver } from "../credentials/adapter";
import { WorkflowEventBuffer } from "./event-buffer";
import { AIRouter, ManagerAgent, AICouncil, QAAgent } from "../../ai-manager/index";
import { sendHandoff, getHandoffsForTask, type Handoff } from "../../agents/handoff";
import { createFact } from "../../vault/facts";
import { createDecision } from "../../vault/decisions";
import { commit as gitCommitImpl, push as gitPushImpl } from "../../github/git";
import { getActionForTool } from "../../authority/tool-action-map";
import type { ProjectTemplate } from "../../vault/projects";
import type { ActionCategory } from "../../roles/authority";

const VALID_PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  "website", "web_app", "software", "research", "content", "data_project", "automation", "custom",
];

const VALID_ACTION_CATEGORIES: readonly ActionCategory[] = [
  "read_data", "write_data", "delete_data", "send_message", "send_email",
  "execute_command", "install_software", "make_payment", "modify_settings",
  "spawn_agent", "terminate_agent", "access_browser", "control_app", "git_operation",
];

export interface BuildServiceBackendsOptions {
  credentialResolver: CredentialResolver;
  llmManager: LLMManager;
  toolRegistry?: ToolRegistry;
  channelService: ChannelService;
  wsService: WebSocketService;
  /**
   * Optional desktop-notification sender. Receives `(title, body)`. The daemon
   * passes a function that calls `sendDesktopNotification` with normal urgency.
   */
  sendDesktop?: (title: string, body: string) => Promise<void>;
  /** Recent-events buffer for `jarvis-trigger:on_event` polling. */
  eventBuffer: WorkflowEventBuffer;
  /**
   * URL prefix used to mint resumeUrl values for waitpoints. Should be a
   * publicly reachable URL of the daemon. Default: empty string -- the
   * waitpoint route will mint relative URLs that callers must concatenate.
   */
  resumeUrlPrefix?: string;
  /**
   * M7 sub-agent dependencies. When all of these are supplied, `jarvis-agent.delegate`
   * runs the full LLM + tool loop via `runSubAgent`. When any are missing,
   * the backend falls back to the single-shot `LlmOnlyAgentDelegator`.
   *
   * The fallback exists so:
   *   - tests that don't care about agent delegation can omit the wiring,
   *   - the workflow runtime stays usable in early-boot windows before the
   *     daemon's agent-service has finished initializing.
   *
   * Production wiring should always supply all four: orchestrator,
   * specialists, authorityEngine, auditTrail/emergencyController.
   */
  agentOrchestrator?: AgentOrchestrator;
  agentSpecialists?: Map<string, RoleDefinition>;
  authorityEngine?: AuthorityEngine;
  auditTrail?: AuditTrail;
  emergencyController?: EmergencyController;
  /**
   * Phase 9 (AI Manager workflow integration). `taskDispatcher` powers the
   * "AI Task" node (`ManagerAgent.handleRequest`) -- unset in classic mode
   * (no llm.tiers.conversation configured), in which case that one backend
   * is omitted and the route 503s while every other Phase 9 node (council,
   * handoff, QA, router, memory/decision write, git) still works.
   * `approvalManager` powers the "Approval" node and the authority gate the
   * "Git Push" node runs through -- see the gate note on `gitPush` below.
   */
  taskDispatcher?: TaskDispatcher;
  approvalManager?: ApprovalManager;
  /**
   * Optional callback that builds the Jarvis-flavoured system prompt for
   * a workflow LLM call. When set, the `jarvis-ask` piece will pass this
   * prompt to the LLM so the model knows it's Jarvis (role, personality,
   * vault context). Skipped when the piece's `system` field is set --
   * that's the user's explicit override.
   *
   * Returned split at the prompt-cache boundary (static role prompt vs
   * per-call context) so the provider can cache the static prefix across
   * workflow LLM calls.
   *
   * Production wiring passes `AgentService.buildFullSystemPromptParts`.
   */
  buildJarvisSystemPrompt?: (userMessage: string) => SystemPromptParts;
}

export function buildSandboxServiceBackends(
  opts: BuildServiceBackendsOptions,
): SandboxApiServices {
  const llmClient = new JarvisLlmClient(opts.llmManager);
  const llmChat: LlmChatFn = async (req) => {
    // System-prompt composition:
    //   - overrideSystem=true       : use `req.system` only. Jarvis
    //                                 context (role, personality, vault
    //                                 knowledge) is dropped. Picked when
    //                                 the user wants generic LLM behaviour
    //                                 (text transforms, summarisation of
    //                                 inputs that shouldn't be coloured
    //                                 by Jarvis's identity).
    //   - `req.system` set, default : Jarvis prompt + "\n\n" + req.system.
    //                                 Lets the user steer the reply (e.g.
    //                                 "respond in JSON") while keeping the
    //                                 Jarvis identity.
    //   - no `req.system`           : Jarvis prompt alone. Default for
    //                                 plain "ask Jarvis" steps.
    //   - no prompt builder wired   : whatever the piece sent (or nothing).
    //                                 Defensive fallback for tests / pre-
    //                                 agent-service bootstrap windows.
    const jarvisParts = opts.buildJarvisSystemPrompt
      ? opts.buildJarvisSystemPrompt(req.prompt)
      : undefined;
    let system: string | undefined;
    let systemParts: { static: string; dynamic?: string } | undefined;
    if (req.overrideSystem) {
      system = req.system;
    } else if (jarvisParts) {
      // Static Jarvis prefix stays cacheable; per-call context and the
      // piece's steering prompt ride on the dynamic half. Rendered text is
      // identical to the old `jarvis + '\n\n' + req.system` join.
      const dynamic = [jarvisParts.dynamic, req.system].filter(Boolean).join('\n\n');
      systemParts = { static: jarvisParts.static, ...(dynamic ? { dynamic } : {}) };
    } else {
      system = req.system;
    }
    const reply = await llmClient.chat({
      prompt: req.prompt,
      ...(system !== undefined ? { system } : {}),
      ...(systemParts !== undefined ? { systemParts } : {}),
    });
    if (req.parseJson) {
      try {
        return { text: reply.text, parsed: JSON.parse(reply.text) };
      } catch {
        // Fall back to the raw text; the piece-side action surfaces both
        // fields so the caller can handle parse failures explicitly.
        return { text: reply.text };
      }
    }
    return { text: reply.text };
  };

  const toolAdapter = opts.toolRegistry
    ? new JarvisToolRegistryAdapter(opts.toolRegistry)
    : null;
  const toolsInvoke: ToolsInvokeFn | undefined = toolAdapter
    ? async (req) => {
        if (!toolAdapter.has(req.toolName)) {
          throw new Error(`tool not found: ${req.toolName}`);
        }
        const result = await toolAdapter.execute(req.toolName, req.params);
        return { result, toolName: req.toolName };
      }
    : undefined;

  const notifierDeps: NotifierDeps = {
    broadcastToDashboard: (text, priority) =>
      opts.wsService.broadcastNotification(text, priority),
    // Real per-channel routing: tryBroadcastToChannels iterates the requested
    // names, dispatches each to its adapter, and reports delivered/failed
    // independently. A flow that says "telegram" only goes to telegram (with
    // a clear error when the adapter isn't connected or no recipient is
    // known yet). Replaces the previous broadcastToAll fan-out which sent
    // every notification to every connected channel.
    broadcastToChannels: (channels, text) =>
      opts.channelService.tryBroadcastToChannels(channels, text),
    // Voice channel = TTS over the same WS path used by awareness
    // suggestions. No-op when no client is connected or no TTS provider
    // is configured; the underlying method handles both.
    sendVoice: (text) => opts.wsService.broadcastProactiveVoice(text),
    // Drives `auto`-channel expansion so unconfigured external channels
    // don't surface as failures on every notification. Explicit
    // `["telegram"]` still bypasses this and attempts delivery either way.
    getConnectedExternalChannels: () => {
      const status = opts.channelService.getChannelStatus();
      const live = new Set<string>();
      for (const [name, connected] of Object.entries(status)) {
        if (connected) live.add(name);
      }
      return live;
    },
    ...(opts.sendDesktop ? { sendDesktop: opts.sendDesktop } : {}),
  };
  const notifierAdapter = new JarvisNotifierAdapter(notifierDeps);
  const notify: NotifyFn = async (req) => {
    const result = await notifierAdapter.notify({
      message: req.message,
      channels: req.channels as Parameters<typeof notifierAdapter.notify>[0]["channels"],
      priority: req.priority,
    });
    return { delivered: result.delivered, failed: result.failed };
  };

  const contextAdapter = new JarvisContextProviderAdapter();
  const contextProvider: JarvisContextProvider = {
    vaultSearch: (input) =>
      contextAdapter.vaultSearch(
        input as Parameters<typeof contextAdapter.vaultSearch>[0],
      ),
    vaultGetEntity: (id) => contextAdapter.vaultGetEntity(id),
    awarenessRecent: (input) => contextAdapter.awarenessRecent(input),
    commitmentsList: (input) =>
      contextAdapter.commitmentsList(
        input as Parameters<typeof contextAdapter.commitmentsList>[0],
      ),
  };

  // Prefer the full M7 loop when the daemon supplied an orchestrator +
  // specialist registry. Fall back to the single-shot LLM delegator
  // otherwise -- workflow runs still get *some* answer instead of a 503.
  const m7Ready =
    opts.agentOrchestrator !== undefined && opts.agentSpecialists !== undefined;
  const agentAdapter = m7Ready
    ? new M7AgentDelegator({
        orchestrator: opts.agentOrchestrator!,
        llmManager: opts.llmManager,
        specialists: opts.agentSpecialists!,
        ...(opts.authorityEngine ? { authorityEngine: opts.authorityEngine } : {}),
        ...(opts.auditTrail ? { auditTrail: opts.auditTrail } : {}),
        ...(opts.emergencyController ? { emergencyController: opts.emergencyController } : {}),
      })
    : new LlmOnlyAgentDelegator(llmClient);
  const agentDelegate: AgentDelegateFn = async (req) => {
    const result = await agentAdapter.delegate({
      goal: req.goal,
      ...(req.role !== undefined ? { role: req.role } : {}),
      ...(req.maxIterations !== undefined ? { maxIterations: req.maxIterations } : {}),
    });
    return result;
  };

  const eventsPoll: EventsPollFn = async (req) => {
    const reply = opts.eventBuffer.poll(req);
    // The route's `JarvisEvent` types `id` as a string (consistent with all
    // other engine ids); the buffer assigns monotonic numbers internally.
    // Stringify at the boundary so the wire shape stays uniform.
    return {
      events: reply.events.map((ev) => ({
        id: String(ev.id),
        eventType: ev.eventType,
        payload: ev.payload,
        timestamp: ev.timestamp,
      })),
      cursor: reply.cursor,
    };
  };

  const runnerAdapter = new JarvisWorkflowRunnerAdapter();
  const workflowsStart: WorkflowsStartFn = async (req, ctx) => {
    const out = await runnerAdapter.start(
      {
        flowId: req.flowId,
        ...(req.payload !== undefined ? { payload: req.payload } : {}),
      },
      // Caller's run id lets the adapter walk the parent-run chain
      // and refuse cycles. Plumbed in by the sandbox-api route from
      // `ctx.claims.runId`.
      ctx.runId,
    );
    return { runId: out.runId };
  };

  // Phase 9: AI Manager workflow-integration backends. AIRouter/ManagerAgent/
  // AICouncil are cheap to construct (thin wrappers over LLMManager/
  // TaskDispatcher, no state of their own -- see src/ai-manager/api/routes.ts
  // for the same per-call construction pattern), so a fresh instance is
  // built per call rather than held as a field here.
  const router = new AIRouter(opts.llmManager);

  const routerChat: RouterChatFn = async (req) => {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const response = await router.chat(
      { template: req.template, mode: req.mode, subsystem: req.subsystem ?? "workflow_router" },
      messages,
    );
    return {
      text: response.content ?? "",
      tier: response.routing.tier,
      mode: response.routing.mode,
      recent_error_rate: response.routing.recent_error_rate,
    };
  };

  const managerRunProject: ManagerRunProjectFn | undefined = opts.taskDispatcher
    ? async (req) => {
        if (req.template !== undefined && !VALID_PROJECT_TEMPLATES.includes(req.template as ProjectTemplate)) {
          throw new Error(`template must be one of: ${VALID_PROJECT_TEMPLATES.join(", ")}`);
        }
        const manager = new ManagerAgent(router, opts.taskDispatcher!);
        return manager.handleRequest(req.name, req.request, {
          ...(req.template !== undefined ? { template: req.template as ProjectTemplate } : {}),
          ...(req.execution_mode !== undefined ? { execution_mode: req.execution_mode } : {}),
        });
      }
    : undefined;

  const managerAssignAgent: ManagerAssignAgentFn = async (req) => {
    return router.route({ template: req.template, mode: req.mode });
  };

  const councilConvene: CouncilConveneFn = async (req) => {
    const council = new AICouncil(router);
    return council.convene(req.question, {
      seats: req.seats,
      template: req.template,
      project_id: req.project_id,
      record: req.record,
    });
  };

  const handoffSend: HandoffSendFn = async (req) => {
    const handoff: Handoff = {
      task_id: req.task_id,
      from_agent: req.from_agent,
      to_agent: req.to_agent,
      status: req.status,
      summary: req.summary,
      instructions: req.instructions ?? [],
      artifacts: req.artifacts ?? [],
      decisions: req.decisions ?? [],
      warnings: req.warnings ?? [],
      open_questions: req.open_questions ?? [],
      next_action: req.next_action,
    };
    const message = sendHandoff(handoff, {
      ...(req.project_id !== undefined ? { project_id: req.project_id } : {}),
      ...(req.priority === "high" || req.priority === "normal" ? { priority: req.priority } : {}),
    });
    return { id: message.id };
  };

  const handoffList: HandoffListFn = async (req) => {
    return { handoffs: getHandoffsForTask(req.task_id) };
  };

  const qaRun: QARunFn = async (req) => {
    const qa = new QAAgent();
    return qa.run(req);
  };

  // Generic human-in-the-loop gate for the "Approval" node. Always inline:
  // nothing auto-executes on approval here (see jarvis-approval.ts's header
  // note) -- the flow branches on the returned status itself.
  const approvalRequest: ApprovalRequestFn | undefined = opts.approvalManager
    ? async (req) => {
        if (!VALID_ACTION_CATEGORIES.includes(req.actionCategory as ActionCategory)) {
          throw new Error(`actionCategory must be one of: ${VALID_ACTION_CATEGORIES.join(", ")}`);
        }
        const request = opts.approvalManager!.createRequest({
          agentId: "workflow",
          agentName: "Workflow",
          toolName: req.toolName,
          toolArguments: req.arguments ?? {},
          actionCategory: req.actionCategory as ActionCategory,
          urgency: req.urgency ?? "normal",
          reason: req.reason,
          context: req.context ?? "",
          executionMode: "inline",
        });
        const resolved = await opts.approvalManager!.waitForResolution(request.id, {
          timeoutMs: req.timeoutMs,
        });
        return { requestId: resolved.id, status: resolved.status };
      }
    : undefined;

  const memoryWrite: MemoryWriteFn = async (req) => {
    return createFact(req.subjectId, req.predicate, req.object, {
      confidence: req.confidence,
      source: req.source,
    });
  };

  const decisionWrite: DecisionWriteFn = async (req) => {
    return createDecision(req.statement, {
      project_id: req.project_id,
      reason: req.reason,
      made_by: req.made_by,
    });
  };

  const gitCommit: GitCommitFn = async (req) => {
    return gitCommitImpl(req.repoPath, req.message, { all: req.all });
  };

  // "Git Push" -- the safety-critical node. Runs the same authority-gate
  // sequence AgentOrchestrator.executeTool applies to the git_push tool
  // (src/agents/orchestrator.ts) rather than calling git.push() directly:
  // checkAuthority first (context_rules seeded in src/daemon/index.ts make
  // this require_approval by default, force-push equivalents are a
  // separate tool this route doesn't expose), then block on approval when
  // required, and only then push. `agentAuthorityLevel: 0` is deliberate --
  // effectiveLevel = max(agentAuthorityLevel, config.default_level), so a
  // workflow-originated push never gets more authority than the daemon's
  // configured default; it can't bypass the same numeric floor an agent
  // would need to clear.
  const gitPush: GitPushFn | undefined =
    opts.authorityEngine && opts.approvalManager
      ? async (req) => {
          const actionCategory = getActionForTool("git_push", "github");
          const decision = opts.authorityEngine!.checkAuthority({
            agentId: "workflow",
            agentAuthorityLevel: 0,
            agentRoleId: "workflow",
            toolName: "git_push",
            toolCategory: "github",
            actionCategory,
            temporaryGrants: new Map(),
          });
          if (!decision.allowed) {
            return { ok: false, output: "", error: `[AUTHORITY DENIED] ${decision.reason}` };
          }
          if (decision.requiresApproval) {
            const request = opts.approvalManager!.createRequest({
              agentId: "workflow",
              agentName: "Workflow",
              toolName: "git_push",
              toolArguments: { repo_path: req.repoPath, remote: req.remote, branch: req.branch },
              actionCategory,
              urgency: "normal",
              reason: decision.reason,
              context: `Workflow-initiated git push in ${req.repoPath}`,
              executionMode: "inline",
            });
            const resolved = await opts.approvalManager!.waitForResolution(request.id);
            if (resolved.status !== "approved") {
              return { ok: false, output: "", error: `[APPROVAL ${resolved.status.toUpperCase()}]` };
            }
          }
          return gitPushImpl(req.repoPath, {
            remote: req.remote,
            branch: req.branch,
            setUpstream: req.setUpstream,
          });
        }
      : undefined;

  const services: SandboxApiServices = {
    credentialResolver: opts.credentialResolver,
    llmChat,
    notify,
    contextProvider,
    agentDelegate,
    eventsPoll,
    workflowsStart,
    routerChat,
    managerAssignAgent,
    councilConvene,
    handoffSend,
    handoffList,
    qaRun,
    memoryWrite,
    decisionWrite,
    gitCommit,
    ...(opts.resumeUrlPrefix !== undefined ? { resumeUrlPrefix: opts.resumeUrlPrefix } : {}),
  };
  if (toolsInvoke) services.toolsInvoke = toolsInvoke;
  if (managerRunProject) services.managerRunProject = managerRunProject;
  if (approvalRequest) services.approvalRequest = approvalRequest;
  if (gitPush) services.gitPush = gitPush;
  return services;
}
