/* Small SVG chart helpers. Colours come from CSS custom properties so both themes work. */
(function (G) {
'use strict';
const Chart = {};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function niceStep(range, n) {
  const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function niceTicks(a, b, n) {
  const st = niceStep(b - a, n), out = [];
  for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}
Chart.niceTicks = niceTicks;

function setup(el, cfg) {
  const W = Math.max(160, el.clientWidth || 360), H = cfg.height || 200;
  const m = Object.assign({ t: 14, r: cfg.y2 ? 46 : 14, b: cfg.xTitle ? 38 : 26, l: cfg.y && cfg.y.wide ? 52 : 40 }, cfg.margin || {});
  const x0 = cfg.x.min, x1 = cfg.x.max;
  const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const mkY = ax => { const y0 = ax.min, y1 = ax.max; return v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); };
  return { W, H, m, sx, sy: mkY(cfg.y), sy2: cfg.y2 ? mkY(cfg.y2) : null, x0, x1 };
}
function axes(g, cfg) {
  const { W, H, m, sx, sy, sy2 } = g; let s = '';
  const yt = cfg.y.ticks || niceTicks(cfg.y.min, cfg.y.max, 4);
  for (const t of yt) {
    const v = typeof t === 'object' ? t.v : t, l = typeof t === 'object' ? t.l : (cfg.y.fmt ? cfg.y.fmt(v) : v);
    s += `<line class="ch-grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}"/><text class="ch-tick" x="${m.l - 6}" y="${(sy(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(l)}</text>`;
  }
  if (cfg.y2) {
    const t2 = cfg.y2.ticks || niceTicks(cfg.y2.min, cfg.y2.max, 4);
    for (const t of t2) { const v = typeof t === 'object' ? t.v : t, l = typeof t === 'object' ? t.l : (cfg.y2.fmt ? cfg.y2.fmt(v) : v); s += `<text class="ch-tick" style="fill:${cfg.y2.color || 'var(--ink-3)'}" x="${W - m.r + 6}" y="${(sy2 ? sy2(v) : 0) + 3.5}" text-anchor="start">${esc(l)}</text>`; }
  }
  const xt = cfg.x.ticks || niceTicks(cfg.x.min, cfg.x.max, Math.max(3, Math.floor((W - m.l - m.r) / 80)));
  for (const t of xt) {
    const v = typeof t === 'object' ? t.v : t, l = typeof t === 'object' ? t.l : (cfg.x.fmt ? cfg.x.fmt(v) : v);
    s += `<line class="ch-tickline" x1="${sx(v).toFixed(1)}" x2="${sx(v).toFixed(1)}" y1="${H - m.b}" y2="${H - m.b + 4}"/><text class="ch-tick" x="${sx(v).toFixed(1)}" y="${H - m.b + 16}" text-anchor="middle">${esc(l)}</text>`;
  }
  s += `<line class="ch-axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  if (cfg.xTitle) s += `<text class="ch-title" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(cfg.xTitle)}</text>`;
  if (cfg.y.title) s += `<text class="ch-title" transform="translate(11 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(cfg.y.title)}</text>`;
  return s;
}
let uid = 0;
Chart.line = function (el, cfg) {
  const g = setup(el, cfg), { W, H, m, sx, sy, sy2 } = g, id = 'c' + (++uid);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || 'chart')}">`;
  s += `<defs>` + (cfg.series || []).map((se, i) => `<linearGradient id="${id}g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity="0.38"/><stop offset="1" stop-color="${se.color}" stop-opacity="0.02"/></linearGradient>`).join('') + `<clipPath id="${id}c"><rect x="${m.l}" y="${m.t - 2}" width="${W - m.l - m.r}" height="${H - m.t - m.b + 4}"/></clipPath></defs>`;
  for (const b of cfg.bands || []) s += `<rect x="${sx(Math.max(b.x0, g.x0)).toFixed(1)}" y="${m.t}" width="${Math.max(0, sx(Math.min(b.x1, g.x1)) - sx(Math.max(b.x0, g.x0))).toFixed(1)}" height="${H - m.t - m.b}" style="fill:${b.color};opacity:${b.opacity ?? 0.12}"/>`;
  s += axes(g, cfg);
  for (const h of cfg.hlines || []) { const f = h.axis === 'y2' ? sy2 : sy; s += `<line class="ch-ref" style="stroke:${h.color || 'var(--ink-3)'}" x1="${m.l}" x2="${W - m.r}" y1="${f(h.y).toFixed(1)}" y2="${f(h.y).toFixed(1)}" stroke-dasharray="4 4"/>` + (h.label ? `<text class="ch-note" x="${W - m.r - 4}" y="${(f(h.y) - 4).toFixed(1)}" text-anchor="end">${esc(h.label)}</text>` : ''); }
  s += `<g clip-path="url(#${id}c)">`;
  (cfg.series || []).forEach((se, i) => {
    const f = se.axis === 'y2' ? sy2 : sy; const pts = se.pts.filter(p => p[1] !== null && isFinite(p[1]));
    if (!pts.length) return;
    let d = '';
    if (se.kind === 'step') { pts.forEach((p, k) => { d += (k ? `H${sx(p[0]).toFixed(1)}V${f(p[1]).toFixed(1)}` : `M${sx(p[0]).toFixed(1)} ${f(p[1]).toFixed(1)}`); }); }
    else d = pts.map((p, k) => (k ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + f(p[1]).toFixed(1)).join('');
    if (se.kind === 'area') { const base = f(se.base ?? (se.axis === 'y2' ? cfg.y2.min : cfg.y.min)); s += `<path d="${d}L${sx(pts[pts.length - 1][0]).toFixed(1)} ${base.toFixed(1)}L${sx(pts[0][0]).toFixed(1)} ${base.toFixed(1)}Z" fill="url(#${id}g${i})"/>`; }
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  s += `</g>`;
  for (const v of cfg.vlines || []) {
    if (v.x < g.x0 || v.x > g.x1) continue; const x = sx(v.x).toFixed(1);
    s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" stroke="${v.color || 'var(--ink-3)'}" stroke-width="1" ${v.dash === false ? '' : 'stroke-dasharray="3 3"'} opacity="0.85"/>`;
    if (v.label) s += `<text class="ch-note" x="${x}" y="${m.t + (v.row || 0) * 11 + 8}" text-anchor="${v.anchor || 'middle'}" style="fill:${v.color || 'var(--ink-2)'}">${esc(v.label)}</text>`;
  }
  s += `<line class="ch-cursor ch-cur" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>`;
  s += `<g class="ch-hover" style="display:none"><line class="ch-hline" y1="${m.t}" y2="${H - m.b}"/></g>`;
  s += `<rect class="ch-hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="ch-tip" hidden></div>`;
  el.innerHTML = s; el.style.position = 'relative';
  const svg = el.querySelector('svg'), hit = el.querySelector('.ch-hit'), hov = el.querySelector('.ch-hover'), hl = el.querySelector('.ch-hline'), tip = el.querySelector('.ch-tip'), cur = el.querySelector('.ch-cur');
  el._setCursor = x => { if (x === null || x === undefined || x < g.x0 || x > g.x1) { cur.style.display = 'none'; return; } const px = sx(x).toFixed(1); cur.setAttribute('x1', px); cur.setAttribute('x2', px); cur.style.display = ''; };
  el._setCursor(cfg.cursor);
  const toX = ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return g.x0 + (px - m.l) / (W - m.l - m.r) * (g.x1 - g.x0); };
  const move = ev => {
    if (!cfg.tooltip) return; const xv = toX(ev), info = cfg.tooltip(xv); if (!info) return;
    hov.style.display = ''; const px = sx(xv); hl.setAttribute('x1', px); hl.setAttribute('x2', px);
    tip.hidden = false; tip.innerHTML = `<b>${esc(info.title)}</b>` + info.rows.map(r => `<div><i style="background:${r.c}"></i><span>${esc(r.k)}</span><em>${esc(r.v)}</em></div>`).join('');
    const rr = el.getBoundingClientRect(), sr = svg.getBoundingClientRect(); let left = (px / W) * sr.width + 12; if (left + 150 > rr.width) left -= 170; tip.style.left = Math.max(4, left) + 'px'; tip.style.top = '8px';
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerleave', () => { hov.style.display = 'none'; tip.hidden = true; });
  if (cfg.onPick) hit.addEventListener('click', ev => cfg.onPick(toX(ev)));
};

/* stacked bars over a numeric x (years) */
Chart.bars = function (el, cfg) {
  const g = setup(el, cfg), { W, H, m, sx, sy } = g;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || 'chart')}">` + axes(g, cfg);
  const bw = Math.max(1.2, (W - m.l - m.r) / (g.x1 - g.x0 + 1) - 1);
  for (const b of cfg.bars) {
    let acc = 0; const x = sx(b.x) - bw / 2 + (W - m.l - m.r) / (g.x1 - g.x0 + 1) / 2;
    for (const p of b.parts) { if (!p.v) continue; const y0 = sy(acc), y1 = sy(acc + p.v); s += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" fill="${p.color}"/>`; acc += p.v; }
  }
  if (cfg.highlight !== undefined) { const x = sx(cfg.highlight) + (W - m.l - m.r) / (g.x1 - g.x0 + 1) / 2; s += `<line class="ch-cursor" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t}" y2="${H - m.b}"/>`; }
  s += `<rect class="ch-hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="ch-tip" hidden></div>`;
  el.innerHTML = s; el.style.position = 'relative';
  const svg = el.querySelector('svg'), hit = el.querySelector('.ch-hit'), tip = el.querySelector('.ch-tip');
  const toX = ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return Math.floor(g.x0 + (px - m.l) / (W - m.l - m.r) * (g.x1 - g.x0 + 1)); };
  hit.addEventListener('pointermove', ev => { if (!cfg.tooltip) return; const info = cfg.tooltip(toX(ev)); if (!info) { tip.hidden = true; return; } tip.hidden = false; tip.innerHTML = `<b>${esc(info.title)}</b>` + info.rows.map(r => `<div><i style="background:${r.c}"></i><span>${esc(r.k)}</span><em>${esc(r.v)}</em></div>`).join(''); const rr = el.getBoundingClientRect(); let left = ev.clientX - rr.left + 12; if (left + 150 > rr.width) left -= 170; tip.style.left = Math.max(4, left) + 'px'; tip.style.top = '8px'; });
  hit.addEventListener('pointerleave', () => { tip.hidden = true; });
  if (cfg.onPick) hit.addEventListener('click', ev => cfg.onPick(toX(ev)));
};

/* dots over time: items [{x, y, color, r, label, id, active}] */
Chart.dots = function (el, cfg) {
  const g = setup(el, cfg), { W, H, m, sx, sy } = g;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || 'chart')}">` + axes(g, cfg);
  for (const h of cfg.hlines || []) s += `<line class="ch-ref" x1="${m.l}" x2="${W - m.r}" y1="${sy(h.y).toFixed(1)}" y2="${sy(h.y).toFixed(1)}" stroke-dasharray="4 4"/>` + (h.label ? `<text class="ch-note" x="${W - m.r - 4}" y="${(sy(h.y) - 4).toFixed(1)}" text-anchor="end">${esc(h.label)}</text>` : '');
  if (cfg.vlineNow !== undefined && cfg.vlineNow >= g.x0 && cfg.vlineNow <= g.x1) s += `<line class="ch-cursor" x1="${sx(cfg.vlineNow).toFixed(1)}" x2="${sx(cfg.vlineNow).toFixed(1)}" y1="${m.t}" y2="${H - m.b}"/><text class="ch-note" x="${(sx(cfg.vlineNow) + 4).toFixed(1)}" y="${m.t + 8}">today</text>`;
  cfg.items.forEach((it, i) => {
    const x = sx(it.x).toFixed(1), y = sy(it.y).toFixed(1);
    if (it.stem) s += `<line x1="${x}" x2="${x}" y1="${sy(0).toFixed(1)}" y2="${y}" stroke="${it.color}" stroke-width="1.4" opacity="0.7"/>`;
    s += `<circle data-i="${i}" cx="${x}" cy="${y}" r="${it.r || 4}" fill="${it.color}" stroke="${it.active ? 'var(--ink)' : 'var(--surface)'}" stroke-width="${it.active ? 2 : 1}" style="cursor:pointer"/>`;
    if (it.label) s += `<text class="ch-note" x="${x}" y="${(+y - (it.r || 4) - 4).toFixed(1)}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  s += `</svg><div class="ch-tip" hidden></div>`;
  el.innerHTML = s; el.style.position = 'relative';
  const tip = el.querySelector('.ch-tip');
  el.querySelectorAll('circle').forEach(c => {
    const it = cfg.items[+c.dataset.i];
    c.addEventListener('pointerenter', ev => { if (!cfg.tooltip) return; const info = cfg.tooltip(it); tip.hidden = false; tip.innerHTML = `<b>${esc(info.title)}</b>` + info.rows.map(r => `<div><i style="background:${r.c}"></i><span>${esc(r.k)}</span><em>${esc(r.v)}</em></div>`).join(''); const rr = el.getBoundingClientRect(), cr = c.getBoundingClientRect(); let left = cr.left - rr.left + 14; if (left + 150 > rr.width) left -= 176; tip.style.left = Math.max(4, left) + 'px'; tip.style.top = Math.max(4, cr.top - rr.top - 30) + 'px'; });
    c.addEventListener('pointerleave', () => { tip.hidden = true; });
    c.addEventListener('click', () => cfg.onPick && cfg.onPick(it));
  });
};
G.Chart = Chart; G.esc = esc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
