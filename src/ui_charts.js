/* Charts pane. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, Calc = G.Calc, Chart = G.Chart, esc = G.esc, $ = App.$, $$ = App.$$;
const TYPE_KEYS = { solar: ['T', 'A', 'H', 'P'], lunar: ['T', 'P', 'N'] };
const colorOf = (kind, type) => `var(--c-${kind === 'solar' ? 's' : 'l'}${type})`;
let dirty = true;

function timeTicks(a, b, tz, stepMin, hostId) {
  const el = hostId ? $('#' + hostId) : null, w = el ? el.clientWidth || 360 : 480, maxN = Math.max(3, Math.floor((w - 80) / 62));
  const steps = [stepMin, 5, 10, 15, 20, 30, 60, 120, 180, 360].filter(s => s >= stepMin).sort((x, y) => x - y);
  let st = steps[steps.length - 1]; for (const s of steps) if ((b - a) / (s * 60000) <= maxN) { st = s; break; }
  const out = []; st *= 60000;
  for (let t = Math.ceil(a / st) * st; t <= b; t += st) out.push({ v: t, l: U.hm(t, tz) });
  return out;
}
function stepFor(span) { const m = span / 60000; return m <= 40 ? 5 : m <= 100 ? 10 : m <= 190 ? 20 : m <= 400 ? 30 : 60; }
const yearFrac = ms => { const d = new Date(ms), y = d.getUTCFullYear(); return y + (ms - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)); };

const card = (id, title, sub, wide) => `<section class="card ${wide ? 'wide' : ''}"><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="chart-host" id="${id}"></div><div class="legend-row" id="${id}L"></div></section>`;
const msg = (id, text) => { const el = $('#' + id); if (el) el.innerHTML = `<div class="note">${esc(text)}</div>`; };
const legend = (id, items) => { const el = $('#' + id + 'L'); if (el) el.innerHTML = items.map(i => `<span><i style="background:${i[0]}"></i>${i[1]}</span>`).join(''); };

function chartLocalSolar() {
  const L = S.loc, an = S.an, tz = App.tz();
  if (!L.eclipse) return msg('chLocal', 'The Moon’s shadow does not reach this site, so there is nothing to chart. Pick a place inside the partial zone on the Earth tab.');
  const ob = Ecl.makeObserver(S.site.lat, S.site.lon, S.site.elev);
  const a = (L.c1 || L.tRise || L.tMax - 40 * 60000) - 8 * 60000, b = (L.c4 || L.tSet || L.tMax + 40 * 60000) + 8 * 60000;
  const N = 260, ob_ = [], al_ = [], mg_ = [];
  for (let i = 0; i <= N; i++) { const t = a + (b - a) * i / N, q = Ecl.localAt(an, ob, t); ob_.push([t, q.obsc * 100]); al_.push([t, q.alt]); mg_.push([t, q.mag]); }
  const col = colorOf('solar', an.type === 'H' ? (L.kind === 'annular' ? 'A' : 'T') : an.type);
  const vl = []; const mk = [['C1', L.c1], ['C2', L.c2], ['MAX', L.tMax], ['C3', L.c3], ['C4', L.c4]];
  mk.forEach(m => { if (m[1]) vl.push({ x: m[1], label: m[0], color: m[0] === 'MAX' ? 'var(--accent)' : 'var(--ink-3)' }); });
  Chart.line($('#chLocal'), {
    height: 230, x: { min: a, max: b, ticks: timeTicks(a, b, tz, stepFor(b - a), 'chLocal') }, y: { min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: v => v + '%', title: 'Obscuration' }, y2: { min: -10, max: 90, ticks: [0, 30, 60, 90], fmt: v => v + '°', color: 'var(--info)' },
    series: [{ kind: 'area', pts: ob_, color: col, axis: 'y' }, { kind: 'line', pts: al_, color: 'var(--info)', axis: 'y2', width: 1.6, dash: '5 4' }],
    hlines: [{ y: 0, axis: 'y2', color: 'var(--info)' }], vlines: vl, cursor: S.time, label: 'Obscuration and Sun altitude at your site',
    tooltip: x => { const q = Ecl.localAt(an, ob, x); return { title: U.hms(x, tz) + (S.useUT ? ' UT' : ''), rows: [{ c: col, k: 'Obscuration', v: U.pct(q.obsc) }, { c: col, k: 'Magnitude', v: q.mag.toFixed(3) }, { c: 'var(--info)', k: 'Sun altitude', v: q.alt.toFixed(1) + '°' }] }; },
    onPick: x => App.setTime(x),
  });
  legend('chLocal', [[col, 'Obscuration of the Sun (area)'], ['var(--info)', 'Sun altitude (right axis)']]);
}
function chartLocalLunar() {
  const L = S.loc, an = S.an, tz = App.tz();
  const a = an.tP1 - 12 * 60000, b = an.tP4 + 12 * 60000, N = 180;
  const obs = new G.Astronomy.Observer(S.site.lat, S.site.lon, S.site.elev || 0);
  const um = [], pm = [], al = [];
  for (let i = 0; i <= N; i++) {
    const t = a + (b - a) * i / N, ls = Ecl.lunarState(t), tt = Ecl.mkTime(t), eq = G.Astronomy.Equator('Moon', tt, obs, true, true), alt = G.Astronomy.Horizon(tt, obs, eq.ra, eq.dec, 'normal').altitude;
    um.push([t, Math.max(-0.2, (ls.k + ls.moonR - ls.r) / (2 * ls.moonR))]); pm.push([t, Math.max(-0.2, (ls.p + ls.moonR - ls.r) / (2 * ls.moonR))]); al.push([t, alt]);
  }
  const maxY = Math.ceil(Math.max(an.penumbralMag, 1.3) * 2) / 2;
  const vl = []; for (const [n, t] of [['P1', an.tP1], ['U1', an.tU1], ['U2', an.tU2], ['MAX', an.tGreatest], ['U3', an.tU3], ['U4', an.tU4], ['P4', an.tP4]]) if (t) vl.push({ x: t, label: n, color: n === 'MAX' ? 'var(--accent)' : 'var(--ink-3)', row: (['U1', 'U3'].includes(n) ? 1 : 0) });
  const col = colorOf('lunar', an.type);
  Chart.line($('#chLocal'), {
    height: 230, x: { min: a, max: b, ticks: timeTicks(a, b, tz, stepFor(b - a), 'chLocal') }, y: { min: 0, max: maxY, fmt: v => v.toFixed(1), title: 'Magnitude' }, y2: { min: -30, max: 90, ticks: [0, 30, 60, 90], fmt: v => v + '°', color: 'var(--info)' },
    series: [{ kind: 'area', pts: um, color: col, axis: 'y' }, { kind: 'line', pts: pm, color: 'var(--ink-2)', axis: 'y', width: 1.4 }, { kind: 'line', pts: al, color: 'var(--info)', axis: 'y2', width: 1.6, dash: '5 4' }],
    hlines: [{ y: 1, axis: 'y', label: 'total', color: 'var(--ink-3)' }, { y: 0, axis: 'y2', color: 'var(--info)' }], vlines: vl, cursor: S.time, label: 'Eclipse magnitude and Moon altitude',
    tooltip: x => { const ls = Ecl.lunarState(x), tt = Ecl.mkTime(x), eq = G.Astronomy.Equator('Moon', tt, obs, true, true), alt = G.Astronomy.Horizon(tt, obs, eq.ra, eq.dec, 'normal').altitude; return { title: U.hms(x, tz) + (S.useUT ? ' UT' : ''), rows: [{ c: col, k: 'Umbral mag.', v: Math.max(0, (ls.k + ls.moonR - ls.r) / (2 * ls.moonR)).toFixed(3) }, { c: 'var(--ink-2)', k: 'Penumbral mag.', v: Math.max(0, (ls.p + ls.moonR - ls.r) / (2 * ls.moonR)).toFixed(3) }, { c: 'var(--info)', k: 'Moon altitude', v: alt.toFixed(1) + '°' }] }; },
    onPick: x => App.setTime(x),
  });
  legend('chLocal', [[col, 'Umbral magnitude'], ['var(--ink-2)', 'Penumbral magnitude'], ['var(--info)', 'Moon altitude at your site (right axis)']]);
}
function chartTrack() {
  const an = S.an; if (!an.path || an.path.t.length < 3) return msg('chTrack', 'This eclipse has no central path: the Moon’s umbra misses the Earth, so there is no track to chart.');
  const p = an.path, pts = [], alts = [], ev = S.ev;
  const keep = [];
  for (let i = 1; i < p.t.length - 1; i += 2) keep.push(i);
  for (const i of keep) { pts.push([p.t[i], p.dur[i]]); alts.push([p.t[i], p.alt[i]]); }
  const a = p.t[1], b = p.t[p.t.length - 2], mx = Math.max(...pts.map(q => q[1])), col = U.color(ev), pi = S.pathInfo;
  const vl = [{ x: an.tGreatest, label: 'greatest', color: 'var(--accent)' }];
  if (pi && pi.km < pi.halfWidth * 3 + 200) vl.push({ x: pi.t, label: 'you', color: 'var(--info)', row: 1 });
  const hi = i => { let bi = 0, bd = 1e18; for (let k = 0; k < p.t.length; k++) { const d = Math.abs(p.t[k] - i); if (d < bd) { bd = d; bi = k; } } return bi; };
  Chart.line($('#chTrack'), {
    height: 230, x: { min: a, max: b, ticks: timeTicks(a, b, 'UTC', stepFor(b - a), 'chTrack') }, xTitle: 'Universal time, along the track', y: { min: 0, max: Math.ceil(mx / 60) * 60, ticks: Chart.niceTicks(0, Math.ceil(mx / 60) * 60, 4).map(v => ({ v, l: U.dur(v) })), wide: true },
    y2: { min: 0, max: 90, ticks: [0, 30, 60, 90], fmt: v => v + '°', color: 'var(--info)' },
    series: [{ kind: 'area', pts, color: col, axis: 'y' }, { kind: 'line', pts: alts, color: 'var(--info)', axis: 'y2', width: 1.6, dash: '5 4' }], vlines: vl, label: 'Duration of totality and Sun altitude along the path',
    tooltip: x => { const i = hi(x); return { title: U.hms(p.t[i], 'UTC') + ' UT', rows: [{ c: col, k: ev.type === 'A' ? 'Annularity' : 'Totality', v: U.dur(p.dur[i]) }, { c: col, k: 'Path width', v: Math.round(p.width[i]) + ' km' }, { c: 'var(--info)', k: 'Sun altitude', v: p.alt[i].toFixed(0) + '°' }, { c: 'var(--ink-3)', k: 'Position', v: U.coord(p.lat[i], p.lon[i]) }] }; },
    onPick: x => { const i = hi(x); const site = Calc.siteAt(p.lat[i], p.lon[i]); App.setSite(site); App.toast('Site set: ' + site.name); },
  });
  legend('chTrack', [[col, ev.type === 'A' ? 'Duration of annularity on the centre line' : 'Duration of totality on the centre line'], ['var(--info)', 'Sun altitude (right axis)'], ['var(--ink-3)', 'Click to move your site here']]);
}
function chartAcross() {
  const an = S.an, pi = S.pathInfo; if (!an.path || !pi) return msg('chAcross', 'No central path to cross.');
  const p = an.path, i = U.clamp(pi.idx, 1, p.t.length - 2);
  const lat = p.lat[i], lon = p.lon[i], hw = Math.max(20, pi.halfWidth);
  const brg = U.bearing(p.lat[i - 1], p.lon[i - 1], p.lat[i + 1], p.lon[i + 1]);
  let perp = (brg + 90) % 360; if (Math.cos(perp * Math.PI / 180) < -0.05 || (Math.abs(Math.cos(perp * Math.PI / 180)) <= 0.05 && Math.sin(perp * Math.PI / 180) < 0)) perp = (perp + 180) % 360;
  const north = Math.abs(Math.cos(perp * Math.PI / 180)) > 0.3;
  const R = hw * 1.7, pts = [], N = 48;
  for (let k = 0; k <= N; k++) { const off = -R + 2 * R * k / N, q = U.dest(lat, lon, off >= 0 ? perp : (perp + 180) % 360, Math.abs(off)); const Lc = Ecl.local(an, q[0], q[1], 0); pts.push([off, Lc.eclipse && Lc.kind !== 'partial' && Lc.sunUpAtMax ? Lc.duration : 0]); }
  const mx = Math.max(...pts.map(q => q[1]), 1);
  // your offset from the centre line, signed along the chosen perpendicular
  const bs = U.bearing(lat, lon, S.site.lat, S.site.lon), d = Ecl.geoDist(lat, lon, S.site.lat, S.site.lon), you = d * Math.cos((bs - perp) * Math.PI / 180);
  const col = U.color(S.ev), step = Chart.niceTicks(-R, R, 6);
  Chart.line($('#chAcross'), {
    height: 230, x: { min: -R, max: R, ticks: step.map(v => ({ v, l: Math.round(v) })) }, xTitle: north ? 'km north of the centre line (negative: south)' : 'km east of the centre line (negative: west)',
    y: { min: 0, max: Math.ceil(mx / 30) * 30 || 60, ticks: Chart.niceTicks(0, Math.ceil(mx / 30) * 30 || 60, 4).map(v => ({ v, l: U.dur(v) })), wide: true },
    series: [{ kind: 'area', pts, color: col, axis: 'y' }], vlines: [{ x: 0, label: 'centre', color: 'var(--ink-3)' }, ...(Math.abs(you) <= R ? [{ x: you, label: 'you', color: 'var(--info)', row: 1 }] : [])],
    bands: [{ x0: -hw, x1: hw, color: col, opacity: 0.07 }], label: 'Duration across the path',
    tooltip: x => { let best = pts[0]; for (const q of pts) if (Math.abs(q[0] - x) < Math.abs(best[0] - x)) best = q; return { title: Math.round(best[0]) + ' km from the centre', rows: [{ c: col, k: S.ev.type === 'A' ? 'Annularity' : 'Totality', v: best[1] ? U.dur(best[1]) : 'none (partial)' }] }; },
  });
  legend('chAcross', [[col, 'Duration at the point where the track passes ' + (S.site.name.split(',')[0])], ['var(--info)', 'Your position']]);
}

function chartTerrainTrack() {
  const an = S.an; if (!an.path || an.path.t.length < 3) return msg('chTerr', 'No central path to profile.');
  const p = an.path, pts = [], idx = [];
  for (let i = 1; i < p.t.length - 1; i += 2) { const e = Calc.elevation(p.lat[i], p.lon[i]); pts.push([p.t[i], Math.max(0, e)]); idx.push(i); }
  const mx = Math.max(...pts.map(q => q[1]), 100), top = Math.ceil(mx / 500) * 500;
  const a = pts[0][0], b = pts[pts.length - 1][0];
  const hi = x => { let bi = 0, bd = 1e18; idx.forEach((i, k) => { const d = Math.abs(p.t[i] - x); if (d < bd) { bd = d; bi = k; } }); return bi; };
  const pi = S.pathInfo, vl = [{ x: an.tGreatest, label: 'greatest', color: 'var(--accent)' }];
  if (pi && pi.km < pi.halfWidth * 3 + 200) vl.push({ x: pi.t, label: 'you', color: 'var(--info)', row: 1 });
  Chart.line($('#chTerr'), {
    height: 190, x: { min: a, max: b, ticks: timeTicks(a, b, 'UTC', stepFor(b - a), 'chTerr') }, xTitle: 'Universal time, along the track', y: { min: 0, max: top, ticks: Chart.niceTicks(0, top, 4).map(v => ({ v, l: v + ' m' })), wide: true },
    series: [{ kind: 'area', pts, color: 'var(--c-sH)', axis: 'y' }], vlines: vl, label: 'Terrain under the centre line',
    tooltip: x => { const k = hi(x), i = idx[k], c = Calc.nearestCity(p.lat[i], p.lon[i], 30000); return { title: U.coord(p.lat[i], p.lon[i]), rows: [{ c: 'var(--c-sH)', k: 'Elevation', v: Math.round(pts[k][1]) + ' m' }, ...(c && c.km < 120 ? [{ c: 'var(--ink-3)', k: 'Near', v: c.city.name }] : [{ c: 'var(--ink-3)', k: 'Surface', v: pts[k][1] === 0 ? 'sea / lowland' : 'land' }])] }; },
    onPick: x => { const k = hi(x), i = idx[k]; const site = Calc.siteAt(p.lat[i], p.lon[i]); App.setSite(site); App.toast('Site set: ' + site.name); },
  });
  legend('chTerr', [['var(--c-sH)', 'Ground height under the centre line (14 km grid). Zero means sea or lowland. Click to move your site.']]);
}
function chartYears() {
  const ev = S.ev, y = ev.date.getUTCFullYear(), y0 = Math.max(1900, y - 40), y1 = Math.min(2100, y + 40), keys = TYPE_KEYS[ev.kind];
  const bars = []; for (let yy = y0; yy <= y1; yy++) bars.push({ x: yy, parts: keys.map(k => ({ key: k, v: 0, color: colorOf(ev.kind, k) })) });
  for (const e of App.D.events) { if (e.kind !== ev.kind) continue; const yy = e.date.getUTCFullYear(); if (yy < y0 || yy > y1) continue; bars[yy - y0].parts.find(p => p.key === e.type).v++; }
  const names = ev.kind === 'solar' ? { T: 'Total', A: 'Annular', H: 'Hybrid', P: 'Partial' } : { T: 'Total', P: 'Partial', N: 'Penumbral' };
  Chart.bars($('#chYears'), {
    height: 210, x: { min: y0, max: y1, ticks: Chart.niceTicks(y0, y1, 6).map(v => ({ v: v + 0.5 - 0.5, l: String(v) })) }, y: { min: 0, max: ev.kind === 'solar' ? 5 : 4, ticks: [0, 1, 2, 3, 4, 5].filter(v => v <= (ev.kind === 'solar' ? 5 : 4)) },
    bars, highlight: y, label: 'Eclipses per year',
    tooltip: x => { const b = bars[x - y0]; if (!b) return null; return { title: String(x), rows: b.parts.filter(p => p.v).map(p => ({ c: p.color, k: names[p.key], v: String(p.v) })) }; },
    onPick: x => { const t = App.D.events.find(e => e.kind === ev.kind && e.date.getUTCFullYear() === x); if (t) App.selectEvent(t); },
  });
  legend('chYears', keys.map(k => [colorOf(ev.kind, k), names[k]]));
}
function chartSaros() {
  const ev = S.ev, items = [];
  for (const e of App.D.events) { if (e.kind !== ev.kind || e.saros !== ev.saros) continue; items.push({ x: yearFrac(e.t), y: ev.kind === 'solar' ? e.mag : e.umb, color: U.color(e), r: e.id === ev.id ? 7 : 5, active: e.id === ev.id, stem: false, ev: e, label: String(e.date.getUTCFullYear()) }); }
  if (!items.length) return msg('chSaros', 'No other members of this series fall in 1900–2100.');
  const ys = items.map(i => i.y), lo = ev.kind === 'solar' ? Math.floor(Math.min(...ys, 0.3) * 10) / 10 - 0.05 : Math.min(-0.5, Math.floor(Math.min(...ys) * 2) / 2), hi = Math.max(1.15, Math.ceil(Math.max(...ys) * 10) / 10 + 0.1);
  Chart.dots($('#chSaros'), {
    height: 210, margin: { t: 22 }, x: { min: 1900, max: 2100, ticks: [1900, 1950, 2000, 2050, 2100].map(v => ({ v, l: String(v) })) }, y: { min: lo, max: hi, fmt: v => v.toFixed(1), title: ev.kind === 'solar' ? 'Magnitude' : 'Umbral magnitude' },
    items, hlines: [{ y: 1, label: ev.kind === 'solar' ? 'total / annular boundary' : 'totality begins' }, ...(ev.kind === 'lunar' ? [{ y: 0, label: 'umbra reached' }] : [])], vlineNow: yearFrac(Date.now()), label: 'Saros series',
    tooltip: it => ({ title: U.date(it.ev.t, 'UTC'), rows: [{ c: it.color, k: U.typeShort(it.ev), v: (ev.kind === 'solar' ? it.ev.mag : it.ev.umb).toFixed(3) }, { c: 'var(--ink-3)', k: 'Gamma', v: it.ev.gamma.toFixed(3) }] }),
    onPick: it => App.selectEvent(it.ev),
  });
  legend('chSaros', [['var(--ink-3)', `Saros ${ev.saros}: eclipses repeat every 18 years 11 days 8 hours, drifting along the series`]]);
}
function chartNext() {
  const ev = S.ev, now = Date.now(), span = (ev.kind === 'solar' ? 25 : 15) * 365.25 * 86400000, items = [];
  const list = App.D.events.filter(e => e.kind === ev.kind && e.t >= now - 30 * 86400000 && e.t <= now + span);
  for (const e of list) {
    const v = App.visSummary(e); let y = 0;
    if (e.kind === 'solar') y = v.L ? (v.L.obscVisible ?? v.L.obsc ?? 0) * 100 : 0; else y = v.L ? v.L.fractionUp * 100 : 0;
    items.push({ x: yearFrac(e.t), y, color: U.color(e), r: y > 0 ? 5 : 3.5, stem: y > 0, ev: e, active: e.id === ev.id, v });
  }
  const x1 = yearFrac(now + span);
  Chart.dots($('#chNext'), {
    height: 210, x: { min: yearFrac(now), max: x1, ticks: Chart.niceTicks(yearFrac(now), x1, 6).map(v => ({ v, l: String(Math.round(v)) })) }, y: { min: 0, max: 105, ticks: [0, 25, 50, 75, 100], fmt: v => v + '%', title: ev.kind === 'solar' ? 'Sun covered' : 'Eclipse with Moon up' },
    items, label: 'Eclipses visible from your site',
    tooltip: it => ({ title: U.date(it.ev.t, 'UTC') + ' · ' + U.typeShort(it.ev), rows: [{ c: it.color, k: ev.kind === 'solar' ? 'Obscuration' : 'Moon up', v: it.y > 0 ? Math.round(it.y * 10) / 10 + '%' : 'not visible' }, ...(it.v && it.v.L && it.v.L.kind === 'total' ? [{ c: it.color, k: 'Totality', v: U.dur(it.v.L.duration) }] : [])] }),
    onPick: it => App.selectEvent(it.ev),
  });
  legend('chNext', [['var(--ink-3)', 'Click a point to open that eclipse; dots on the baseline cannot be seen from ' + S.site.name.split(',')[0]]]);
}
function chartDiagram() {
  const an = S.an, el = $('#chDiag'); if (!el) return;
  const t0 = an.tP1 - 8 * 60000, t1 = an.tP4 + 8 * 60000, N = 80, pts = [];
  for (let i = 0; i <= N; i++) { const t = t0 + (t1 - t0) * i / N; pts.push(Ecl.lunarState(t)); }
  const g = Ecl.lunarState(an.tGreatest), Rm = g.moonR;
  const W = Math.max(260, el.clientWidth || 420), H = 260, ext = (g.p + Rm) * 1.12, sc = Math.min(W / 2, H / 2) / ext * 0.98 * 1, cx = W / 2, cy = H / 2;
  const X = e => cx - e * sc, Y = n => cy - n * sc;         // east to the left, north up (as seen in the sky)
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Moon crossing the Earth's shadow">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${(g.p * sc).toFixed(1)}" style="fill:var(--ink);opacity:.08" /><circle cx="${cx}" cy="${cy}" r="${(g.p * sc).toFixed(1)}" fill="none" style="stroke:var(--ink-3)" stroke-dasharray="3 4"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${(g.k * sc).toFixed(1)}" style="fill:var(--c-lT);opacity:.28"/><circle cx="${cx}" cy="${cy}" r="${(g.k * sc).toFixed(1)}" fill="none" style="stroke:var(--c-lT)" stroke-width="1.4"/>`;
  s += `<text class="ch-note" x="${cx}" y="${(cy - g.p * sc - 5).toFixed(1)}" text-anchor="middle">penumbra</text><text class="ch-note" x="${cx}" y="${(cy - g.k * sc + 12).toFixed(1)}" text-anchor="middle">umbra</text>`;
  s += `<path d="${pts.map((q, i) => (i ? 'L' : 'M') + X(q.e).toFixed(1) + ' ' + Y(q.n).toFixed(1)).join('')}" fill="none" style="stroke:var(--ink-2)" stroke-width="1.2"/>`;
  const marks = [['P1', an.tP1], ['U1', an.tU1], ['U2', an.tU2], ['MAX', an.tGreatest], ['U3', an.tU3], ['U4', an.tU4], ['P4', an.tP4]].filter(m => m[1]);
  marks.forEach(([n, t], i) => { const q = Ecl.lunarState(t), x = X(q.e), y = Y(q.n), mx = n === 'MAX'; s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(Rm * sc).toFixed(1)}" style="fill:${mx ? 'var(--accent)' : 'var(--surface)'};fill-opacity:${mx ? 0.25 : 0.55};stroke:${mx ? 'var(--accent)' : 'var(--ink-2)'}" stroke-width="1.2"/><text class="ch-note" x="${x.toFixed(1)}" y="${(y + (i % 2 ? Rm * sc + 12 : -Rm * sc - 4)).toFixed(1)}" text-anchor="middle" style="fill:${mx ? 'var(--accent)' : 'var(--ink-2)'}">${n}</text>`; });
  const now = Ecl.lunarState(U.clamp(S.time, t0, t1)); s += `<circle cx="${X(now.e).toFixed(1)}" cy="${Y(now.n).toFixed(1)}" r="${(Rm * sc).toFixed(1)}" fill="none" style="stroke:var(--ink)" stroke-width="2"/>`;
  s += `<text class="ch-title" x="8" y="14">N ↑</text><text class="ch-title" x="${W - 8}" y="14" text-anchor="end">← E</text></svg>`;
  el.innerHTML = s;
}

function render() {
  const pane = $('#paneCharts'); if (!S.ev) return;
  const ev = S.ev, solar = ev.kind === 'solar', site = esc(S.site.name.split(',')[0]);
  const grid = $('#chartGrid');
  grid.innerHTML = (solar
    ? card('chLocal', 'Your eclipse, minute by minute', `How much of the Sun is covered at ${site}, and how high it stands.`, true)
      + card('chTrack', 'Along the path', 'Duration on the centre line and the Sun’s height, from sunrise end to sunset end.')
      + card('chAcross', 'Across the path', 'How quickly the duration falls toward the edges. The centre is worth the drive.')
      + card('chTerr', 'Terrain along the path', 'Ground height under the centre line, from the topographic grid.')
    : card('chLocal', 'The eclipse at your site', `Magnitude of the shadow and the Moon’s altitude at ${site}.`, true)
      + card('chDiag', 'The Moon in the Earth’s shadow', 'Moon positions at each contact, seen from the sky with north up.')
  ) + card('chNext', solar ? 'What you can see from here' : 'Lunar eclipses from here', solar ? `The next 25 years of solar eclipses as seen from ${site}.` : `The next 15 years of lunar eclipses as seen from ${site}.`)
    + card('chYears', solar ? 'Solar eclipses by year' : 'Lunar eclipses by year', 'Around the selected year. Click a bar to jump there.')
    + card('chSaros', `Saros series ${ev.saros}`, 'Members of this series in 1900–2100.');
  try { solar ? chartLocalSolar() : chartLocalLunar(); } catch (e) { console.error(e); }
  if (solar) { try { chartTrack(); } catch (e) { console.error(e); } try { chartAcross(); } catch (e) { console.error(e); } try { chartTerrainTrack(); } catch (e) { console.error(e); } } else chartDiagram();
  try { chartNext(); } catch (e) { console.error(e); }
  try { chartYears(); } catch (e) { console.error(e); }
  try { chartSaros(); } catch (e) { console.error(e); }
  dirty = false;
}
App.renderCharts = render;
let cursorReq = null;
App.initFns.push(function () {
  $('#paneCharts').innerHTML = '<div class="grid gut" id="chartGrid"></div>';
  const mark = () => { dirty = true; if (S.tab === 'charts') render(); };
  App.on('event', mark); App.on('site', mark); App.on('theme', mark); App.on('tzmode', mark);
  App.on('tab', t => { if (t === 'charts' && dirty) render(); });
  App.on('time', () => { if (S.tab !== 'charts' || cursorReq) return; cursorReq = requestAnimationFrame(() => { cursorReq = null; const h = $('#chLocal'); if (h && h._setCursor) h._setCursor(S.time); if (S.ev.kind === 'lunar') { try { chartDiagram(); } catch (e) { } } }); });
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (S.tab === 'charts' && $('#chartGrid').clientWidth) render(); }, 120); }).observe($('#paneCharts'));
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
