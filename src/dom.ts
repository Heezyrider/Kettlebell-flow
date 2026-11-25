type Child = Node | string | number | null | false | undefined;

/** Tiny hyperscript helper: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Labelled − / value / + control with big touch targets. */
export function stepper(opts: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}): HTMLElement {
  let value = opts.value;
  const step = opts.step ?? 1;
  const fmt = opts.format ?? String;
  const out = h('span', { class: 'stepper-value' }, fmt(value));
  const set = (v: number): void => {
    const next = Math.min(opts.max, Math.max(opts.min, Math.round(v / step) * step));
    if (next === value) return;
    value = next;
    out.textContent = fmt(value);
    opts.onChange(value);
  };
  return h(
    'div',
    { class: 'stepper' },
    h('button', { type: 'button', class: 'btn stepper-btn', 'aria-label': 'decrease', onclick: () => set(value - step) }, '−'),
    out,
    h('button', { type: 'button', class: 'btn stepper-btn', 'aria-label': 'increase', onclick: () => set(value + step) }, '+'),
  );
}
