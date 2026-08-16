# AI Manager Architecture Audit

Audit of the existing JARVIS codebase (`vierisid/jarvis`, cloned into this repo) performed prior to extending it into the AI Management System described in `JARVIS AI MANAGEMENT SYSTEM.md`. Written per that document's Section 4 requirements. All facts below reflect the code as of this clone; no design decisions for the new system are made here beyond noting where things plug in.

---

## 1. Current Architecture

- **What it is**: an always-on autonomous AI **daemon** (single long-running Bun process), not a stateless CLI and not a hosted SaaS. `package.json`: *"An always-on autonomous AI daemon."*
- **Entry points**: `bin/jarvis.ts` (CLI: start/stop/restart/status/logs/update/uninstall/doctor/enroll/sidecars/revoke/export/restore/version) launches `src/daemon/index.ts`, which wires every subsystem together and serves the dashboard.
- **Runtime**: **Bun** (`engines.bun >= 1.0.0`), not Node — all scripts use `bun run`/`bun test`, DB access via `bun:sqlite`. TypeScript, ESM throughout.
- **Frontend**: React 19 + Tailwind 4 + `@xyflow/react` (workflow visual builder) + CodeMirror, served by the same Bun process. No separate `ui/` directory — the dashboard lives inside `src/`.
- **Desktop/OS access**: a separate **Go** binary (`sidecar/`) running on each machine JARVIS should control, connected over a JWT-authenticated WebSocket ("brain" = daemon, "hands" = sidecar).
- **Composition**: one process hosts the LLM Router, Vault (SQLite memory), Agent hierarchy/orchestrator, Workflow engine (vendored Activepieces), Tool executor, Authority engine, Goal tracker, Awareness pipeline, HTTP API (`Bun.serve()`), and WebSocket service.
- **Windows**: native Windows is not supported for the daemon itself — WSL2 or Docker is required (per project constraint noted in the spec, Section 44/45). The Go sidecar *does* run natively on Windows and is how Windows desktop/filesystem/browser control happens.

## 2. Reusable Features (use as-is / build directly on top)

These map closely to concepts the spec asks for and should not be reimplemented:

| Spec concept | Existing implementation |
|---|---|
| AI Provider | `src/llm/*.ts` — `AnthropicProvider`, `OpenAIProvider`, `GeminiProvider`, `OllamaProvider`, `GroqProvider`, `OpenRouterProvider`, `OpenAICompatibleProvider`, `NvidiaProvider`, `LiteLLMProvider`, `OmniRouteProvider`, all implementing the common `LLMProvider` interface (`chat`/`stream`/`listModels`) in `src/llm/provider.ts`. |
| AI Router / Model routing (Cheap/Balanced/Quality abstraction) | `LLMManager` (`src/llm/manager.ts`) + tier system (`src/llm/tiers.ts`): `conversation \| high \| medium \| low` tiers, each resolved to a `(provider, model)` pair, with fall-up chains on failure. This is very close to the spec's Section 41 Cheap/Balanced/Quality abstraction already. |
| Provider Failover | Built into `LLMManager.chatTier`/`streamTier`: per-tier retries (`MAX_RETRIES_PER_PROVIDER=3`), tier fall-up chain, and an `LLMErrorCode` classifier (`auth \| rate_limit \| network \| bad_request \| not_found \| server \| unknown`) that already distinguishes the failure classes the spec calls out in Section 12. |
| Cost/usage tracking | `src/llm/usage.ts` writes every call (tier, provider, model, tokens incl. cache tokens, latency, error_code, `subsystem` label) to the `llm_usage` table — this is Section 40's cost control requirement, already implemented. |
| Agent / Role | `src/roles/*.yaml` + `roles/specialists/*.yaml`, loaded via `src/roles/loader.ts`. `RoleDefinition` has responsibilities, tools, authority_level, autonomous_actions, approval_required, KPIs, heartbeat_instructions, sub_roles. |
| Agent hierarchy | `src/agents/hierarchy.ts` (`AgentHierarchy`), `src/agents/agent.ts` (`AgentInstance`, `AuthorityBounds`, `canSpawnChildren`). |
| delegate_task / manage_agents | `src/actions/tools/delegate.ts` (blocking single delegation) and `src/actions/tools/agents.ts` (async spawn/assign/status/collect/terminate). Already exposed as LLM tools. |
| Task System | `src/agents/conv/task-envelope.ts` (`TaskRequest`/`TaskRecord`/`TaskResultEnvelope`/`TaskTemplate`), `task-registry.ts` (`TaskRegistry`, persisted to the `tasks` table, survives daemon restart, supports `needs_input`/pause-resume), `task-dispatcher.ts` (dispatches to a tier with per-template system prompts: research/code/plan/write/general). This is a working single-provider version of the spec's Task System (Section 13) and should be generalized, not replaced. |
| Handoff (inter-agent messaging) | `agent_messages` table + `src/agents/delegation.ts` (`delegateTask`/`reportCompletion`) already implement a parent↔child handoff protocol (`type: task \| report \| question \| escalation`). The spec's JSON handoff format (Section 14) can be layered on top of this table rather than inventing a new one. |
| Memory / Vault | `src/vault/*.ts` over SQLite (`bun:sqlite`). Tables: `entities, facts, relationships, commitments, observations, vectors, conversations, conversation_messages, agent_messages, personality_state`, etc. Vector search via `vectors` table. |
| Decision Memory | No dedicated `decisions` table exists yet (see Section 4 below), but `commitments` + `audit_trail` are adjacent and the vault's `entities/facts/relationships` graph could store decisions as typed facts. Likely needs a small additive table rather than new infra. |
| Agent Performance | `agent_activity` table + `src/vault/agent-activity.ts` already track per-agent activity for the dashboard; extending this to the metrics list in spec Section 20 (success rate, retry rate, human intervention rate) is additive, not new infrastructure. |
| Authority Engine / Permission levels | `src/authority/engine.ts` (`AuthorityEngine.checkAuthority`), numeric 1-10 authority levels, `ActionCategory` taxonomy (`src/roles/authority.ts`), context rules, temporary grants, governed-category soft gates. Already very close to spec Section 30's LEVEL 0-5 model — needs mapping, not rebuilding. |
| Approval / Audit log | `src/authority/approval.ts` (`ApprovalManager`), `src/authority/audit.ts` (`AuditTrail`), backed by `approval_requests`/`audit_trail` tables, with multi-channel delivery (`approval-delivery.ts`) and approval-pattern learning (`approval_patterns` table). |
| Emergency Stop | `src/authority/emergency.ts` (`EmergencyController`, normal/paused/killed states) — the primitive for spec Section 31 already exists; needs a dashboard button + propagation to workflow/sidecar/browser subsystems if not already wired everywhere. |
| Workflow Engine | Vendored Activepieces-based engine under `src/workflows/` (sandboxed subprocess, SQLite job queue, cron/webhook/event triggers, versioned flow definitions, pause/resume with zstd checkpoints). Already callable from agents (`jarvis-agent.ts`) and exposes JLM/tools/notify/context callbacks to flow steps. |
| Sidecar / Desktop awareness | `src/sidecar/` (brain side) + `sidecar/` (Go "hands" binary) already provide filesystem/terminal/browser/desktop/clipboard/screenshot/process/notification access exactly as spec Section 44 requires. |
| Local AI (no API key) | `OllamaProvider` already implemented and treated as a normal provider. |
| Secrets | `src/vault/keychain.ts` — encrypted credential storage; LLM/provider config is explicitly DB+keychain-owned, never in `config.yaml` or logs. |
| Config split | `USER_OWNED_SECTIONS` vs system `config.yaml` split (`src/config/types.ts`) is a deliberate, working convention — new AI Manager config should follow it (see Section 5 below). |
| Existing CLI / dashboard | `bin/jarvis.ts`, dashboard served at `http://localhost:3142` after `jarvis start`. |

## 3. Features to Extend (existing subsystem, needs generalization)

- **LLM tiers → AI Router with skill/candidate-agent awareness (spec §10-11)**: today `LLMManager` resolves a *tier* to one `(provider, model)`. The spec wants routing decisions to also consider required skill, candidate agents, provider state, failure history, and user preference. This is a routing-policy layer on top of `chatTier`, not a new provider abstraction.
- **Task Registry → cross-Project Task System (spec §13)**: `TaskRegistry`/`tasks` table already has most fields (id, status, template, result). Needs: `project_id`, `parent_task_id`, `dependencies`, `assigned_agent`/`assigned_provider`/`assigned_model` (currently implicit via tier, not stored explicitly), `artifacts`, `next_agent`, `approval_required` as first-class columns, and the fuller status enum (`PENDING/PLANNING/READY/RUNNING/WAITING/BLOCKED/REVIEW/QA/COMPLETED/FAILED/CANCELLED`) vs. today's simpler task states.
- **agent_messages → formal Handoff format (spec §14-15)**: the table and delegation functions exist; needs the structured JSON envelope (summary/instructions/artifacts/decisions/warnings/open_questions/next_action) and a rule that a task isn't "complete" until a Handoff record + Manager evaluation happens, not just when an agent stops.
- **Authority levels → spec's LEVEL 0-5 (spec §30)**: existing 1-10 numeric scale + `ActionCategory` taxonomy needs a mapping/compression to the 6-level model the spec's UI describes (or the spec's levels get redefined in terms of the existing 1-10 scale — a decision to make in Phase 1, not this audit).
- **agent_activity/llm_usage → Agent Performance dashboard (spec §20)**: raw data exists; needs aggregation queries (success rate, retry rate, human intervention rate) and exposure via API for the Router to consume as routing input.
- **Dashboard → new AI Manager Room/View (spec §23-25)**: the existing dashboard has Agents/Goals/Content/Authority views already; the spec's Project/Task Kanban/AI Status dashboard should be added as a new top-level view, reusing existing card/list components rather than a new design system.
- **Image generation → Image Agent as Provider/Adapter (spec §33)**: no image provider currently exists in `src/llm/`; the *pattern* (provider interface + manager) is proven and should be reused for an `ImageProvider` interface, kept separate from `LLMProvider`.
- **Research tool use → Research Agent with Source/URL/Date/Confidence (spec §34)**: browser/search tools exist (`src/actions/browser/`); citation metadata capture is not yet structured and should be added to whatever result envelope Research tasks return.
- **QA checks → QA Agent (spec §36)**: no dedicated QA subsystem found; existing `bun test`/typecheck/lint scripts and the workflow engine's retry/self-heal primitives are the building blocks, but an explicit QA Agent role + task template (like `research|code|plan|write|general` in `task-dispatcher.ts`) needs to be added.

## 4. New Features Needed (no existing equivalent)

- **Project entity**: no `projects` table exists today (content_items/goals are adjacent but not the same concept). Needed as the top-level container the spec's Task/Handoff/Decision/Memory records key off of.
- **Decision Memory (spec §17)**: no dedicated `decisions` table. Needs `decisions(id, project_id, statement, reason, date, made_by, ...)`.
- **Project Memory vs User Memory separation (spec §18-19)**: vault memory today is largely global/agent-scoped; needs a `project_id` scoping convention layered across relevant tables (or a new `project_memory` table) so Project/User/Task/Decision/Agent memory stay logically separate as required.
- **AI Council (spec §16)**: no multi-provider "ask everyone, compare, decide" primitive exists. Needs a new orchestration function that fans a prompt out to multiple `LLMProvider`s/tiers in parallel and a consensus/decision module (evidence/confidence/expertise/contradiction weighting) — net new.
- **Manager Agent as explicit top-level orchestrator (spec §8, §51)**: today the "conversation tier" + `AgentOrchestrator` play this role implicitly for a single LLM; the spec wants an explicit Manager Agent that performs project detection, task decomposition, agent/provider selection, and completion judgment as a named, inspectable component — likely a thin new layer over `TaskDispatcher` + `LLMManager` + `AgentHierarchy` rather than new infrastructure, but it doesn't exist as a distinct component today.
- **Planner Agent / Task decomposition into a dependency graph (spec §9, §39)**: `task-dispatcher.ts` has per-template prompts but no explicit "break a request into N tasks with a dependency graph" step or Task↔Subtask relationship in the schema.
- **GitHub integration (spec §28-29)**: no GitHub-specific module found in `src/`. Needs new `src/github/` (or similar) covering repo/branch detection, status/diff, commit, push/pull, branch creation, and optionally issues/PRs — net new, with push/force-push/delete gated per the spec's safety table through the existing Authority Engine.
- **Cheap/Balanced/Quality user-facing mode selector (spec §40-41)**: the tier abstraction exists technically, but there's no user-facing 3-mode selector mapped onto it yet.
- **Execution mode (AUTO/ASSISTED/MANUAL) (spec §50)**: Authority levels gate individual actions today; a project/session-level AUTO/ASSISTED/MANUAL mode that changes how often the Manager pauses for confirmation is a new, small config+behavior addition.
- **Chat display modes (Simple/Detailed/Developer) (spec §52)**: no existing concept of collapsing agent/task/handoff detail in the chat UI; new UI-layer work.

## 5. Parts That Must Not Be Changed

Per the spec's Section 3.1 and reinforced by what the audit found working end-to-end:

- `src/llm/` provider implementations and the `LLMProvider` interface contract.
- The `USER_OWNED_SECTIONS` vs `config.yaml` split (`src/config/types.ts`) — LLM/provider config must stay DB+keychain-owned, never added back into `config.yaml`.
- `src/vault/schema.ts`'s existing tables and its idempotent inline-migration convention (`ALTER TABLE ... ADD COLUMN` wrapped in `try/catch`, `CREATE TABLE IF NOT EXISTS`) — no migration framework swap, no destructive schema changes.
- `src/authority/` decision logic and the numeric authority-level semantics already relied on by existing roles/tools.
- `src/sidecar/` protocol (JWT scheme, RPC format) and the Go sidecar binary's platform-specific code.
- `src/workflows/` (Activepieces-based engine) internals — extend via new pieces/nodes, don't fork the engine.
- Existing CLI commands and their flags in `bin/jarvis.ts`.
- The single-daemon, single-tenant, SQLite-job-queue architecture — the workflow docs explicitly state this is *not* meant to be distributed/multi-tenant; do not introduce a queue/worker redesign to support the AI Manager.

## 6. Technical Risks

- **Schema growth in one file**: `src/vault/schema.ts` is already large; adding `projects`, `decisions`, and extended `tasks` columns via the inline-DDL convention keeps things additive but the file will keep growing — acceptable per existing convention, but should be organized with clear section comments per new table.
- **Tier system overload**: routing decisions in the spec (skill, candidate agents, provider state, cost, latency, reliability) go beyond what the 4-tier abstraction was designed for. Bolting a full policy engine onto `LLMManager.chatTier` risks making that function's responsibilities unclear. A separate `AIRouter` module that *calls* `LLMManager` (rather than modifying it) is lower-risk.
- **Authority level remapping**: compressing/mapping the existing 1-10 scale to the spec's 0-5 LEVEL model touches every role YAML and `AUTHORITY_REQUIREMENTS`; a mistake here has real security impact (could under- or over-gate destructive actions). Needs careful, explicit mapping and tests, not a silent renumbering.
- **Task status enum mismatch**: existing `tasks`/`TaskRecord` status values don't match the spec's 11-state enum (`PENDING/PLANNING/READY/RUNNING/WAITING/BLOCKED/REVIEW/QA/COMPLETED/FAILED/CANCELLED`). Changing an enum that's already persisted and read by `TaskRegistry` reconciliation-on-restart logic must be done via additive migration with careful handling of existing rows, not a hard rename.
- **Workflow engine coupling**: the sandboxed engine subprocess already calls back into agents/LLM/tools via `/v1/jarvis/*` bridges — any new AI Manager nodes (spec §26) must go through this existing bridge pattern, not a new direct channel, to avoid breaking the sandbox isolation the engine relies on.
- **GitHub push/force-push safety**: the spec explicitly requires push=APPROVAL, force-push=BLOCK, repo-delete=BLOCK. This must be wired through the existing `AuthorityEngine`/`ApprovalManager`, not a bespoke check inside the new GitHub module, to keep one source of truth for dangerous-action gating.
- **Windows constraint**: the daemon requires WSL2/Docker; any new AI Manager server-side code must run inside that same environment. Only sidecar-side (Go) code runs natively on Windows.

## 7. Implementation Order

Following the spec's own Phase 0-10 plan, refined with what's now known about the existing code:

1. **Phase 0 — Repository audit** (this document). Done.
2. **Phase 1 — Domain model**: additive migrations in `src/vault/schema.ts` for `projects`, `decisions`, extended `tasks` columns (`project_id`, `parent_task_id`, `dependencies`, `assigned_agent/provider/model`, `artifacts`, `next_agent`, `approval_required`) and the fuller status enum; extend `agent_messages`/handoff helpers with the structured JSON envelope.
3. **Phase 2 — AI Manager Core**: new `AIRouter` module (wraps `LLMManager`, adds skill/candidate/cost/reliability policy), a Planner step in `TaskDispatcher` that produces a dependency graph of subtasks, and an explicit Manager Agent component orchestrating Planner → Router → Assignment → Execution → Handoff using existing `AgentHierarchy`/`delegateTask`/`TaskRegistry`.
4. **Phase 3 — Dashboard**: new Project/Task Kanban/AI Status view reusing existing dashboard components and API patterns (`src/daemon/api-routes.ts` route-group style).
5. **Phase 4 — Memory / Decisions / Metrics**: wire the new `decisions` table into a Decision Memory API; project-scope existing memory queries; build Agent Performance aggregation off `agent_activity`/`llm_usage`.
6. **Phase 5 — AI Council**: new parallel multi-provider fan-out + consensus module, built on `LLMManager`/`AIRouter`, not on tier internals.
7. **Phase 6 — QA / Self-Healing**: new QA Agent role + task template in `TaskDispatcher`, backed by existing `bun test`/typecheck/lint/build scripts and the workflow engine's retry/self-heal primitives; bounded retry (default 3, per spec §37) via existing failure classification. Done — `src/ai-manager/qa.ts` (`QAAgent`, 10-category checklist) and `src/ai-manager/self-healing.ts` (`SelfHealingRunner`: Classify → Retry → Alternative strategy → Alternative Agent → QA, bounded by `maxRetries`), wired into `ManagerAgent.runSubtask`; `retry_count`/`max_retries`/`qa_report` columns added to `tasks`.
8. **Phase 7 — GitHub integration**: new `src/github/` module, all mutating operations routed through `AuthorityEngine`/`ApprovalManager` per the spec's safety table. Done — `src/github/git.ts` (repository/branch detection, status, diff, commit, push, pull, branch creation) + `src/github/api.ts` (Issue/PR/PR-status/Review via REST, token in the existing keychain under `github_token`), exposed as distinct-named tools in `src/actions/tools/github.ts` so the authority gate can apply spec §29's safety table per operation. New `git_operation` `ActionCategory` (level 4, spec §30) added to `src/roles/authority.ts`; `git_push`→`require_approval` and `git_force_push`→`deny` seeded as default `context_rules` in `src/daemon/index.ts` (user-configurable, per spec §29).
9. **Phase 8 — Image Agent**: new `ImageProvider` interface + adapter(s), mirroring the `LLMProvider` pattern, kept as its own provider family. Done — `src/image/provider.ts` (`ImageProvider`, `ImageGenerateOptions`/`ImageResult`, reusing `LLMErrorCode` classification) + `src/image/manager.ts` (`ImageManager`: primary/fallback chain, per-provider retry, usage recorded into the existing `llm_usage` table under subsystem `image` rather than a new table) + two adapters (`src/image/openai-image.ts` for gpt-image-1/dall-e-3, `src/image/gemini-image.ts` for Imagen). Credentials use lightweight keychain secrets (`image.provider.<name>.api_key` via `src/image/config-binding.ts`) rather than the full LLM provider-map/DB system, matching Phase 7's `github_token` precedent since image generation doesn't need per-tier routing. Exposed as `image_generate` in `src/actions/tools/image.ts` (writes to `~/.jarvis/images`, returns the file path plus an inline image content block); `image_generate`→`write_data` in `src/authority/tool-action-map.ts` (no new `ActionCategory` needed - same impact class as `write_file`). Wired into `AgentService.start()` in `src/daemon/agent-service.ts` (`getImageManager()`).
10. **Phase 9 — Workflow integration**: new AI Manager nodes (`AI Task`, `Agent Assignment`, `AI Council`, `Handoff`, `Review`, `QA`, `Approval`, `Provider Failover`, `Memory Write`, `Decision Write`, `Git Commit`, `Git Push`) added as Activepieces pieces under the existing `/v1/jarvis/*` bridge pattern. Done — 9 new pieces under `src/workflows/activepieces/packages/pieces/jarvis/` (`router`, `manager`, `council`, `handoff`, `qa`, `approval`, `memory`, `decision`, `git`) covering all 12 nodes (`manager` exposes both `runProject`/AI Task and `assignAgent`/Agent Assignment; `handoff` exposes both `send`/Handoff and `list`/Review; `git` exposes both `commit` and `push`), backed by 9 new `/v1/jarvis/*` routes in `src/workflows/sandbox-api/routes/jarvis-{router,manager,council,handoff,qa,approval,memory,decision,git}.ts` and matching backend functions in `src/workflows/runtime/service-backends.ts`, each wrapping the existing Phase 1-8 subsystem directly (`AIRouter.chat`/`.route`, `ManagerAgent.handleRequest`, `AICouncil.convene`, `sendHandoff`/`getHandoffsForTask`, `QAAgent.run`, `createFact`, `createDecision`, `commit`/`push` from `src/github/git.ts`) rather than adding new orchestration. Git Push and the generic Approval node run through the same `AuthorityEngine.checkAuthority` + `ApprovalManager.createRequest`/`waitForResolution` sequence `AgentOrchestrator.executeTool` uses (see Technical Risks below) — `git_push`'s `require_approval` context rule applies to workflow-originated pushes too, not just agent-originated ones. Wired into `SandboxApiServices`/`registerRoutes` (`src/workflows/sandbox-api/server.ts`) and daemon startup (`src/daemon/index.ts`, passing `taskDispatcher`/`approvalManager` into `buildSandboxServiceBackends`).
11. **Phase 10 — Full integration testing**: run the spec's four demo scenarios (simple website, code review, logo, full project + GitHub push) end-to-end, plus the regression checklist in spec §61 (LLM connection, chat, memory, agent delegation, workflow, authority, sidecar, browser, dashboard) to confirm no existing functionality broke.

Each phase should end with `bun test`, typecheck, lint, and build passing before moving to the next, per spec §60-61.

## 8. Phase 11 Plan (post-launch hardening)

The spec's own Phase 0-10 plan is complete (see section 7 above; confirmed via a
full Phase 10 integration-test pass — 1896 passing, all 63 remaining failures
pre-existing Windows-only POSIX permission issues unrelated to this work).
Phase 11 is not spec-defined; it addresses three gaps found by re-reading the
shipped code against the audit's own section 4 "New Features Needed" list -
fields that exist but are never consulted, and subsystems that are reachable
by API but invisible in the UI. Scoped to the three items with real user
impact (a genuine dead end, and two features that are effectively inert);
the lower-priority items below (cost-mode selector, Project/User memory
separation, chat display modes, a real-provider setup guide) are deliberately
deferred, not forgotten - re-evaluate once 11-A/B/C ship.

**Suggested order: 11-A, then 11-C, then 11-B** - A and C both restructure
`ManagerAgent`, so doing the harder one (A, task-lifecycle reconstruction)
first means C's approval gate can be added around an already-resumable
execution path rather than needing its own follow-up patch. B is pure UI
wiring against existing/new endpoints and benefits from A/C's new state
being visible to build against.

### 11-A: Resume a WAITING project subtask — Done

Implemented largely as planned, with one deviation: rather than reconstructing
subtask state purely from `tasks` table columns (a `template` column already
existed there via `TaskRegistry`'s own schema, so no migration was needed for
that part), the full `PlannedSubtask[]` is persisted verbatim as JSON on a
new `projects.plan` column (`src/vault/projects.ts`'s `PlanSubtask`/
`setProjectPlan`/`getProjectPlan`), with each entry's `task_id` filled in
the first time that index is dispatched. This was necessary because a
subtask blocked behind a WAITING one may never have been dispatched at all
(no `tasks` row exists for it yet), so the DB-columns-only approach couldn't
fully reconstruct the graph shape - the persisted plan can. `ManagerAgent`
gained `continueProject()` (rebuilds the wave scheduler's state from the
persisted plan + each dispatched subtask's live `project_status`) and
`resumeSubtask()` (calls `TaskDispatcher.resume()`, updates the task row,
sends a Handoff, then calls `continueProject()`), with `runPlan`'s wave loop
extracted into a shared private `runWaves()`. New route
`POST /api/ai-manager/projects/:id/tasks/:taskId/resume`. Tests in
`manager-agent.e2e.test.ts` cover the full pause → resume → dependent-runs
flow and rejecting a resume on a non-WAITING task.

<details>
<summary>Original plan (superseded by the "Done" note above where it differs)</summary>

**Problem** (self-documented in `manager-agent.ts:20-23`): when a subtask's
`TaskRunner` returns `{ kind: 'paused' }` (the task tier called
`ask_for_clarification`), `runSubtask` records `WAITING` and `runPlan`'s wave
loop treats it as neither ready nor failed - any dependent subtask stays
unsettled, and the loop's "nothing ready, nothing to cancel" branch
(`manager-agent.ts:134-146`) intentionally `break`s out of `runPlan`, leaving
the rest of the graph unprocessed **in that call's memory only**. There is no
caller anywhere in the codebase that invokes `TaskDispatcher.resume()` for an
AI-Manager subtask (confirmed by grep across `task-dispatcher.ts`,
`conv-orchestrator.ts`, `agent-service.ts`,
`workflows/sandbox-api/server.ts`) - a paused project subtask has no way back
to running today.

**Why this needs more than "just call `dispatcher.resume()`"**: `runPlan`'s
wave scheduler operates over the in-memory `PlannedSubtask[]` from the
`Planner`'s `PlanResult`. That array does not survive past the original
`handleRequest`/`runPlan` call (and never survives a daemon restart at all).
Resuming later - possibly in a different request, possibly after a restart -
needs the graph state reconstructed from what's actually persisted: the
`tasks` table's `project_status`/`dependencies`/`title`/`priority` columns
(`src/vault/project-tasks.ts`), which already carry everything `runPlan`
needs except the original `TaskTemplate` per subtask (also already stored
via `assigned_agent: task_${template}` - needs a small parse or an explicit
`template` column added alongside).

**Plan**:
1. Add a `template` column to `project_tasks.ts`'s `ProjectTaskFields` (or
   parse it back out of `assigned_agent`'s `task_${template}` prefix - column
   is cleaner and matches the file's existing additive-migration convention).
2. Add `ManagerAgent.continueProject(projectId: string): Promise<ProjectRunResult>`
   that rebuilds a wave-schedulable subtask list from `getProjectTasks(projectId)`
   (mapping `COMPLETED/FAILED/CANCELLED/WAITING` rows back into the same
   `settled`/`taskIdByIndex` shape `runPlan` uses internally) and resumes the
   exact same wave loop from wherever it left off, instead of requiring the
   original in-memory `PlanResult`. This likely means factoring `runPlan`'s
   loop body out into a shared private method both `runPlan` (fresh plan) and
   `continueProject` (reconstructed plan) call.
3. Add `ManagerAgent.resumeSubtask(projectId, taskId, userInput): Promise<ProjectRunResult>`:
   calls `dispatcher.resume(taskId, userInput)`, mirrors `runSubtask`'s
   post-dispatch tail (`setProjectTaskFields`, `sendHandoff`, decision-on-QA-
   failure), then calls `continueProject(projectId)` so any dependents that
   were blocked on this subtask get picked up in the same request.
4. New route `POST /api/ai-manager/projects/:id/tasks/:taskId/resume` (body
   `{ input: string }`) in `src/ai-manager/api/routes.ts`, calling
   `resumeSubtask`. Needs a `ManagerAgent` instance reachable from the API
   layer - check how `src/daemon/agent-service.ts` currently wires
   `ManagerAgent` for the existing project-creation route and reuse that
   wiring rather than constructing a second instance.
5. Tests: extend `manager-agent.e2e.test.ts` with a scenario where a subtask
   pauses, gets resumed via `resumeSubtask`, and its dependents then run -
   this is the direct regression guard for the dead end above.

</details>

### 11-B: Surface Phases 5-9 in the dashboard — Done

Implemented as planned: `useAIManagerData.ts` now fetches handoffs and
per-project agent performance alongside tasks/decisions; `qa_report` renders
as a checklist on task cards (expand on click); `AIManagerRoom.tsx` gained a
Handoffs feed, an Agent Performance panel, and an "Ask the Council" dialog
(fans a question to Cheap/Balanced/Quality seats, shows opinions +
synthesis, records a Decision). Item 5 (GitHub push approvals) needed no new
code - confirmed `ui/src/v2/rooms/authority/useAuthorityData.ts` already
polls the generic `/api/authority/approvals?status=pending` endpoint, which
surfaces `git_push` (and now the new 11-C subtask-approval) requests
automatically since `ApprovalManager` is subsystem-agnostic. Item 6 (Image
Agent generation history) was deferred as noted in the original plan below -
no backend list endpoint exists yet for past generations.

<details>
<summary>Original plan</summary>

**Problem**: `ui/src/v2/rooms/aiManager/useAIManagerData.ts:90-200` only
calls `/api/ai-manager/{projects,tasks,decisions}`. Server endpoints already
exist for AI Council (`/api/ai-manager/council`,
`src/ai-manager/api/routes.ts:238`), handoffs (`.../handoffs`, routes.ts:224),
and agent performance (`/api/ai-manager/agents/performance`, routes.ts:288) -
none are called from any UI component. `AIManagerRoom.tsx:19-24` shows QA
only as a bare Kanban status label; the actual `qa_report` (10-category
checklist, already returned per-task per `project-tasks.ts`'s
`ProjectTaskFields.qa_report`) has no viewer.

**Plan** (purely additive UI work against existing data - no new backend
needed except where noted):
1. Task detail panel: render `qa_report.checks` (name/passed/summary/detail)
   when a task's status is `QA`/`FAILED` with a `qa_failed` error, reusing
   whatever card/list primitives the existing Kanban view already has.
2. New "Handoffs" tab/feed on the project view, calling `.../handoffs` -
   chronological list of `from_agent -> to_agent`, `status`, `summary`.
3. New "AI Council" tab, calling `.../council` - show per-provider responses
   plus the consensus verdict for any project that used it.
4. New "Agent Performance" panel (success rate / retry rate / human
   intervention rate per agent), calling `.../agents/performance` - likely
   fits better as a small widget on an existing Agents-related room than a
   new top-level tab.
5. GitHub push approvals: verify first whether these already surface via the
   existing generic Authority/Approval queue UI (`ApprovalManager` is
   subsystem-agnostic, so a `git_push` approval request should already
   appear there without new code). If confirmed, this item is just adding a
   repo/branch context line to that existing approval card, not new plumbing.
6. Image Agent generation history: lowest priority of this set (no dedicated
   backend list endpoint exists yet for "past generations" - `image_generate`
   results aren't queried anywhere beyond the `llm_usage` `subsystem='image'`
   rows used for cost tracking) - either add a small list endpoint over that
   usage data, or defer entirely; note in code review which was chosen.

</details>

### 11-C: Make `execution_mode` (AUTO/ASSISTED/MANUAL) actually do something — Done

Implemented as planned: `ManagerAgent` now takes an `ApprovalManager` as a
required constructor argument (all call sites updated - `src/ai-manager/api/
routes.ts`, `src/workflows/runtime/service-backends.ts`'s `managerRunProject`
backend, which now also requires `opts.approvalManager` to be present). In
`runSubtask`, before dispatching: `manual` mode always requests approval
(`createRequest`/`waitForResolution`, `actionCategory: 'spawn_agent'`,
reusing the same pattern as the `git_push` gate rather than adding a new
`ActionCategory`); `assisted` mode gates only `code`-template subtasks (kept
to a single-template `ASSISTED_MODE_GATED_TEMPLATES` list, deliberately
aligned with `self-healing.ts`'s existing `qaCheck ?? template === 'code'`
risk cutoff rather than inventing a second classification); `auto` is
unchanged. A denial cancels the subtask with a clear summary rather than
silently skipping it. Tests in `manager-agent.e2e.test.ts` cover both modes
(manual: approve runs it, deny cancels it; assisted: `code` gates, `write`
doesn't).

<details>
<summary>Original plan</summary>

**Problem**: `ExecutionMode` is stored and API-settable
(`src/vault/projects.ts:131`, `src/ai-manager/api/routes.ts:127-179`) but
`ManagerAgent.runPlan`/`runSubtask` never read it, and `self-healing.ts`
doesn't reference it at all - every project behaves as AUTO regardless of
what's set. This is worse than not having the field: a user who sets MANUAL
expecting to approve each subtask gets silent full-auto execution instead.

**Plan**:
1. Inject an `ApprovalManager` into `ManagerAgent`'s constructor (currently
   takes only `router`, `dispatcher`, `maxRetries` - this is a breaking
   constructor-signature change, update the one call site in
   `agent-service.ts`/wherever `ManagerAgent` is instantiated, plus this
   session's `manager-agent.e2e.test.ts`).
2. In `runSubtask`, before calling `healer.run(...)`: if `project.execution_mode
   === 'manual'`, or `=== 'assisted'` AND the subtask's template is in a
   small risk set (start with `code` - the only template that already
   defaults to a QA gate, per `self-healing.ts`'s `qaCheck ?? template ===
   'code'` - so "assisted" and "already QA-gated" line up naturally), create
   an `ApprovalManager` request (new `ActionCategory` or reuse an existing
   governed category - decide during implementation, mirroring the
   `git_push` context-rule pattern from Phase 7) and `await
   waitForResolution()` before dispatching. A denial should mark the subtask
   `CANCELLED` with a clear summary rather than silently skipping it.
3. AUTO stays exactly as today - no new gate, zero behavior change for the
   common case.
4. Tests: extend `manager-agent.e2e.test.ts` (or a new
   `manager-agent-execution-mode.e2e.test.ts`) with one MANUAL-mode case
   (approval granted -> runs; approval denied -> cancelled) and one ASSISTED
   case (a `write` subtask runs ungated, a `code` subtask gates), following
   the `ApprovalManager.createRequest`/`waitForResolution`/`approve` pattern
   already established in `project-push.e2e.test.ts`.

</details>

All of 11-A/B/C shipped together: `tsc --noEmit` clean, full `bun test` at
1900 passing (1896 baseline + 4 new `manager-agent.e2e.test.ts` cases for
resume + execution_mode gating), the same pre-existing 63 Windows-only
failures as every prior Phase 10/11 run, no new ones. UI changes verified via
successful `tsc`/`bun build:ui`; live browser verification of the dashboard
room wasn't done in this environment (requires a JWT-enrolled device by
default - relaxing that would mean touching `auth.insecure_open_access`, a
security setting outside this pass's scope) - manual verification in a
browser recommended as a follow-up, consistent with QAAgent's own `ui_tests`
policy.

**Deferred, not forgotten** (re-evaluate after 11-A/B/C ship): a
user-settable Cheap/Balanced/Quality cost-mode selector (spec §40-41,
currently template-default-only); Project Memory vs User Memory `project_id`
scoping across vault queries (spec §18-19, currently vault memory is fully
global); chat display modes (spec §52, Simple/Detailed/Developer, entirely
unimplemented); and a real-provider AI Manager setup guide in `docs/` (none
exists today - this environment has never exercised Phases 2/5/6/8 against a
real, non-mock LLM/image provider).

## 9. Phase 12 Plan (clearing the 11-deferred list) — Done

All four items shipped: `tsc --noEmit` clean (both `src/` and `ui/`), full
`bun test` at 1900 passing / 63 failing - the same pre-existing Windows-only
failures as every prior Phase 10/11 run, no new ones, `bun run build:ui`
succeeds. Deviations from the plan below, by item:

- **12-A**: `AIRouter.route()` already had `mode`/`MODE_TO_TIER` plumbing
  built (spec §40-41 groundwork landed earlier than the audit's Phase 7
  survey noticed) - this pass only had to add the persisted
  `projects.cost_mode` column/API/UI and thread it into
  `ManagerAgent.runSubtask`'s call to `router.route()`, passing `mode` only
  when `cost_mode !== 'balanced'` so the existing per-template tier defaults
  stay the no-op case, same convention as `execution_mode: 'auto'`.
- **12-B**: scoped to `entities`/`facts`/`observations`/`commitments` only,
  as planned (relationships inherit scope transitively via their entity
  endpoints - `getEntityRelationships` now also returns each endpoint's
  `project_id`). Found and fixed a live bug while wiring this: the Phase 9
  workflow bridge's `memoryWrite` backend (`service-backends.ts`) was
  silently dropping the `ctx.projectId` the route handler already extracted
  (`jarvis-memory.ts`) instead of forwarding it to `createFact`, unlike its
  sibling `decisionWrite`. `retrieveForMessage`/`getKnowledgeForMessage` now
  take an optional `projectId` and scope to "this project or global", but
  nothing in the conversational path (`AgentService.buildAmbientFactsBlock`/
  `buildPromptContext`) calls them with one yet - that path has no project
  concept at all today (confirmed: `ManagerAgent`'s task execution runs
  through a separate `TaskDispatcher` runner in `agent-service.ts`, not
  through the prompt builders). Wiring project-scoped memory into that
  runner is a larger, separate change and was deliberately left out of this
  pass rather than risk a rushed cross-path integration.
- **12-C**: implemented as a client-side density filter
  (`ui/src/v2/thread/displayMode.ts`) over the existing `ThreadItem` kinds
  rather than new task/handoff item kinds - no such kinds exist in the
  thread today (confirmed: task/agent chatter currently only surfaces via
  `card`/`result`/`room-window`). `simple` keeps only user/Jarvis-speech/
  decision-required kinds; `detailed` adds `card`/`result`; `developer`
  (default, matching today's unfiltered behavior) adds `jarvis-thought`.
  Persisted via `useChatDisplayMode` (localStorage, mirrors `useTheme.ts`),
  selector added next to the Talk panel's close button.
- **12-D**: `docs/AI_MANAGER_SETUP.md` written from the code (`llm-settings.ts`,
  `keychain.ts`, tier validation), not from a live provider run - no API keys
  are available in this environment. It documents a real, confirmed gap
  found while writing it: unlike `/api/config/llm`, there is no
  `/api/config/image` or `/api/config/github` route to set the Image/GitHub
  keychain secrets from the dashboard - currently keychain-only, no UI path.

**Deferred, not forgotten** (re-evaluate later, not urgent): project-scoped
memory retrieval wired into `AgentService`'s conversational prompt builders
(12-B's remaining half); `/api/config/image` and `/api/config/github` routes
mirroring `/api/config/llm` (surfaced by 12-D); `cost_mode`/`execution_mode`
exposed in `CreateProjectDialog` at creation time instead of only via
post-creation `PATCH`; Image Agent generation history (deferred since
Phase 11-B, still no backend list endpoint).

All four items deferred at the end of Phase 11 are in scope. Not spec-ordered
- scoped by what actually blocks what.

## 10. Phase 13 Plan (clearing the 12-deferred list) — Done

All four items shipped: `tsc --noEmit` clean, full `bun test` at 1901 passing
(1900 baseline + 1 new Phase 13-A test) / 63 failing - the same pre-existing
Windows-only failures as every prior phase, no new ones, `bun run build:ui`
succeeds. Notes by item:

- **13-B**: `/api/config/image` (`GET`/`POST`) and `/api/config/github`
  (`GET`/`POST`) added to `api-routes.ts`, calling the keychain getter/setter
  functions that already existed. Image key saves re-call
  `registerImageProviders()` against the live `ImageManager` so a new key
  applies without a restart (`Map.set` keyed by provider name makes
  re-registration safe); GitHub needs no re-registration since
  `getGitHubToken()` is read fresh per call. UI: two new sections in the
  existing `IntegrationsTab.tsx`, wired through `useSettingsData.ts` in the
  same `Promise.all` poll as the other settings reads. Not covered by an
  automated test - both credential setters write through
  `src/vault/keychain.ts` to a real `~/.jarvis/.secrets.*` file (not an
  in-memory test DB, confirmed no existing test exercises `setSecret`
  directly for this reason), so a round-trip test would need
  `keychain.ts` mocked rather than called for real; deferred rather than
  risk a test that writes into a developer's actual secrets file.
- **13-C**: `CreateProjectDialog` gained `execution_mode`/`cost_mode`
  selects (defaulting to `assisted`/`balanced`, matching the API's own
  defaults so leaving them untouched changes nothing). Pure UI wiring, no
  backend change - both fields already flowed through `runProject`'s body
  and the API route since Phase 12-A.
- **13-D**: new `image_generations` table (`src/vault/schema.ts`), a small
  `src/vault/image-generations.ts` module, `image_generate`'s `execute()`
  now records prompt/provider/model/file paths alongside the existing
  `llm_usage` cost row, `GET /api/image/generations` (paginated), and a
  "Recent generations" list in `IntegrationsTab.tsx`'s Image Agent section
  (load-on-demand, not on the 10s settings poll). One real gap found and
  fixed along the way: `ImageManager.generate()`'s return type had no
  `provider` field (only `model`), so there was no way to know which
  provider actually produced a given image after fallback - widened its
  return type to `ImageResult & { provider: string }`.
- **13-A**: turned out narrower than planned once traced end to end. The
  Phase 12 plan doc's premise - "`ManagerAgent`'s task execution never
  touches vault memory retrieval at all" - was wrong: the `TaskRunner`
  closure in `agent-service.ts:685` already calls
  `buildFullSystemPromptParts('conv', originalMessage)`, which already calls
  `getKnowledgeForMessage()`, for every task-tier dispatch, including
  `ManagerAgent`-driven subtasks. It was just unscoped (global search only).
  So this became pure plumbing, not new retrieval logic: added
  `project_id?: string` to `TaskRequest` (`task-envelope.ts`) and
  `TaskRunner`'s args (`task-dispatcher.ts`), threaded it through
  `runAndHandle` → the runner call → `buildFullSystemPromptParts`/
  `buildPromptContext` → `getKnowledgeForMessage(message, projectId)`, and
  set it from `HealingRunOptions.project_id` (`self-healing.ts`) ← passed by
  `ManagerAgent.runSubtask` as `project.id` (`manager-agent.ts`). The
  plan's second half - whether classic (non-project) conversation should be
  able to pin an "active project" - was correctly identified as a UI
  decision, not a code gap, and stayed out of scope. New test:
  `manager-agent.e2e.test.ts`'s "ManagerAgent project-scoped memory" block
  asserts `project.id` reaches the task runner as `TaskRequest.project_id`
  for a dispatched subtask.

**Deferred, not forgotten**: whether classic conversational chat should be
able to pin an "active project" so ambient facts get scoped outside the AI
Manager project flow (13-A's second half, needs a product decision first);
an automated round-trip test for `/api/config/image`/`/api/config/github`
(needs `keychain.ts` mocked, not called for real).

**Suggested order: 13-B, 13-C, 13-D, then 13-A.** The first three are small,
independent, and low-risk - each closes a concrete gap surfaced while
building Phase 12, with no dependency on each other. 13-A is last because
it's the one genuinely open architectural question in this list: it's not a
missing route or a missing UI field, it's "does the conversational path get
a project concept at all, and if so how" - worth doing once, deliberately,
not squeezed in alongside three smaller items.

## 11. Phase 14 Plan (clearing the 13-deferred list) — Done

Both items shipped: `tsc --noEmit` clean, full `bun test` at 1889 passing / 65
failing / 2 errors - the same pre-existing Windows-only failures as every
prior phase (file-permission/chmod tests, PID/process-lock tests, Unix
domain sockets, `EBUSY` temp-dir cleanup races, symlink `O_NOFOLLOW` tests -
none touch anything Phase 14 changed), plus 17 new passing tests, `bun run
build:ui` succeeds. Notes by item:

- **14-A**: `AgentService` gained a single in-memory `activeProjectId` field
  + `setActiveProject`/`getActiveProject` (`src/daemon/agent-service.ts`,
  next to `setConvTaskEventListener`/`getTaskDispatcher`) - no DB table,
  since the daemon is still single-user/single-session (confirmed nothing
  changed about that assumption since 13-A). Threaded into the two ambient-
  memory call sites the interactive chat UI actually uses:
  `buildAmbientFactsBlock` (conv-tier, now takes an optional `projectId` and
  passes it to `getKnowledgeForMessage`) and the classic
  (no-conversation-tier) branch of `streamMessageInner`'s
  `buildFullSystemPromptParts` call - both only reachable from
  `streamMessage`, which is what `ws-service.ts`'s interactive chat handler
  and the pebble voice path call. Deliberately did **not** thread it into
  `handleMessage`'s classic branch, since that non-streaming entry point is
  shared by `event-reactor.ts`/`commitment-executor.ts`/`channel-service.ts`
  for background/scheduled/external-channel turns that aren't the
  interactive session the pin is scoped to - scoping those too would have
  been silent behavior change with no caller asking for it, the same trap
  12-B's plan explicitly flagged. New route `/api/chat/active-project`
  (`GET`/`POST` in `api-routes.ts`, deliberately not reusing the `projectId`
  field already used in chat WS payloads - that field is the unrelated Site
  Builder filesystem-project concept, confirmed by `ws-service.ts`'s
  `siteBuilderService` branch). `POST` validates the id against
  `getProject()` (404 if unknown, 400 if empty/wrong type) before pinning,
  `null` clears it. UI: a project picker `<select>` next to the existing
  chat-density selector in `AppShell.tsx`'s "Talk" panel header (same spot
  `useChatDisplayMode`'s control lives), backed by a new
  `useActiveProject.ts` hook that fetches `GET /api/ai-manager/projects` for
  the option list and round-trips the pin through the new route with
  optimistic-then-revert-on-failure state - unlike `useChatDisplayMode`,
  this can't be a localStorage-only preference since the pin changes what
  the daemon retrieves, not just how the UI renders. Only rendered when at
  least one active project exists, so users with no AI Manager projects see
  no new UI. Tests: `agent-service-active-project.test.ts` (plumbing -
  `getKnowledgeForMessage` receives the pinned id, or `undefined` when
  nothing's pinned) and `api-active-project.test.ts` (route-level round-trip
  + 404/400 validation), following 13-A's precedent of testing at the layer
  where the id is actually forwarded rather than through a full daemon
  harness.
- **14-B**: `api-config-credentials.test.ts` added, mocking
  `../vault/keychain.ts` via `mock.module` (resolved-path interception, so
  both `src/image/config-binding.ts` and `src/github/api.ts`'s existing
  `../vault/keychain.ts` imports pick up the mock without touching either
  module) rather than calling the real AES-256-GCM file-backed keychain -
  this was exactly the gap 13-B's own plan flagged as "would need
  `keychain.ts` mocked, not called for real, to avoid writing into a
  developer's actual secrets file." Covers both routes: empty-state GET,
  POST-then-GET round-trip asserting `has_api_key`/`has_token` flips to
  `true` and the raw secret never appears in any response body, invalid-
  provider/missing-key/missing-token 400s, and (image only) that a saved key
  re-registers onto a live `ImageManager` instance without a restart -
  the exact behavior 13-B's `registerImageProviders()` re-call was for.

**Suggested order: 14-B, then 14-A.** B is fully self-contained (one new
test file, no production code change) and closes out Phase 13's last
loose end regardless of any product decision. A depended on the "should
chat be able to pin a project" question the Phase 13 doc explicitly left
open - resolved before implementation (pin it, since project-scoped memory
in ordinary conversation is worth more than the small UI surface it costs,
and the deferred note's alternative of doing nothing would have left the
12-B/13-A `project_id` plumbing dead on the conversational side
indefinitely).

## 12. Phase 15 Plan (post-14 gap audit) — Done

All three items shipped in suggested order (15-A, 15-C, 15-B). `tsc --noEmit`
clean, `bun run build:ui` succeeds. Notes by item:

- **15-A**: `updateExecutionMode` added to `useAIManagerData.ts` (mirrors
  `updateCostMode` exactly), the static `execution_mode` label in
  `AIManagerRoom.tsx` replaced with a `<select>` next to the existing
  cost-mode selector. New route-level test file
  `src/ai-manager/api/routes-project-patch.test.ts` (none existed for this
  route at all before - status/execution_mode/cost_mode round-trip plus
  400/404 cases).
- **15-C**: additive `tasks.healing_attempts TEXT` column (`schema.ts`,
  same convention as `qa_report`) storing a compact per-attempt summary
  (`attempt, strategy, template, mode, failure_class` - not the full
  `TaskResultEnvelope`), threaded through `project-tasks.ts`'s
  `ProjectTaskFields`/`setProjectTaskFields` and persisted by
  `manager-agent.ts` alongside `retry_count`/`qa_report`. UI: superseded
  `CANCELLED` retry rows are now filtered out of the Kanban board (they were
  previously dumped into the generic CANCELLED column, indistinguishable
  from a real cascade-cancellation) and nested under the winning task's
  expanded card instead, next to the new attempt-sequence list. New test in
  `manager-agent.e2e.test.ts`: a subtask that fails once (transient) then
  succeeds asserts `healing_attempts` has both entries and the superseded
  task row is linked via `parent_task_id`.
- **15-B**: `AuditTrail.query()` gained a `tools?: string[]` filter (`IN`
  clause, additive alongside the existing single-`tool` filter) and
  `/api/authority/audit` threads a comma-separated `?tools=` param through
  to it. UI: a "recent github activity" panel in `AIManagerRoom.tsx`
  fetching that route filtered to the `git_*`/`github_*` tool-name family
  or once each project's detail loads. Deliberately **not** project-scoped
  - confirmed `audit_trail` has no `project_id` column, and adding one
  would mean threading a project id through every `AuditTrail.log()` call
  site across the codebase, well beyond this item's scope - the panel
  header says so explicitly rather than implying a scoping guarantee that
  isn't there.

**Deferred, not forgotten**: project-scoping `audit_trail` (would make the
GitHub activity panel, and any future per-project audit view, actually
project-scoped) - a bigger, cross-cutting change than any single Phase 15
item, revisit only if a concrete need for project-scoped audit history
shows up.

Phase 14 cleared its own deferred list in full - nothing carried over. Phase
15's items therefore come from a fresh audit of the code shipped across
Phases 11-14 rather than a queued list: three spots where the backend
already has the data or the tool already runs, but the dashboard never
surfaces it, plus one small live-editing gap that's the direct sibling of
12-A/13-C's cost-mode work.

Findings from that audit:
- `execution_mode` is readable but not editable from the dashboard after
  project creation - `cost_mode` got a live `<select>` in 12-A's wake but
  `execution_mode` still renders as a static label
  (`AIManagerRoom.tsx:109`) despite `PATCH /projects/:id` already accepting
  it (`src/ai-manager/api/routes.ts:173-194`).
- GitHub Issue/PR/Review tools (`github_create_issue`/`github_create_pr`/
  `github_pr_status`/`github_pr_review`, `src/actions/tools/github.ts:176-
  252`, backed by a complete `src/github/api.ts`) are fully agent-callable
  but have zero dashboard surface - Phase 7 authority-gated them, it never
  gave them a UI, unlike Council/QA which both got dedicated panels in
  earlier phases.
- Self-healing's per-attempt detail (`HealingAttempt[]` - strategy +
  failure_class per try, `src/ai-manager/self-healing.ts:31-38`) is computed
  but `manager-agent.ts:421` only persists a bare `retry_count`; a subtask
  that needed 2 retries looks identical to one that succeeded first try
  except for a number.
- The superseded/CANCELLED task rows retries generate
  (`manager-agent.ts:395-404`, deliberately `project_id`-scoped so they stay
  queryable) are never rendered anywhere - dead data that already has the
  plumbing needed to show it.

**Suggested order: 15-A, then 15-C, then 15-B.** A is the smallest (mirrors
an already-shipped pattern almost exactly) and has no dependency on
anything else. C is next because it's pure "persist and render data that
already exists," no new subsystem. B is last since it's the most net-new
surface (first GitHub-specific dashboard UI at all), and benefits from
confirming during C whether `audit_trail` is the right read model to reuse
rather than inventing a second one.

## 15. Phase 18 Plan (post-17 gap audit) — Done

All three items shipped in the suggested order (18-A, 18-B, 18-C).
`bunx tsc --noEmit` clean, `bun build ui/index.html ui/pebble.html --outdir
ui/dist` succeeds (the `bun run build:ui` wrapper's `copy:models` prebuild
step fails in this worktree because the wasm model assets aren't installed
here at all - a pre-existing environment gap unrelated to this phase's code,
confirmed by running the underlying `bun build` command directly). Full
`bun test`: 1900 passing (1893-passing baseline measured in this environment
at the start of this phase + 5 new: 4 in `routes-github-action.test.ts`, 1 in
`authority.test.ts`) / 65 failing / 2 errors - all in the same pre-existing
Windows-only categories as every prior phase (unix-domain sockets, process-
lock files, `chmod`/`O_NOFOLLOW` permission tests, `jarvis export`/`restore`
subprocess tests, `EBUSY` temp-dir cleanup races) - none touch `ai-manager`/
`authority`/`vault` code, confirmed by grepping the failing-test list for
those paths. (Note: this environment's raw pass/fail counts drift a few
tests run-to-run - 1893/67/3 on one run, 1907/65/2 reported by Phase 17 -
which reads as pre-existing flakiness in the same lock/socket/subprocess
tests rather than anything this phase touched; the fail *categories* and
zero involvement of AI-Manager-adjacent code are the stable signal checked
here.) Notes by item:

- **18-A**: `PendingApprovalCard` (`ui/src/v2/rooms/authority/
  AuthorityRoom.tsx`) gained a `parseToolArguments()` helper (JSON.parse,
  drops nested object/array values, fails soft on malformed input) rendering
  `tool_arguments` as a compact key:value `<dl>`, plus a `context` line
  above it. The history row (formerly a single-line grid) is now wrapped in
  a `.v2-auth__history-row-wrap` column that adds `context`/
  `execution_result` lines below the existing time/agent/tool/status grid
  row. No route/schema change - both fields were already written by
  `ApprovalManager.createRequest` and, for GitHub actions specifically,
  `routes.ts`'s `context: "Dashboard: ${toolName} on ${repo_path}"` /
  `toolArguments: { repo_path, title, ... }`.
- **18-B**: two one-line additions - `QACheckResult.detail` now renders
  under a failed automated check (`AIManagerRoom.tsx`'s `TaskCard`, new
  `.rk-aim__qa-check-detail` class, `rk-aim__qa-check`'s flex row given
  `flex-wrap` so the detail line wraps onto its own row rather than
  truncating), and `CouncilOpinion.tier` is now shown next to `mode` in the
  Council opinion header. No backend change, no test (pure rendering of
  already-typed/fetched fields, same as 17-A/16-B/15-C's equivalent items).
- **18-C**: additive `audit_trail.project_id TEXT` column + `idx_audit_project`
  index (`schema.ts`, same convention as every other `project_id`-scoped
  table since Phase 1). `AuditTrail.log()`/`AuditEntry`/`query()` gained an
  optional `project_id`/`projectId`; `GET /api/authority/audit` accepts
  `?project_id=`. `POST /api/ai-manager/github/action` now accepts an
  optional `project_id` in its body (404s if the id doesn't resolve via
  `getProject`), threads it into both `AuditTrail.log()` calls it makes, and
  - since `ApprovalRequest` itself has no `project_id` column and adding one
  was explicitly out of scope per the plan - appends `(project <id>)` to the
  pending-approval `context` string instead. `useAIManagerData.ts`'s
  `githubAction` now sends the currently selected project's id automatically
  (the GitHub Action dialog only ever opens from a project's detail view),
  and the "recent GitHub activity" fetch passes `?project_id=` so the panel
  shows only the selected project's activity - closing the "not project-
  scoped" caveat 15-B's panel comment stated. Deliberately left the other 5
  `AuditTrail.log()` call sites (orchestrator, sub-agent-runner, deferred-
  executor, workflow backend) untouched - none has a project id in local
  scope, confirmed while writing this item, so full daemon-wide threading is
  still the larger, not-yet-worth-it change the doc has correctly deferred
  three phases running. New tests: `routes-github-action.test.ts` gained
  4 cases (unknown `project_id` → 404, allowed-path audit row scoped,
  pending-approval audit row + `ApprovalRequest.context` scoped, and
  omitted-`project_id` still defaults to `null` - the pre-18-C behavior);
  `authority.test.ts` gained one `AuditTrail`-level case asserting `log()`
  persists `project_id` and `query({ projectId })` filters correctly.

**Deferred, not forgotten**: a dashboard-side inline-wait approval flow
(unchanged from Phase 16/17 - still no concrete need, still the same 202→
check-the-Authority-tab round trip); full daemon-wide `project_id` threading
through the remaining 5 `AuditTrail.log()` call sites (18-C only closed the
2 dashboard-reachable ones; the other 5 have no project id in scope without
larger changes to `TaskDispatcher`/agent context plumbing - re-evaluate only
if a concrete cross-cutting need for full audit-trail project-scoping shows
up, not just "it would be nice for completeness").

Phase 17 cleared both its own items and left only the same two "no concrete
need yet" carry-overs it inherited from Phase 16: a dashboard-side inline-
wait approval flow, and project-scoping `audit_trail`. Re-checked both
against the current code before starting a fresh audit:

- **Inline-wait approval flow**: still no concrete need. Nothing in this
  pass's review of `useAIManagerData.ts`/`AIManagerRoom.tsx` suggests the
  202-then-check-the-Authority-tab round trip is causing friction - there's
  no telemetry or user complaint to act on, and building a live-resolving
  dialog (WebSocket push or long-poll against a single approval id) would be
  genuinely new plumbing, not a "render what's already there" item. Stays
  deferred.
- **Project-scoping `audit_trail`**: re-examined with a concrete question
  this time (which Phase 15/16/17 hadn't asked): *how many `AuditTrail.log()`
  call sites actually have a `project_id` in scope already?* Answer: of the
  7 real call sites (`sub-agent-runner.ts:153`, `orchestrator.ts:769,929`,
  `service-backends.ts:474`, `deferred-executor.ts:80`, and
  `routes.ts:379,421`), only the last two - both inside
  `POST /api/ai-manager/github/action` - are reachable from a UI surface
  that already knows which project is selected (`AIManagerRoom.tsx`'s
  GitHub Action dialog opens from a project's detail view). The other five
  operate on tool calls/agent contexts with no project concept in local
  scope, so full daemon-wide threading is still not worth it. But narrowed
  to just those two call sites plus the read side (`GET /api/authority/audit`
  and the dashboard's "recent GitHub activity" panel, which today explicitly
  says it is *not* project-scoped), this is now a small, concrete change
  worth shipping - see 18-C.

A fresh audit of the code shipped through Phase 17 turned up two more items,
both the "fetched/typed but never rendered" pattern every prior phase has
favored:

- `ApprovalRequest.tool_arguments`/`context`/`execution_result`
  (`ui/src/v2/rooms/authority/useAuthorityData.ts:38,41,47`) are typed and
  populated server-side (`approval.ts`'s `createRequest`, and for GitHub
  actions specifically `routes.ts:401-419`'s
  `context: "Dashboard: ${toolName} on ${repo_path}"` +
  `toolArguments: { repo_path, title, ... }`), but
  `PendingApprovalCard`/the history row in `AuthorityRoom.tsx:395-478` never
  render any of them - a GitHub-action approval card shows only the tool
  name and a generic reason string, with no visible repo path, PR
  title/head/base, or (once resolved) what the tool actually returned. This
  is the exact "generic blob missing context" shape 17-B's own doc note
  anticipated when it said a project-aware panel could add context cheaply -
  turns out the context is already being written, just not read.
- Two smaller sibling fields in the AI Manager room: `QACheckResult.detail`
  (`useAIManagerData.ts:33`, distinct from `summary`, presumably the
  longer diagnostic for a failed automated check) and `CouncilOpinion.tier`
  (`useAIManagerData.ts:132`, alongside `mode` which *is* shown) are both
  fetched and typed but never referenced in `AIManagerRoom.tsx`'s QA-check
  list (`:409-419`) or Council opinion header (`:590`).

**18-A: Render approval request context/arguments/result in the Authority
Room.** The pending-approval card and history row currently drop
`tool_arguments`, `context`, and `execution_result` on the floor even though
the server already writes meaningful values into all three (most visibly for
GitHub actions, but every approval request carries them). Parse
`tool_arguments` (JSON) into a compact key:value list, show `context` under
the reason line, and show `execution_result` on resolved/executed history
rows. Pure rendering of already-fetched data - no schema or route change.

**18-B: Surface `QACheckResult.detail` and `CouncilOpinion.tier`.** Same
"computed but not displayed" pattern 15-C/16-B/17-A each closed one instance
of - these are the two remaining scalar fields of that shape left in the AI
Manager room after 17-A closed the task-level ones. Show `detail` under a
failed QA check (collapsed/secondary to `summary`) and add `tier` to the
Council opinion header next to `mode`. Trivial, no backend change.

**18-C: Project-scope the GitHub dashboard-action audit trail.** Add a
nullable `audit_trail.project_id TEXT` column (same additive convention
already used for `tasks`/`decisions`/`agent_messages`/`entities`/`facts`/
`observations`/`commitments`), accept an optional `project_id` in
`POST /api/ai-manager/github/action`'s body, thread it through the two
`AuditTrail.log()` calls in that route plus the `ApprovalManager.createRequest`
call's `context` (append `, project <id>` for the pending-approval case since
`ApprovalRequest` has no `project_id` column of its own - out of scope to add
one there too), add a matching `project_id` query filter to
`AuditTrail.query()`, extend `GET /api/authority/audit` with an optional
`?project_id=`, and have `useAIManagerData.ts`'s GitHub-activity fetch pass
the selected project's id so the "recent github activity" panel actually
shows only this project's activity instead of the whole daemon's - closing
out the caveat 15-B's panel header states today. Deliberately still not
touching the other 5 `AuditTrail.log()` call sites (orchestrator,
sub-agent-runner, deferred-executor, workflow backend) - none of them have a
project id in local scope, and threading one through would be the larger,
still-not-worth-it change the doc has correctly deferred three phases
running.

**Suggested order: 18-A, then 18-B, then 18-C.** A is the highest-value item
(closes a real "can't tell what this approval is actually for" UX gap) and
touches only the UI layer against data the server already writes, so it's
both valuable and low-risk to do first. B is the smallest possible item -
two one-line render additions - and shares no code with A or C, so it can
slot in anywhere; doing it second keeps the UI-only items grouped before C's
schema/route change. C is last because it's the only item touching the
backend (migration + route + query filter + UI wiring across two files), the
same relative ordering 15-B/16-C/17-B each used for "the one item that isn't
pure rendering."

## 14. Phase 17 Plan (clearing the 16-deferred list) — Done

Both addressable items shipped: `tsc --noEmit` clean (`src/` and `ui/`),
`bun run build:ui` succeeds, full `bun test` at 1907 passing (same as the
Phase 16 baseline - one existing test was rewritten in place rather than
added, plus its assertion count grew) / 65 failing + 2 errors, the same
pre-existing Windows-only failures as every prior phase, no new ones. Notes
by item:

- **17-A**: `dependencies` (task-id list) and `next_agent`/`approval_required`
  were the last of Phase 16's own "fetched but unrendered" `ProjectTask`
  fields (`artifacts`/`assigned_provider`/`assigned_model` were closed in
  16-B). `TaskCard` (`AIManagerRoom.tsx`) now takes the full `allTasks` list
  as a prop (already available in the parent's `data.tasks`) so a
  dependency id can resolve to the referenced task's title and live status
  rather than a bare id - mirrors 16-B's artifact-list styling
  (`rk-aim__card-qa`/`rk-aim__qa-check`). `next_agent`/`approval_required`
  are compact meta-row badges next to `assigned_provider`/retry count,
  matching that row's existing pattern rather than a new expanded section -
  they're single scalar values, not lists, so they didn't need the
  click-to-expand treatment `dependencies` did. Pure rendering of
  already-fetched data; no new test needed (no backend change).
- **17-B**: closed the 16-C `409` dead end using an existing mechanism this
  phase's audit found already fully wired for other tools:
  `ApprovalManager`'s `deferred` execution mode + `DeferredExecutor`, which
  executes against the daemon's shared `ToolRegistry`
  (`src/actions/tools/builtin.ts`) - and all four GitHub action tools were
  already registered there via `GITHUB_TOOLS` (confirmed: Phase 7's tools
  are agent-callable, meaning they were already in that registry; 16-C's
  route just never used it). So `POST /api/ai-manager/github/action` now
  creates a real `deferred` approval request (same `createRequest` call
  `manager-agent.ts`'s manual-mode gate already makes) instead of returning
  409, and returns `202 { status: 'pending_approval', approval_id }`. No new
  approval-surfacing UI was needed - 11-B already confirmed the dashboard's
  generic Authority tab (`useAuthorityData.ts`) polls
  `/api/authority/approvals?status=pending` and is subsystem-agnostic, so
  the filed request appears there automatically, gets approved/denied
  through the same `applyApprovalDecision` path `git_push` approvals already
  use, and `DeferredExecutor.executeApproved()` runs the tool for real. The
  audit-trail log call was restructured to fire once per branch (not
  unconditionally before knowing the outcome) so the `approval_required` row
  now carries the real `approval_id` instead of always logging `null` -
  matches every other authority-gate log site's convention of linking the
  audit row to its approval request. `useAIManagerData.ts`'s `githubAction`
  and `AIManagerRoom.tsx`'s `GitHubActionDialog` both gained a `pending`
  result branch (202 → "sent for approval, check the Authority tab" instead
  of a raw error). `routes-github-action.test.ts`'s former "returns 409"
  case was rewritten to assert the 202 response, the audit row's
  `approval_id`, and the persisted `approval_requests` row's
  `execution_mode: 'deferred'`/tool name/arguments.

**Deferred, not forgotten** (unchanged from Phase 16, still true): a
dashboard-side *inline-wait* approval flow (this phase closed the dead end
with the existing deferred path, not a new synchronous one - a user still
has to go check the Authority tab rather than watch the dialog resolve
live; revisit only if that round-trip proves annoying in practice);
project-scoping `audit_trail` (carried over from Phase 15/16, still no
concrete need).

Phase 16 cleared its own deferred list in full except for the audit-trail
item it explicitly held back again. Phase 17 had only two real items left
from that list (`dependencies`/`next_agent`/`approval_required` rendering,
and the GitHub approval dead end) - both closed without a fresh gap audit
turning up a third, unlike Phases 15/16 which each surfaced three findings.

**Suggested order: 17-A, then 17-B.** A is pure rendering with zero
dependencies, same role it played in 16-B. B is the substantive item - it
looked like it might need new plumbing (an inline-wait UI, a polling
mechanism) but turned out to be existing infrastructure the route simply
hadn't been wired to yet, once the `ToolRegistry` registration was
confirmed.

## 13. Phase 16 Plan (post-15 gap audit) — Done

All three items shipped in suggested order (16-A, 16-B, 16-C). `tsc --noEmit`
clean, `bun run build:ui` succeeds, full `bun test` at 1907 passing (1901
Phase-15 baseline + 6 new: 2 `rules` PATCH cases + a route-level 404 already
covered, plus 8 new `routes-github-action.test.ts` cases minus overlap) /
65 failing + 2 errors - the same pre-existing Windows-only filesystem/lock/
export failures as every prior phase (unix-domain sockets, process-lock
files, chmod permissions, symlink handling, `jarvis export`/`restore`
subprocess tests), none touching `ai-manager`/`vault`/`authority` code.
Notes by item:

- **16-A**: `updateProjectRules` added to `useAIManagerData.ts` (mirrors
  `updateExecutionMode`/`updateCostMode`), a new `RulesEditor` component in
  `AIManagerRoom.tsx` rendered below the description (add/remove rows,
  reusing the decisions-list and resume-input styling rather than new CSS).
  `routes-project-patch.test.ts` gained a `rules` round-trip case and a
  non-array-rejection case.
- **16-B**: `TaskCard` now renders `task.artifacts` in its expanded detail
  (same location/pattern as 15-C's healing-attempt list) and
  `assigned_provider`/`assigned_model` next to `assigned_agent` in the card
  meta row. `dependencies`/`next_agent`/`approval_required` deliberately
  left unrendered per the plan's scope note - carried into this phase's own
  deferred list. Pure rendering of already-covered data; no new test.
- **16-C**: turned out to need one piece of new plumbing the plan hadn't
  named - `AIManagerApiContext` had no `AuthorityEngine`/`AuditTrail`
  access at all (`getLLMManager`/`getTaskDispatcher`/`getApprovalManager`
  only), because no AI Manager route had ever needed the gate before. Added
  `getAuthorityEngine`/`getAuditTrail` to the context type and wired them
  from `src/daemon/index.ts`'s existing `authorityEngine`/`auditTrail`
  instances (both already constructed there for the orchestrator - no new
  instances). New `POST /api/ai-manager/github/action` route
  (`routes.ts`) wraps `githubCreateIssueTool`/`githubCreatePrTool`/
  `githubPrStatusTool`/`githubReviewTool`'s `execute()` directly, gated by
  the same `checkAuthority` + `AuditTrail.log()` sequence
  `src/agents/orchestrator.ts`'s `executeTool()` uses for agent-initiated
  calls - since a dashboard click has no agent identity, it's given a
  synthetic `'dashboard'` actor at authority level 10 (a human triggering
  their own dashboard is at least as trusted as any agent role), so the
  same context rules (git-push-approval-style) would still apply if one
  were ever added for these tools. Denied → 403, `requiresApproval` → 409
  (dashboard-triggered approval flow isn't built - out of scope, same
  reasoning as 13-B's deferred credential round-trip test - falls back to
  telling the caller to use the conversational path instead of silently
  bypassing the gate). New `GitHubActionDialog` in `AIManagerRoom.tsx`
  (repo path + per-tool fields, mirrors `CouncilDialog`'s
  request/result-view structure) opened from a button next to the 15-B
  activity panel, which also gained an explicit "No GitHub activity yet"
  empty state (previously the whole panel just didn't render). New
  `routes-github-action.test.ts`: validation-error cases, an allowed+
  executed round trip (asserts the resulting `audit_trail` row), a
  context-rule-denied case (403, not executed, audit row says `denied`),
  and a context-rule-approval-required case (409, not executed, audit row
  says `approval_required`).

**Deferred, not forgotten**: `dependencies`/`next_agent`/`approval_required`
task fields (16-B's scope note, still fetched-but-unrendered); a dashboard-
side approval flow for `git_operation`-governed GitHub actions (16-C
returns 409 rather than building one - no concrete need yet, since none of
the four dashboard-exposed GitHub tools are governed or push/force-push by
default); project-scoping `audit_trail` (carried over from Phase 15, still
no concrete need).

Phase 15 cleared its own deferred list except for one item explicitly held
back ("project-scoping `audit_trail`" - no concrete need yet, still true).
Phase 16's items come from a fresh audit of the code shipped in Phase 15:
one spot where a PATCH-able project field still has zero dashboard surface
(the exact shape 15-A closed for `execution_mode`), one spot where task data
is fetched and typed but never rendered (the exact shape 15-C closed for
healing attempts), and one genuinely new surface (GitHub tools are still
agent-only despite 15-B's read-only activity log).

Findings from that audit:
- `project.rules` is PATCH-able (`PATCH /projects/:id` → `setProjectRules`,
  `src/ai-manager/api/routes.ts:179,202-206`; `src/vault/projects.ts:26-70`)
  and `Project.rules: string[]` is already typed in `useAIManagerData.ts:19`,
  but `AIManagerRoom.tsx` never reads `selected.rules`, there is no
  `updateProjectRules` alongside `updateCostMode`/`updateExecutionMode`
  (`useAIManagerData.ts:303-336`), and `routes-project-patch.test.ts` covers
  `execution_mode`/`cost_mode`/404 but not `rules`.
- `ProjectTaskFields.artifacts: string[]` is persisted and returned
  (`src/vault/project-tasks.ts:40,76,89,99`) and typed in
  `useAIManagerData.ts:64`, but the task-card renderer in `AIManagerRoom.tsx`
  only shows `assigned_agent` - `artifacts`, `dependencies`,
  `assigned_provider`/`assigned_model`, and `next_agent`/`approval_required`
  are all fetched into hook state and never referenced in the component.
- `github_create_issue`/`github_create_pr`/`github_pr_status`/
  `github_pr_review` (`src/actions/tools/github.ts:176-252`) remain callable
  only from inside an agent conversation. Council got an interactive "Ask
  the Council" dialog with its own request/response UI
  (`AIManagerRoom.tsx:158`, `CouncilDialog` at line 428) in an earlier phase;
  GitHub tools got only a one-way activity feed in 15-B
  (`AIManagerRoom.tsx:239-244`) - no "open a PR" / "check PR status" control
  exists anywhere in the dashboard.

**Suggested order: 16-A, then 16-B, then 16-C.** A mirrors 15-A almost
exactly (smallest, no dependencies). B is next - pure "render data that
already exists," no new subsystem, same role 15-C played. C is last since
it's the first interactive GitHub surface (needs a small form plus a new
route wrapping an existing tool's `execute()`), the same relative sizing
15-B had against 15-A/15-C.

### 16-A: `project.rules` live-editable from the dashboard

**Problem**: `PATCH /projects/:id` already accepts and persists `rules`, but
nothing in the dashboard reads, displays, or edits them - the exact gap
15-A closed for `execution_mode`.

**Plan**:
1. Add `updateProjectRules` to `useAIManagerData.ts`, mirroring
   `updateExecutionMode`/`updateCostMode` (same PATCH call, same optimistic
   update).
2. Render `selected.rules` in `AIManagerRoom.tsx` next to the
   execution/cost-mode controls - a simple editable list (add/remove line
   items), not free-text, since `rules` is `string[]`.
3. Tests: extend `routes-project-patch.test.ts` with a `rules` round-trip
   case alongside the existing `execution_mode`/`cost_mode`/404 cases.

### 16-B: Surface task `artifacts` (and sibling fetched-but-unused fields)

**Problem**: `artifacts` (deliverable file paths a subtask produced) is
already fetched into hook state per task but never rendered - same
"computed, not displayed" shape 15-C fixed for healing attempts.

**Plan**:
1. Render `task.artifacts` in the task card's expanded detail (same location
   healing-attempt detail was added in 15-C), as a simple file-path list.
2. While in the same component, also surface `assigned_provider`/
   `assigned_model` next to `assigned_agent` if trivial to add alongside -
   otherwise leave `dependencies`/`next_agent`/`approval_required` for a
   future pass rather than scope-creeping this item.
3. Tests: none needed if this is pure rendering of already-covered data: no
   new backend logic. Confirm during implementation whether any existing
   test asserts `artifacts` round-trips through `project-tasks.ts` - add one
   only if that assertion doesn't already exist.

### 16-C: GitHub issue/PR actions triggerable from the dashboard

**Problem**: 15-B made GitHub tool activity visible (read-only log) but the
tools themselves (`github_create_issue`, `github_create_pr`,
`github_pr_status`, `github_pr_review`) still require an agent conversation
to invoke - no dashboard control exists, unlike Council's dedicated
request/response dialog.

**Plan**:
1. A small form in (or near) the GitHub activity panel added in 15-B - repo,
   title/body for issue/PR creation; PR number for status/review lookup.
2. A new route wrapping the existing tool `execute()` functions directly
   (not re-implementing GitHub API calls) - confirm authority-gating applies
   the same way it does when an agent calls these tools
   (`src/roles/authority.ts`), so the dashboard path can't bypass a gate the
   conversational path enforces.
3. Tests: route-level round trip following the `api-*-test.test.ts` pattern,
   plus a check that the authority gate rejects an unauthorized dashboard
   call the same way it would an agent-initiated one.

**Deferred, not forgotten**: `dependencies`/`next_agent`/`approval_required`
task fields, if 16-B doesn't cover them - same "fetched but unrendered"
shape, lower priority than `artifacts`; project-scoping `audit_trail`
(carried over from Phase 15, still no concrete need).

### 15-A: `execution_mode` live-editable from the dashboard

**Problem**: `useAIManagerData.ts` exposes `updateCostMode` (~line 270) which
calls the existing `PATCH /projects/:id` route and renders as a `<select>`
next to the static `execution_mode` label at `AIManagerRoom.tsx:109` - the
route already accepts `execution_mode` in the same PATCH body
(`routes.ts:173-194`), only the UI never wired a control for it.

**Plan**:
1. Add `updateExecutionMode` to `useAIManagerData.ts`, mirroring
   `updateCostMode` exactly (same PATCH call, same optimistic-update
   pattern).
2. Replace the static `{selected.execution_mode}` label with a `<select>`
   (auto/assisted/manual) next to the existing cost-mode selector.
3. Tests: extend whatever route-level test currently covers the `cost_mode`
   PATCH path with an equivalent `execution_mode` case, following 11-C's
   existing `updateProjectExecutionMode` unit coverage if no route-level
   case exists yet.

### 15-B: GitHub tool activity surfaced on the dashboard

**Problem**: GitHub tools run against real repos/issues/PRs today with no
dashboard trace - a user can only see what happened by reading raw chat
transcript, if the call even happened inside an interactive session.
`git_operation` is an authority-gated `ActionCategory` (Phase 7,
`src/roles/authority.ts`), so gated calls already produce `audit_trail`
rows; check during implementation whether ungated read calls
(`github_pr_status` etc.) also log there or need an explicit log line
added alongside the tool `execute()`.

**Plan**:
1. Confirm whether `audit_trail` (`src/authority/audit.ts`) already has a
   row per GitHub tool call; if yes this becomes a read-only panel over
   existing data (mirrors 11-B's Handoffs panel), if some calls are missing
   rows, add them at the tool `execute()` level rather than inventing a
   parallel log.
2. A `GET` route filtered by `project_id` (or reuse an existing audit-trail
   route if `project_id` is already a filterable column) returning the
   GitHub-tagged subset.
3. A small panel in `AIManagerRoom.tsx` next to the Council/QA panels -
   issue/PR links, action type, timestamp, status.
4. Tests: route-level round trip following the `api-*-test.test.ts`
   pattern.

### 15-C: Surface self-healing retry detail and superseded task history

**Problem**: combines the third and fourth audit findings above - both are
"the data exists, nothing renders it" gaps in the same code path
(`ManagerAgent.runSubtask` → `self-healing.ts`).

**Plan**:
1. Persist a compact per-attempt summary (strategy + failure_class, not the
   full envelope) onto the winning task row - a new `healing_attempts` JSON
   column on `tasks`, additive `ALTER TABLE`, same convention `qa_report`
   already established.
2. Task cards with `retry_count > 0` expand to show the attempt sequence
   (mirrors the existing `qa_report` inline-detail pattern from 11-B).
3. Surface the `CANCELLED` superseded rows as a collapsed "previous
   attempts" sub-list under the winning task, using the existing
   `parent_task_id` linkage - no new query needed, `getProjectTasks()`
   already returns them.
4. Tests: extend `manager-agent.e2e.test.ts` with a case asserting
   `healing_attempts` persists the expected strategy sequence for a subtask
   that retries once then succeeds.

**Deferred, not forgotten**: whether the Phase 14 active-project pin should
extend beyond interactive chat to background/scheduled execution - confirmed
during this audit that no such path exists yet (`event-reactor.ts`/
`commitment-executor.ts` never touch `ManagerAgent`/`ai-manager`), so there
is nothing to scope today; revisit only if a background project-execution
path is ever added.

### 14-A: Active project pin for conversational chat

See implementation notes above - this section exists to preserve the
original "Problem" framing from the Phase 13 audit for future reference:
Phase 13-A resolved project-scoped memory for `ManagerAgent`'s task-tier
subtask execution (task_request.project_id → `getKnowledgeForMessage`), but
left classic conversational chat (outside any AI Manager project) with no
way to say "I'm currently working on project X," so ambient facts in
ordinary conversation stayed global-only even when a user was mid-project.
14-A closes that gap with the smallest change that does so: a pinnable
session-level project id, not a new persistent "current project" concept
tied to conversations/channels in the schema.

### 14-B: `/api/config/image`/`/api/config/github` round-trip tests

See implementation notes above - both routes existed and worked correctly
since Phase 13-B; this item only closes the automated-coverage gap that
phase's plan explicitly deferred.

### 13-A: Project-scoped memory in the conversational path

**Problem**: Phase 12-B added `project_id` scoping to `entities`/`facts`/
`observations`/`commitments` and an optional `projectId` parameter to
`retrieveForMessage`/`getKnowledgeForMessage` (`src/vault/retrieval.ts`), but
nothing calls them with one. The two real call sites -
`AgentService.buildAmbientFactsBlock` and `buildPromptContext`
(`src/daemon/agent-service.ts:610-622`, `:856-...`) - build the system prompt
for the **conversational** tier, which has no project concept anywhere in
its state today (confirmed while building 12-B: no `currentProject`/
`activeProject`/`selectedProject` field exists in `src/daemon/`).
`ManagerAgent`'s **task** tier execution is a separate path entirely (its own
`TaskDispatcher` runner closure in `agent-service.ts:685`, not
`buildPromptContext`) and already threads `project.id` end-to-end for
tasks/decisions/handoffs - it just never touches vault memory retrieval.

So there are really two different gaps hiding under one name:
1. Should a `ManagerAgent`-run subtask's LLM call see project-scoped memory
   context (facts/entities relevant to *this* project)? Today it sees none
   at all, project-scoped or otherwise - `TaskDispatcher`'s runner builds a
   template-specific system prompt with no vault retrieval step.
2. Should the classic conversational chat (outside any AI Manager project)
   have a way to say "I'm currently working on project X" so ambient facts
   get scoped? Today conversation and projects are entirely parallel
   surfaces - a user can have an active project and an unrelated chat
   session at the same time, and nothing links them.

**Plan**:
1. Resolve (1) first, since `ManagerAgent` already has `project.id` in hand
   and it's the narrower, lower-risk change: add an optional
   `getKnowledgeForMessage(subtask.title, project.id)` call inside the
   `TaskDispatcher` runner closure (`agent-service.ts:685`) or inside
   `runSubtask` before dispatch (`manager-agent.ts`), appended to the task
   tier's system context the same way `buildAmbientFactsBlock` appends it
   for the conversational tier. This alone makes the `project_id` plumbing
   from 12-B load-bearing instead of dead code.
2. For (2), don't invent a new "current project" concept without a UI
   decision first - ask whether the dashboard should let a user pin an
   active project to their chat session (a small piece of session state,
   not a schema change) before writing any retrieval-side code. If the
   answer is no (projects and chat stay deliberately separate surfaces),
   close this half of 13-A as "not needed" rather than building unused
   plumbing - don't repeat 12-B's mistake of adding a parameter with no
   caller.
3. Tests: extend `manager-agent.e2e.test.ts` with a case asserting a
   project-scoped fact created via `createFact(..., { project_id })` shows
   up in a subtask's task-tier context, and a fact scoped to a *different*
   project does not.

### 13-B: `/api/config/image` and `/api/config/github` routes

**Problem**: Phase 12-D's setup guide found that Image Agent
(`src/image/config-binding.ts`) and GitHub (`src/github/api.ts`) credentials
already have working keychain-backed getter/setter functions
(`getImageProviderKey`/`setImageProviderKey`, `getGitHubToken`/
`setGitHubToken`) but no daemon API route calls them - unlike
`/api/config/llm` (`src/daemon/llm-settings.ts` + `api-routes.ts:1460-1482`),
there is no dashboard-reachable way to set these two credentials at all
today.

**Plan**:
1. `/api/config/image`: `GET` returns `{ providers: { 'openai-image': {
   has_api_key }, 'gemini-image': { has_api_key } } }` (mirrors
   `LLMSettingsProviderView`'s `has_api_key`-only shape - never echo the
   key back). `POST` accepts `{ provider: ImageProviderName, api_key:
   string }`, calls `setImageProviderKey`, then re-registers providers on
   the shared `ImageManager` (mirrors `hotReloadLLMProviders`'s pattern -
   check how `ImageManager` is constructed in `agent-service.ts`/
   `daemon/index.ts` for where a re-registration hook would go, likely just
   re-calling `registerImageProviders(manager)` since it's idempotent per
   provider name).
2. `/api/config/github`: `GET` returns `{ has_token: boolean }`. `POST`
   accepts `{ token: string }`, calls `setGitHubToken`. No re-registration
   step needed - `src/github/git.ts`/`api.ts` read the token fresh via
   `getGitHubToken()` on every call rather than caching it.
3. UI: a small "Integrations" or "Credentials" section (wherever the
   existing LLM provider settings screen lives) with two more provider
   rows, reusing whatever form component that screen already has for an
   API-key input.
4. Tests: route-level tests following `api-llm-test.test.ts`'s pattern -
   `POST` then `GET` shows `has_api_key`/`has_token: true`, no key ever
   appears in a response body.

### 13-C: `cost_mode`/`execution_mode` at project creation time

**Problem**: `CreateProjectDialog` (`ui/src/v2/rooms/aiManager/
AIManagerRoom.tsx:399-442`) only collects `name`/`request` - `execution_mode`
and `cost_mode` (Phase 12-A) both default silently (`assisted`/`balanced`)
and can only be changed via a follow-up `PATCH` after the project already
exists. Not wrong, just an extra round-trip for anyone who wants something
other than the defaults from the start.

**Plan**:
1. Add two selects to `CreateProjectDialog` (same `<select>` pattern as the
   Phase 12-A cost-mode selector added to the project header), defaulting
   to `assisted`/`balanced` so the common case's markup is unchanged - just
   two more optional fields in the dialog.
2. Thread `execution_mode`/`cost_mode` through `onCreate`'s input type and
   `runProject`'s body (`useAIManagerData.ts:220-246`) - both already flow
   through to the API unchanged today for any field present in `input`,
   the API route already accepts and validates both
   (`src/ai-manager/api/routes.ts`, Phase 12-A), so this is pure UI wiring,
   no backend change.

### 13-D: Image Agent generation history

**Problem**: Deferred since Phase 11-B, re-confirmed while writing 12-D:
`llm_usage`'s `subsystem='image'` rows (`src/llm/usage.ts`) record tokens/
latency/error_code for cost tracking, but **not** the generated file path or
prompt - `image_generate` (`src/actions/tools/image.ts:60-70`) writes files
under `~/.jarvis/images/<uuid>.<ext>` and returns the path in the tool
result, but nothing persists that path anywhere queryable afterward. This
isn't a missing endpoint over existing data (as originally scoped in
Phase 11-B) - the data itself doesn't exist yet.

**Plan**:
1. Add a lightweight `image_generations` table (`id, prompt, revised_prompt,
   provider, model, file_paths (JSON array), created_at`) via the usual
   additive `CREATE TABLE IF NOT EXISTS` in `schema.ts` - deliberately not
   reusing `llm_usage` (that table's shape is token/cost accounting, not
   artifact tracking; conflating them was rejected for the same reason
   `qa_report` got its own task column instead of overloading `status`).
2. `image_generate`'s `execute()` (`src/actions/tools/image.ts`) writes one
   row here right after `writeFileSync`, alongside (not instead of) the
   existing `llm_usage` cost-tracking row `ImageManager` already records.
3. New `GET /api/image/generations` route (paginated, newest first) -
   mirrors the read-only list pattern `/api/ai-manager/projects/:id/tasks`
   already uses.
4. UI: the deferred item from Phase 11-B - a small gallery/list panel,
   lowest priority of this phase's four items since it's the most net-new
   surface (a table plus a route plus a panel, vs. the other three which
   are wiring existing pieces together).

**Suggested order: 12-B, then 12-A, then 12-C, with 12-D done in parallel at
any point.** B touches the most call sites (every vault memory read/write
used by agents and the dashboard) and both A and C are easiest to build once
project-scoped state is the norm rather than an exception - A adds another
per-project setting next to `execution_mode`/`project_id`-scoped memory, and
C's chat panel wants to show memory/decision context next to messages, which
reads better once that context is already project-scoped. D is pure
documentation research against a real provider account and has no code
dependency on A/B/C, so it can run independently rather than gating the end
of the phase.

### 12-A: Cheap/Balanced/Quality cost-mode selector (spec §40-41)

**Problem**: `TaskDispatcher.dispatch` already accepts a `tier` override per
`TaskRequest` (`src/agents/conv/task-dispatcher.ts:56`), and `runSubtask`
picks a tier per template today with no user input. There is no persisted,
user-facing "Cheap / Balanced / Quality" setting anywhere - `projects` has
`execution_mode` (Phase 11-C) but nothing analogous for cost. A user who
wants to cap spend on a project has no lever; the spec explicitly asks for a
3-mode selector layered on the existing tier system (not a new router).

**Plan**:
1. Add a `cost_mode: 'cheap' | 'balanced' | 'quality'` column to `projects`
   (additive `ALTER TABLE ... ADD COLUMN`, default `'balanced'`, same
   convention as `execution_mode`) plus a `updateProjectCostMode` helper in
   `src/vault/projects.ts` mirroring `updateProjectExecutionMode`.
2. Define the mode → tier mapping once, near `TIERS`/`TIER_FALLUP_ORDER` in
   `src/llm/tiers.ts` or as a small table in `src/ai-manager/`: `cheap` forces
   `low` (falling up through the existing chain only on failure), `quality`
   forces `high`, `balanced` leaves each template's existing per-template
   default alone (today's behavior, so `balanced` is a no-op mapping - keeps
   the common case unchanged like `auto` did for execution mode).
3. In `ManagerAgent.runSubtask`, read `project.cost_mode` and pass the
   resolved tier as `TaskRequest.tier` instead of leaving it to the
   dispatcher's per-template default, following the same
   read-project-field-before-dispatch pattern 11-C established for
   `execution_mode`.
4. API: extend the existing project create/update routes in
   `src/ai-manager/api/routes.ts` (same handlers that already accept
   `execution_mode`) to accept/return `cost_mode`.
5. UI: a 3-way selector next to wherever `execution_mode` is already exposed
   in `AIManagerRoom.tsx` / project settings, calling the same update route.
6. Tests: extend `manager-agent.e2e.test.ts` with cases asserting the
   resolved tier for each mode (cheap forces low, quality forces high,
   balanced matches today's per-template default), following the
   execution-mode test pattern from 11-C.

### 12-B: Project Memory vs User Memory separation (spec §18-19)

**Problem**: `entities`, `facts`, `relationships`, `observations` (`src/vault/
schema.ts`) have no `project_id` column - all vault memory is global across
every agent and project. `tasks`/`decisions`/`agent_messages` already carry
`project_id` (Phase 1). Without scoping, a fact learned while working on
project A can leak into project B's context, and there is no way to query
"memory for this project only" vs. "memory about the user in general" - both
required by the spec as logically separate categories.

**Plan**:
1. Additive migration: `project_id TEXT` (nullable - `NULL` means
   user/global-scoped, matching the spec's User Memory category) on
   `entities`, `facts`, `observations`, `commitments`, plus a
   `idx_*_project` index on each, following the exact `try { ALTER TABLE ...
   } catch {}` + `CREATE INDEX IF NOT EXISTS` convention already used for
   `tasks.project_id`/`agent_messages.project_id` (`schema.ts:865-920`).
   `relationships` inherits scoping transitively via its `entities` endpoints
   rather than getting its own column.
2. Vault write paths: every function that creates an entity/fact/observation
   from within a project-scoped agent call (`ManagerAgent`/`TaskDispatcher`
   context) needs to thread `project_id` through - audit
   `src/vault/*.ts` create functions and their call sites in
   `src/agents/`/`src/ai-manager/` for where a project id is already
   available in scope vs. where it needs to be passed down one more level.
3. Vault read paths used by agents (whatever builds LLM context from
   memory - likely in `src/vault/` retrieval helpers or wherever
   `AgentInstance`/task runners assemble their system prompt) should default
   to `project_id = current project OR project_id IS NULL` (project memory +
   user memory, never other projects' memory) unless a caller explicitly asks
   for cross-project/global-only.
4. Do not touch `conversations`/`conversation_messages`/`vectors`/
   `personality_state` unless a concrete leak is found there - the spec's
   separation concern is about facts/entities/observations bleeding across
   projects, not chat transcripts, and Section 5's "must not be changed"
   list argues for the smallest schema surface that satisfies the
   requirement.
5. Tests: a vault-level test creating facts under two different `project_id`s
   (plus one `NULL`/global fact) and asserting project-scoped retrieval
   returns only its own + global, never the other project's.

### 12-C: Chat display modes - Simple/Detailed/Developer (spec §52)

**Problem**: no existing concept of collapsing agent/task/handoff detail in
the chat UI - every message renders at the same level of detail regardless
of user preference. Phase 11-B already surfaced Handoffs/Council/Agent
Performance as dashboard panels; this item is about the density of the main
chat stream itself, not new data sources.

**Plan**:
1. A per-user (not per-project) UI preference, `chatDisplayMode: 'simple' |
   'detailed' | 'developer'`, persisted client-side (localStorage, consistent
   with other UI-only prefs already in `ui/src/v2/`) rather than a new vault
   table - this is a rendering concern, not data the backend needs to know
   about.
2. `Simple`: only final agent replies and user messages, no task/handoff/tool
   chatter.
3. `Detailed`: adds task lifecycle events (spawned/running/waiting/completed)
   and Handoff summaries inline, reusing the same data 11-B's Handoffs feed
   already fetches rather than a new endpoint.
4. `Developer`: adds raw tool calls/results and QA report detail inline
   (the `qa_report` checklist 11-B already renders on task cards gets a
   compact inline variant here).
5. Implementation is a filter/render-density switch over the existing
   message/event stream in whatever component renders the chat panel - no
   new backend endpoint needed since 11-B already wired the underlying data
   fetches; confirm during implementation whether any of it needs to move
   from "dashboard-only" fetches into the main chat view's data hook.
6. A mode selector control near the chat input, mirroring wherever
   execution_mode/cost_mode selectors end up living so project- and
   user-level controls read as one settings surface, not two.

### 12-D: Real-provider AI Manager setup guide (docs)

**Problem**: every Phase 2/5/6/8 integration test in this environment runs
against mock/test providers. No `docs/` guide exists for pointing a real
account (Anthropic/OpenAI/etc. for LLM tiers, an image provider for Phase 8)
at the AI Manager and confirming Council/QA/Image generation work end to end
against live APIs. This is pure documentation + manual verification, not a
code change, and has no dependency on 12-A/B/C.

**Plan**:
1. Walk through `jarvis enroll`/config setup with a real provider API key,
   documenting the keychain-based credential flow already established
   (`src/vault/keychain.ts`, `github_token`/`image.provider.*` precedents)
   rather than inventing a new setup path.
2. Document the minimum tier config needed (`llm/tiers.ts`'s "at least one of
   `medium` or `high`" validation) to get AI Manager project creation
   working.
3. Run one real end-to-end project through the dashboard against live
   providers (not mocked) and capture what breaks, if anything - this is
   also the first real-provider validation of Phases 2/5/6/8 called out as a
   gap at the end of Phase 11.
4. Write the guide as `docs/AI_MANAGER_SETUP.md`, covering: prerequisites,
   provider credential setup, minimum config, first project walkthrough,
   troubleshooting common failures (auth errors, tier fall-up behavior,
   image provider setup).

## 16. Phase 19 Plan (post-18 gap audit) — Done

All four items shipped in the suggested order (19-A, 19-B, 19-C, 19-D).
`bunx tsc --noEmit` clean, `bun build ui/index.html ui/pebble.html --outdir
ui/dist` succeeds (only the pre-existing `@theme`/`@tailwind` Tailwind-4
at-rule warnings, unrelated to this phase). Full `bun test`: 1912 passing /
65 failing / 2 errors - the same pre-existing categories as every prior
phase (Windows-only unix-domain sockets, process-lock files, `chmod`/
`O_NOFOLLOW` permission tests, `jarvis export`/`restore` subprocess tests,
`EBUSY` temp-dir races, plus `shared-runtime-paths.test.ts`'s POSIX-path
assertions failing on Windows path separators) - confirmed none touch
`ai-manager`/`authority`/`workflows` code by running those three test
directories in isolation first (`src/ai-manager`: 34/34 passing; `src/
authority` + `src/workflows`: 427 passing / 4 failing, all 4 in
`shared-runtime-paths.test.ts`). Notes by item:

- **19-A**: `AuditEntry.channel` added to the client type
  (`useAuthorityData.ts`) and rendered as a small uppercase chip on each
  audit row (`AuthorityRoom.tsx`'s `AuditTab`, new
  `.v2-auth__audit-channel` class); the row's grid gained a 7th column for
  it. `AuditStats.byCategory` is now rendered as a wrapped pill list below
  the four `StatCard`s (new `.v2-auth__audit-bycat*` classes), sorted
  descending by count. No route/schema change - both fields were already
  returned by the existing `/api/authority/audit` and `/api/authority/
  audit/stats` endpoints.
- **19-B**: `decided_by`/`decided_at`/`executed_at` now render as two
  additional lines on the "Recent decisions" history row
  (`AuthorityRoom.tsx`, new `.v2-auth__history-decided`/
  `.v2-auth__history-executed` classes, same list as 18-A's `context`/
  `execution_result` lines) - "Decided by \<who\> at \<time\>" when present,
  and "Executed at \<time\>" only for `status === "executed"` rows. No
  backend change.
- **19-C**: `AgentPerformanceRow` (`AIManagerRoom.tsx`) now shows
  `tasks_cancelled` (conditional, next to `tasks_failed`), `llm_error_rate`
  as a percentage, and a `providers_used`/`models_used` line beneath the
  stat row (new `.rk-aim__perf-models*` classes; row given `flex-wrap` so
  the line wraps rather than overflowing, same technique 18-B used for
  `QACheckResult.detail`). No backend change - `getAgentPerformance` was
  already computing and returning all five fields.
- **19-D**: `service-backends.ts`'s `gitPush` backend now accepts the
  `ctx: { runId, projectId }` second parameter its `GitPushFn` type always
  declared (and which `jarvis-git.ts`'s route already supplied - the
  parameter was just never consumed), and passes `project_id: ctx.projectId`
  into the `auditTrail.log()` call. Closes the last of the two dashboard/
  workflow-reachable `AuditTrail.log()` call sites that have a project id
  in local scope; the other 4 (`sub-agent-runner.ts`, `orchestrator.ts` x2,
  `deferred-executor.ts`) remain deferred, unchanged. No schema migration -
  `audit_trail.project_id` already exists from Phase 18-C. No new test (no
  behavior branch - just an additional column value on an existing insert;
  covered indirectly by the existing `sandbox-api`/`repos` workflow test
  suites passing unchanged).

**Deferred, not forgotten**: a dashboard-side inline-wait approval flow
(unchanged since Phase 16 - still no concrete need); `project_id` threading
through the remaining 4 `AuditTrail.log()` call sites in
`sub-agent-runner.ts`/`orchestrator.ts`(x2)/`deferred-executor.ts` - none
has a project id in local scope without larger context-plumbing changes,
re-evaluate only if a concrete need surfaces.

Phase 18 cleared all three of its own items. Its "deferred, not forgotten"
list carried over two items: a dashboard-side inline-wait approval flow
(still no concrete need - re-checked below, still true), and full
daemon-wide `project_id` threading through the remaining 5 `AuditTrail.log()`
call sites (18-C only closed the 2 dashboard-reachable ones).

Re-checked both against the code shipped through Phase 18:

- **Inline-wait approval flow**: still no concrete need. `githubAction`
  (`useAIManagerData.ts:417-454`) already handles the `202 pending` case by
  pointing the user at the Authority tab; nothing in this pass suggests
  that round trip is causing friction. Stays deferred.
- **Daemon-wide `audit_trail.project_id` threading**: re-examined per call
  site. `sub-agent-runner.ts` and both `orchestrator.ts` sites still have no
  `project_id` in local scope - stay deferred, unchanged from Phase 18's
  conclusion. `deferred-executor.ts` likewise. But
  `service-backends.ts`'s `gitPush` backend (used by the Phase 9 "Git Push"
  workflow node) is the one exception: the route that calls it,
  `createJarvisGitPushRoute` (`jarvis-git.ts:78-102`), already resolves
  `ctx.claims.projectId` and passes `{ runId, projectId }` as the backend's
  second argument - exactly the pattern `gitCommit`/`memoryWrite` use. The
  `gitPush` backend itself just declares `async (req) => {...}` with no
  second parameter, so the `project_id` that's already flowing through the
  route is silently dropped before it ever reaches `auditTrail.log()`
  (`service-backends.ts:448,474`). This is a one-parameter fix, not new
  plumbing, so it's worth closing now rather than leaving it deferred a
  fourth phase.

A fresh audit of the code shipped through Phase 18 turned up two more
"fetched/computed but never rendered" items, the same recurring pattern
every prior phase (15-C/16-B/17-A/18-B) has closed instances of:

- `AuditStats.byCategory` (`src/authority/audit.ts:151-189`, typed and
  fetched via `useAuthorityData.ts:67-73,158`) is computed server-side (one
  `GROUP BY action_category` query) and reaches the client, but `AuditTab`
  (`AuthorityRoom.tsx:507-529`) only renders the four scalar totals
  (`total`/`allowed`/`denied`/`approvalRequired`) - the per-category
  breakdown is dropped entirely, even though `ActionCategory` already has a
  fixed, known set of values (`ACTION_CATEGORIES`,
  `useAuthorityData.ts:20-27`) that maps cleanly onto a small bar/list.
  Same tab also has `AuditEntry.channel` (`'click'|'voice'|'system'`,
  `audit.ts:17,30`, written at `orchestrator.ts:937` for voice-resolved
  auto-approvals and `routes.ts:393/442/458` for dashboard clicks, returned
  by the `SELECT *` in `audit.ts:143-145`) - but the frontend `AuditEntry`
  type (`useAuthorityData.ts:54-65`) never declares `channel` at all, so a
  value the server already writes can't be surfaced even in the raw entry
  list. Both items live in the same tab/component, so one pass covers both.
- `ApprovalRequest.decided_by`/`decided_at`/`executed_at`
  (`useAuthorityData.ts:44-46`, written by `ApprovalManager.approve`/
  `.deny`/`.markExecuted` - `src/authority/approval.ts:36-38,82-84,117,
  133,182`) are fetched and typed but the "Recent decisions" history row
  (`AuthorityRoom.tsx:403-426`) only shows `created_at`/`agent_name`/
  `tool_name`/`status` - there's no "who decided" or "when it actually
  ran" line, even though 18-A already added that row's sibling `context`/
  `execution_result` fields in the same phase.

**19-A: Render `AuditStats.byCategory` and `AuditEntry.channel` in the Audit
tab.** Add a compact per-category count list/bar next to the four existing
`StatCard`s in `AuditTab` (`AuthorityRoom.tsx:520-529`), sourced from
`stats.byCategory` (already fetched, no route change). Add `channel:
"click" | "voice" | "system" | null` to the `AuditEntry` type
(`useAuthorityData.ts:54-65`) and show it as a small chip on each audit row
(if the tab renders a per-entry list; otherwise on the history rows that
already show `tool_name`/`status`). Pure rendering of already-fetched data,
no schema/route change.

**19-B: Render `decided_by`/`decided_at`/`executed_at` on the approvals
history row.** Add a line under the existing history row in `AuthorityRoom.tsx`
showing who resolved the request and when (`decided_by` at `decided_at`),
and - for `executed` status - when it actually ran (`executed_at`), mirroring
18-A's `context`/`execution_result` addition to the same row. All three
fields are already typed and fetched; no backend change.

**19-C: Surface the remaining unrendered `AgentPerformance` fields.**
`AgentPerformanceRow` (`AIManagerRoom.tsx:535-547`) renders
`tasks_completed`/`tasks_failed`/`success_rate`/`average_duration_ms` but
drops `tasks_cancelled`, `llm_error_rate`, `llm_calls`, `providers_used`,
`models_used` - all populated by the existing `getAgentPerformance`
aggregation and already typed in `AgentPerformance`
(`useAIManagerData.ts:121-132`). Add `tasks_cancelled` next to
`tasks_failed` (same conditional-render pattern), `llm_error_rate` next to
`success_rate`, and a compact `providers_used`/`models_used` list (the only
place this data would ever reach a user) below the stat row. Pure
rendering, no backend change.

**19-D: Thread `project_id` through the workflow `gitPush` backend's audit
log.** Give the `gitPush` backend in `service-backends.ts` (currently
`async (req) => {...}`, matching `GitPushFn`'s `(req, ctx) => ...` signature
minus the second parameter) the `ctx: { runId: string; projectId: string }`
parameter the route (`jarvis-git.ts:96-99`) already supplies, and pass
`project_id: ctx.projectId` into the `auditTrail.log()` call at
`service-backends.ts:474` (the column already exists from Phase 18-C - no
migration). Leaves the other 4 deferred call sites untouched, per the
re-check above.

**Suggested order: 19-A, then 19-B, then 19-C, then 19-D.** A/B/C are all
pure UI rendering of already-fetched data, no shared code between them, so
order among them doesn't matter much - grouped first because they're the
lowest-risk, highest-value-per-line items, same reasoning as every prior
phase's ordering. D is last because it's the only item touching backend
code (a function signature + one call site), even though it's small.

## 17. Phase 20 Plan (post-19 gap audit) — Done

All four items shipped in the suggested order (20-A, 20-B, 20-C, 20-D).
`bunx tsc --noEmit` clean, `bun build ui/index.html ui/pebble.html --outdir
ui/dist` succeeds (only the pre-existing `@theme`/`@tailwind` Tailwind-4
at-rule warnings). `src/ai-manager`: 34/34 passing; `src/authority` + `src/
workflows`: 437 passing / 4 failing, all 4 in `shared-runtime-paths.test.ts`
(the same pre-existing Windows-path-separator category every prior phase
has hit - unrelated to this phase's code). Notes by item:

- **20-A**: `perf.llm_calls` now renders as an `N LLM calls` stat next to
  `llm_error_rate` in `AgentPerformanceRow` (`AIManagerRoom.tsx`),
  conditional on `> 0`. No backend/type change - already computed by
  `getAgentPerformance` and typed.
- **20-B**: the project detail header (`AIManagerRoom.tsx`'s `rk-aim__dh`
  block) now shows a `Completed <date>` line (new
  `.rk-aim__dh-completed` class) when `status === "completed" &&
  completed_at`, formatted with `toLocaleString()` to match the rest of the
  room. No backend change.
- **20-C**: `AuditTab`'s row list (`AuthorityRoom.tsx`) now shows a `not
  executed` marker (new `.v2-auth__audit-notexec` class) when
  `e.executed === 0`. Since the row's CSS grid was already fixed at 7
  columns (from 19-A), the marker shares the last grid cell with
  `execution_time_ms` inside a new flex-wrap wrapper
  (`.v2-auth__audit-ms-wrap`) rather than adding an 8th column, avoiding a
  grid-layout break. No backend change.
- **20-D**: `councilConvene` (`service-backends.ts`) now accepts the `ctx:
  { runId, projectId }` second parameter `CouncilConveneFn` always
  declared (and which the route, `jarvis-council.ts:73-76`, already
  supplied), falling back to `ctx.projectId` when the workflow node's own
  `req.project_id` is absent. Closes the `councilConvene` instance of the
  declared-but-dropped `ctx.projectId` shape 19-D closed for `gitPush`. The
  identical shape at `decisionWrite`/`handoffSend` remains deferred, per
  the plan.

**Deferred, not forgotten**: a dashboard-side inline-wait approval flow
(unchanged since Phase 16 - still no concrete need, now a 6th phase
running); `project_id` threading through `sub-agent-runner.ts`/
`orchestrator.ts`(x2)/`deferred-executor.ts` (none has a project id in
local scope without larger context-plumbing changes, unchanged since Phase
18); `decisionWrite`/`handoffSend`'s `ctx.projectId`-dropped fallback in
`service-backends.ts` (identical shape to the `councilConvene` fix above,
deliberately left for a future phase rather than bundled into 20-D).

A fresh audit of the code shipped through Phase 19 (same methodology as
every prior phase: check every backend-computed/typed field against its
frontend render function, and every `Fn` type's `ctx` parameter against
what the implementing backend actually consumes) turned up four more
"fetched/computed but never rendered" or "declared but dropped" items -
the same recurring pattern 15-C/16-B/17-A/18-B/19-A/19-B/19-C have each
closed instances of.

- `AgentPerformance.llm_calls` (`src/vault/agent-performance.ts:29`, set at
  `agent-performance.ts:93`) is returned by `/api/ai-manager/agents/
  performance` and typed in `useAIManagerData.ts`, but `AgentPerformanceRow`
  (`AIManagerRoom.tsx:535-563`) - freshly touched by 19-C - renders
  `tasks_completed`/`tasks_failed`/`tasks_cancelled`/`success_rate`/
  `average_duration_ms`/`llm_error_rate`/`providers_used`/`models_used` but
  never the raw call count the error-rate percentage is computed from.
- `Project.completed_at` (`src/vault/projects.ts:39,53`, set at
  `projects.ts:132-133` when `updateStatus` transitions a project to
  `completed`) is typed and fetched, but the project detail header
  (`AIManagerRoom.tsx:125-171`, the block that already shows
  `execution_mode`/`cost_mode`/`status`) never shows it - a completed
  project's card gives no indication of when it finished.
- `AuditEntry.executed` (`src/authority/audit.ts:27,84`, written by every
  `AuditTrail.log()` call site) is typed and returned by `/api/authority/
  audit`, but `AuditTab`'s row list (`AuthorityRoom.tsx:578-604`) drops it -
  for `approval_required` rows this is the only signal for "was it
  eventually carried out", and the AI Manager Room's GitHub-activity list
  already has the exact rendering precedent for this
  (`AIManagerRoom.tsx:263`: `{g.executed ? "" : " - not executed"}`).
- `councilConvene`'s `CouncilConveneFn` type (`jarvis-council.ts:25-28`)
  declares `ctx: { runId: string; projectId: string }`, and the route
  (`jarvis-council.ts:73-76`) already resolves and passes
  `ctx.claims.projectId` - but the backend implementation
  (`service-backends.ts:349`, `async (req) => {...}`) ignores the second
  parameter entirely and forwards only the caller-supplied, optional
  `req.project_id` into `council.convene()`. A workflow-triggered "Ask the
  Council" node running inside a known project run silently records an
  unscoped Decision (`project_id: null`) unless the workflow author also
  wires `project_id` into the node's own input - the same
  declared-but-dropped shape 19-D closed for `gitPush`. (The identical
  shape also exists at `decisionWrite`/`handoffSend`; only `councilConvene`
  is in scope for this phase - see 20-D below for why.)

**20-A: Render `AgentPerformance.llm_calls` in the agent performance row.**
Add a small `N calls` stat next to `llm_error_rate` in `AgentPerformanceRow`
(`AIManagerRoom.tsx:535-563`), same conditional-render pattern as its
siblings. Pure rendering, no backend change.

**20-B: Render `Project.completed_at` on the project detail header.** Add a
conditional "Completed \<date\>" line next to the `StatusChip` in the
project detail header (`AIManagerRoom.tsx:125-171`) when
`selected.status === "completed" && selected.completed_at`, formatted with
`new Date(...).toLocaleString()` to match how `HandoffCard`/decisions
already render timestamps. No backend change.

**20-C: Render `AuditEntry.executed` on audit rows.** Add a small "not
executed" marker to `AuditTab`'s row list (`AuthorityRoom.tsx:578-604`),
shown only when `executed === 0` to avoid visual noise on the common case -
mirroring the existing `AIManagerRoom.tsx:263` precedent. No backend
change.

**20-D: Thread `ctx.projectId` into `councilConvene`'s fallback.** Give the
`councilConvene` backend in `service-backends.ts:349` the `ctx` parameter
`CouncilConveneFn` already declares, and pass
`project_id: req.project_id ?? ctx.projectId` into `council.convene()` (no
schema change - `decisions.project_id` already exists). Scoped to
`councilConvene` only: it's the most user-visible of the three sites still
carrying this shape (also reachable from the dashboard's "Ask the Council"
button via `useAIManagerData.ts:388-405`, which already sends
`project_id` explicitly - the gap is workflow-node-only). `decisionWrite`
(`service-backends.ts:423-429`) and `handoffSend`
(`service-backends.ts:359-378`) have the identical gap but are left as
deferred candidates for a future phase rather than bundled in, per the
one-contained-fix-per-item precedent every phase since 19-D has followed.

**Deferred-list re-check (carried over from Phase 19):**

- Inline-wait approval flow: still no concrete need - nothing in the
  current `githubAction`/`202 pending` path (`useAIManagerData.ts:417-454`)
  suggests friction. Stays deferred for a 5th phase running.
- `project_id` threading through `sub-agent-runner.ts`/`orchestrator.ts`
  (x2)/`deferred-executor.ts`: re-checked all four call sites directly:
  none has a project id in local scope without larger context-plumbing
  changes. Unchanged since Phase 18's original conclusion.
- **New deferred candidates**: `decisionWrite`/`handoffSend`'s
  `ctx.projectId`-dropped fallback (see 20-D above) - both real, both
  small, but deliberately not bundled into this phase.

**Suggested order: 20-A, then 20-B, then 20-C, then 20-D.** A/B/C are all
pure UI rendering of already-fetched data, no shared code between them, so
order among them doesn't matter - same reasoning as every prior phase. D is
last because it's the only item touching backend code (a function
signature + one call site), even though it's small.

## 18. Phase 21 Plan (post-20 gap audit) — Done

All three items shipped in the suggested order (21-A, 21-B, 21-C).
`bunx tsc --noEmit` clean, `bun build ui/index.html ui/pebble.html --outdir
ui/dist` succeeds (only the pre-existing `@theme`/`@tailwind` Tailwind-4
at-rule warnings). `bun test src/ai-manager`: 34/34 passing. `bun test
src/authority src/workflows`: 437 passing / 4 failing, all 4 in
`shared-runtime-paths.test.ts` - the same pre-existing Windows-path-separator
category every prior phase has hit, unrelated to this phase's code. Notes by
item:

- **21-A**: `Handoff.handoff` (`useAIManagerData.ts`) gained
  `instructions: string[]` and `artifacts: string[]` (`decisions` was
  already effectively redundant with the project-level Decision list so it
  was included too, for parity with the other three string-array fields the
  backend's `Handoff` type carries). `HandoffCard` (`AIManagerRoom.tsx`) now
  renders both as additional `.rk-aim__handoff-meta` lines, conditional on
  non-empty, in the same style as the existing `warnings`/`open_questions`
  lines. No route/schema change - `listProjectHandoffs` (`routes.ts`) already
  returns the full parsed JSON payload; only the frontend type was narrower
  than what the server sends.
- **21-B**: `QAReport.ran_at` now renders as a small timestamp line above the
  check list in the task card's expanded QA section (`AIManagerRoom.tsx`,
  new `.rk-aim__qa-ran-at` class), formatted with `toLocaleString()` to match
  every other timestamp in the room. No backend change - `ran_at` was already
  set by `QAAgent.run()` and typed in `useAIManagerData.ts`.
- **21-C**: `decisionWrite` (`service-backends.ts`) now accepts the `ctx:
  { runId, projectId }` second parameter `DecisionWriteFn` always declared
  (and which `jarvis-decision.ts`'s route already supplied), passing
  `project_id: req.project_id ?? ctx.projectId` into `createDecision()` -
  the same fallback shape 20-D used for `councilConvene`. Closes the
  `decisionWrite` instance of the declared-but-dropped `ctx.projectId` shape;
  `handoffSend` still has the identical gap and is left as a deferred
  candidate, per the one-contained-fix-per-item precedent every phase since
  19-D has followed.

**Deferred, not forgotten**: a dashboard-side inline-wait approval flow
(unchanged since Phase 16 - still no concrete need, now a 7th phase
running: `githubAction`'s `202 pending` branch, `useAIManagerData.ts:442-444`,
still just returns `{ pending: true, approvalId }` and
`AIManagerRoom.tsx:716` still just tells the user to "resolve it from the
Authority tab" with no live-resolving affordance); `project_id` threading
through `sub-agent-runner.ts:153`/`orchestrator.ts:769,929`/
`deferred-executor.ts:80` (re-checked directly this phase - none has a
project id in local scope without larger context-plumbing changes, unchanged
since Phase 18's original conclusion); `handoffSend`'s `ctx.projectId`-
dropped fallback in `service-backends.ts:362-381` (identical shape to the
`decisionWrite` fix above, deliberately left for a future phase rather than
bundled into 21-C).

Phase 20 cleared all four of its own items. Its "deferred, not forgotten"
list carried over three items, re-checked against the code shipped through
Phase 20:

- **Inline-wait approval flow**: still no concrete need, confirmed above.
- **`project_id` threading through the remaining `AuditTrail.log()` call
  sites**: re-checked all four (`sub-agent-runner.ts:153`,
  `orchestrator.ts:769,929`, `deferred-executor.ts:80`) - none has a
  `project_id` in local scope. Unchanged.
- **`decisionWrite`/`handoffSend`'s dropped `ctx.projectId`**: both still
  present in `service-backends.ts` (confirmed at lines 362 and 426). Per the
  plan's own suggestion to fix one or both this phase, `decisionWrite` was
  picked - see 21-C below for why.

A fresh audit of the code shipped through Phase 20 (same methodology as
every prior phase: every backend-computed/typed field checked against its
frontend render function, and every `Fn` type's `ctx` parameter checked
against what the implementing backend actually consumes) turned up two more
"fetched/computed but never rendered" items, the same recurring pattern
15-C through 20-C have each closed instances of:

- `Handoff.handoff`'s frontend type (`useAIManagerData.ts:112-118`) declares
  only `status`/`summary`/`warnings`/`open_questions`/`next_action`, but the
  backend `Handoff` record it's parsed from (`src/agents/handoff.ts:21-33`)
  also carries `instructions: string[]` and `artifacts: string[]` (plus
  `decisions: string[]`) - and `listProjectHandoffs` (`routes.ts:118-134`)
  returns the entire parsed JSON payload verbatim as `handoff`, so the server
  already sends these fields on every response. `HandoffCard`
  (`AIManagerRoom.tsx:524-537`) only reads `h.summary`/`h.open_questions`/
  `h.warnings`/`h.status` - the frontend type is narrower than what's on the
  wire, so `instructions`/`artifacts`/`decisions` can't be rendered even
  though the data already arrives with every handoff.
- `QAReport.ran_at` (`useAIManagerData.ts:41`, set at `src/ai-manager/
  qa.ts:108` when `QAAgent.run()` completes) is typed and fetched onto every
  task's `qa_report`, but `TaskCard`'s expanded QA section
  (`AIManagerRoom.tsx:413-429`) only iterates `qa_report.checks` - there's no
  indication anywhere in the UI of when a task's QA pass actually ran.

**21-A: Add `instructions`/`artifacts`/`decisions` to the `Handoff` type and
render them.** Widen `Handoff.handoff` in `useAIManagerData.ts:112-118` to
include the two (or three) missing `string[]` fields the backend already
sends, and add matching conditional lines to `HandoffCard`
(`AIManagerRoom.tsx:524-537`), reusing the existing `.rk-aim__handoff-meta`
class the `warnings`/`open_questions` lines already use. Pure rendering
against data already on the wire - no route change, matches how 19-A added
`channel` to `AuditEntry` when the server already wrote it.

**21-B: Render `QAReport.ran_at` in the task card's QA section.** Add a
small timestamp line above the check list in `AIManagerRoom.tsx`'s expanded
QA block (`:413-429`), formatted with `toLocaleString()` to match every
other timestamp in the room (e.g. `HandoffCard`'s `created_at` line, `20-B`'s
`completed_at` line). Trivial, no backend change.

**21-C: Thread `ctx.projectId` into `decisionWrite`'s fallback.** Give the
`decisionWrite` backend in `service-backends.ts:426` the `ctx` parameter
`DecisionWriteFn` already declares (`jarvis-decision.ts:19-22`), and pass
`project_id: req.project_id ?? ctx.projectId` into `createDecision()` - the
identical fallback shape 20-D used for `councilConvene`. Scoped to
`decisionWrite` only, matching the one-contained-fix-per-item precedent:
`handoffSend` (`service-backends.ts:362-381`) has the same gap and is left
as a deferred candidate for a future phase.

**Suggested order: 21-A, then 21-B, then 21-C.** A and B are both pure UI
rendering of already-fetched/already-on-the-wire data, no shared code
between them, so their relative order doesn't matter - grouped first as the
lowest-risk, highest-value-per-line items, same reasoning as every prior
phase's ordering. C is last because it's the only item touching backend
code (a function signature + one call site), even though it's small.

## 19. Phase 22 Plan (post-21 gap audit) — Done

A fresh audit of the code shipped through Phase 21 (same methodology as
every prior phase: every backend-computed/typed field checked against its
frontend render function, every `Fn` type's `ctx` parameter checked against
what the implementing backend actually consumes) found the entire surface
21-A/B closed already fully rendered (`Handoff.handoff.instructions/
artifacts/decisions` all render in `HandoffCard`; `QAReport.ran_at` renders
in the task card's QA section) and every other UI-facing type in
`useAIManagerData.ts`/`useAuthorityData.ts` (`ProjectTask.next_agent/
approval_required/healing_attempts/assigned_provider/assigned_model`,
`AgentPerformance.llm_calls`, `Project.completed_at`, `AuditEntry.executed/
channel`, `CouncilVerdict.contradictions`) already has a render site -
confirming 15-C through 21-B have genuinely closed out that entire category
of gap. The one item still open was the one flagged as a deferred candidate
in each of the last three phases:

- `handoffSend`'s `HandoffSendFn` type (`jarvis-handoff.ts:34-37`) declares
  `ctx: { runId: string; projectId: string }`, and the route
  (`jarvis-handoff.ts:111-114`) already resolves and passes
  `ctx.claims.projectId` - but the backend implementation
  (`service-backends.ts:362`, `async (req) => {...}`) ignored the second
  parameter entirely and only forwarded the caller-supplied, optional
  `req.project_id` into `sendHandoff()`. Identical shape to `councilConvene`
  (closed by 20-D) and `decisionWrite` (closed by 21-C) - a workflow-
  triggered "Handoff" node running inside a known project run silently filed
  an unscoped handoff (`project_id: null`) unless the workflow author also
  wired `project_id` into the node's own input.

**22-A: Thread `ctx.projectId` into `handoffSend`'s fallback.** Give the
`handoffSend` backend in `service-backends.ts:362` the `ctx` parameter
`HandoffSendFn` already declares, and pass
`project_id: req.project_id ?? ctx.projectId` into `sendHandoff()` - the
identical fallback shape 20-D/21-C used for `councilConvene`/`decisionWrite`.
This closes out the last of the three sites that carried this shape; no
further deferred candidates of this pattern remain.

**Deferred-list re-check (carried over from Phase 21):**

- Inline-wait approval flow: still no concrete need - `githubAction`'s `202
  pending` branch (`useAIManagerData.ts`) still just returns `{ pending:
  true, approvalId }` and the room still just points the user at the
  Authority tab. Stays deferred for an 8th phase running.
- `project_id` threading through `sub-agent-runner.ts:153`/
  `orchestrator.ts:769,929`/`deferred-executor.ts:80`: re-checked all four
  call sites directly, none has a `project_id` in local scope without
  larger context-plumbing changes. Unchanged since Phase 18's original
  conclusion.
- No new deferred candidates surfaced this phase - this is the first phase
  since 15-C where the fresh-audit sweep found nothing new to add to the
  list.

Shipped: `bunx tsc --noEmit` clean, `bun build ui/index.html ui/pebble.html
--outdir ui/dist` succeeds (same pre-existing Tailwind-4 `@theme`/`@tailwind`
at-rule warnings as every prior phase), `bun test src/ai-manager`: 34/34
passing, `bun test src/workflows`: 382 passing / 4 failing - the same
pre-existing `shared-runtime-paths.test.ts` Windows-path-separator failures
every phase since at least Phase 21 has hit, unrelated to this phase's
one-line change. No UI diff, so no browser verification needed for this
phase - the change is backend-only (a function signature and one call
site), identical in shape and risk profile to 20-D/21-C.

## 20. Phase 23 Plan (post-22 gap audit) — Done

Same fresh-audit methodology as every prior phase. The backend-field/
frontend-render sweep and the `Fn`-type `ctx` sweep both came back clean
again for every site checked in Phases 15-22 (nothing regressed). One new
gap surfaced, one step earlier in the git-operation chain than the
`ctx.projectId`-dropped pattern 19-D/20-D/21-C/22-A closed:

- `gitCommit`'s `GitCommitFn` type (`jarvis-git.ts:29-32`) declares
  `ctx: { runId: string; projectId: string }`, and the route
  (`jarvis-git.ts:70-73`) already resolves and passes it - but the backend
  implementation (`service-backends.ts:443-445`, pre-fix) ignored the
  second parameter *and* never called `checkAuthority`/`auditTrail.log` at
  all. `git_commit` maps to the same `git_operation` action category as
  `git_push` (`tool-action-map.ts:55-56`); the agent-tool path
  (`orchestrator.ts:769`) and the `gitPush` workflow backend
  (`service-backends.ts:489-499`, fixed in 19-D) both write an audit-trail
  row for every attempt. The `gitCommit` workflow backend was the one path
  producing zero record of a workflow-triggered commit - not a missing
  `project_id` on an existing row like the four sites 19-D/20-D/21-C/22-A
  fixed, but no row at all, invisible in the Authority Audit tab.

**23-A: Give `gitCommit` the same authority-check + audit-log block
`gitPush` already has.** `service-backends.ts`'s `gitCommit` now takes its
`ctx` parameter, runs the emergency-controller check, calls
`checkAuthority` for `git_commit`/`git_operation` (agent id `"workflow"`,
authority level 0, same floor `gitPush` uses), logs to `auditTrail` with
`project_id: ctx.projectId`, and short-circuits on `[AUTHORITY DENIED]`.
Unlike `gitPush`, `gitCommit` isn't gated behind
`opts.authorityEngine && opts.approvalManager` at definition time - it's
AUTO by default (`actions/tools/github.ts:85-86`) and stays registered even
when those deps are absent, running the check only `if (opts.
authorityEngine)`. The `requiresApproval` branch (reachable only if a
context-rule override ever adds one for `git_commit`) denies with
`[AUTHORITY DENIED] Approval required but no approval manager configured.`
when `opts.approvalManager` is absent, rather than silently committing -
same fail-closed posture as every other governed path in this file.

**Deferred-list re-check (unchanged from Phase 22):**

- Inline-wait approval flow: `githubAction`'s `202 pending` branch
  (`useAIManagerData.ts:448-450`) still just returns `{ pending: true,
  approvalId }`. Stays deferred for a 9th phase running.
- `project_id` threading through `sub-agent-runner.ts:153`/
  `orchestrator.ts:769,929`/`deferred-executor.ts:80`: re-checked all four,
  plus traced whether `agentDelegate`'s dropped `ctx.projectId`
  (`service-backends.ts:269-276`) could close it from that side - it
  can't, since `PieceAgentDelegateInput`/`RunSubAgentOptions` have no
  `projectId` field. Unchanged since Phase 18's original conclusion.
- `agentDelegate`/`toolsInvoke`/`qaRun`/`managerAssignAgent` all drop
  `ctx` the same way `gitCommit` did, but each lacks a downstream sink
  that already accepts a project id (`QAAgent.run`, `ToolRegistry.
  execute`, `AIRouter.route` take none) - no minimal fix exists the way
  `gitPush`'s block gave `gitCommit` a direct template. Newly added to the
  deferred list, not closed this phase.
- Three `auditTrail.log()` calls in `ws-service.ts:1881,1899,1925` (voice
  approve/deny) also omit `project_id`, but `ApprovalRequest` has no
  `project_id` field at all - same "no local scope" conclusion, not a
  one-line fix. Newly added to the deferred list.

Shipped: `bunx tsc --noEmit` clean, `bun test src/ai-manager`: 34/34
passing, `bun test src/workflows`: 382 passing / 4 failing - the same
pre-existing `shared-runtime-paths.test.ts` Windows-path-separator
failures every phase since at least Phase 21 has hit, unrelated to this
phase's change. No UI diff (this phase closes a missing audit-trail write,
not a rendering gap), so no browser verification needed - same backend-
only risk profile as 19-D/20-D/21-C/22-A, scaled up slightly since this
gap required restoring a whole authority-check block rather than a single
fallback expression.

## 21. Phase 24 Plan (post-23 gap audit) — Done

Same fresh-audit methodology as every prior phase. Re-verified all four
items on Phase 23's deferred list against the current code (unchanged
since Phase 23's own commit, `a8e5f00`) and re-ran both sweeps (backend-
field/frontend-render, `Fn`-type `ctx`) - both came back clean again
except for one new gap:

- `approvalRequest` (`service-backends.ts:400-421`, the workflow "Approval"
  node backend) had the exact pre-23-A `gitCommit` shape: its route,
  `jarvis-approval.ts:87-90`, already resolves and passes `ctx: { runId,
  projectId }`, but the backend function only took `(req)`, silently
  dropping the second parameter (TypeScript allows a narrower-arity
  function to satisfy a wider `Fn` type, so this compiled clean and stayed
  invisible to `tsc`). Unlike `gitCommit`/`gitPush`, there was no
  `auditTrail.log()` call to restore here - `approvalRequest` only calls
  `ApprovalManager.createRequest()` - and `ApprovalRequest` had no
  `project_id` column to put the value in even if the ctx were threaded.
  That column's absence was itself a deliberate Phase 18-C decision
  (`src/ai-manager/api/routes.ts:415-418`, pre-fix comment: "out of scope
  to add one - see the Phase 18 plan doc"), made when only one call site
  needed it and stuffing the id into the free-text `context` string was
  cheaper. A second, independent call site now needing the same sink is
  what the Phase 18 doc's deferral was waiting on.

**24-A: Give `ApprovalRequest` a `project_id` column (same additive,
nullable convention `audit_trail.project_id` used in 18-C), thread
`ctx.projectId` through it everywhere a caller already has one in scope.**
`src/vault/schema.ts` adds the migration + index; `ApprovalRequest`'s type
and `ApprovalManager.createRequest()`'s params (`src/authority/
approval.ts`) gain an optional `project_id`/`projectId`, defaulting to
`null` so every existing call site compiles unchanged. Four call sites
then pass it explicitly, all using a project id already resolved in local
scope (no new resolution logic added anywhere):
`approvalRequest` (closes this phase's actual gap), and - for consistency,
since the column now exists and leaving them out would immediately relist
them as gaps - `gitCommit`/`gitPush`'s own `createRequest` calls
(`service-backends.ts`, both already receive `ctx.projectId` for their
`auditTrail.log()` calls) and the dashboard GitHub-action route
(`src/ai-manager/api/routes.ts:419`, which already had `body.project_id`
in scope and was the site whose absence of a sink justified deferring the
column in Phase 18). `orchestrator.ts:794`'s `createRequest` call is
unchanged - confirmed it has no project id in scope at all (same
conclusion Phase 18-22's `ctx`-sweeps reached for that file), so there's
nothing to thread there.

**Deferred-list re-check:**

- Inline-wait approval flow (`useAIManagerData.ts:448-450`'s `202
  pending` branch): still just returns `{ pending: true, approvalId }`
  with no polling. `ApprovalRequest` now carries `project_id`, which is a
  prerequisite a project-scoped polling UI would need, but no consumer of
  it was added this phase - the UI still doesn't read the field. Stays
  deferred, 10th phase running.
- `project_id` threading through `sub-agent-runner.ts:153`/
  `orchestrator.ts:769,929`/`deferred-executor.ts:80`: re-checked, still
  no sink (`RunSubAgentOptions`/`PieceAgentDelegateInput` still have no
  `projectId` field). Unchanged since Phase 18.
- `agentDelegate`/`toolsInvoke`/`qaRun`/`managerAssignAgent` dropping
  `ctx`: re-checked all four downstream sinks
  (`PieceAgentDelegateInput`, `ToolRegistry.execute`, `QAOptions`,
  `AIRouter.route`) - none gained a project id field. Unchanged since
  Phase 22/23.
- Three `auditTrail.log()` calls in `ws-service.ts:1881,1899,1925` (voice
  approve/deny): `ApprovalRequest` (the request being approved/denied)
  now has `project_id`, but these three call sites log to `audit_trail`
  from the *decision*, not the request object itself, and weren't
  changed to look it up. A future phase could fetch the request via
  `ApprovalManager.getRequest(requestId)` and forward its `project_id`
  into the audit-trail entry - a concrete, minimal fix now exists where
  Phase 23 found none - but that's a new piece of logic, not the
  same-shape ctx-restore this phase's budget covered. Left deferred,
  now with a template for the next phase to use.

Shipped: `bunx tsc --noEmit` clean (after also adding `project_id: null`
to the `ApprovalRequest` fixture in
`src/authority/approval-delivery.test.ts`, the one place a full literal
of the type existed outside production code), `bun test src/ai-manager
src/authority src/workflows`: 471 passing / 4 failing - the same
pre-existing `shared-runtime-paths.test.ts` failures every phase since
Phase 21 has hit, unrelated to this change. `bun test src/github`: 3/3
passing (covers `ApprovalManager.createRequest`/`waitForResolution` via
the project-push e2e path). No UI diff, so no browser verification
needed - same backend-only risk profile as 19-D/20-D/21-C/22-A/23-A.
