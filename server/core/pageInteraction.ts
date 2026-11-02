// Runs inside the page opened by the smoke test: fills the empty inputs with sample values and presses each visible button
// (at most MAX_BUTTONS), telling whether anything reacted (the screen changed or a request was sent). A page that opens but
// whose button does nothing is the failure this finds.
export type InteractionReport = { clicked: number; reacted: number; idle: string[] };

const MAX_BUTTONS = 6;

export const INTERACT_EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  let requests = 0;
  const f = window.fetch; window.fetch = function () { requests++; return f.apply(this, arguments); };
  const send = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function () { requests++; return send.apply(this, arguments); };
  const setValue = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!visible(el) || el.disabled || el.readOnly) continue;
    if (el instanceof HTMLSelectElement) { if (!el.value && el.options.length > 1) setValue(el, el.options[1].value); continue; }
    if (el.value) continue;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (['number', 'range'].includes(t)) setValue(el, '10');
    else if (t === 'email') setValue(el, 'test@example.com');
    else if (t === 'date') setValue(el, today);
    else if (['text', 'search', 'url', 'tel', ''].includes(t) || el instanceof HTMLTextAreaElement) setValue(el, 'テスト');
  }
  await sleep(200);
  const snap = () => document.body.innerHTML.length + '|' + (document.body.innerText || '');
  const buttons = [...document.querySelectorAll('button, input[type=button], input[type=submit], [role=button]')].filter((b) => visible(b) && !b.disabled).slice(0, ${MAX_BUTTONS});
  const out = { clicked: 0, reacted: 0, idle: [] };
  for (const b of buttons) {
    const label = ((b.innerText || b.value || b.getAttribute('aria-label') || '').trim() || '(名前なし)').slice(0, 30);
    const beforeSnap = snap(); const beforeReq = requests;
    b.click();
    await sleep(800);
    out.clicked++;
    if (snap() !== beforeSnap || requests !== beforeReq) out.reacted++; else out.idle.push(label);
  }
  return out;
})()`;
