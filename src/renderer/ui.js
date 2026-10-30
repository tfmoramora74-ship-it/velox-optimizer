// Utilitários de interface: criação de elementos, ícones, toasts, modais e formatação.
/* global velox */
window.Pages = {};

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  rocket: 'M5 15c-1.5 1-2 4-2 6 2 0 5-.5 6-2M14.5 4.5C17 2 20.5 2 21.5 2.5c.5 1 .5 4.5-2 7L12 17l-5-5zM9 12l-3-1 3-4h4M12 15l1 3 4-3v-4',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  gamepad: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M7 6h10a5 5 0 0 1 5 5v1a5 5 0 0 1-9 3h-2a5 5 0 0 1-9-3v-1a5 5 0 0 1 5-5z',
  wifi: 'M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01',
  gauge: 'M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0',
  windows: 'M3 5.5 10.5 4.5v7H3zM12.5 4.2 21 3v8.5h-8.5zM3 13h7.5v7L3 19zM12.5 13H21v8l-8.5-1.2z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  cpu: 'M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  gpu: 'M2 7h18v10H2zM20 10h2M6 17v3M10 17v3M7 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM14 10h3M14 13h3',
  ram: 'M3 7h18v9H3zM7 7v9M11 7v9M15 7v9M5 16v3M19 16v3',
  disk: 'M4 5h16v14H4zM8 15h.01M12 15h4',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  mouse: 'M12 2a6 6 0 0 1 6 6v8a6 6 0 0 1-12 0V8a6 6 0 0 1 6-6zM12 6v4',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 18l10 5 10-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  window: 'M3 4h18v16H3zM3 9h18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  broom: 'M14 4l6 6M11 7l6 6M3 21l7-7M10 14c-2 0-5 1-7 7 6-2 7-5 7-7zM9 9l6 6',
  memory: 'M4 6h16v12H4zM8 10h2v4H8zM14 10h2v4h-2z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  plus: 'M12 5v14M5 12h14',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  star: 'M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z',
  cast: 'M2 16a6 6 0 0 1 6 6M2 12a10 10 0 0 1 10 10M2 20h.01M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  package: 'M16.5 9.4 7.5 4.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  logo:'M4 5l8 14 8-14M8.5 5 12 11l3.5-6',
};

function icon(name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  s.appendChild(p);
  return s;
}

// h('div.card.elev', { onclick }, child...)
function h(sel, attrs, ...children) {
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(message, level = 'info', ms = 4500) {
  const t = h('div.toast.' + level, message);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function toastResult(r, okMsg) {
  if (!r) return;
  toast(r.message || okMsg || (r.ok ? 'Concluído.' : 'Falhou.'), r.ok ? 'success' : 'warning', r.ok ? 4000 : 8000);
}

function modal({ title, body, confirm = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const close = (v) => { bg.remove(); resolve(v); };
    const bg = h('div.modal-bg', { onclick: (e) => e.target === bg && close(false) },
      h('div.modal', h('h2', title), body,
        h('div.actions',
          cancel ? h('button.btn.ghost', { onclick: () => close(false) }, cancel) : null,
          h('button.btn.' + (danger ? 'danger' : 'primary'), { onclick: () => close(true) }, confirm))));
    root.appendChild(bg);
  });
}

function sw(checked, onchange) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  const el = h('label.switch', input, h('i'));
  input.addEventListener('change', async () => {
    el.classList.add('busy');
    try { await onchange(input.checked, input); } finally { el.classList.remove('busy'); }
  });
  return el;
}

function meter(pct, color) { return h('div.meter' + (color ? '.' + color : ''), h('i', { style: { width: Math.max(0, Math.min(100, pct || 0)) + '%' } })); }

const fmt = {
  bytes(b) { if (b === null || b === undefined || isNaN(b)) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(i >= 3 ? 1 : 0) + ' ' + u[i]; },
  pct(v) { return v === null || v === undefined ? '—' : Math.round(v) + '%'; },
  time(ts) { return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); },
  dur(ms) { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); const hh = Math.floor(m / 60); return hh ? `${hh}h ${m % 60}min` : m ? `${m}min ${s % 60}s` : `${s}s`; },
  ms(v) { return v === null || v === undefined ? '—' : (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ms'; },
};

// Linha SVG simples para séries (0-100 ou com max dado)
function sparkline(series, { color = 'var(--accent)', max = 100, height = 46, fill = true } = {}) {
  const w = 300;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  const lists = Array.isArray(series[0]) || (series[0] && series[0].data) ? series : [{ data: series, color }];
  for (const s of lists) {
    const data = (s.data || s).filter((v) => v !== null && v !== undefined);
    if (data.length < 2) continue;
    const m = s.max || max;
    const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 2 - (Math.min(v, m) / m) * (height - 4)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (fill && lists.length === 1) {
      const a = document.createElementNS(NS, 'path');
      a.setAttribute('d', d + ` L${w} ${height} L0 ${height} Z`);
      a.setAttribute('fill', s.color || color); a.setAttribute('opacity', '0.12');
      svg.appendChild(a);
    }
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', s.color || color);
    p.setAttribute('stroke-width', '2'); p.setAttribute('vector-effect', 'non-scaling-stroke'); p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  }
  return svg;
}

function ring(pct, label) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  const r = 52; const c = 2 * Math.PI * r;
  for (const cls of ['bg', 'fg']) {
    const ci = document.createElementNS(NS, 'circle');
    ci.setAttribute('cx', 60); ci.setAttribute('cy', 60); ci.setAttribute('r', r); ci.setAttribute('class', cls);
    if (cls === 'fg') { ci.setAttribute('stroke-dasharray', c); ci.setAttribute('stroke-dashoffset', c * (1 - pct / 100)); }
    svg.appendChild(ci);
  }
  return h('div.ring', svg, h('div.lbl', h('div', h('b', Math.round(pct) + ''), h('small', label))));
}

function pageHead(eyebrow, title, sub, ...actions) {
  return h('div.page-head', h('div', h('div.eyebrow', eyebrow), h('h1', title), sub ? h('div.sub', sub) : null), actions.length ? h('div.row', ...actions) : null);
}

function loading(text = 'Carregando...') { return h('div.loading', h('div.spinner'), text); }

const RISK = { low: ['Seguro', 'green'], medium: ['Moderado', 'amber'], high: ['Avançado', 'red'] };
function riskBadge(r) { const [t, c] = RISK[r] || RISK.low; return h('span.badge.' + c, t); }

async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '';
  btn.appendChild(h('div.spinner', { style: { width: '14px', height: '14px' } }));
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

Object.assign(window, { h, icon, toast, toastResult, modal, sw, meter, fmt, sparkline, ring, pageHead, loading, riskBadge, busy });
