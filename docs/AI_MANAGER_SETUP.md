# AI Manager Setup Guide (real providers)

Phase 12-D. Every Phase 2/5/6/8 integration test in this repo runs against
mock/test LLM and image providers (see `docs/AI_MANAGER_ARCHITECTURE_AUDIT.md`
section 8's closing note). This guide walks through pointing the AI Manager
at a real, paid provider account so Project creation, the AI Council, QA
self-healing, and Image generation can be exercised end to end.

**Not yet live-verified**: this guide was written by reading the code paths
below (`src/daemon/llm-settings.ts`, `src/ai-manager/*`, `src/vault/keychain.ts`),
not by running a real project against a live API key in this environment - no
API keys are available here. Treat the routes/behavior described as accurate
to the code, but do a first real run yourself and file anything that doesn't
match this doc.

## 1. Prerequisites

- The daemon running (`jarvis start`) - the AI Manager is a subsystem of the
  daemon process, not a separate service.
- At least one LLM provider account. Anthropic or OpenAI are the
  best-tested paths; Ollama works too and needs no API key (see step 4).
- For Phase 8 (Image Agent) and Phase 7 (GitHub) coverage: an OpenAI/Gemini
  image API key and a GitHub personal access token, respectively. Optional -
  the core AI Manager flow (Planner → Router → Execution → Handoff) only
  needs an LLM provider.

## 2. Credential storage - keychain, not `config.yaml`

LLM provider credentials are **DB + encrypted-keychain owned**, never
written to `~/.jarvis/config.yaml` (`src/config/types.ts`'s
`USER_OWNED_SECTIONS` split - see the architecture audit's section 5, "Parts
That Must Not Be Changed"). `QUICKSTART.md`'s `config.yaml`-with-`api_key`
examples predate this split and no longer reflect how credentials are
actually stored - don't follow them for provider setup.

The real flow is the dashboard's LLM settings screen, backed by:

- `GET /api/config/llm` - current provider list, default, tier assignments
  (`src/daemon/llm-settings.ts`'s `getLLMSettings`).
- `POST /api/config/llm` - add/update/remove a provider, set tier
  assignments, hot-reloads the shared `LLMManager` on save (no daemon
  restart needed). Body shape is `LLMSettingsRequest` in
  `src/daemon/llm-settings.ts:82-97`:

  ```json
  {
    "providers": {
      "anthropic": { "kind": "anthropic", "api_key": "sk-ant-..." }
    },
    "tiers": {
      "high": "anthropic",
      "medium": "anthropic"
    }
  }
  ```

  The API key never round-trips back out through `GET` - only
  `has_api_key: true/false` is exposed (`LLMSettingsProviderView`).
- `POST /api/config/llm/test` - fires one real request through a provider to
  confirm the key/model/base_url combination works before you commit to it
  (`testLLMProvider`).

Keys are stored under `llm.provider.<name>.api_key` in the encrypted
keychain (`src/vault/keychain.ts`), keyed by the provider **name** you chose
(not its `kind`) - so you can register two Anthropic-kind providers (e.g.
different accounts or base URLs) side by side.

## 3. Minimum tier config for AI Manager

The AI Manager's `ManagerAgent`/`TaskDispatcher` path only runs in
router-first ("multi-tier") mode - it needs `llm.tiers.conversation`
configured, or `POST /api/ai-manager/projects` 503s with:

> AI Manager project execution requires llm.tiers.conversation to be
> configured (TaskDispatcher unavailable in classic mode).

Below that, `src/llm/tiers.ts`'s `validateTierMap` requires **at least one**
of `medium` or `high` to be set - `low` and any unconfigured tier fall up to
whichever of those exists (`TIER_FALLBACK`, `tiers.ts:37-42`). The simplest
real config that satisfies both:

```json
{
  "providers": { "anthropic": { "kind": "anthropic", "api_key": "sk-ant-..." } },
  "tiers": { "conversation": "anthropic", "high": "anthropic" }
}
```

One provider, assigned to both `conversation` and `high`, is enough to run a
project end to end - `medium`/`low` subtasks fall up to `high` automatically.
Split providers/tiers later once you want cost control (this is exactly what
Phase 12-A's `cost_mode` selector maps onto - see
`docs/AI_MANAGER_ARCHITECTURE_AUDIT.md` section 9, item 12-A).

## 4. Zero-cost option: Ollama

No API key needed. Install Ollama, pull a model, then register it as a
provider with `kind: "ollama"` and no `api_key` (base_url defaults to
`http://localhost:11434`). Useful for exercising the AI Manager's
control-flow (Planner, wave scheduling, Handoffs, resume) without spending
money, before switching `high`/`medium` over to a stronger hosted model for
real work.

## 5. First project walkthrough

1. Open the dashboard's AI Manager room (`AIManagerRoom.tsx`).
2. Click **New project**, give it a name and a plain-English request (the
   existing dialog only takes name + request - `template`/`execution_mode`/
   `cost_mode` default to `custom`/`assisted`/`balanced` and can be changed
   afterward via `PATCH /api/ai-manager/projects/:id`, or by extending
   `CreateProjectDialog` if you want them exposed at creation time).
3. This calls `ManagerAgent.handleRequest` synchronously - the request blocks
   until the whole subtask graph settles, which can be tens of seconds to
   several minutes against a real provider depending on subtask count and
   `cost_mode`.
4. Watch the Kanban board fill in as subtasks move through
   `PENDING → RUNNING → COMPLETED/FAILED/WAITING`. A `WAITING` card means a
   subtask called `ask_for_clarification` - type a reply in its card and hit
   **Resume** (Phase 11-A).
5. Check the **Handoffs** feed and **Agent Performance** panel (Phase 11-B)
   populate with real data once subtasks complete.
6. Try **Ask the Council** - fans your question to Cheap/Balanced/Quality
   seats in parallel against your configured tiers and records a Decision.

## 6. Image Agent (Phase 8) and GitHub (Phase 7) - optional

Both use the same keychain convention as LLM providers
(`image.provider.<name>.api_key`, `github_token` -
`src/image/config-binding.ts`, `src/github/api.ts`) but **neither currently
has a dashboard settings screen or daemon API route wired to set them** -
confirmed by grep, there's no `/api/config/image` or `/api/config/github`
equivalent to `/api/config/llm` today. Setting these credentials currently
requires calling `setSecret()` (`src/vault/keychain.ts`) directly, e.g. from
a one-off script run against the daemon's DB, or a REPL. This is a real gap,
not an oversight in this guide - worth its own small follow-up (a
`/api/config/image` and `/api/config/github` route pair mirroring
`/api/config/llm`'s shape) if Image/GitHub setup needs to be as easy as LLM
setup.

## 7. Troubleshooting

- **"AI Manager project execution requires llm.tiers.conversation..."** -
  see step 3; `tiers.conversation` isn't set.
- **`POST /api/config/llm` 400 on a `base_url` change** - a stored
  credential is scoped to the endpoint it was saved against
  (`llm-settings.ts:180-189`); resend the `api_key` alongside any
  `base_url` change.
- **Provider auth errors surfacing as tier fall-up instead of a clear
  failure** - expected: `LLMManager.chatTier` retries within a tier
  (`MAX_RETRIES_PER_PROVIDER`) then falls up per `TIER_FALLBACK` before
  surfacing an error - check `llm_usage.error_code` (`src/llm/usage.ts`) for
  the real per-call classification (`auth | rate_limit | network |
  bad_request | not_found | server | unknown`) rather than only the final
  visible failure.
- **A project silently runs at `medium` instead of a template's usual
  `high`** - check `project.cost_mode`; anything other than `balanced`
  overrides every subtask's tier regardless of template
  (`src/ai-manager/manager-agent.ts`'s `runSubtask`, Phase 12-A).
