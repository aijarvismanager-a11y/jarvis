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
