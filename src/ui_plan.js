/* Plan pane: compare sites, find a spot, itinerary, terrain horizon, notes. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, Calc = G.Calc, Chart = G.Chart, esc = G.esc, $ = App.$, $$ = App.$$;
let dirty = true, spotCache = new Map(), horizonCache = new Map();
S.spotSort = 'duration';

const CHECK = ['Eclipse glasses (ISO 12312-2) for everyone', 'Solar filter for every camera, binocular and telescope', 'Tripod and a remote shutter', 'A backup site about an hour away', 'Weather forecast checked 48 and 24 hours before', 'Water, hat, sun protection and snacks', 'Offline maps and a printed route', 'Accommodation and transport booked early'];

function siteResult(ev, an, s) {
  const L = Calc.local(ev, an, s.lat, s.lon, s.elev);
  let r = { s, L, label: 'No eclipse', cls: 'no', sort: 0, max: null, alt: null, off: null };
  if (ev.kind === 'solar') {
    if (L.eclipse && L.visible) {
      r.max = L.sunUpAtMax ? L.tMax : (L.tSet || L.tRise); r.alt = L.sunUpAtMax ? L.altMax : null;
      if (L.kind !== 'partial' && L.sunUpAtMax) { r.label = (L.kind === 'total' ? 'Total ' : 'Annular ') + U.dur(L.duration); r.cls = 'yes'; r.sort = 1000 + L.duration; }
      else { r.label = 'Partial ' + U.pct(L.obscVisible); r.cls = 'part'; r.sort = L.obscVisible * 100; }
    } else if (L.eclipse) r.label = 'Sun down';
    if (an.path) { const pi = Calc.distToPath(an, s.lat, s.lon); r.off = pi ? (pi.km <= pi.halfWidth ? pi.km : pi.km - pi.halfWidth) : null; r.inside = pi ? pi.km <= pi.halfWidth : false; }
  } else {
    if (L.visible) { r.label = L.whole ? 'Whole eclipse' : L.partLabel; r.cls = L.whole ? 'yes' : 'part'; r.max = S.an.tGreatest; r.alt = L.altMax; r.sort = (L.whole ? 100 : 0) + L.fractionUp * 50 + Math.max(0, L.altMax) / 5; }
    else r.label = 'Moon down';
  }
  return r;
}

/* candidate places */
function spots() {
  const key = S.ev.id; if (spotCache.has(key)) return spotCache.get(key);
  const ev = S.ev, an = S.an, out = [], t0 = performance.now();
  if (ev.kind === 'solar' && an.central && an.path) {
    const p = an.path, idx = []; for (let i = 0; i < p.t.length; i += 2) idx.push(i);
    for (const c of Calc.cities) {
      if (c.pop < 25000 && !c.extra) continue;
      let ok = false; const cl = Math.cos(c.lat * Math.PI / 180);
      for (const i of idx) { const dx = ((c.lon - p.lon[i] + 540) % 360 - 180) * cl, dy = c.lat - p.lat[i]; const lim = (p.width[i] / 111.2) * 0.6 + 0.4; if (dx * dx + dy * dy < lim * lim) { ok = true; break; } }
      if (!ok) continue;
      const s = { name: c.name + ', ' + c.country, lat: c.lat, lon: c.lon, elev: Math.max(0, Calc.elevation(c.lat, c.lon)), tz: c.tz };
      const r = siteResult(ev, an, s); if (r.cls === 'yes') { r.pop = c.pop; r.city = c; out.push(r); }
    }
  } else if (ev.kind === 'solar') {
    for (const c of Calc.cities) { if (c.pop < 300000) continue; const s = { name: c.name + ', ' + c.country, lat: c.lat, lon: c.lon, elev: Math.max(0, Calc.elevation(c.lat, c.lon)), tz: c.tz }; const r = siteResult(ev, an, s); if (r.L.eclipse && r.L.visible && r.L.sunUpAtMax) { r.pop = c.pop; out.push(r); } }
  } else {
    for (const c of Calc.cities) { if (c.pop < 800000) continue; const s = { name: c.name + ', ' + c.country, lat: c.lat, lon: c.lon, elev: 0, tz: c.tz }; const r = siteResult(ev, an, s); if (r.cls === 'yes') { r.pop = c.pop; out.push(r); } }
  }
  spotCache.set(key, out); if (spotCache.size > 4) spotCache.delete(spotCache.keys().next().value);
  return out;
}
function spotList() {
  const all = spots().slice(), me = S.site, sort = S.spotSort, ev = S.ev;
  const dist = r => Ecl.geoDist(me.lat, me.lon, r.s.lat, r.s.lon);
  if (sort === 'sun') all.sort((a, b) => (b.alt ?? -1) - (a.alt ?? -1) || b.sort - a.sort);
  else if (sort === 'near') all.sort((a, b) => dist(a) - dist(b));
  else if (sort === 'pop') all.sort((a, b) => b.pop - a.pop);
  else all.sort((a, b) => b.sort - a.sort);
  return all.slice(0, 12).map(r => (r.dist = dist(r), r));
}

/* ---------- builders ---------- */
function renderSaved() {
  const el = $('#plSaved'); if (!el) return;
  const ev = S.ev, an = S.an, rows = [];
  const cur = siteResult(ev, an, S.site); cur.me = true; rows.push(cur);
  for (const s of S.saved) { if (s.id === S.site.lat.toFixed(3) + ',' + S.site.lon.toFixed(3)) { cur.saved = s; continue; } const r = siteResult(ev, an, s); r.saved = s; rows.push(r); }
  rows.sort((a, b) => b.sort - a.sort);
  const tz = r => S.useUT ? 'UTC' : r.s.tz;
  el.innerHTML = `<div class="scrollx"><table class="tbl"><thead><tr><th>Site</th><th>${ev.kind === 'solar' ? 'Result' : 'Visibility'}</th><th class="n">Maximum</th><th class="n">${ev.kind === 'solar' ? 'Sun' : 'Moon'} alt</th>${ev.kind === 'solar' && an.central ? '<th class="n">Off path</th>' : ''}<th></th></tr></thead><tbody>${rows.map(r => `<tr class="row-link ${r.me ? 'me' : ''}" data-site="${r.s.lat},${r.s.lon}"><td class="nm">${esc(r.s.name.split(',')[0])}<small>${esc(r.s.name.split(',').slice(1).join(',').trim() || U.coord(r.s.lat, r.s.lon))}${r.me ? ' · current' : ''}</small></td><td class="${r.cls === 'yes' ? '' : 'dim'}"><b style="color:${r.cls === 'yes' ? 'var(--good)' : r.cls === 'part' ? 'var(--warn)' : 'var(--ink-3)'}">${esc(r.label)}</b></td><td class="n">${r.max ? U.hms(r.max, tz(r)) : '—'}</td><td class="n">${r.alt !== null ? r.alt.toFixed(0) + '°' : '—'}</td>${ev.kind === 'solar' && an.central ? `<td class="n">${r.off === null ? '—' : r.inside ? '<span style="color:var(--good)">inside</span>' : U.km(r.off)}</td>` : ''}<td class="n">${r.saved ? `<button class="btn sm ghost" data-del="${r.saved.id}" aria-label="Remove ${esc(r.s.name)}">${App.icons.trash}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    ${S.saved.length ? '' : '<div class="note">Save places with <b>Save to plan</b> in the site panel, then compare them here for this eclipse.</div>'}`;
}
function renderSpots() {
  const el = $('#plSpots'); if (!el) return;
  const ev = S.ev, list = spotList(), solarC = ev.kind === 'solar' && S.an.central;
  const sorts = solarC ? [['duration', 'Longest ' + (ev.type === 'A' ? 'annularity' : 'totality')], ['sun', 'Highest Sun'], ['near', 'Nearest to me'], ['pop', 'Biggest cities']] : [['duration', 'Best view'], ['near', 'Nearest to me'], ['pop', 'Biggest cities']];
  if (!sorts.find(s => s[0] === S.spotSort)) S.spotSort = 'duration';
  if (!list.length) { el.innerHTML = `<div class="note">No listed city sees the best part of this eclipse. Search any place or click the map to try a spot.</div>`; return; }
  el.innerHTML = `<div class="f-row"><div class="seg" role="group" aria-label="Sort places">${sorts.map(s => `<button data-sort="${s[0]}" aria-pressed="${S.spotSort === s[0]}">${s[1]}</button>`).join('')}</div></div>
    <div class="scrollx"><table class="tbl"><thead><tr><th>Place</th><th class="n">${ev.kind === 'solar' ? (ev.type === 'A' ? 'Annular' : 'Totality') : 'Moon'}</th><th class="n">${ev.kind === 'solar' ? 'Sun' : 'Moon'} alt</th><th class="n">Max (local)</th><th class="n">From me</th></tr></thead><tbody>
    ${list.map(r => `<tr class="row-link" data-site="${r.s.lat},${r.s.lon}" data-name="${esc(r.s.name)}"><td class="nm">${esc(r.s.name.split(',')[0])}<small>${esc(r.s.name.split(',').slice(1).join(',').trim())}</small></td><td class="n">${ev.kind === 'solar' ? U.dur(r.L.duration) : r.L.whole ? 'whole' : 'partly'}</td><td class="n">${r.alt !== null ? r.alt.toFixed(0) + '°' : '—'}</td><td class="n">${r.max ? U.hm(r.max, r.s.tz) : '—'}</td><td class="n">${Math.round(r.dist).toLocaleString('en-GB')} km</td></tr>`).join('')}</tbody></table></div>`;
}
function renderItinerary() {
  const el = $('#plItin'); if (!el) return;
  const L = S.loc, ev = S.ev, tz = App.tz();
  if (!L.eclipse || !L.visible) { el.innerHTML = `<div class="note">No eclipse to plan for at this site. Choose a site inside the visible zone.</div>`; return; }
  const items = [];
  if (ev.kind === 'solar') {
    const c1 = L.c1 || L.tRise || L.tMax - 30 * 60000, central = L.kind !== 'partial' && L.sunUpAtMax;
    items.push([c1 - 120 * 60000, 'Arrive', 'Park, find shade, walk the view. Roads fill up on eclipse days.']);
    items.push([c1 - 60 * 60000, 'Set up', 'Tripod, filters, camera settings. Test the horizon toward the Sun.']);
    if (L.c1) items.push([L.c1, 'First contact (C1)', 'The Moon starts to bite the Sun. Eclipse glasses on.', true]);
    if (central) {
      items.push([L.c2 - 10 * 60000, 'Ten minutes to ' + (L.kind === 'total' ? 'totality' : 'annularity'), 'Light turns thin and the air cools. Check focus one last time.']);
      items.push([L.c2, (L.kind === 'total' ? 'Totality begins (C2)' : 'Annularity begins (C2)'), L.kind === 'total' ? 'Glasses off for the total phase only. Look for the corona and the diamond ring.' : 'Keep glasses on. The Sun forms a ring around the Moon.', true]);
      items.push([L.tMax, 'Maximum', `${U.dur(L.duration)} in total, Sun ${L.altMax.toFixed(0)}° high.`, true]);
      items.push([L.c3, (L.kind === 'total' ? 'Totality ends (C3)' : 'Annularity ends (C3)'), L.kind === 'total' ? 'Glasses back on at the first bright bead of sunlight.' : 'Ring breaks.', true]);
    } else items.push([L.tMax, 'Maximum', `${U.pct(L.obscVisible)} of the Sun covered.`, true]);
    if (L.c4) items.push([L.c4, 'Last contact (C4)', 'The eclipse ends.', true]);
    items.push([(L.c4 || L.tMax) + 30 * 60000, 'Pack up', 'Expect heavy traffic. Leave the site in good order.']);
  } else {
    const an = S.an, c = L.contacts;
    items.push([an.tP1 - 60 * 60000, 'Set up', 'Dark spot, warm clothes. Binoculars help; no filters needed.']);
    for (const k of ['P1', 'U1', 'U2', 'max', 'U3', 'U4', 'P4']) if (c[k]) items.push([c[k].t, ({ P1: 'Penumbral phase begins', U1: 'Partial phase begins', U2: 'Totality begins', max: 'Maximum', U3: 'Totality ends', U4: 'Partial phase ends', P4: 'Penumbral phase ends' })[k], `Moon ${c[k].alt.toFixed(0)}° ${c[k].alt >= 0 ? 'high' : 'below the horizon'}.`, ['U1', 'U2', 'max', 'U3', 'U4'].includes(k)]);
  }
  items.sort((a, b) => a[0] - b[0]);
  el.innerHTML = `<div class="timeline">${items.map(i => `<div class="tl ${i[3] ? 'key' : ''}"><div class="tt">${U.hms(i[0], tz).slice(0, 8)}</div><div class="dot"></div><div class="ds"><b>${esc(i[1])}</b>${esc(i[2])}</div></div>`).join('')}</div><div class="dimmer" style="font-size:12px">Times in ${S.useUT ? 'universal time' : esc(S.site.tz.replace(/_/g, ' ')) + ' (' + U.offsetLabel(L.tMax || S.an.tGreatest, S.site.tz) + ')'}. Use the UT / Local switch in the site panel.</div>`;
}
function horizonFor(s) {
  const k = s.lat.toFixed(3) + ',' + s.lon.toFixed(3) + ',' + Math.round(s.elev);
  let h = horizonCache.get(k); if (!h) { h = G.horizonProfile(G.TS && G.TS.hasLayers() ? G.TS : App.D.terrain, s.lat, s.lon, s.elev || 0); horizonCache.set(k, h); if (horizonCache.size > 12) horizonCache.delete(horizonCache.keys().next().value); }
  return h;
}
function renderTerrain() {
  const el = $('#plHorizon'); if (!el) return;
  const s = S.site, L = S.loc, an = S.an, h = horizonFor(s);
  const path = [];
  if (L.eclipse && S.ev.kind === 'solar') {
    const ob = Ecl.makeObserver(s.lat, s.lon, s.elev), a = L.c1 || L.tMax - 30 * 60000, b = L.c4 || L.tMax + 30 * 60000;
    for (let i = 0; i <= 40; i++) { const t = a + (b - a) * i / 40, q = Ecl.localAt(an, ob, t); path.push([q.az, q.alt]); }
  } else if (L.eclipse && S.ev.kind === 'lunar') {
    const obs = new G.Astronomy.Observer(s.lat, s.lon, s.elev || 0), a = an.tP1, b = an.tP4;
    for (let i = 0; i <= 40; i++) { const t = a + (b - a) * i / 40, tt = Ecl.mkTime(t), eq = G.Astronomy.Equator('Moon', tt, obs, true, true), hz = G.Astronomy.Horizon(tt, obs, eq.ra, eq.dec, 'normal'); path.push([hz.azimuth, hz.altitude]); }
  }
  const pts = []; for (let az = 0; az <= 360; az += 2) pts.push([az, h[az % 360]]);
  const maxH = Math.max(...pts.map(p => p[1]), 0), maxA = Math.max(...path.map(p => p[1]), 5);
  const yMax = Math.max(10, Math.ceil(Math.max(maxH * 1.4, maxA * 1.1, 6) / 5) * 5);
  const mid = path.length ? path[Math.floor(path.length / 2)] : null;
  const sep = []; // split the sun path where it wraps around north
  const seg = []; let cur = [];
  for (const p of path) { if (cur.length && Math.abs(p[0] - cur[cur.length - 1][0]) > 180) { seg.push(cur); cur = []; } cur.push(p); } if (cur.length) seg.push(cur);
  const ser = [{ kind: 'area', pts, color: 'var(--ink-3)', axis: 'y', width: 1.6 }];
  seg.forEach(sg => ser.push({ kind: 'line', pts: sg, color: 'var(--accent)', axis: 'y', width: 3 }));
  Chart.line(el, {
    height: 220, x: { min: 0, max: 360, ticks: [0, 45, 90, 135, 180, 225, 270, 315, 360].map(v => ({ v, l: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'][v / 45] })) }, y: { min: 0, max: yMax, fmt: v => v + '°', title: 'Altitude' },
    series: ser, label: 'Terrain horizon and the path of the ' + (S.ev.kind === 'solar' ? 'Sun' : 'Moon'),
    tooltip: x => { const az = ((Math.round(x) % 360) + 360) % 360; return { title: Math.round(az) + '° ' + U.compass(az), rows: [{ c: 'var(--ink-3)', k: 'Terrain horizon', v: h[az].toFixed(1) + '°' }] }; },
  });
  let verdict = '';
  if (mid && L.eclipse) {
    const azMax = (S.ev.kind === 'solar' ? L.azMax : mid[0]), altMax = (S.ev.kind === 'solar' ? L.altMax : L.altMax);
    const hz = h[Math.round(azMax) % 360], margin = altMax - hz;
    const worst = Math.max(...path.map(p => p[1] - h[Math.round(p[0]) % 360]).map(v => -v));
    if (!L.sunUpAtMax && S.ev.kind === 'solar') verdict = 'The Sun is below the horizon at maximum here.';
    else if (margin > 4) verdict = `Clear. At maximum the ${S.ev.kind === 'solar' ? 'Sun' : 'Moon'} stands ${altMax.toFixed(0)}° high toward ${U.compass(azMax)}; regional relief reaches ${hz.toFixed(1)}° in that direction.`;
    else if (margin > 0) verdict = `Tight. The ${S.ev.kind === 'solar' ? 'Sun' : 'Moon'} clears regional relief by only ${margin.toFixed(1)}° toward ${U.compass(azMax)}. Scout for a higher or more open spot.`;
    else verdict = `Blocked. Regional relief rises to ${hz.toFixed(1)}° toward ${U.compass(azMax)}, above the ${S.ev.kind === 'solar' ? 'Sun' : 'Moon'} at maximum (${altMax.toFixed(0)}°). Move toward that direction’s flatter side or climb.`;
  }
  const vEl = $('#plHorizonV'); if (vEl) vEl.textContent = verdict + ' Relief resolution here: ' + G.TS.resLabel(G.TS.quality(s.lat, s.lon)) + '. Buildings and trees are not included; the Horizon tab shows the full panorama.';
  const lg = $('#plHorizonL'); if (lg) lg.innerHTML = `<span><i style="background:var(--ink-3)"></i>Terrain horizon (regional)</span><span><i style="background:var(--accent)"></i>${S.ev.kind === 'solar' ? 'Sun' : 'Moon'} during the eclipse</span>`;
  // mini map
  const mm = App.views.miniMap;
  if (mm) { mm.resize(); mm.setSite(s); mm.setView(s.lat, s.lon, 70, 'flat'); }
}
function renderUpcoming() {
  const el = $('#plNext'); if (!el) return;
  const now = Date.now(), list = App.D.events.filter(e => e.t >= now - 30 * 86400000 && e.t <= now + 20 * 365.25 * 86400000);
  const rows = [];
  for (const e of list) { const v = App.visSummary(e); if (v.cls === 'no') continue; rows.push([e, v]); if (rows.length >= 14) break; }
  el.innerHTML = rows.length ? `<div class="scrollx"><table class="tbl"><thead><tr><th>Date</th><th>Eclipse</th><th>You would see</th><th class="n">Max (local)</th></tr></thead><tbody>${rows.map(([e, v]) => { const L = v.L; const mx = e.kind === 'solar' ? (L.sunUpAtMax ? L.tMax : (L.tSet || L.tRise)) : e.t; return `<tr class="row-link" data-ev="${e.id}"><td class="nm">${U.date(e.t, 'UTC')}</td><td>${U.icon(e, 16).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-3px;margin-right:6px"')}${U.typeShort(e)} ${e.kind}</td><td><b style="color:${v.cls === 'yes' ? 'var(--good)' : 'var(--warn)'}">${esc(v.b)}</b> <span class="dim">${esc(v.t)}</span></td><td class="n">${mx ? U.hm(mx, S.useUT ? 'UTC' : S.site.tz) : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="note">No eclipse is visible from this site in the next 20 years.</div>';
}
function renderNotes() {
  const el = $('#plNotes'); if (!el) return;
  const key = S.ev.id + '|' + S.site.lat.toFixed(2) + ',' + S.site.lon.toFixed(2);
  const notes = U.store.get('notes', {}), checks = U.store.get('checks', {});
  el.innerHTML = `<textarea class="field" id="plNoteText" placeholder="Parking, viewpoint, who is coming, backup plan…" aria-label="Notes for this site and eclipse">${esc(notes[key] || '')}</textarea>
    <div class="legend-row" style="display:grid;gap:6px">${CHECK.map((c, i) => `<label class="tog"><input type="checkbox" data-chk="${i}" ${checks[S.ev.id + '|' + i] ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
    <div class="row-btns"><button class="btn" id="plCopy">${App.icons.copy}Copy plan as text</button></div>`;
  $('#plNoteText').addEventListener('input', e => { const n = U.store.get('notes', {}); n[key] = e.target.value; U.store.set('notes', n); });
  el.querySelectorAll('[data-chk]').forEach(c => c.addEventListener('change', () => { const ch = U.store.get('checks', {}); ch[S.ev.id + '|' + c.dataset.chk] = c.checked; U.store.set('checks', ch); }));
  $('#plCopy').addEventListener('click', copyPlan);
}
function copyPlan() {
  const ev = S.ev, s = S.site, L = S.loc, tz = App.tz(), lines = [];
  lines.push(`${U.typeLong(ev)} · ${U.dateLong(ev.t, 'UTC')}`, `Site: ${s.name} (${U.coord(s.lat, s.lon)}, ${Math.round(s.elev)} m)`);
  if (L.eclipse) {
    if (ev.kind === 'solar') lines.push(L.kind === 'partial' ? `Result: partial, ${U.pct(L.obscVisible)} of the Sun covered` : `Result: ${L.kind}, ${U.dur(L.duration)} at ${L.altMax.toFixed(0)}° Sun altitude`);
    for (const r of App.contactRows()) lines.push(`${r.label}: ${U.hms(r.t, tz)} ${S.useUT ? 'UT' : U.offsetLabel(r.t, s.tz)}  (${r.moon ? 'Moon' : 'Sun'} ${r.alt.toFixed(0)}°)`);
  } else lines.push('Result: no eclipse visible from here');
  if (S.saved.length) { lines.push('', 'Saved sites:'); for (const sv of S.saved) { const r = siteResult(ev, S.an, sv); lines.push(`- ${sv.name}: ${r.label}${r.max ? ', max ' + U.hms(r.max, sv.tz) + ' local' : ''}`); } }
  const notes = U.store.get('notes', {})[ev.id + '|' + s.lat.toFixed(2) + ',' + s.lon.toFixed(2)]; if (notes) lines.push('', 'Notes: ' + notes);
  lines.push('', 'Safety: view the partial and annular phases only through ISO 12312-2 eclipse glasses or a certified solar filter.');
  App.copy(lines.join('\n'), 'Plan copied');
}

function build() {
  const solar = S.ev.kind === 'solar';
  $('#planBody').innerHTML = `<div class="plan gut" id="planGrid">
    <section class="card wide"><h3>My sites</h3><div class="sub">Compare the places you saved for this eclipse. The current site is highlighted.</div><div id="plSaved"></div></section>
    <section class="card wide"><h3>Find a spot</h3><div class="sub">${solar && S.an.central ? 'Cities inside the path, ranked by what they would see.' : 'Cities that get the best view.'}</div><div id="plSpots"></div></section>
    <section class="card"><h3>Eclipse day itinerary</h3><div class="sub">For your current site.</div><div id="plItin"></div></section>
    <section class="card"><h3>Notes &amp; kit</h3><div class="sub">Saved on this device for this eclipse and site.</div><div id="plNotes"></div></section>
    <section class="card wide"><h3>Terrain around your site</h3><div class="sub">Relief and elevation contours from the topographic grid, with the ${solar ? 'Sun' : 'Moon'}'s path against the regional horizon.</div>
      <div class="plan" style="padding:0;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start"><div class="mini-map" id="miniMapHost"></div><div style="min-width:0"><div id="plHorizon" class="chart-host"></div><div class="legend-row" id="plHorizonL"></div></div></div>
      <div class="note" id="plHorizonV"></div></section>
    <section class="card wide"><h3>Next eclipses from this site</h3><div class="sub">Everything in the next 20 years that you can see at least in part. Click to open one.</div><div id="plNext"></div></section>
        <section class="card wide"><details><summary style="cursor:pointer;font:700 15px/1 var(--f-display);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)">About the data and its limits</summary><div style="display:grid;gap:8px;margin-top:12px;font-size:13px;color:var(--ink-2)">
      <p style="margin:0"><b>Astronomy.</b> Sun, Moon and planet positions come from Astronomy Engine by Don Cross (MIT licence). Shadow geometry, tracks and local circumstances are computed here from Besselian elements. For recent total eclipses, greatest-eclipse position, magnitude, duration and path width match NASA's published figures to about 1%, and contact times agree with an independent solver to a few seconds.</p>
      <p style="margin:0"><b>Earth rotation.</b> Predictions after about 2030 depend on the length of the day, which cannot be forecast exactly. Expect times to drift by several seconds and paths by a few kilometres in the 2040s and later.</p>
      <p style="margin:0"><b>Terrain.</b> Relief and elevations come from a global grid at one-eighth of a degree (about 14 km), built from the public AWS Terrain Tiles (SRTM, GMTED and ETOPO sources). It shows mountain ranges and basins, not the ridge, building or tree line next to you. Always scout the actual horizon.</p>
      <p style="margin:0"><b>Places, borders and stars.</b> Cities and time zones from Natural Earth populated places (via city-timezones, MIT). Coasts and borders from Natural Earth (public domain, via world-atlas). Stars and constellation lines from d3-celestial (BSD-3, Olaf Frohn), based on the Hipparcos catalogue.</p>
      <p style="margin:0"><b>Weather.</b> Clouds decide most eclipse days, and this page has no forecast. Check one for several candidate sites in the final days.</p></div></details></section>
  </div>`;
  // mini map
  const host = $('#miniMapHost');
  const mm = new G.MapView(host, App.D, Ecl); App.views.miniMap = mm; mm.setTheme(App.theme);
  mm.setLayers({ grid: false, tint: false, daynight: false, labels: false, shadow: false, cities: true, contours: true, bandAlpha: 0.2 });
  mm.on('pick', p => { const site = Calc.siteAt(p.lat, p.lon); App.setSite(site); });
  mm.setEvent(S.ev, S.an, null, null); mm.setSite(S.site);
}
function renderAll() {
  if (!S.ev) return;
  if (!$('#planGrid') || $('#planGrid').dataset.ev !== S.ev.kind) { build(); $('#planGrid').dataset.ev = S.ev.kind; }
  else if (App.views.miniMap) { App.views.miniMap.setEvent(S.ev, S.an, null, null); }
  const t0 = performance.now();
  renderSaved(); renderSpots(); renderItinerary(); renderNotes(); renderUpcoming(); renderTerrain();
  dirty = false;
}
App.renderPlan = renderAll;
App.initFns.push(function () {
  const mark = () => { dirty = true; if (S.tab === 'plan') renderAll(); };
  App.on('event', mark); App.on('site', mark); App.on('saved', mark); App.on('tzmode', mark); App.on('theme', t => { if (App.views.miniMap) App.views.miniMap.setTheme(t); if (S.tab === 'plan') renderTerrain(); });
  App.on('tab', t => { if (t === 'plan') { if (dirty) renderAll(); else if (App.views.miniMap) App.views.miniMap.resize(); } });
  App.on('layout', () => { dirty = true; if (S.tab === 'plan') renderAll(); });
  App.on('terrain', () => { horizonCache.clear(); if (S.tab === 'plan') renderTerrain(); else dirty = true; });
  document.addEventListener('click', e => {
    if (!e.target.closest('#panePlan')) return;
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); S.saved = S.saved.filter(x => x.id !== del.dataset.del); U.store.set('saved', S.saved); renderSaved(); return; }
    const srt = e.target.closest('[data-sort]'); if (srt) { S.spotSort = srt.dataset.sort; renderSpots(); return; }
    const tr = e.target.closest('tr[data-site]'); if (tr) { const [la, lo] = tr.dataset.site.split(',').map(Number); const f = S.saved.find(x => Math.abs(x.lat - la) < 1e-6 && Math.abs(x.lon - lo) < 1e-6); const c = Calc.cities.find(x => Math.abs(x.lat - la) < 1e-6 && Math.abs(x.lon - lo) < 1e-6); const site = f ? f : (c ? { name: c.name + ', ' + c.country, lat: c.lat, lon: c.lon, elev: Math.max(0, Calc.elevation(c.lat, c.lon)), tz: c.tz } : Calc.siteAt(la, lo)); App.setSite(site); App.toast('Site set: ' + site.name); return; }
    const er = e.target.closest('tr[data-ev]'); if (er) { App.selectEvent(App.D.byId.get(er.dataset.ev)); }
  });
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
