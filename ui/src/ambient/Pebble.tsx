import React, { useEffect, useRef, useState } from "react";

export type PebbleState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "asking"   // amber — waiting on your approval/authority
  | "done"     // green flash — job landed
  | "muted";   // mic muted — quiet, no chroma

// "thinking" is intentionally NOT locked — it should follow the cursor like
// idle, since thinking is a transient state where the user has no input
// affordance to interact with. Listening + speaking lock so bubble buttons
// stay clickable.
// Only speaking summons a bubble + grabs clicks. Listening is just the red
// drop following the cursor — no window, clicks pass through so you can keep
// working while you talk.
const LOCKED: ReadonlySet<PebbleState> = new Set(["speaking"]);

const FOLLOW_FACTOR = 0.10;
const SETTLE_FACTOR = 0.18;

// Cursor never sits on the pebble. Small offset down-right of the pointer.
const CURSOR_OFFSET_X = 30;
const CURSOR_OFFSET_Y = 36;

// In native mode the sidecar moves the entire window to follow the cursor,
// so the pebble div itself stays put. Pinned a few px from the window's
// top-left so the visible disc sits right next to the OS cursor tip
// (which lives just outside the window's TL corner).
const NATIVE_PEBBLE_X = 4;
const NATIVE_PEBBLE_Y = 4;

// True when the daemon spawned this page with ?native=1, meaning the
// sidecar is doing native cursor-follow at the window level. The page
// should NOT do its own cursor-follow physics in this mode.
const IS_NATIVE = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("native") === "1";

export function Pebble() {
  const [state, setState] = useState<PebbleState>("idle");
  const stateRef = useRef<PebbleState>("idle");

  const pebbleRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  const x = useRef(window.innerWidth / 2);
  const y = useRef(window.innerHeight / 2);
  const tx = useRef(window.innerWidth / 2);
  const ty = useRef(window.innerHeight / 2);
  const lockedX = useRef(window.innerWidth / 2);
  const lockedY = useRef(window.innerHeight / 2);

  useEffect(() => {
    stateRef.current = state;
    if (LOCKED.has(state)) {
      lockedX.current = x.current;
      lockedY.current = y.current;
    }
  }, [state]);

  // Expose summon/dismiss globals so the sidecar (via webview Eval) can
  // drive the pebble's state from a global hotkey or other native trigger.
  // Only exposed in native mode — browser dev mode uses the in-page chord.
  useEffect(() => {
    if (!IS_NATIVE) return;
    (window as unknown as Record<string, unknown>).__pebble_summon = () => {
      setState("listening");
    };
    (window as unknown as Record<string, unknown>).__pebble_dismiss = () => {
      setState("idle");
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__pebble_summon;
      delete (window as unknown as Record<string, unknown>).__pebble_dismiss;
    };
  }, []);

  // Toggle whole-window click-through on state changes (Clicky-style):
  //   idle / thinking / working → clicks pass through (everywhere) so the
  //                                user never feels the pebble window
  //   listening / speaking      → window grabs clicks so bubble buttons
  //                                respond. Whole desktop is "frozen" while
  //                                the user has the bubble open.
  // Visibility is handled entirely by WebView2 transparency
  // (WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0, set before process start) +
  // body { background: transparent }. No region masking — only the
  // explicitly painted pebble + bubble pixels render.
  useEffect(() => {
    if (!IS_NATIVE) return;
    type SidecarSetClickThrough = (ct: boolean) => Promise<unknown>;
    const fn = (window as unknown as { __sidecar_set_clickthrough?: SidecarSetClickThrough }).__sidecar_set_clickthrough;
    if (!fn) return;
    const interactive = state === "listening" || state === "speaking";
    fn(!interactive).catch(() => { /* sidecar may be down */ });
  }, [state]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      tx.current = e.clientX;
      ty.current = e.clientY;
      if (!LOCKED.has(stateRef.current)) {
        lockedX.current = e.clientX + CURSOR_OFFSET_X;
        lockedY.current = e.clientY + CURSOR_OFFSET_Y;
      }
    }

    // Summon chord: Ctrl + left click anywhere (Cmd on macOS).
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      setState((s) => (s === "idle" ? "listening" : "idle"));
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && stateRef.current !== "idle") {
        setState("idle");
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    // Browser dev mode kept for design reference (open pebble.html in a
    // browser to see the visual). Production native pebble is rendered
    // by the sidecar via GDI+/Cocoa/Cairo (W2-T10/T11/T12) — this React
    // component is no longer used in the native path.
    if (IS_NATIVE) {
      // No-op: native pebble doesn't run this React component.
      return;
    }

    // Phase 36 — this loop's elastic follow (interpolating toward the
    // cursor every frame) is exactly the kind of continuous, non-essential
    // motion prefers-reduced-motion exists for. The positioning itself is
    // functional (the pebble has to track the cursor), so reduced motion
    // doesn't disable tracking — it snaps straight to the target each
    // frame (factor 1) instead of chasing it smoothly.
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    function tick() {
      const locked = LOCKED.has(stateRef.current);
      const targetX = locked
        ? lockedX.current
        : tx.current + CURSOR_OFFSET_X;
      const targetY = locked
        ? lockedY.current
        : ty.current + CURSOR_OFFSET_Y;
      const factor = reduceMotion ? 1 : locked ? SETTLE_FACTOR : FOLLOW_FACTOR;

      x.current += (targetX - x.current) * factor;
      y.current += (targetY - y.current) * factor;

      if (pebbleRef.current) {
        pebbleRef.current.style.left = `${x.current}px`;
        pebbleRef.current.style.top = `${y.current}px`;
      }
      if (bubbleRef.current) {
        bubbleRef.current.style.left = `${x.current}px`;
        bubbleRef.current.style.top = `${y.current - 30}px`;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const showBubble = state === "speaking";
  const cls =
    "pebble pebble--" + state + (LOCKED.has(state) ? " pebble--locked" : "");

  return (
    <>
      <div ref={pebbleRef} className={cls} aria-hidden>
        <span className="gd">
          <span className="in" />
          <span className="ring" />
        </span>
      </div>

      {showBubble && (
        <div ref={bubbleRef} className="pebble-thread">
          <div className="thread-header">
            <span>スレッド</span>
            <button
              type="button"
              className="thread-dismiss"
              onClick={() => setState("idle")}
            >
              esc
            </button>
          </div>
          <div className="thread-body">
            <span className="thread-from">jarvis</span>
            発話中…
          </div>
          <div className="thread-actions">
            <button
              type="button"
              className="thread-btn thread-btn--primary"
              onClick={() => setState("speaking")}
            >
              読み上げる
            </button>
            <button
              type="button"
              className="thread-btn"
              onClick={() => setState("thinking")}
            >
              考える
            </button>
            <button
              type="button"
              className="thread-btn"
              onClick={() => setState("idle")}
            >
              閉じる
            </button>
          </div>
          <div className="thread-hint">
            <kbd>⌃</kbd>+クリックで呼び出し · <kbd>esc</kbd>で閉じる
          </div>
        </div>
      )}
    </>
  );
}
