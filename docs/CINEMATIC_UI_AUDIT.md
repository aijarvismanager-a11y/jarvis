# Cinematic UI Audit

Audit performed per `JARVIS AI MANAGEMENT SYSTEM2.md` ("CINEMATIC UI 完全版開発仕様書") Section 84's
required pre-implementation steps: repository / existing-UI / state-management / WebSocket /
Agent-data / Workflow-data / Pebble / Sidecar-integration audit. This document is that audit,
plus a section-by-section diff against the spec and a markdown-quality check of the spec file
itself. It intentionally makes no design decisions beyond noting where new work plugs into
existing code — that belongs to the Phase 28+ plan in
`docs/AI_MANAGER_ARCHITECTURE_AUDIT.md`.

The AI Manager *backend* (Projects/Tasks/Agents/Handoffs/Decisions/Approvals/Council/QA/GitHub/
Image) is already built and audited separately in `docs/AI_MANAGER_ARCHITECTURE_AUDIT.md`
(Phases 0–27). This document covers only what that backend audit didn't: the client-side UI,
state management, WebSocket event surface, Pebble, Voice, and Sidecar-on-the-UI-side — the
layer the Cinematic UI spec actually asks to build.

---

## 1. Repository / existing-UI audit

`ui/src/v2/` is a React 19 + Tailwind 4 dashboard ("v2"), structured as **Rooms** (`RoomKey` in
`ui/src/v2/router.ts:21-36`): `workflows, memory, tools, agents, agent_strip, authority, logs,
calendar, goals, tasks, content, workspaces, usage, settings, ai_manager`. Each Room follows the
same `Room.tsx` + `useXData.ts` (+ `.css`) convention.

Relevant to Cinematic UI:

- **`rooms/aiManager/AIManagerRoom.tsx` + `useAIManagerData.ts`** — the existing "Standard
  Dashboard" for the AI Manager subsystem: project list, Kanban task board (11-state enum),
  execution/cost-mode selectors, decisions list, handoffs list, agent-performance list, GitHub
  activity panel, "Ask the Council" dialog. **List/table/board based — no node-graph or orbit
  visualization.**
- **`rooms/agents/AgentsRoom.tsx`** — separate "Agents" room with three tabs: Command Center
  (card grid), **Orbital View** (hand-rolled CSS concentric-ring layout, PA in center /
  specialists orbiting, plus a live activity ticker — the closest existing analog to spec §9's
  "Agent Orbit"), and Agent Builder (stub, redirects to Workflows Room).
- **`rooms/authority/AuthorityRoom.tsx`** — Approvals/Audit/Grants/Learning tabs plus an
  always-visible `EmergencyBand` (spec §32's Emergency Stop primitive already exists here, but
  is scoped to this Room only — not global).
- **`shell/`** — app chrome: `AppShell.tsx` (top-level composition), `BootSplash.tsx` (an
  existing boot sequence — 5 variants, directly reusable for spec §35/§58), `SystemStates.tsx`
  (offline/updating/crash/quota takeovers), `VoiceRail.tsx`/`MicOrb.tsx`, `TopBar.tsx`.
- **`thread/`** — chat thread incl. `ApprovalCard.tsx` (spec §31's Approval UI already exists,
  inline in the thread, not a modal), `ClarifierCard.tsx`, `RepeatBackCard.tsx`.
- Outside `v2/`: **`ui/src/ambient/Pebble.tsx`** — a separate Vite/React entry point (see §4).

**Existing "Boot Sequence", "Approval UI", "Emergency Stop", and a rough "Agent Orbit" already
exist in some form** — this materially reduces Phase 28+ scope versus a from-scratch build.

## 2. State management audit

No global store (no Redux/Zustand/Jotai). Pattern is **React hooks + one Context**:

- **`shell/LiveDataContext.tsx`** (`LiveDataProvider`/`useLiveData()`) — lifts WS-derived event
  arrays (approvals, clarifiers, repeatBacks, notices, taskEvents, contentEvents,
  agentActivity, settingsEvents, latestAssistantReply) into context, deliberately scoped to
  "event arrays more than one Room consumes."
- **`rooms/aiManager/useAIManagerData.ts`** — polls `/api/ai-manager/*` every 8s, **by design,
  not WS-tailed** (own comment: polling is sufficient because mutating actions already return
  the settled result; polling only needs to catch changes from other channels).
- **`shell/useActiveProject.ts`** — server-authoritative pinned project for chat
  (`GET/POST /api/chat/active-project`).
- **`shell/useChatDisplayMode.ts`** — client-only `simple|detailed|developer` preference
  (localStorage), spec §52's "Chat display modes" already implemented.
- **`shell/useTheme.ts`** — `light|dark` via `data-theme` on `<html>` + localStorage. **This is
  the existing mode-switch mechanism a new Normal/Cinematic/Focus switch should piggyback on**
  (same pattern: own `data-*` attribute + localStorage key + `[mode, set]` hook).

**Gap**: no single unified "current project + active agents + task status + provider status"
app-state hook exists — that state is currently spread across four different hooks/contexts,
and **no client-side provider/LLM online-offline status hook exists at all** (see §7).

## 3. WebSocket audit

Single connection point: **`ui/src/hooks/useWebSocket.ts`** (`useWebSocket()`), connects to
`${proto}//${host}/ws` once, from `AppShell.tsx`. `LiveDataContext` does not connect itself — it
re-exposes state `useWebSocket()` already produces.

Message types already handled: `tts_start/text/end`, `realtime_status/transcript`,
`thinking_start/end`, `chat` (voice-originated), `stream` (assistant text + tool_call +
sub-agent progress → feeds `agentActivity`), `status: done`, `goal_event`, `workflow_event`,
`site_event`, `settings_applied`, and a `notification` fan-out (`task_update`, `content_update`,
`awareness_event`, `sidecar_event`/`sidecar_disconnect`, `assistant_message`,
`approval_request`/`approval_update`, `clarifier_request`, `repeat_back_request`,
`voice_confirmation_resolved`, `navigate_room`, `navigate_home`, `room_action`,
`window_control`).

**Gap**: no task/agent-handoff-specific push event exists — the AI Manager room's task/handoff
changes are polled, not pushed. There is no general pub/sub event bus (only the voice-scoped
`useRoomActionBus`). A new Cinematic UI push channel needs: (1) a new `msg.type`/`payload.source`
case in `handleMessage`, (2) new state returned from `useWebSocket()`, (3) optionally added to
`LiveDataContext` if more than one consumer needs it. This is additive, not a rearchitecture.

## 4. Pebble audit

`ui/src/ambient/Pebble.tsx` (+ `pebble.css`, `main.tsx`) — separate entry point from the main v2
dashboard. States: `idle|listening|thinking|speaking|working|asking|done|muted`; only
`speaking` locks/shows a bubble panel (`Speak it`/`Think`/`Dismiss` — a design placeholder, not
wired to real thread state).

Native/desktop wiring: in `?native=1` mode, the **sidecar process itself moves the OS window**
and drives Pebble via injected globals (`window.__pebble_summon/dismiss`,
`window.__sidecar_set_clickthrough`); the React cursor-follow physics is explicitly kept only
"for design reference" — production native Pebble is rendered by the sidecar (GDI+/Cocoa/
Cairo), not this component. Ctrl/Cmd+click toggles idle⇄listening; Escape returns to idle.

**Gap**: spec §20's "Sub-Pebble" (background-agent-activity satellite indicator) **does not
exist** — confirmed via grep, `Pebble.tsx` has exactly one visual element plus the conditional
speaking-bubble.

## 5. Voice audit

`ui/src/v2/voice/` (`TranscriptBubble`, `RailReplyPreview`, `RailConfirmationStack`,
`stateMapper`, `useSpacebarPTT`, `useSuggestions`), integrated into the shell's `VoiceRail`, not
a standalone command bar. Resolved voice utterances arrive over WS as
`chat`/`payload.source === "voice_transcript"` and are appended as **normal user chat
messages** — voice input already flows straight into the same Thread as typed text (spec §17's
requirement that voice input also appear as text is already satisfied structurally). Ambiguous/
low-confidence voice turns surface as `ClarifierCard`/`RepeatBackCard` in the Thread.

## 6. Sidecar / desktop-awareness UI audit

No live "AWARENESS ● ACTIVE" toggle exists (spec §39). What exists: a Settings → Sidecar tab
(enroll/revoke/config, management surface not a status HUD) and a one-shot disconnect notice
(`createSidecarNotice()` in `useWebSocket.ts`) — **only the negative (disconnected) state is
surfaced; there is no positive "active" indicator anywhere in the UI.**

## 7. Agent / Provider data-availability audit

- **Agent performance** (`GET /api/ai-manager/agents/performance`, `src/ai-manager/api/
  routes.ts:536-547`) — live, already consumed by `useAIManagerData.ts`. Accepts an optional
  `project_id`, so an unscoped cross-project call is already supported by the route signature.
  **No backend work needed.**
- **Task Kanban status** (`GET /api/ai-manager/projects/:id/tasks`) — live, 11-state enum
  already returned. **No backend work needed**, but only single-project scoped today; an
  aggregate "all active tasks" call isn't exposed as one endpoint.
- **Provider/LLM online-offline status** — **no dedicated endpoint exists.** `/api/health`
  reports daemon/service/DB health, not per-LLM-provider reachability; LLM settings routes are
  test-connection/save actions, not a continuous status feed; provider errors only surface
  reactively per failed request over WS. **Spec §23 "AI Network" (per-provider ONLINE/OFFLINE)
  needs new backend work** — at minimum a status endpoint, ideally a WS push, to avoid the
  "fake data" ban in spec §78/§9's "dummy animation prohibited" rule.

## 8. Existing animation/graphics tooling audit

- **`@xyflow/react`** is a real dependency, used today only in `rooms/workflows/
  WorkflowEditor.tsx` (full node/edge graph editor — a working reference implementation).
  `AgentsRoom.tsx`'s Agent Builder tab *plans* to reuse it for agent graphs but doesn't yet —
  the existing Orbital View there is hand-rolled CSS, a second, different pattern. **Phase
   28+ decision point**: reuse xyflow for Agent Orbit (consistent with the stated future
  direction) vs. extend the existing CSS orbital layout (less new dependency surface, matches
  what's already shipped in `AgentsRoom`).
- Dark theme via `data-theme` + CSS variables (mechanism confirmed, exact variable files not
  fully enumerated here). Glow/pulse/bloom effects already exist as CSS-only prior art
  (`SystemStates.tsx`'s bloom/drop, `BootSplash.tsx`'s pulse rings, `Pebble.tsx`'s gradient
  rings) — no JS animation library (no Framer Motion/GSAP) is in the dependency tree.
- **Gap**: `prefers-reduced-motion` (spec §40) is handled in exactly one place
  (`onboarding/OnboardingWizard.tsx`) — none of the heavy-animation surfaces that already exist
  (`BootSplash`, `SystemStates`, `AgentsRoom`'s orbital rings, `Pebble`'s physics) currently
  check for it. This is a pre-existing gap, not new Cinematic UI debt, but Cinematic Mode will
  make it more visible and should not add a fifth unchecked surface.

## 9. Mode-switching audit

`shell/useTheme.ts` (`light|dark` via `data-theme` + localStorage) is the only existing mode
switch; no OS-preference "System" option was found. A new Normal/Cinematic/Focus switch (spec
§3, §51) should copy this exact shape rather than invent a new state-management pattern.

## 10. Approval / Emergency Stop audit

- **Approval UI** (spec §31) already exists: `thread/ApprovalCard.tsx`, inline in the Thread
  (`role="alertdialog"`), fed by `PendingApproval` from WS `approval_request`/`approval_update`
  + REST rehydration, exposed via `LiveDataContext.approvals`. Its own doc comment: "no
  destructive tool call bypasses it."
- **Emergency Stop** (spec §32) already exists as `EmergencyBand` in `AuthorityRoom.tsx`, driven
  by `EmergencyState = normal|paused|killed`. **Gap**: scoped to the Authority Room only — not
  reachable from `TopBar`, `Pebble`, or globally from `AppShell`, but spec §32 explicitly wants
  it reachable from Cinematic Mode too.

---

## 11. Spec-vs-implementation diff (by spec section)

| Spec § | Requirement | Status |
|---|---|---|
| §3–6 (Normal/Cinematic/Focus modes) | 3-mode UI | **New** — only a 2-mode (light/dark) switch pattern exists to copy from |
| §7–13 (Cinematic Main Screen, Core, Agent Orbit, Task Flow) | Central Core + orbiting Agent nodes + Task Flow stepper | **Partial** — `AgentsRoom`'s Orbital View is a real precedent; Core visualization and Task Flow stepper are new |
| §14 (AI Council display) | Multi-AI opinion panel | **Exists** — `CouncilDialog` in `AIManagerRoom.tsx` already does this (list-based, not cinematic-styled) |
| §15 (JARVIS Decision Display) | Decision + confidence + approve/review | **Partial** — Decisions list exists in `AIManagerRoom`; confidence/approve-inline framing is new |
| §16 (Command Bar) | `Ask JARVIS...` input | **Exists** — `Composer.tsx` in shell is this already |
| §17–18 (Voice, Voice Feedback) | Voice→text, waveform feedback | **Partial** — voice→text flow exists (§5 above); abstract waveform-in-Core is new |
| §19 (Pebble) | Entry point, click→Cinematic/Command UI | **Partial** — Pebble exists; click currently toggles listening, not mode-switch — needs wiring, not a rebuild |
| §20 (Sub-Pebble) | Background agent indicator | **New** — confirmed absent |
| §21–23 (HUD, System Status, AI Network) | Lightweight status HUD | **Partial** — daemon health exists; per-provider online/offline needs new backend (§7 above) |
| §24 (Provider/Agent/Model separation) | Data model | **Exists** — already modeled in AI Manager backend (`assigned_agent/provider/model`) |
| §25–28 (Project Panel/Core/Orbit, Task Detail) | Project selection + drill-down | **Exists in list form** — `AIManagerRoom`'s project list/detail; orbit framing is new presentation over existing data |
| §29–30 (Handoff animation/detail) | Handoff visualization | **Partial** — handoff *data* and a list view exist (`HandoffCard`); animated packet-transfer visualization is new, and needs a new WS push (§3 above) to be non-dummy |
| §31 (Approval UI) | Authorization required card | **Exists** — `ApprovalCard.tsx` |
| §32 (Emergency Stop) | Global, confirm-gated stop | **Partial** — exists in Authority Room only, not global (§10 above) |
| §33 (Notification) | Toast + history | **Exists** — `NotificationDrawer.tsx` + notice arrays in `LiveDataContext` |
| §34–35 (Animation principles, Boot Sequence) | Meaningful-only animation, short boot | **Exists** — `BootSplash.tsx` already has 5 variants; needs a reduced-motion audit (§8 above) and adherence review against the new Cinematic surfaces specifically |
| §36–38 (Idle/Working/Error modes) | Core state reflects real system state | **New presentation, existing data** — all source data (task/project/QA status) already available via `useAIManagerData`/`LiveDataContext` |
| §39 (Privacy/Awareness Mode) | Live awareness toggle | **New** — confirmed absent (§6 above) |
| §40 (Accessibility) | Contrast, keyboard, reduced-motion, color-blind, font-size | **Partial** — theme system exists; reduced-motion is the confirmed gap (§8 above) |
| §41 (Responsive) | Desktop-first, tablet/laptop min | Not audited in depth this pass — existing Rooms are already responsive-ish per Tailwind; revisit once Cinematic layout is designed |
| §42 (Theme) | Dark/Light/System | **Partial** — Dark/Light exists, System (OS-preference) does not |
| §51–54 (Mode switch, Focus switch, Command Center nav, Command Palette) | Navigation | **Exists** — `CommandPalette.tsx` (Cmd/Ctrl-K) already covers §54; §51/§52 need the new mode state from §3 |
| §55–58 (Voice+Cinematic, NL control, Cinematic Boot) | Natural-language control surfacing in Cinematic UI | **New presentation, existing data** — NL command execution already works (chat/voice → tools); only the cinematic rendering of results is new |
| §59 (Performance) | GPU/animation discipline at scale | Design constraint for Phase 29+, not auditable against code that doesn't exist yet |
| §60–61 (UI state, Real-time updates) | Central state model, WS-driven | **Gap confirmed** (§2–3 above) — this is the actual Phase 28→29 foundation work |
| §62–64 (Architecture, Components, Orbit expansion) | New `ui/cinematic/` etc. tree | Deferred to implementation phases — existing `v2/rooms/<name>/Room.tsx` convention should be followed rather than the spec's illustrative tree, per spec's own §62 override clause ("既存アーキテクチャを優先する") |
| §65–70 (Background tasks, AI Network health routing, GitHub viz, Security UI, Memory viz) | Various panels | **Exists in list/table form already** in `AIManagerRoom`/`AuthorityRoom`/settings; cinematic re-presentation is the net-new work, not the underlying data |
| §71–73 (UX rules, priority, design principle) | No decorative bloat; readability > cinema | Governing constraint for all future phases, not a build item |
| §79–80 (Demo Mode) | Explicit non-real-data mode, labelled | **New** — no such mode exists; must be added if any pre-real-data demo is ever shown, per spec's explicit anti-dummy-data rule (§78) |
| §81–82 (Testing, acceptance criteria) | Functional/visual/perf test matrix | Applies to Phase 29+ implementation, tracked there |

**Headline conclusion**: roughly half of what the spec describes already exists as *data* and
even as rough *UI precedent* (Orbital View, Approval Card, Emergency Band, Boot Splash, Council
dialog, Command Palette, Composer). The genuinely new work is (a) the **Normal/Cinematic/Focus
mode switch and a unified live-state model** (spec §60 — the actual foundation everything else
sits on), (b) a **provider/LLM online-offline status feed** (new backend), (c) **animated
handoff/packet visualization** requiring a new WS push type, (d) the **Sub-Pebble** and **global
Emergency Stop reach**, and (e) **systemic reduced-motion coverage** so Cinematic Mode doesn't
regress accessibility across four already-shipped animated surfaces.

---

## 12. Markdown check of the spec file

Checked `JARVIS AI MANAGEMENT SYSTEM2.md` (2,436 lines) programmatically:

- **Code fences**: all ` ``` ` fences are balanced — 0 unclosed fences.
- **Heading hierarchy**: 1 non-sequential jump found — **line 2199** goes from `#` (Section 82
  title) directly to `###` (its `A`/`B`/`C`... sub-items), skipping `##`. This is a deliberate
  stylistic choice for a lettered checklist, not a structural error — Sections 1–81 and 83–86 all
  increment `#`-level sections sequentially with no other skips. No fix needed; noted for
  awareness only.
- No other structural issues (no broken tables, no mismatched list nesting detected by a plain
  read-through of the 86 numbered sections).

**Verdict: the spec file is well-formed markdown.** No corrections required before using it as
the implementation reference document.
