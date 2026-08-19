import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInterviewSession } from "./useInterviewSession";
import type { OnboardingStatus } from "./useOnboardingStatus";
import "./OnboardingWizard.css";
import { modelForOnboardingTest, onboardingDefaultModelRef } from "./llm-setup";
import { useTheme } from "../shell/useTheme";

/* ═══════════════════ Onboarding · the nine-screen first-run flow ═══════════
   Faithful to the design (usejarvis-onboarding.html): Welcome · Permissions
   · The brain · Hearing · Speaking · Connect · The interview · The tour · All
   set. The ported steps (brain / hearing / speaking / interview) keep the real
   daemon wiring; the new steps (welcome / permissions / connect / tour / all
   set) are built to the design. The Pebble is the only thing alive. */

type StepKey =
  | "welcome" | "perms" | "brain" | "hear" | "speak" | "connect" | "interview" | "tour" | "allset";

const STEPS: ReadonlyArray<[StepKey, string]> = [
  ["welcome", "ようこそ"], ["perms", "権限"], ["brain", "頭脳"],
  ["hear", "聞く"], ["speak", "話す"], ["connect", "連携"],
  ["interview", "インタビュー"], ["tour", "ツアー"], ["allset", "完了"],
];

/* — inline SVG glyphs (design I{}) — */
const SVG: Record<string, string> = {
  access: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l4.5 13 2-5.5 5.5-2z"/></svg>',
  screen: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5-8-5.5-8-5.5z"/><circle cx="10" cy="10" r="2.4"/></svg>',
  auto: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="5.5" height="5.5" rx="1.2"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2"/></svg>',
  files: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 6a1 1 0 0 1 1-1h3.6l1.6 2H16a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
  mic: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="7" y="2.5" width="6" height="9.5" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0"/><path d="M10 15v2.5"/></svg>',
  micoff: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="7" y="2.5" width="6" height="9.5" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0"/><path d="M10 15v2.5"/><path d="M3 3l14 14"/></svg>',
  vol: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 8h3l4-3v10l-4-3H4z"/><path d="M14 7a4 4 0 0 1 0 6"/></svg>',
  voloff: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l4-3v10l-4-3H4z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/></svg>',
  calendar: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/></svg>',
  mail: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="5" width="14" height="10" rx="2"/><path d="M3.5 6l6.5 4.5L16.5 6"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M17 3L8.5 11.5M17 3l-5.5 14-3-6-6-3z"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 5h12a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H8l-4 3V6a1 1 0 0 1 1-1z"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4.5 6.5 11.5 3 8"/></svg>',
};
const Glyph = ({ k }: { k: string }) => <span dangerouslySetInnerHTML={{ __html: SVG[k] ?? "" }} />;

/* — providers (backend kind ids); model lists per the design — */
type Provider = {
  id: string; name: string; abbr: string; kind: string; reco?: boolean; soon?: boolean;
  noConfig?: boolean; needsKey?: boolean; keyOptional?: boolean; needsBaseUrl?: boolean; optionalBaseUrl?: boolean; freeModel?: boolean;
  keyLabel?: string; urlLabel?: string; urlPh?: string; models?: string[]; hint?: string;
};
const PROVIDERS: Provider[] = [
  { id: "jarvis", name: "Jarvis AI", abbr: "JA", kind: "キー不要", soon: true, noConfig: true },
  { id: "anthropic", name: "Anthropic", abbr: "A", kind: "APIキー", needsKey: true, optionalBaseUrl: true, keyLabel: "APIキー", urlLabel: "カスタムエンドポイントURL", urlPh: "https://gateway.example.com", models: ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"], hint: "カスタムエンドポイントを有効にすると、ANTHROPIC_BASE_URL および ANTHROPIC_AUTH_TOKEN 形式の認証を使用できます。" },
  { id: "openai", name: "OpenAI", abbr: "O", kind: "APIキー", needsKey: true, models: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5-mini", "o4-mini"] },
  { id: "groq", name: "Groq", abbr: "G", kind: "APIキー", needsKey: true, models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
  { id: "gemini", name: "Gemini", abbr: "Ge", kind: "APIキー", needsKey: true, models: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"] },
  { id: "ollama", name: "Ollama", abbr: "Ol", kind: "ローカル", needsBaseUrl: true, urlLabel: "Ollamaベース URL", urlPh: "http://localhost:11434", models: ["llama3.1", "llama3.2", "mistral", "qwen2.5"] },
  { id: "openrouter", name: "OpenRouter", abbr: "OR", kind: "APIキー", needsKey: true, models: ["anthropic/claude-opus-4", "openai/gpt-5.4", "google/gemini-2.5-pro"] },
  { id: "nvidia", name: "NVIDIA NIM", abbr: "N", kind: "APIキー", needsKey: true, models: ["meta/llama-3.3-70b-instruct"], hint: "モデルカタログはあなたのNVIDIAアカウントからリアルタイムで読み込まれます。" },
  { id: "openai_compatible", name: "OpenAI-compatible", abbr: "C", kind: "セルフホスト", needsBaseUrl: true, freeModel: true, urlLabel: "ベースURL", urlPh: "http://localhost:8080/v1", hint: "/v1/chat/completions に対応するサーバーなら何でも: llama.cpp、vLLM、LM Studio、TGI。/v1 サフィックスを含めてください。" },
  { id: "litellm", name: "LiteLLM", abbr: "L", kind: "プロキシ", needsBaseUrl: true, freeModel: true, urlLabel: "LiteLLMプロキシURL", urlPh: "http://localhost:4000/v1", hint: "以下のモデルはプロキシで定義したエイリアスと一致させてください。" },
  { id: "omniroute", name: "OmniRoute", abbr: "Om", kind: "ゲートウェイ", needsKey: true, keyOptional: true, needsBaseUrl: true, urlLabel: "OmniRoute API URL", urlPh: "http://localhost:20128/v1", models: ["auto"], hint: "OmniRouteインスタンスからすべてのルートとコンボを読み込みます。OpenAI互換APIを通じてツール呼び出しとストリーミングに対応しています。" },
];

const EDGE_VOICES = [
  { label: "Aria · 米国女性", id: "en-US-AriaNeural" },
  { label: "Guy · 米国男性", id: "en-US-GuyNeural" },
  { label: "Sonia · 英国女性", id: "en-GB-SoniaNeural" },
  { label: "Natasha · 豪州女性", id: "en-AU-NatashaNeural" },
  { label: "Jenny · 米国女性", id: "en-US-JennyNeural" },
  { label: "Davis · 米国男性", id: "en-US-DavisNeural" },
];

// ElevenLabs premade voice ids — stable, no /voices call needed (so a key
// that can synthesize but lacks the voices_read scope still works).
const ELEVEN_PREMADE = [
  { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel · 落ち着いた声" },
  { voice_id: "AZnzlk1XvdvUeBnXmlld", name: "Domi · 力強い声" },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Bella · 柔らかい声" },
  { voice_id: "ErXwobaYiN019PkySvjV", name: "Antoni · 温かい声" },
  { voice_id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli · 感情豊かな声" },
  { voice_id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh · 低い声" },
];

const IS_MAC = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.userAgent || (navigator as { platform?: string }).platform || "");
// Deep links to the OS privacy pane per permission. The app can't self-grant
// (the OS forbids it), but it can open the exact place you grant it.
const PERM_PANE: Record<string, { mac: string; win: string }> = {
  access: { mac: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility", win: "ms-settings:easeofaccess" },
  screen: { mac: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", win: "ms-settings:privacy-general" },
  auto: { mac: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation", win: "ms-settings:privacy-general" },
  files: { mac: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles", win: "ms-settings:privacy-broadfilesystemaccess" },
};

// Play MP3 bytes returned by /api/tts/preview in the dashboard itself.
async function playPreviewAudio(res: Response): Promise<void> {
  const buf = await res.arrayBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  await a.play().catch(() => URL.revokeObjectURL(url));
}

const TOUR = [
  { sm: "これがペブル、あなたの相棒です。カーソルのそばに常駐します。いつでもクリックして私に話しかけてください。", t: "→ ペブルをクリックして試す", pos: { right: 18, bottom: 50 } },
  { sm: "⌘Jを押すと会話パネル「Talk」が開きます。私たちのやり取りはすべてここに、セッションを越えて残ります。", t: "→ ⌘Jを押す", pos: { right: 18, top: 60 } },
  { sm: "左側のインデックスはすべてのルームです。名前が明示され、バッジがあなたの対応が必要な項目を知らせます。記憶より認識を優先します。", t: "", pos: { left: 130, top: 58 } },
  { sm: "Nowは監視画面です。私が何をしているか、あなたを待っているものが一目でわかります。", t: "", pos: { left: 130, top: 104 } },
  { sm: "Authorityはキルスイッチを備えたコントロールパネルです。現実世界に影響する操作は、あなたの承認なしには一切行われません。", t: "", pos: { left: 130, top: 150 } },
];

type TestState = { status: "idle" | "testing" | "ok" | "err"; msg?: string; validatedModel?: string };

export function OnboardingWizard({
  status,
  onComplete,
}: {
  status: OnboardingStatus | null;
  onComplete: () => void;
}) {
  const startStep = useMemo<number>(() => {
    if (!status?.setup_completed) return 0;
    if (!status.profile_completed && !status.setup_skipped_profile) return 6;
    if (!status.tutorial_completed && !status.tutorial_dismissed) return 7;
    return 8;
  }, [status]);

  const [step, setStep] = useState(startStep);
  const key = STEPS[step]![0];
  // True when the wizard is running the setup steps in this session (fresh
  // start) — a resume at the interview/tour never touched brain/voice state,
  // so the recap must not print those defaults as if they were saved.
  const configuredThisSession = startStep === 0;

  // welcome — same hook TopBar/Settings use, so an onboarding pick stays in
  // sync with the app's theme mechanism instead of a parallel light/dark-only
  // implementation.
  const [, themePreference, setThemePreference] = useTheme();

  // permissions
  // brain
  const [provId, setProvId] = useState("anthropic");
  const prov = PROVIDERS.find((p) => p.id === provId)!;
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState(false);
  const [model, setModel] = useState("");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  // The model catalog read from a custom Anthropic gateway. Kept outside the
  // test verdict so picking a model from it doesn't wipe the list.
  const [discoveredModels, setDiscoveredModels] = useState<string[] | null>(null);
  // Stale-response guard: bumped whenever the inputs a running test was
  // started with change, so a slow response can't resurrect a cleared
  // verdict (or install a catalog read from a since-edited endpoint).
  const testEpoch = useRef(0);
  // hearing
  const [stt, setStt] = useState<"skip" | "openai" | "groq" | "local">("skip");
  const [sttKey, setSttKey] = useState("");
  const [sttEndpoint, setSttEndpoint] = useState("http://localhost:8080");
  // speaking
  const [tts, setTts] = useState<"off" | "edge" | "elevenlabs">("edge");
  const [edgeVoice, setEdgeVoice] = useState(EDGE_VOICES[0]!.id);
  const [elevenKey, setElevenKey] = useState("");
  const [elevenVoice, setElevenVoice] = useState(ELEVEN_PREMADE[0]!.voice_id);
  const [elevenModel, setElevenModel] = useState("eleven_flash_v2_5");
  const [ttsTest, setTtsTest] = useState<TestState>({ status: "idle" });
  const [previewing, setPreviewing] = useState(false);
  // connect
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [googleState, setGoogleState] = useState<"idle" | "pending" | "connected">("idle");
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [tgOpen, setTgOpen] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [tgBusy, setTgBusy] = useState(false);
  // tour
  const [tourI, setTourI] = useState(0);
  // flow
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the ElevenLabs test whenever the key changes or the provider flips.
  useEffect(() => { setTtsTest({ status: "idle" }); }, [elevenKey, tts]);

  // Restore the URL last typed for each provider instead of clobbering it
  // with the default every time the user toggles between providers.
  const urlByProvider = useRef<Record<string, string>>({});
  useEffect(() => {
    const p = PROVIDERS.find((x) => x.id === provId)!;
    setModel(p.models?.[0] ?? "");
    const nextBaseUrl = urlByProvider.current[provId]
      ?? (provId === "omniroute" ? "http://localhost:20128/v1" : "");
    setBaseUrl(nextBaseUrl);
    setCustomEndpoint(provId === "anthropic" && Boolean(nextBaseUrl));
    testEpoch.current++;
    setTest({ status: "idle" });
    setDiscoveredModels(null);
  }, [provId]);

  // Same for the brain test: a changed key, base URL, or endpoint mode
  // invalidates a previous "Connected" verdict — and the gateway catalog,
  // which was read with those inputs.
  useEffect(() => {
    testEpoch.current++;
    setTest((t) => (t.status === "idle" ? t : { status: "idle" }));
    setDiscoveredModels(null);
  }, [apiKey, baseUrl, customEndpoint]);
  // A model change invalidates the verdict too — except when it's the model
  // the daemon itself just validated (runTest snaps the picker to it).
  useEffect(() => {
    if (test.status === "idle" || test.validatedModel === model) return;
    testEpoch.current++;
    setTest({ status: "idle" });
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ollama serves only what the operator pulled, and every id carries a tag
  // ("qwen2.5:3b"). The curated list is untagged guesswork — picking from it
  // yields ":latest", usually not pulled, and the first chat 404s. Ask the
  // daemon for the real catalog instead — debounced, since the base URL
  // arrives one keystroke at a time and every probe of a half-typed host is
  // a doomed network call. Falls back to the curated list when Ollama is
  // unreachable (empty base URL means "let the daemon pick its default").
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  useEffect(() => {
    if (provId !== "ollama") return;
    let cancelled = false;
    setOllamaLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/config/llm/ollama/models?base_url=${encodeURIComponent(baseUrl.trim())}`)
        .then((r) => r.json())
        .then((d: { ok: boolean; models?: string[] }) => {
          if (cancelled) return;
          setOllamaModels(d.ok && d.models && d.models.length > 0 ? d.models : []);
        })
        .catch(() => { if (!cancelled) setOllamaModels([]); })
        .finally(() => { if (!cancelled) setOllamaLoading(false); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [provId, baseUrl]);

  // Snap the untagged curated default to its installed sibling once the real
  // list arrives ("qwen2.5" -> "qwen2.5:3b"), so the test button works
  // without the user having to notice the mismatch. The model field is a
  // strict select here, so the selection always came from a list we offered —
  // snapping can't clobber a hand-typed id. The [apiKey, baseUrl, model]
  // effect above resets a stale test verdict when this fires.
  useEffect(() => {
    if (provId !== "ollama") return;
    if (!ollamaModels || ollamaModels.length === 0) return;
    if (!ollamaModels.includes(model)) {
      const sameFamily = ollamaModels.find((m) => m.split(":")[0] === model.split(":")[0]);
      setModel(sameFamily ?? ollamaModels[0]!);
    }
  }, [ollamaModels, provId]); // eslint-disable-line react-hooks/exhaustive-deps

  // OmniRoute's catalog is installation-specific: it includes configured
  // providers, free routes, and custom combos. Read it live instead of
  // shipping a stale shortlist. The key travels in a POST body, never a URL.
  const [omniRouteModels, setOmniRouteModels] = useState<string[] | null>(null);
  const [omniRouteLoading, setOmniRouteLoading] = useState(false);
  useEffect(() => {
    if (provId !== "omniroute") return;
    // No URL to probe: also drop a catalog fetched with earlier inputs so a
    // stale list doesn't linger on screen.
    if (!baseUrl.trim()) { setOmniRouteModels(null); return; }
    let cancelled = false;
    setOmniRouteLoading(true);
    const timer = window.setTimeout(() => {
      fetch("/api/config/llm/omniroute/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl.trim(), ...(apiKey ? { api_key: apiKey } : {}) }),
      })
        .then((r) => r.json())
        .then((d: { ok: boolean; models?: string[] }) => {
          if (!cancelled) setOmniRouteModels(d.ok && d.models ? d.models : []);
        })
        .catch(() => { if (!cancelled) setOmniRouteModels([]); })
        .finally(() => { if (!cancelled) setOmniRouteLoading(false); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [provId, baseUrl, apiKey]);

  useEffect(() => {
    if (provId !== "omniroute" || !omniRouteModels?.length) return;
    if (!omniRouteModels.includes(model)) setModel(omniRouteModels.includes("auto") ? "auto" : omniRouteModels[0]!);
  }, [omniRouteModels, provId]); // model intentionally snaps when the catalog arrives

  // The Google OAuth poll outlives the click handler — keep its id in a ref so
  // finishing/unmounting the wizard stops it (it ran for up to 5 min after).
  const googlePollRef = useRef<number | null>(null);
  const stopGooglePoll = useCallback(() => {
    if (googlePollRef.current != null) { window.clearInterval(googlePollRef.current); googlePollRef.current = null; }
  }, []);
  useEffect(() => stopGooglePoll, [stopGooglePoll]);

  const go = (n: number) => { setError(null); setStep(n); };
  const next = () => go(Math.min(step + 1, STEPS.length - 1));
  const back = () => go(Math.max(0, step - 1));

  /* — brain: test connection — */
  const runTest = useCallback(async () => {
    const epoch = ++testEpoch.current;
    setTest({ status: "testing" });
    try {
      const body: Record<string, unknown> = { provider: provId };
      // A custom Anthropic gateway may not recognize public Anthropic model
      // ids. Until its catalog is known, let the daemon discover a model,
      // validate it, and return the exact id that succeeded; afterwards the
      // user's pick from that catalog is validated as-is.
      const testModel = modelForOnboardingTest(provId, customEndpoint, model, discoveredModels);
      if (testModel) body.model = testModel;
      if (prov.needsKey) {
        if (!apiKey && !prov.keyOptional) { setTest({ status: "err", msg: "先にAPIキーを入力してください。" }); return; }
        if (apiKey) body.api_key = apiKey;
      }
      if (prov.needsBaseUrl) { if (!baseUrl.trim()) { setTest({ status: "err", msg: "先にベースURLを入力してください。" }); return; } body.base_url = baseUrl.trim(); }
      if (prov.optionalBaseUrl && customEndpoint) {
        if (!baseUrl.trim()) { setTest({ status: "err", msg: "先にカスタムエンドポイントURLを入力してください。" }); return; }
        body.base_url = baseUrl.trim();
      }
      if ((provId === "openai_compatible" || provId === "litellm") && apiKey) body.api_key = apiKey;
      const r = await fetch("/api/config/llm/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await r.json()) as { ok: boolean; model?: string; models?: string[]; error?: string };
      if (epoch !== testEpoch.current) return; // inputs changed mid-flight — verdict is stale
      if (data.ok) {
        const validatedModel = data.model ?? model;
        setTest({ status: "ok", msg: validatedModel, validatedModel });
        if (data.models?.length) {
          // Discovery ran: surface the gateway catalog in the model picker
          // and snap the selection to the id that actually passed the test.
          setDiscoveredModels(data.models);
          setModel(validatedModel);
        }
      }
      else setTest({ status: "err", msg: data.error ?? "テストに失敗しました。" });
    } catch (e) {
      if (epoch !== testEpoch.current) return;
      setTest({ status: "err", msg: e instanceof Error ? e.message : "テストに失敗しました。" });
    }
  }, [provId, model, apiKey, baseUrl, customEndpoint, discoveredModels, prov]);

  const brainReady = !prov.soon && (prov.noConfig || test.status === "ok");

  /* — the setup POST: fires when leaving Speaking (llm + stt + tts) — */
  const saveSetup = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const entry: Record<string, unknown> = { kind: prov.kind === "no key" ? "jarvis" : provId };
      if (prov.needsKey && apiKey) entry.api_key = apiKey;
      if (prov.needsBaseUrl) entry.base_url = baseUrl.trim();
      if (prov.optionalBaseUrl && customEndpoint && baseUrl.trim()) entry.base_url = baseUrl.trim();
      const validatedModel = test.status === "ok" ? test.validatedModel : undefined;
      const llm: Record<string, unknown> = {
        providers: { [provId]: entry },
        default: onboardingDefaultModelRef(provId, model, validatedModel),
      };

      const ttsBlock: Record<string, unknown> = { enabled: tts !== "off", provider: tts === "off" ? "edge" : tts };
      if (tts === "edge") { ttsBlock.voice = edgeVoice; ttsBlock.rate = "+0%"; }
      else if (tts === "elevenlabs") ttsBlock.elevenlabs = { api_key: elevenKey, voice_id: elevenVoice, model: elevenModel };

      const payload: Record<string, unknown> = { llm, tts: ttsBlock };
      if (stt !== "skip") {
        const sttBlock: Record<string, unknown> = { provider: stt };
        if ((stt === "openai" || stt === "groq") && sttKey) sttBlock[stt] = { api_key: sttKey };
        else if (stt === "local") sttBlock.local = { endpoint: sttEndpoint.trim(), server_type: "whisper_cpp" };
        payload.stt = sttBlock;
      }
      const r = await fetch("/api/onboarding/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
      go(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : "セットアップに失敗しました。");
    } finally { setBusy(false); }
  }, [prov, provId, apiKey, baseUrl, customEndpoint, model, test, tts, edgeVoice, elevenKey, elevenVoice, elevenModel, stt, sttKey, sttEndpoint]);

  const skipAll = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/onboarding/skip", { method: "POST" });
      if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
      onComplete();
    } catch (e) {
      // Closing anyway would replay onboarding next launch — surface it instead.
      setError(e instanceof Error && e.message ? `スキップの保存に失敗しました: ${e.message}` : "デーモンに接続できませんでした — もう一度お試しください。");
    } finally { setBusy(false); }
  }, [onComplete]);

  /* — speaking: ElevenLabs test via real synthesis — */
  // A synthesis call exercises the exact TTS path the app uses (and plays the
  // sample), so it validates the key without depending on the voices-list
  // scope. If it 401s, the key is genuinely bad.
  const testElevenLabs = useCallback(async () => {
    if (!elevenKey.trim()) { setTtsTest({ status: "err", msg: "先にElevenLabsのキーを貼り付けてください。" }); return; }
    setTtsTest({ status: "testing" });
    try {
      const r = await fetch("/api/tts/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "elevenlabs", api_key: elevenKey.trim(), voice_id: elevenVoice, model: elevenModel }) });
      if (!r.ok) {
        const t = await r.json().catch(() => ({ error: "" })) as { error?: string };
        const m = (t.error || "").includes("401") ? "ElevenLabsがこのキーを拒否しました。有効でtext-to-speechの権限があるか確認してください。" : (t.error || "テストに失敗しました。").slice(0, 90);
        setTtsTest({ status: "err", msg: m });
        return;
      }
      await playPreviewAudio(r);
      setTtsTest({ status: "ok", msg: "音声準備完了" });
    } catch (e) {
      setTtsTest({ status: "err", msg: e instanceof Error ? e.message : "テストに失敗しました。" });
    }
  }, [elevenKey, elevenVoice, elevenModel]);

  /* — connect actions — */
  // Google: real OAuth. Open the consent URL, then poll status until the
  // round-trip completes (covers both Calendar + Gmail — one Google grant).
  const connectGoogle = useCallback(async () => {
    setConnectErr(null);
    setGoogleState("pending");
    try {
      const r = await fetch("/api/auth/google/init", { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { auth_url?: string; error?: string };
      if (!r.ok || !d.auth_url) {
        // Most common: no Google app credentials configured on this daemon.
        setGoogleState("idle");
        setConnectErr(
          (d.error || "").toLowerCase().includes("credential")
            ? "GoogleのAPI認証情報が先に必要です。設定 → 連携で追加してから、ここで接続してください。"
            : (d.error || "Googleサインインを開始できませんでした。").slice(0, 120),
        );
        return;
      }
      const win = window.open(d.auth_url, "_blank", "noopener,noreferrer");
      if (!win) {
        // No popup → no sign-in in flight; don't sit in "Connecting…" polling.
        setGoogleState("idle");
        setConnectErr("ブラウザがサインインウィンドウをブロックしました。ポップアップを許可するか、設定 → 連携から接続してください。");
        return;
      }
    } catch {
      setGoogleState("idle");
      setConnectErr("Googleサインインの開始でデーモンに接続できませんでした。");
      return;
    }
    let tries = 0;
    stopGooglePoll();
    googlePollRef.current = window.setInterval(async () => {
      tries += 1;
      try {
        const s = await fetch("/api/auth/google/status");
        const d = (await s.json()) as { status?: string; is_authenticated?: boolean };
        if (d.is_authenticated || d.status === "connected") {
          stopGooglePoll();
          setGoogleState("connected");
          setConnected((c) => new Set(c).add("google").add("gmail"));
        }
      } catch { /* ignore */ }
      if (tries > 150) { stopGooglePoll(); setGoogleState((g) => (g === "pending" ? "idle" : g)); } // ~5 min cap
    }, 2000);
  }, [stopGooglePoll]);

  const cancelGoogle = useCallback(() => {
    stopGooglePoll();
    setGoogleState("idle");
  }, [stopGooglePoll]);

  // Telegram: real — needs a bot token, saved to the channels config.
  const saveTelegram = useCallback(async () => {
    if (!tgToken.trim()) return;
    setTgBusy(true);
    setConnectErr(null);
    try {
      const r = await fetch("/api/config/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegram: { bot_token: tgToken.trim(), enabled: true } }) });
      // The route hot-applies the config and can return HTTP 200 with
      // ok:false when the save succeeded but connecting the bot failed —
      // treat that as a failure so the wizard doesn't claim "connected".
      const body = r.ok ? await r.json().catch(() => null) as { ok?: boolean; message?: string } | null : null;
      if (r.ok && body?.ok !== false) { setConnected((c) => new Set(c).add("telegram")); setTgOpen(false); setTgToken(""); }
      else if (r.ok) setConnectErr((body?.message || "Telegramトークンは保存されましたが、ボットが接続できませんでした。").slice(0, 120));
      else setConnectErr(((await r.text().catch(() => "")) || `Telegramトークンを保存できませんでした (HTTP ${r.status})。`).slice(0, 120));
    } catch { setConnectErr("Telegramトークンの保存でデーモンに接続できませんでした。"); }
    finally { setTgBusy(false); }
  }, [tgToken]);

  /* — tour + finish — */
  // Both check the response: silently swallowing a failed POST would replay
  // the whole tour on next launch.
  const endTour = useCallback(async (endpoint: string) => {
    try {
      const r = await fetch(endpoint, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      go(8);
    } catch {
      setError("進行状況の保存でデーモンに接続できませんでした — もう一度お試しください。");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finishTour = useCallback(() => endTour("/api/onboarding/tutorial/complete"), [endTour]);
  const skipTour = useCallback(() => endTour("/api/onboarding/tutorial/dismiss"), [endTour]);

  // Real preview: synthesize a sample and play the returned MP3 in the
  // dashboard (no config round-trip, no Pebble dependency).
  const preview = useCallback(async () => {
    if (previewing) return;
    setPreviewing(true);
    try {
      const body: Record<string, unknown> = { provider: tts === "elevenlabs" ? "elevenlabs" : "edge" };
      if (tts === "elevenlabs") { body.api_key = elevenKey.trim(); body.voice_id = elevenVoice; body.model = elevenModel; }
      else body.voice = edgeVoice;
      const r = await fetch("/api/tts/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) await playPreviewAudio(r);
    } catch { /* best-effort */ }
    window.setTimeout(() => setPreviewing(false), 2000);
  }, [previewing, tts, edgeVoice, elevenKey, elevenVoice, elevenModel]);

  const speakReady = tts !== "elevenlabs" || ttsTest.status === "ok";

  /* — progress bar (steps 1..5 only) — */
  const showProgress = step >= 1 && step <= 5;
  const progress = showProgress && (
    <>
      <div className="obw-steps">
        {STEPS.map((_, i) => <i key={i} className={i < step ? "done" : i === step ? "cur" : ""} />)}
      </div>
      <div className="obw-steplab">ステップ {step + 1} / 9 · {STEPS[step]![1]}</div>
    </>
  );

  const drop = (cls = "", size = 60) => (
    <span className={`obw-drop ${cls}`} style={{ width: size, height: size }}>
      <span className="in" /><span className="ring" />
    </span>
  );

  return (
    <div className="obw">
      <div className="obw-bar">
        <i /><i /><i />
        <span className="obw-wt">{key === "welcome" || key === "interview" || key === "tour" || key === "allset" ? "Jarvis" : "Jarvis · セットアップ"}</span>
      </div>
      {progress}

      {key === "interview" ? (
        <InterviewStep ttsDisabled={tts === "off"} onComplete={() => go(7)} />
      ) : key === "tour" ? (
        renderTour()
      ) : (
        <div className="obw-scroll">{renderStep()}</div>
      )}
    </div>
  );

  /* ─────────── step renderers ─────────── */
  function renderStep() {
    switch (key) {
      case "welcome": return (
        <div className="obw-body mid"><div className="obw-wrap">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20, position: "relative" }}>
            <span className="obw-bloom" style={{ width: 150, height: 150, left: "50%", top: "50%", transform: "translate(-50%,-52%)" }} />
            {drop("", 60)}
          </div>
          <div className="obw-word" style={{ fontSize: 15, marginBottom: 11 }}><span className="u">use</span>jarvis</div>
          <h2>これがあなたのJarvisです。</h2>
          <div className="obw-sub" style={{ maxWidth: "34ch", margin: "9px auto 0" }}>
            5分ほどかけて設定しましょう: 何に触れられるか、動作する頭脳と声、そしてあなたについて少し。いつでもスキップして後で仕上げられます。
          </div>
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 11, alignItems: "center" }}>
            <div className="obw-themelab">見た目を選択</div>
            <div className="obw-themeseg">
              <button className={themePreference === "light" ? "on" : ""} onClick={() => setThemePreference("light")}>ライト</button>
              <button className={themePreference === "dark" ? "on" : ""} onClick={() => setThemePreference("dark")}>ダーク</button>
              <button className={themePreference === "system" ? "on" : ""} onClick={() => setThemePreference("system")}>システム</button>
            </div>
            <button className="obw-btn obw-btn-pri" style={{ minWidth: 208, marginTop: 8 }} onClick={next}>Jarvisをセットアップ</button>
            <button className="obw-skip" disabled={busy} onClick={skipAll}>後で行う</button>
            {error && <div className="obw-hint" style={{ color: "var(--listen)" }}>{error}</div>}
          </div>
        </div></div>
      );

      case "perms": {
        const rows: Array<[string, string, string, boolean]> = [
          ["access", "アクセシビリティ", "Jarvisがあなたのアプリを操作できるよう、クリック・入力・画面読み取りを許可します。", true],
          ["screen", "画面収録", "Awarenessのために画面を見ます: OCR、そしてあなたが行き詰まったときの検知。", false],
          ["auto", "自動化", "カレンダー、ブラウザ、メールなど他のアプリを直接操作します。", false],
          ["files", "ファイルとフォルダ", "指定したファイルやフォルダの読み書きを行います。", false],
        ];
        return (
          <div className="obw-body"><div className="obw-wrap wide">
            <h2>Jarvisにあなたのマシンへのアクセスを許可する。</h2>
            <div className="obw-sub">Jarvisはこれらを通じてあなたのコンピューター上で動作します。Jarvis自身では権限を付与できないため(OSが許可しません)、それぞれが該当の設定画面を開きます。安心できるものだけ許可するか、{IS_MAC ? "Mac" : "PC"}が確認を求めたときに後で承認してください。</div>
            <div className="obw-rows" style={{ marginTop: 16 }}>
              {rows.map(([id, name, body, req]) => (
                <button key={id} type="button" className="obw-prow" style={{ cursor: "pointer", textAlign: "left", width: "100%", background: "var(--raise)" }}
                  onClick={() => { try { window.open((IS_MAC ? PERM_PANE[id]?.mac : PERM_PANE[id]?.win) || "", "_blank"); } catch { /* webview may block the scheme */ } }}>
                  <span className="pg"><Glyph k={id} /></span>
                  <div className="pt"><div className="pn">{name}{req && <span className="req">必須</span>}</div><div className="pb">{body}</div></div>
                  <span className="obw-grant" style={{ pointerEvents: "none" }}>設定を開く ↗</span>
                </button>
              ))}
            </div>
            <div className="obw-hint" style={{ marginTop: 12 }}>{IS_MAC ? "システム設定 → プライバシーとセキュリティ" : "Windows設定 → プライバシーとセキュリティ"}、または設定 → 権限からいつでも確認・取り消しできます。</div>
            <div className="obw-btnrow"><button className="obw-btn obw-btn-ghost" onClick={back}>戻る</button><span className="grow" /><button className="obw-btn obw-btn-pri" onClick={next}>続ける</button></div>
          </div></div>
        );
      }

      case "brain": return (
        <div className="obw-body"><div className="obw-wrap wide">
          <h2>Jarvisの頭脳を選択してください。</h2>
          <div className="obw-sub">自前のものを持ち込む: Ollamaはキー不要でローカル動作、またはAnthropic、OpenAIなどのAPIキーを追加します。ホスト型頭脳のJarvis AIは近日公開予定です。設定からいつでも変更できます。</div>
          <div className="obw-provgrid" style={{ marginTop: 14 }}>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`obw-prov ${p.reco ? "reco" : ""} ${p.soon ? "soon" : ""} ${provId === p.id ? "on" : ""}`}
                disabled={p.soon}
                aria-disabled={p.soon}
                onClick={() => { if (!p.soon) setProvId(p.id); }}
              >
                <span className="pd">{p.abbr}</span>
                <div>
                  <div className="pn">{p.name}{p.soon && <span className="obw-soon">近日公開</span>}</div>
                  <div className="pk">{p.soon ? "近日公開" : p.kind}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="obw-provdetail">{renderProvDetail()}</div>
          <div className="obw-btnrow"><button className="obw-btn obw-btn-ghost" onClick={back}>戻る</button><span className="grow" /><button className="obw-btn obw-btn-pri" disabled={!brainReady} onClick={next}>続ける</button></div>
          {!brainReady && !prov.noConfig && <div className="obw-hint" style={{ marginTop: 8 }}>接続をテストして続けてください。</div>}
        </div></div>
      );

      case "hear": {
        const opts: Array<["skip" | "openai" | "groq" | "local", string, string, string]> = [
          ["skip", "micoff", "今はスキップ", "テキストのみ。後で設定から音声を設定できます。"],
          ["openai", "mic", "OpenAI Whisper", "クラウドWhisper。高精度、OpenAIキーが必要です。"],
          ["groq", "mic", "Groq Whisper", "最速のホスト型Whisper。Groqキーが必要です。"],
          ["local", "mic", "ローカル Whisper.cpp", "あなたのマシン上で動作します。キー不要です。"],
        ];
        return (
          <div className="obw-body"><div className="obw-wrap wide">
            <h2>Jarvisはどうやってあなたの声を聞くべきですか?</h2>
            <div className="obw-sub">音声認識(Speech to text)は音声メッセージとマイクボタンを支えます。入力のみで使う予定ならスキップし、後で設定から設定してください。</div>
            <div className="obw-choices" style={{ marginTop: 14 }}>
              {opts.map(([v, ic, nm, bd]) => (
                <button key={v} className={`obw-choice ${stt === v ? "on" : ""}`} onClick={() => setStt(v)}>
                  <span className="gi"><Glyph k={ic} /></span>
                  <div className="ct"><div className="cn">{nm}</div><div className="cb">{bd}</div></div>
                  <span className="rad" />
                </button>
              ))}
            </div>
            {(stt === "openai" || stt === "groq") && (
              <div className="obw-subctl"><input className="obw-inp" type="password" placeholder={`${stt === "openai" ? "OpenAI" : "Groq"}のキーを貼り付け`} value={sttKey} onChange={(e) => setSttKey(e.target.value)} /></div>
            )}
            {stt === "local" && (
              <div className="obw-subctl"><input className="obw-inp" placeholder="http://localhost:8080" value={sttEndpoint} onChange={(e) => setSttEndpoint(e.target.value)} /></div>
            )}
            {stt !== "skip" && <MicLevelCheck />}
            <div className="obw-btnrow"><button className="obw-btn obw-btn-ghost" onClick={back}>戻る</button><span className="grow" /><button className="obw-btn obw-btn-pri" onClick={next}>続ける</button></div>
          </div></div>
        );
      }

      case "speak": {
        const opts: Array<["off" | "edge" | "elevenlabs", string, string, string]> = [
          ["off", "voloff", "音声なし", "テキスト返信のみ。最も軽量な選択肢。"],
          ["edge", "vol", "Edge TTS", "無料でクリア、Jarvisに標準搭載。下から声を選択。"],
          ["elevenlabs", "vol", "ElevenLabs", "より高音質。ElevenLabsキーが必要です。"],
        ];
        return (
          <div className="obw-body"><div className="obw-wrap wide">
            <h2>Jarvisはあなたに話しかけるべきですか?</h2>
            <div className="obw-sub">音声応答は任意です。選ぶ前に声を試聴できます。後で設定から変更できます。</div>
            <div className="obw-choices" style={{ marginTop: 14 }}>
              {opts.map(([v, ic, nm, bd]) => (
                <button key={v} className={`obw-choice ${tts === v ? "on" : ""}`} onClick={() => setTts(v)}>
                  <span className="gi"><Glyph k={ic} /></span>
                  <div className="ct"><div className="cn">{nm}</div><div className="cb">{bd}</div></div>
                  <span className="rad" />
                </button>
              ))}
            </div>
            {tts === "edge" && (
              <div className="obw-subctl">
                <select className="obw-inp" style={{ flex: 1 }} value={edgeVoice} onChange={(e) => setEdgeVoice(e.target.value)}>
                  {EDGE_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                <span className={`obw-drop ${previewing ? "s-speak" : ""}`} style={{ width: 24, height: 24, flexShrink: 0 }}><span className="in" /></span>
                <button className="obw-btn obw-btn-ghost sm" disabled={previewing} onClick={preview}>{previewing ? "再生中…" : "試聴"}</button>
                {previewing && <span className="obw-wave">{Array.from({ length: 5 }, (_, i) => <b key={i} style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }} />)}</span>}
              </div>
            )}
            {tts === "elevenlabs" && (
              <div style={{ marginTop: 9 }}>
                <div className="obw-subctl" style={{ flexWrap: "wrap" }}>
                  <select className="obw-inp" style={{ flex: 1, minWidth: 150 }} value={elevenVoice} onChange={(e) => setElevenVoice(e.target.value)}>
                    {ELEVEN_PREMADE.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
                  </select>
                  <select className="obw-inp" style={{ width: 148 }} value={elevenModel} onChange={(e) => setElevenModel(e.target.value)}>
                    <option value="eleven_flash_v2_5">Flash v2.5 (高速)</option>
                    <option value="eleven_multilingual_v2">Multilingual v2</option>
                    <option value="eleven_turbo_v2_5">Turbo v2.5</option>
                  </select>
                </div>
                <div className="obw-subctl" style={{ flexWrap: "wrap" }}>
                  <input className="obw-inp" type="password" style={{ flex: 1, minWidth: 180 }} placeholder="ElevenLabsのキーを貼り付け" value={elevenKey} onChange={(e) => setElevenKey(e.target.value)} />
                  <button className="obw-btn obw-btn-ghost sm" disabled={ttsTest.status === "testing" || !elevenKey.trim()} onClick={testElevenLabs}>{ttsTest.status === "testing" ? "テスト中…" : "テストして試聴"}</button>
                  <span className={`obw-drop ${previewing ? "s-speak" : ""}`} style={{ width: 24, height: 24, flexShrink: 0 }}><span className="in" /></span>
                  {ttsTest.status === "ok" && <span className="obw-testres ok"><span className="dot" />接続済み · {ttsTest.msg}</span>}
                  {ttsTest.status === "err" && <span className="obw-testres err"><span className="dot" />{ttsTest.msg}</span>}
                </div>
              </div>
            )}
            {error && <div className="obw-hint" style={{ color: "var(--listen)", marginTop: 10 }}>{error}</div>}
            {!speakReady && <div className="obw-hint" style={{ marginTop: 10 }}>続けるにはElevenLabsのキーをテストして声を選んでください。</div>}
            <div className="obw-btnrow"><button className="obw-btn obw-btn-ghost" onClick={back}>戻る</button><span className="grow" /><button className="obw-btn obw-btn-pri" disabled={busy || !speakReady} onClick={saveSetup}>{busy ? "セットアップ中…" : "続ける"}</button></div>
          </div></div>
        );
      }

      case "connect": {
        const rows: Array<[string, string, string, string, boolean]> = [
          ["google", "calendar", "Google カレンダー", "予定を読み取り、予約枠を追加します。", false],
          ["gmail", "mail", "Gmail", "承認のもとで振り分けと下書きを行います。", false],
          ["telegram", "send", "Telegram", "スマートフォンからJarvisと話せます。", false],
          ["discord", "chat", "Discord", "現在コード上はスタブです。", true],
          ["whatsapp", "chat", "WhatsApp", "現在コード上はスタブです。", true],
        ];
        return (
          <div className="obw-body"><div className="obw-wrap wide">
            <h2>あなたの世界とつなげる。</h2>
            <div className="obw-sub">Jarvisに知っておいてほしいアプリを連携します。すべて任意で、設定からいつでも解除できます。</div>
            <div className="obw-rows" style={{ marginTop: 14 }}>
              {rows.map(([id, ic, nm, bd, soon]) => {
                const isGoogle = id === "google" || id === "gmail";
                const isConnected = connected.has(id);
                return (
                  <div key={id} className="obw-prow" style={{ flexWrap: "wrap" }}>
                    <span className="pg"><Glyph k={ic} /></span>
                    <div className="pt"><div className="pn">{nm}</div><div className="pb">{bd}</div></div>
                    {soon ? <span className="obw-pill">近日公開</span>
                      : isConnected ? <span className="obw-granted"><Glyph k="check" />接続済み</span>
                      : isGoogle ? (
                        googleState === "pending"
                          ? <button className="obw-grant" onClick={cancelGoogle} title="サインインの待機を中止">接続中… ✕</button>
                          : <button className="obw-grant" onClick={connectGoogle}>接続</button>
                      )
                      : id === "telegram" ? <button className="obw-grant" onClick={() => setTgOpen((o) => !o)}>接続</button>
                      : <span className="obw-pill">近日公開</span>}
                    {id === "telegram" && tgOpen && !isConnected && (
                      <div style={{ flexBasis: "100%", display: "flex", gap: 8, marginTop: 10 }}>
                        <input className="obw-inp" style={{ flex: 1 }} placeholder="@BotFatherから取得したボットトークン" value={tgToken} onChange={(e) => setTgToken(e.target.value)} />
                        <button className="obw-btn obw-btn-pri sm" disabled={tgBusy || !tgToken.trim()} onClick={saveTelegram}>{tgBusy ? "保存中…" : "保存"}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {connectErr && <div className="obw-hint" style={{ color: "var(--listen)", marginTop: 12 }}>{connectErr}</div>}
            <div className="obw-btnrow"><button className="obw-btn obw-btn-ghost" onClick={back}>戻る</button><button className="obw-skip grow" onClick={next} style={{ textAlign: "left", marginLeft: 8 }}>今はスキップ</button><button className="obw-btn obw-btn-pri" onClick={next}>続ける</button></div>
          </div></div>
        );
      }

      case "allset": return (
        <div className="obw-body mid"><div className="obw-wrap">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18, position: "relative" }}>
            <span className="obw-bloom ok" style={{ width: 150, height: 150, left: "50%", top: "50%", transform: "translate(-50%,-52%)" }} />
            <span className="obw-drop s-done" style={{ width: 58, height: 58 }}><span className="in" /></span>
          </div>
          <h2>準備が整いました。</h2>
          <div className="obw-sub" style={{ maxWidth: "33ch", margin: "9px auto 0" }}>
            {recapLine()} ダッシュボードを起動しています。
          </div>
          <div className="obw-recap">
            {configuredThisSession ? (
              <>
                <div><span className="ok">✓</span> 頭脳 · {prov.name}</div>
                <div><span className="ok">✓</span> 音声 · {tts === "off" ? "テキストのみ" : tts === "edge" ? `Edge (${EDGE_VOICES.find((v) => v.id === edgeVoice)?.label.split(" ")[0]})` : "ElevenLabs"}{stt !== "skip" ? " + Whisper" : ""}</div>
                <div><span className="ok">✓</span> プロフィールをVaultに保存しました</div>
              </>
            ) : (
              // Resumed past the setup steps: this session never touched
              // brain/voice, so don't print their defaults as saved config.
              <div><span className="ok">✓</span> プロフィールをVaultに保存しました</div>
            )}
          </div>
          <div style={{ marginTop: 22 }}><button className="obw-btn obw-btn-pri" style={{ minWidth: 208 }} onClick={onComplete}>Jarvisを開く</button></div>
        </div></div>
      );

      default: return null;
    }
  }

  function recapLine() {
    if (!configuredThisSession) return "頭脳の接続が完了し、あなたについても少し把握しました。";
    return `${prov.name}の接続が完了${tts !== "off" ? "、音声も有効に" : ""}し、あなたについても少し把握しました。`;
  }

  function renderProvDetail() {
    if (prov.noConfig) return <div className="obw-testres ok" style={{ fontSize: 12 }}><span className="dot" />Jarvis AIはあなたのプランに含まれています。設定は不要です。</div>;
    // The live catalog when we have one, the curated list otherwise. A custom
    // Anthropic gateway serves its own catalog — the curated public ids would
    // be misleading there, so before discovery the picker is replaced by a
    // hint instead of a list the gateway may not recognize.
    const customAnthropic = Boolean(prov.optionalBaseUrl && customEndpoint);
    const pickerModels = provId === "ollama" && ollamaModels && ollamaModels.length > 0
      ? ollamaModels
      : provId === "omniroute" && omniRouteModels && omniRouteModels.length > 0
        ? omniRouteModels
        : customAnthropic
          ? (discoveredModels ?? [])
          : (prov.models ?? []);
    return (
      <>
        {prov.optionalBaseUrl && (
          <label className="obw-toggle-row">
            <button
              type="button"
              className="obw-toggle"
              data-checked={customEndpoint}
              aria-checked={customEndpoint}
              role="switch"
              onClick={() => {
                setCustomEndpoint((enabled) => !enabled);
                urlByProvider.current[provId] = "";
                setBaseUrl("");
              }}
            />
            <span>カスタムAnthropicエンドポイントを使用</span>
          </label>
        )}
        {(prov.needsBaseUrl || (prov.optionalBaseUrl && customEndpoint)) && <div className="obw-field"><label>{prov.urlLabel}</label><input className="obw-inp" placeholder={prov.urlPh} value={baseUrl} onChange={(e) => { urlByProvider.current[provId] = e.target.value; setBaseUrl(e.target.value); }} /></div>}
        {prov.needsKey && <div className="obw-field"><label>{prov.optionalBaseUrl && customEndpoint ? "認証トークン" : (prov.keyLabel ?? `APIキー${prov.keyOptional ? "(任意)" : ""}`)}</label><input className="obw-inp" type="password" placeholder="キーを貼り付け" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>}
        {prov.freeModel
          ? <div className="obw-field"><label>モデル</label><input className="obw-inp" placeholder="モデルID" value={model} onChange={(e) => setModel(e.target.value)} /></div>
          : customAnthropic && pickerModels.length === 0
            ? <div className="obw-field"><label>モデル</label><div className="obw-hint">接続をテストすると、ゲートウェイからモデルが読み込まれます。</div></div>
            : <div className="obw-field"><label>モデル</label><select className="obw-inp" value={model} onChange={(e) => setModel(e.target.value)}>{pickerModels.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>}
        {provId === "ollama" && ollamaLoading && <div className="obw-hint">Ollamaからインストール済みモデルを読み込み中…</div>}
        {provId === "ollama" && !ollamaLoading && ollamaModels?.length === 0 && <div className="obw-hint">このURLでOllamaに接続できませんでした — 代わりに候補を表示しています。Ollamaが起動しているか確認してください(モデルにはタグを含める必要があります。例: llama3.1:8b)。</div>}
        {provId === "omniroute" && omniRouteLoading && <div className="obw-hint">すべてのOmniRouteモデルとコンボを読み込み中…</div>}
        {provId === "omniroute" && !omniRouteLoading && omniRouteModels?.length === 0 && <div className="obw-hint">このOmniRouteカタログを読み込めませんでした。URLとAPIキーを確認してください。autoルートは引き続きテストできます。</div>}
        <div className="obw-testrow">
          <button className="obw-btn obw-btn-ghost sm" disabled={test.status === "testing"} onClick={runTest}>{test.status === "testing" ? "テスト中…" : "接続をテスト"}</button>
          {test.status === "ok" && <span className="obw-testres ok"><span className="dot" />接続済み · {test.msg}</span>}
          {test.status === "err" && <span className="obw-testres err"><span className="dot" />{test.msg}</span>}
        </div>
        {prov.hint && <div className="obw-hint">{prov.hint}</div>}
      </>
    );
  }

  function renderTour() {
    const T = TOUR[tourI]!;
    const pos = T.pos as React.CSSProperties;
    return (
      <div className="obw-tourstage">
        <div className="obw-tourframe">
          <div className="obw-miniapp">
            <div className="mrail">
              <div className="mh">実行</div><div className="mr">ワークフロー</div><div className="mr">エージェント</div><div className="mr">タスク</div>
              <div className="mh">認識</div><div className="mr">メモリ</div><div className="mr">目標</div>
              <div className="mh">保護</div><div className="mr">権限 <span className="bd">2</span></div><div className="mr on">Now</div>
            </div>
            <div className="mmain">
              <div className="mtop">Now · おはようございます</div>
              <div className="mgrid"><div className="mcard" /><div className="mcard" /><div className="mcard" /><div className="mcard" /></div>
              <span className="mpeb obw-drop" style={{ width: 26, height: 26 }}><span className="in" /></span>
            </div>
          </div>
          <div className="obw-tourdim" />
          <div className="obw-spot" style={pos}>
            <div className="sh"><span className="sd"><span className="in" /></span><span className="sl">Jarvis · ツアー</span><span className="sc">{tourI + 1} / 5</span></div>
            <div className="sm">{T.sm}</div>
            {T.t && <div className="stry">{T.t}</div>}
            {error && <div className="stry" style={{ color: "var(--listen)" }}>{error}</div>}
            <div className="sb">
              <button className="obw-skip" onClick={skipTour}>ツアーをスキップ</button><span className="grow" />
              <button className="obw-btn obw-btn-pri sm" onClick={() => (tourI === TOUR.length - 1 ? finishTour() : setTourI(tourI + 1))}>{tourI === TOUR.length - 1 ? "完了" : "次へ"}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

/* ─────────── Mic level check (Hearing step) ───────────
   A REAL meter: getUserMedia + AnalyserNode drive the bars. Mounted only when
   an STT option is selected, so text-only users never see a mic prompt. Falls
   back to honest copy when access is denied/unavailable. */
function MicLevelCheck() {
  const [level, setLevel] = useState(0); // 0..1 RMS, boosted for visibility
  const [micState, setMicState] = useState<"requesting" | "live" | "denied">("requesting");
  useEffect(() => {
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        setMicState("live");
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i]! - 128) / 128; sum += v * v; }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!cancelled) setMicState("denied");
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => { /* already closed */ });
    };
  }, []);
  const BARS = 9;
  return (
    <div className="obw-miccheck">
      <div className="obw-micbars live">
        {Array.from({ length: BARS }, (_, i) => <b key={i} className={micState === "live" && level * BARS >= i + 0.5 ? "on" : ""} />)}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>既定のマイク</div>
        <div style={{ fontSize: 11, color: "var(--ink3)" }}>
          {micState === "denied"
            ? "マイクにアクセスできませんでした — 後で設定からテストできます。"
            : micState === "live" ? "何か話してレベルを確認してください" : "マイクへのアクセスを要求中…"}
        </div>
      </div>
    </div>
  );
}

/* ─────────── The interview (step 7) ───────────
   The design's ivstage, driven by the real useInterviewSession hook — the WS
   lifecycle, TTS playback, live STT, facts counter, skip and done are all
   preserved; only the presentation is rebuilt to Monochrome Lab. */
const IV_PHASE_CLASS: Record<string, string> = { thinking: "s-think", speaking: "s-speak", done: "s-done" };
const IV_PHASE_LABEL: Record<string, string> = { connecting: "接続中…", ready: "準備完了", error: "再接続中…", thinking: "考え中", speaking: "話しています", listening: "聞いています", done: "完了" };

function InterviewStep({ ttsDisabled, onComplete }: { ttsDisabled: boolean; onComplete: () => void }) {
  const session = useInterviewSession({ ttsDisabled });
  const [composerText, setComposerText] = useState("");
  const recognizerRef = useRef<{ stop: () => void } | null>(null);

  // Auto-arm browser SpeechRecognition while the orb is "listening" (voice
  // input), unless the user opted into text-only. Mirrors the old room.
  useEffect(() => {
    if (session.textOnly) return;
    if (session.phase !== "listening") {
      if (recognizerRef.current) { try { recognizerRef.current.stop(); } catch { /* ignore */ } recognizerRef.current = null; }
      return;
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new (Ctor as unknown as new () => {
      continuous: boolean; interimResults: boolean; lang: string;
      onresult: (e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void;
      onend: () => void; onerror: () => void; start: () => void; stop: () => void;
    })();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
    let finalText = "";
    rec.onresult = (event) => {
      let interim = "", captured = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]!; const t = String(r?.[0]?.transcript ?? "");
        if (r?.isFinal) captured += t; else interim += t;
      }
      if (captured) finalText += captured;
      session.setPartialUserText((finalText + interim).trim());
    };
    rec.onend = () => { const text = finalText.trim(); recognizerRef.current = null; if (text) session.sendUserMessage(text); };
    rec.onerror = () => { recognizerRef.current = null; };
    try { rec.start(); recognizerRef.current = rec; } catch { /* ignore */ }
    return () => { try { rec.stop(); } catch { /* ignore */ } recognizerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase, session.textOnly]);

  const sendTyped = () => { const t = composerText.trim(); if (!t) return; setComposerText(""); session.sendUserMessage(t); };
  const [skipErr, setSkipErr] = useState<string | null>(null);
  const skip = async () => {
    setSkipErr(null);
    try {
      const r = await fetch("/api/onboarding/profile/skip", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onComplete();
    } catch {
      // Completing anyway would replay the interview next launch.
      setSkipErr("デーモンに接続できませんでした — もう一度お試しください。");
    }
  };

  if (session.phase === "done") {
    return (
      <div className="obw-scroll"><div className="obw-body mid"><div className="obw-wrap">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, position: "relative" }}>
          <span className="obw-bloom ok" style={{ width: 140, height: 140, left: "50%", top: "50%", transform: "translate(-50%,-52%)" }} />
          <span className="obw-drop s-done" style={{ width: 52, height: 52 }}><span className="in" /></span>
        </div>
        <h2>把握しました。</h2>
        <div className="obw-sub" style={{ maxWidth: "34ch", margin: "9px auto 0" }}>{session.farewell || "始めるのに十分な情報が集まりました。Jarvisへようこそ。"}</div>
        <div className="obw-recap" style={{ marginTop: 10 }}><div>Vaultに{session.factsRecorded}件の情報を保存しました</div></div>
        <div style={{ marginTop: 20 }}><button className="obw-btn obw-btn-pri" style={{ minWidth: 180 }} onClick={onComplete}>続ける</button></div>
      </div></div></div>
    );
  }

  const msgs = session.messages;
  const lastAsstIdx = msgs.map((m) => m.role).lastIndexOf("assistant");
  const currentQ = lastAsstIdx >= 0 ? msgs[lastAsstIdx]!.text : (session.phase === "connecting" ? "会話の準備をしています…" : "…");
  const history = (lastAsstIdx >= 0 ? msgs.slice(0, lastAsstIdx) : msgs).slice(-4);

  return (
    <div className="obw-iv">
      <div className="obw-ivhead">
        <span className="l">Jarvis · あなたのことを知る</span>
        <span className="r">
          <span className="facts"><b>{session.factsRecorded}</b> 件の情報</span>
          {skipErr && <span className="obw-hint" style={{ color: "var(--listen)" }}>{skipErr}</span>}
          <button type="button" className="obw-skip" onClick={skip}>スキップ</button>
        </span>
      </div>
      <div className="obw-ivstage">
        <span className="obw-bloom" />
        <span className={`obw-drop iv-peb ${IV_PHASE_CLASS[session.phase] ?? ""}`} style={{ width: 54, height: 54 }}>
          <span className="in" /><span className="ring" />
        </span>
        <div className="obw-ivphase">{IV_PHASE_LABEL[session.phase] ?? session.phase}</div>
        <div className="obw-ivq">{currentQ}</div>
        {history.length > 0 && (
          <div className="obw-ivtrans">
            {history.map((m, i) => <div key={i} className={`obw-bub ${m.role === "assistant" ? "jv" : "me"}`}>{m.text}</div>)}
          </div>
        )}
        {session.partialUserText && (
          <div className="obw-ivphase" style={{ fontStyle: "italic", color: "var(--ink2)", textTransform: "none", letterSpacing: 0 }}>“{session.partialUserText}”</div>
        )}
      </div>
      <div className="obw-ivcomposer">
        <input className="obw-inp" placeholder="回答を入力するか、話しかけてください" value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") sendTyped(); }} />
        {session.phase === "listening" && !session.textOnly && <span className="obw-voicepill"><span className="ld" />聞いています</span>}
        <button type="button" className="obw-btn obw-btn-pri sm" onClick={sendTyped}>送信</button>
      </div>
    </div>
  );
}
