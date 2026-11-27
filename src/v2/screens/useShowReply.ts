import { useEffect, useRef } from "react";

const EVERY_MS = 400;
const TIMES = 12; // the cards above load one after another and push the target down: keep it in view for about 5 seconds
const HANDS_ON = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

type Seen = { id: string; version: number | null; leftAt: number | null; touched: boolean };

/**
 * Keeps the latest message in view, like a chat: the AI's reply when a finished request is opened, or the "now" line while
 * the work is running (`version` grows with each new message, which moves the screen again). It moves only as far as
 * needed, and stops for this request as soon as the person scrolls, clicks or types. `id` is null while something above
 * must be read first.
 */
export function useShowReply(id: string | null, version = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<Seen | null>(null);
  useEffect(() => {
    const touch = () => { if (seen.current) seen.current.touched = true; };
    HANDS_ON.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => HANDS_ON.forEach((e) => window.removeEventListener(e, touch));
  }, []);
  useEffect(() => {
    if (!id) return;
    if (seen.current?.id !== id) seen.current = { id, version: null, leftAt: null, touched: false };
    const s = seen.current;
    if (s.touched || s.version === version) return;
    const box = ref.current?.getBoundingClientRect();
    const inView = !!box && box.bottom > 0 && box.top < window.innerHeight;
    // first time: only from the top of the page. Later: only if the person is still where this left them, or can see the target
    const elsewhere = s.leftAt === null ? window.scrollY > 4 : Math.abs(window.scrollY - s.leftAt) > 4 && !inView;
    if (elsewhere) { s.touched = true; return; }
    let left = TIMES;
    const timer = setInterval(() => {
      const el = ref.current;
      if (!s.touched && el) {
        const dock = document.querySelector<HTMLElement>('[aria-label="指示を入力"]'); // pinned over the bottom of the page
        el.style.scrollMarginBottom = `${(dock?.offsetHeight ?? 0) + 12}px`;
        el.scrollIntoView({ block: "nearest" });
        s.leftAt = window.scrollY;
      }
      if (s.touched || --left <= 0) { s.version = version; clearInterval(timer); }
    }, EVERY_MS);
    return () => clearInterval(timer); // the version stays open, so the same message may be shown later
  }, [id, version]);
  return ref;
}
