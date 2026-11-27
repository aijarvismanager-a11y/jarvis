import { useEffect, useRef } from "react";

const EVERY_MS = 400;
const TIMES = 12; // the cards above load one after another and push the reply down: keep it in view for about 5 seconds
const HANDS_ON = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * When the screen opens on a finished request, bring the AI's reply into view, like a chat that opens on its latest message.
 * It moves only as far as needed (nothing when the reply is already visible), once per request, and stops as soon as the
 * person scrolls, clicks or types. `id` is null while something above must be read first.
 */
export function useShowReply(id: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!id || shown.current === id) return;
    if (window.scrollY > 4) { shown.current = id; return; } // the person is already reading somewhere else
    let left = TIMES;
    const stop = () => {
      shown.current = id;
      clearInterval(timer);
      HANDS_ON.forEach((e) => window.removeEventListener(e, stop));
    };
    const timer = setInterval(() => {
      const el = ref.current;
      if (el) {
        const dock = document.querySelector<HTMLElement>('[aria-label="指示を入力"]'); // pinned over the bottom of the page
        el.style.scrollMarginBottom = `${(dock?.offsetHeight ?? 0) + 12}px`;
        el.scrollIntoView({ block: "nearest" });
      }
      if (--left <= 0) stop();
    }, EVERY_MS);
    HANDS_ON.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    return () => { // not `stop`: when something above starts waiting, the same request may be shown later
      clearInterval(timer);
      HANDS_ON.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [id]);
  return ref;
}
