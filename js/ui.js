// Small helpers shared by every screen: building elements, dates, dialogs, toasts.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, size = 18) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    back: 'M15 5l-7 7 7 7',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
    pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
    play: 'M8 5l11 7-11 7z',
    pause: 'M8 5v14M16 5v14',
    next: 'M6 5l9 7-9 7zM18 5v14',
    prev: 'M18 5l-9 7 9 7zM6 5v14',
    photo: 'M4 7h3l2-2h6l2 2h3v12H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    share: 'M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10.6 13.5l2.8 1.8M13.4 6.7l-2.8 1.8',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    check: 'M5 12l5 5 9-10',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    menu: 'M4 7h16M4 12h16M4 17h16',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  };
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || ''}"/></svg>`;
  return span;
}

// ---------- Dates (stored as YYYY-MM-DD, shown in British English) ----------
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const parseISO = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDaysISO = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

export function fmtDate(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = parseISO(s);
  return d ? d.toLocaleDateString('en-GB', opts) : '';
}
export function fmtRange(a, b) {
  if (!a) return 'Dates not set';
  if (!b || a === b) return fmtDate(a);
  const A = parseISO(a), B = parseISO(b);
  if (A.getFullYear() === B.getFullYear()) {
    if (A.getMonth() === B.getMonth()) return `${A.getDate()}–${fmtDate(b)}`;
    return `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(b)}`;
  }
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}
export function fmtDateTime(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  return `${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}${t ? ' · ' + t.slice(0, 5) : ''}`;
}

export function tripStatus(t) {
  const today = todayISO();
  if (!t.start_date || t.start_date > today) return 'upcoming';
  if (t.end_date && t.end_date < today) return 'past';
  if (!t.end_date && t.start_date < today) return 'past';
  return 'now';
}
export function countdown(t) {
  const st = tripStatus(t);
  if (st === 'now') return 'Happening now';
  if (st === 'past') return t.end_date ? fmtDate(t.end_date, { month: 'short', year: 'numeric' }) : '';
  if (!t.start_date) return 'Dates to decide';
  const n = daysBetween(todayISO(), t.start_date);
  if (n === 1) return 'Tomorrow';
  if (n < 60) return `In ${n} days`;
  const months = Math.round(n / 30.4);
  return `In ${months} months`;
}
export const tripDays = (t) => (t.start_date && t.end_date ? daysBetween(t.start_date, t.end_date) + 1 : 0);
export function dayLabel(t, day) {
  if (!day) return 'Not scheduled yet';
  if (!t.start_date) return `Day ${day}`;
  return `Day ${day} · ${fmtDate(addDaysISO(t.start_date, day - 1), { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

export const KINDS = {
  stay: 'Stay', food: 'Food & drink', sight: 'Sight', activity: 'Activity', transport: 'Transport', other: 'Other',
};

export function money(amount, currency) {
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount || 0); }
  catch { return `${(amount || 0).toFixed(2)} ${currency}`; }
}

// Route colours, one per day; chosen to read on both the painted map and satellite.
export const DAY_COLOURS = ['#c4532d', '#2f6f9f', '#7a4e9c', '#2e7d4f', '#b07a12', '#a23b6b', '#3f6f6a', '#8a5a2b'];
export const dayColour = (day) => (day ? DAY_COLOURS[(day - 1) % DAY_COLOURS.length] : '#6b6a63');

// ---------- Toasts ----------
export function toast(message, kind = 'ok') {
  const box = $('#toasts');
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  setTimeout(() => el.classList.add('out'), kind === 'error' ? 5200 : 2800);
  setTimeout(() => el.remove(), kind === 'error' ? 5600 : 3200);
}
export async function attempt(fn, okMessage) {
  try {
    const r = await fn();
    if (okMessage) toast(okMessage);
    return r ?? true;   // success is never undefined; failure is
  } catch (e) {
    console.warn(e);
    toast(e.message || 'Something went wrong.', 'error');
    return undefined;
  }
}

// ---------- Dialogs ----------
// openDialog({ title, body: Node, actions: [{label, kind, onClick -> false to keep open}] })
export function openDialog({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: `dialog${wide ? ' dialog-wide' : ''}`, 'aria-label': title });
  const close = () => { dlg.close(); };
  const footer = h('div', { class: 'dialog-actions' },
    actions.map((a) => h('button', {
      type: a.submit ? 'submit' : 'button',
      class: `btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-quiet'}`,
      onclick: async (e) => {
        if (a.submit) return;
        e.preventDefault();
        const btn = e.currentTarget;
        btn.disabled = true;
        const keep = await a.onClick?.(close);
        btn.disabled = false;
        if (keep !== false) close();
      },
    }, a.label)));
  dlg.append(
    h('header', { class: 'dialog-head' },
      h('h2', { class: 'dialog-title' }, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('div', { class: 'dialog-body' }, body),
  );
  if (actions.length) dlg.append(footer);
  dlg.addEventListener('close', () => { onClose?.(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('input:not([type=hidden]):not([type=file]), select, textarea');
  if (first && window.matchMedia('(pointer:fine)').matches) first.focus();
  return { dlg, close };
}

export function confirmDialog(title, message, label = 'Delete') {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      body: h('p', { class: 'muted' }, message),
      actions: [
        { label: 'Cancel', onClick: () => {} },
        { label, kind: 'danger', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// Form fields
export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id, class: 'field-label' }, label),
    input,
    hint ? h('p', { class: 'field-hint' }, hint) : null);
}
export const input = (attrs = {}) => h('input', { class: 'input', type: 'text', ...attrs });
export const textarea = (attrs = {}) => h('textarea', { class: 'input', rows: 3, ...attrs });
export function select(options, value, attrs = {}) {
  const s = h('select', { class: 'input', ...attrs },
    Object.entries(options).map(([v, label]) => h('option', { value: v }, label)));
  if (value != null) s.value = value;
  return s;
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
}

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const initials = (name = '') => name.split(/\s+/).map((w) => (w.match(/[\p{L}\d]/u) || [''])[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·';
export function brandMark() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32');
  s.innerHTML = '<circle cx="16" cy="16" r="13.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 13c5 2 8-3 12-1s4 6 10 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2.4"/><circle cx="21.5" cy="10" r="2.6" fill="var(--stamp)"/>';
  return s;
}
