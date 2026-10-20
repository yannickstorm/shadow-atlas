/* Horizon pane: PeakFinder-style panorama, high-resolution topo map and the vantage-point finder. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, Calc = G.Calc, TS = G.TS, esc = G.esc, $ = App.$, $$ = App.$$;
const D2R = Math.PI / 180;
const refr = h => h < -1.5 ? h : h + (1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R)) / 60;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const H = { radius: 30, prio: 'balanced', inside: true, results: [], busy: false, eye: 2 };
App.horizon = H;

function bodyAtMax(lat, lon, elev) {
  // apparent altitude/azimuth of the Sun (or Moon) at the moment of maximum for this place, plus contact positions
  const ev = S.ev, an = S.an;
  if (ev.kind === 'solar') {
    const L = Ecl.local(an, lat, lon, elev);
    if (!L.eclipse || !L.visible) return { L, ok: false };
    const pos = [];
    for (const k of ['c2', 'max', 'c3']) { const c = L.contacts[k]; if (c) pos.push({ alt: refr(c.alt), az: c.az }); }
    if (!pos.length) { const c = L.contacts.max; pos.push({ alt: refr(c.alt), az: c.az }); }
    return { L, ok: L.sunUpAtMax, pos, dur: L.kind !== 'partial' ? L.duration : 0, obsc: L.obsc };
  }
  const obs = new G.Astronomy.Observer(lat, lon, elev), tt = Ecl.mkTime(an.tGreatest), eq = G.Astronomy.Equator('Moon', tt, obs, true, true), h = G.Astronomy.Horizon(tt, obs, eq.ra, eq.dec, 'normal');
  return { ok: h.altitude > -1, pos: [{ alt: h.altitude, az: h.azimuth }], dur: 0, obsc: an.umbralMag };
}
function marginAt(lat, lon, h0, pos, rayLen) {
  let worst = 99, blocker = null;
  for (const p of pos) {
    const r = G.PanoView.ray(lat, lon, h0, p.az, rayLen, p.alt + 3);
    const m = p.alt - r.ang;
    if (m < worst) { worst = m; blocker = r; }
  }
  return { margin: worst, blocker };
}
function describePlace(lat, lon) {
  const n = Calc.nearestCity(lat, lon, 5000);
  if (!n || n.km > 60) return U.coord(lat, lon);
  if (n.km < 2) return n.city.name;
  const brg = U.bearing(n.city.lat, n.city.lon, lat, lon);
  return Math.round(n.km) + ' km ' + U.compass(brg) + ' of ' + n.city.name;
}

App.initFns.push(function () {
  const pane = $('#paneHorizon');
  pane.innerHTML = `
  <div class="hz">
    <div class="hz-top" id="panoHost">
      <div class="ovl o-tl" id="hzTL">
        <button class="btn glass sm" id="hzFace" title="Turn toward the eclipse">${App.icons.sun}<span id="hzFaceLbl">Face the Sun</span></button>
        <button class="mini-btn" id="hzIn" aria-label="Zoom in">${App.icons.plus}</button>
        <button class="mini-btn" id="hzOut" aria-label="Zoom out">${App.icons.minus}</button>
        <div class="seg glass" role="group" aria-label="Vertical scale"><button data-vx="1" aria-pressed="true">True scale</button><button data-vx="2" aria-pressed="false">Stretch ×2</button></div>
        <label class="glass hz-eye">Eye <select id="hzEye" aria-label="Eye height above ground"><option value="2">2 m</option><option value="10">10 m</option><option value="30">30 m</option><option value="100">100 m</option></select></label>
      </div>
      <div class="ovl o-tr"><div class="glass hz-verdict keep" id="hzVerdict"></div></div>
      <div class="glass hz-pick" id="hzPick" hidden></div>
      <div class="hz-loading" id="hzLoading" hidden>Loading terrain…</div>
    </div>
    <div class="hz-bottom">
      <div class="hz-mapwrap"><div class="map-wrap" id="hzMapHost"></div>
        <div class="ovl o-tl hz-maptools"><div class="seg glass" role="group" aria-label="Map style"><button data-style="streets" aria-pressed="true">Streets</button><button data-style="terrain" aria-pressed="false">Terrain</button></div>
          <button class="mini-btn" id="hzZin" aria-label="Zoom in">${App.icons.plus}</button><button class="mini-btn" id="hzZout" aria-label="Zoom out">${App.icons.minus}</button></div>
        <div class="ovl o-bl"><div class="glass legend" id="hzLegend"></div></div></div>
      <div class="hz-side" id="hzSide"></div>
    </div>
    <div class="timebar" id="tbHz"></div>
  </div>`;
  const pano = new G.PanoView($('#panoHost')); App.views.pano = pano; pano.setTheme(App.theme);
  const map = new G.MapView($('#hzMapHost'), App.D, Ecl); App.views.hzMap = map; map.setTheme(App.theme);
  map.setMode('flat'); map.setLayers({ grid: false, tint: false, daynight: false, labels: false, shadow: false, cities: true, contours: true, bandAlpha: 0.18, style: U.store.get('mapStyle', 'streets') });
  const tb = new App.TimeBar($('#tbHz'), 'sky'); App.views.tbHz = tb;

  /* ---- panorama controls ---- */
  $('#hzIn').addEventListener('click', () => pano.zoom(pano.opts.fov / 1.5));
  $('#hzOut').addEventListener('click', () => pano.zoom(pano.opts.fov * 1.5));
  $('#hzTL').addEventListener('click', e => { const b = e.target.closest('[data-vx]'); if (b) { pano.setOpts({ vx: +b.dataset.vx }); $$('[data-vx]').forEach(x => x.setAttribute('aria-pressed', x === b)); } });
  $('#hzEye').addEventListener('change', e => { H.eye = +e.target.value; pano.setOpts({ eye: H.eye }); verdict(); });
  $('#hzFace').addEventListener('click', face);
  function face() {
    const p = pano._sunPath(); if (!p) return;
    const mx = p.marks.find(m => m.n === 'MAX') || p.pts[Math.floor(p.pts.length / 2)];
    const vspan = pano.ch / (pano.ppd * pano.opts.vx);
    pano.opts.az0 = mx.az;
    pano.opts.altC = mx.alt < vspan * 0.8 ? Math.max(vspan * 0.3, mx.alt * 0.55) : vspan * 0.32;
    pano.request();
  }
  pano.on('avoid', () => {
    const v = $('#hzVerdict'); if (!v || !v.offsetParent) return [];
    const r = v.getBoundingClientRect(), c = pano.cv.getBoundingClientRect();
    return [{ x0: r.left - c.left, x1: r.right - c.left, y0: r.top - c.top, y1: r.bottom - c.top }];
  });
  pano.on('pick', info => {
    const box = $('#hzPick');
    if (!info) { box.hidden = true; return; }
    box.hidden = false;
    box.style.left = Math.min(info.x + 12, pano.cw - 230) + 'px'; box.style.top = Math.max(8, info.y - 70) + 'px';
    box.innerHTML = `<div class="hc-t">${(info.d / 1000).toFixed(1)} km toward ${Math.round(info.az)}° ${U.compass(info.az)}</div><div class="hc-v">${Math.round(info.elev).toLocaleString('en-GB')} m · ${esc(describePlace(info.lat, info.lon))}</div><div class="row-btns" style="margin-top:6px"><button class="btn sm primary" id="hzStand">Stand here</button><button class="btn sm" id="hzPickClose">Close</button></div>`;
    $('#hzStand').onclick = () => { box.hidden = true; const s = Calc.siteAt(info.lat, info.lon); App.setSite(s); App.toast('Site moved to the ' + Math.round(info.elev) + ' m point ' + (info.d / 1000).toFixed(1) + ' km away'); };
    $('#hzPickClose').onclick = () => { box.hidden = true; };
  });

  /* ---- verdict ---- */
  function verdict() {
    const el = $('#hzVerdict'); if (!S.ev || !S.site) return;
    const a = pano.analyze(), q = TS.quality(S.site.lat, S.site.lon);
    const B = G.BLD, bs = B ? B.stats() : null;
    const bline = !G.LIVE ? 'Buildings: on the online version only (claude.ai blocks the map service).'
      : B.state === 'loading' ? (B.focusDone ? `Buildings toward the ${S.ev && S.ev.kind === 'lunar' ? 'Moon' : 'Sun'} loaded (${bs.n.toLocaleString('en-GB')}). Loading the rest of the circle…` : `Loading buildings toward the ${S.ev && S.ev.kind === 'lunar' ? 'Moon' : 'Sun'} first… ${bs.n ? bs.n.toLocaleString('en-GB') + ' so far.' : ''}`)
      : B.state === 'error' ? 'Buildings could not be loaded: OpenStreetMap (Overpass) did not answer. Try again later.'
      : B.state === 'ready' ? (bs.n ? `Buildings within ${B.radius} m: ${bs.n.toLocaleString('en-GB')} from OpenStreetMap, ${bs.measured ? bs.measured.toLocaleString('en-GB') + ' with a recorded height, ' : ''}${bs.est.toLocaleString('en-GB')} estimated from their type. Trees are not included.` : `No buildings mapped within ${B.radius} m.`) : '';
    const qual = `<div class="hz-q">Terrain detail here: ${TS.resLabel(q)}${q === 'coarse' ? ' (no detailed terrain for this area)' : ''}</div>${bline ? `<div class="hz-q">${esc(bline)}</div>` : ''}`;
    if (!a || !a.atMax) { el.innerHTML = `<div class="hc-t">HORIZON CHECK</div><div class="hc-v">No eclipse visible from this site</div>${qual}`; return; }
    const m = a.atMax, body = a.body, tz = App.tz();
    let head, cls;
    if (m.alt < -0.6 && m.sky.ang < 0.5) { head = `${body} below the horizon at maximum`; cls = 'bad'; }
    else if (m.margin > 2) { head = `Clear: ${body} ${m.margin.toFixed(1)}° above the ${m.sky.bld ? 'buildings' : 'terrain'}`; cls = 'good'; }
    else if (m.margin > 0.3) { head = `Tight: only ${m.margin.toFixed(1)}° of clearance`; cls = 'warn'; }
    else { head = `Blocked: ${m.sky.bld ? 'a building hides' : 'terrain hides'} the ${body.toLowerCase()} at maximum`; cls = 'bad'; }
    const ridge = !(m.sky.d > 0) ? '' : m.sky.bld ? `${G.BLD.label(m.sky.bld)}, ${Math.round(m.sky.d)} m away toward ${Math.round(m.az)}° ${U.compass(m.az)}, rises to ${m.sky.ang.toFixed(1)}° above your eye.` : m.sky.h < 30 && m.sky.ang < 0.3 ? `Open, flat horizon toward ${Math.round(m.az)}° ${U.compass(m.az)} (sea or plain).` : `Terrain toward ${Math.round(m.az)}° ${U.compass(m.az)} tops out at ${m.sky.ang.toFixed(1)}°, a ${Math.round(m.sky.h).toLocaleString('en-GB')} m ridge ${(m.sky.d / 1000).toFixed(1)} km away.`;
    const segs = a.segs.length ? a.segs.map(s => U.hm(s.a, tz) + '–' + U.hm(s.b, tz)).join(', ') : 'never';
    const keyVis = a.marks.filter(k => k.n !== 'MAX').map(k => `<span class="${k.vis ? 'ok' : 'no'}">${k.n}</span>`).join('');
    el.innerHTML = `<div class="hc-t">HORIZON CHECK · ${esc(S.site.name.split(',')[0])}</div><div class="hc-v ${cls}">${esc(head)}</div>
      <div class="hc-r"><span>${body} at maximum</span><b>${m.alt.toFixed(1)}° · ${Math.round(m.az)}° ${U.compass(m.az)}</b></div>
      <div class="hz-small">${esc(ridge)}</div>
      <div class="hc-r"><span>${body} in view</span><b>${esc(segs)}</b></div>
      <div class="hz-contacts">${keyVis}</div>${qual}`;
    pano.request();
  }
  App.horizonVerdict = verdict;

  /* ---- spot finder ---- */
  function side() {
    const ev = S.ev; if (!ev) return;
    const central = ev.kind === 'solar' && S.an && S.an.central;
    const prios = [['balanced', 'Balanced'], ['clear', 'Clear view'], ['long', central ? 'Longest' : 'Biggest'], ['near', 'Nearby']];
    $('#hzSide').innerHTML = `<h3>Find a vantage point</h3>
      <div class="sub">Scans the terrain around your site for places where the ${ev.kind === 'solar' ? 'Sun' : 'Moon'} stays clear of mountains during ${ev.kind === 'solar' ? (central ? 'totality' : 'the maximum') : 'the maximum'}.</div>
      <label class="hz-row"><span>Search radius</span><input type="range" id="hzR" min="5" max="100" step="5" value="${H.radius}" class="rng"><b class="mono" id="hzRv">${H.radius} km</b></label>
      <div class="seg" role="group" aria-label="Priority">${prios.map(p => `<button data-prio="${p[0]}" aria-pressed="${H.prio === p[0]}">${p[1]}</button>`).join('')}</div>
      ${central ? `<label class="tog"><input type="checkbox" id="hzInside" ${H.inside ? 'checked' : ''}> Stay inside the path of ${ev.type === 'A' ? 'annularity' : 'totality'}</label>` : ''}
      <div class="row-btns"><button class="btn primary" id="hzGo">${App.icons.search}Find spots</button><span class="dimmer" id="hzProg"></span></div>
      <div id="hzResults">${resultsHtml()}</div>`;
    $('#hzR').addEventListener('input', e => { H.radius = +e.target.value; $('#hzRv').textContent = H.radius + ' km'; });
    $('#hzSide').querySelectorAll('[data-prio]').forEach(b => b.addEventListener('click', () => { H.prio = b.dataset.prio; $$('[data-prio]').forEach(x => x.setAttribute('aria-pressed', x === b)); if (H.cands) { rank(); renderResults(); } }));
    const ins = $('#hzInside'); if (ins) ins.addEventListener('change', e => { H.inside = e.target.checked; if (H.cands) { rank(); renderResults(); paintOverlay(); } });
    $('#hzGo').addEventListener('click', search);
  }
  function resultsHtml() {
    if (!H.results.length) return H.searched ? '<div class="note">No spot in this radius keeps the view clear. Try a larger radius or turn off "Stay inside the path".</div>' : '<div class="note">Uses the terrain grid around your site. On the map, green means clear, amber means low clearance, red means the terrain blocks the view.</div>';
    const solar = S.ev.kind === 'solar';
    return `<div class="scrollx"><table class="tbl hz-tbl"><thead><tr><th>#</th><th>Place</th><th class="n">${solar ? 'Totality' : 'Moon alt'}</th><th class="n">Clear</th><th class="n">Elev.</th><th class="n">Away</th></tr></thead><tbody>${H.results.map((r, i) => `<tr class="row-link" data-spot="${i}"><td><b>${i + 1}</b></td><td class="nm">${esc(r.name)}</td><td class="n">${solar ? (r.dur ? U.dur(r.dur) : U.pct(r.obsc)) : r.alt.toFixed(0) + '°'}</td><td class="n" style="color:${r.margin > 2 ? 'var(--good)' : 'var(--warn)'}">+${r.margin.toFixed(1)}°</td><td class="n">${Math.round(r.elev)} m</td><td class="n">${r.dist.toFixed(0)} km</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderResults() {
    $('#hzResults').innerHTML = resultsHtml();
    map.setMarkers(H.results.map((r, i) => ({ lat: r.lat, lon: r.lon, label: i + 1, color: r.margin > 2 ? '#4cc790' : '#f0a93e' })));
  }
  $('#hzSide').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-spot]'); if (!tr) return;
    const r = H.results[+tr.dataset.spot]; const s = Calc.siteAt(r.lat, r.lon); s.name = r.name; s.elev = Math.max(0, Math.round(r.elev));
    App.setSite(s, { keepSearch: true }); App.toast('Site set: ' + r.name);
  });
  async function search() {
    if (H.busy || !S.ev) return;
    H.busy = true; H.searched = true; const prog = $('#hzProg'); prog.textContent = 'Loading terrain…';
    const c0 = { lat: S.site.lat, lon: S.site.lon }, R = H.radius;
    const probe = bodyAtMax(c0.lat, c0.lon, S.site.elev || 0);
    const alt0 = probe.pos ? Math.max(0.5, probe.pos[0].alt) : 10;
    await TS.ensureAround(c0.lat, c0.lon, R + 10);
    const rayLen = clamp((Math.max(TS.hmax || 3000, 1500)) / Math.tan(alt0 * D2R), 6000, 160000);
    await TS.ensureAround(c0.lat, c0.lon, R + rayLen / 1000);
    const sp = Math.max(0.5, R / 24), cands = [], kmLat = 111.2, kmLon = 111.2 * Math.cos(c0.lat * D2R);
    for (let dy = -R; dy <= R; dy += sp) for (let dx = -R; dx <= R; dx += sp) if (dx * dx + dy * dy <= R * R) cands.push({ lat: c0.lat + dy / kmLat, lon: c0.lon + dx / kmLon, dist: Math.hypot(dx, dy) });
    let i = 0; const t0 = performance.now();
    await new Promise(res => {
      const step = () => {
        const ts = performance.now();
        while (i < cands.length && performance.now() - ts < 14) {
          const c = cands[i++]; c.elev = Math.max(0, TS.at(c.lat, c.lon));
          const b = bodyAtMax(c.lat, c.lon, c.elev);
          c.ok = b.ok; c.dur = b.dur || 0; c.obsc = b.obsc || 0; c.alt = b.pos ? b.pos[0].alt : -90;
          if (b.ok) { const mm = marginAt(c.lat, c.lon, c.elev + H.eye, b.pos, rayLen); c.margin = mm.margin; c.blocker = mm.blocker; } else c.margin = -99;
        }
        prog.textContent = `Checking ${Math.min(i, cands.length)} of ${cands.length} spots…`;
        if (i < cands.length) setTimeout(step, 0); else res();
      };
      step();
    });
    H.cands = cands; H.box = { lat0: c0.lat - R / kmLat, lat1: c0.lat + R / kmLat, lon0: c0.lon - R / kmLon, lon1: c0.lon + R / kmLon, sp, R, c0 };
    rank(); renderResults(); paintOverlay();
    const clear = cands.filter(c => c.margin > 0.3).length;
    prog.textContent = `${cands.length} spots checked in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${Math.round(clear / cands.length * 100)}% have a clear view`;
    map.setView(c0.lat, c0.lon, zoomFor(R), 'flat');
    H.busy = false;
  }
  function rank() {
    const cs = H.cands; if (!cs) return;
    const central = S.ev.kind === 'solar' && S.an.central;
    const maxDur = Math.max(1, ...cs.map(c => c.dur)), maxOb = Math.max(1e-6, ...cs.map(c => c.obsc));
    const w = { balanced: [0.5, 0.3, 0.2], clear: [0.2, 0.65, 0.15], long: [0.85, 0.15, 0], near: [0.3, 0.15, 0.55] }[H.prio];
    const R = H.box.R;
    const ok = cs.filter(c => c.ok && c.margin > 0.3 && (!central || !H.inside || c.dur > 0));
    for (const c of ok) {
      const q = central ? c.dur / maxDur : S.ev.kind === 'solar' ? c.obsc / maxOb : clamp(c.alt / 40, 0, 1);
      c.score = w[0] * q + w[1] * clamp(c.margin / 6, 0, 1) + w[2] * (1 - c.dist / R);
    }
    ok.sort((a, b) => b.score - a.score);
    const picked = [], minSep = Math.max(1.5, R / 6);
    for (const c of ok) { if (picked.length >= 8) break; if (picked.some(p => Ecl.geoDist(p.lat, p.lon, c.lat, c.lon) < minSep)) continue; picked.push(c); }
    H.results = picked.map(c => Object.assign({}, c, { name: describePlace(c.lat, c.lon) }));
  }
  function paintOverlay() {
    const cs = H.cands, B = H.box; if (!cs) return;
    const n = Math.round(2 * B.R / B.sp) + 1, cv = document.createElement('canvas'); cv.width = n; cv.height = n;
    const cx = cv.getContext('2d'), img = cx.createImageData(n, n), d = img.data;
    const central = S.ev.kind === 'solar' && S.an.central, kmLat = 111.2, kmLon = 111.2 * Math.cos(B.c0.lat * D2R);
    for (const c of cs) {
      const gx = Math.round(((c.lon - B.c0.lon) * kmLon + B.R) / B.sp), gy = Math.round((B.R - (c.lat - B.c0.lat) * kmLat) / B.sp);
      if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
      const o = (gy * n + gx) * 4;
      let col;
      if (!c.ok) col = [120, 120, 130, 120];
      else if (central && H.inside && c.dur <= 0) col = [120, 120, 130, 90];
      else if (c.margin > 2) col = [60, 200, 120, 200];
      else if (c.margin > 0.3) col = [240, 170, 60, 210];
      else col = [230, 70, 60, 210];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = col[3];
    }
    cx.putImageData(img, 0, 0);
    map.setOverlay({ lat0: B.lat0 - B.sp / kmLat / 2, lat1: B.lat1 + B.sp / kmLat / 2, lon0: B.lon0 - B.sp / kmLon / 2, lon1: B.lon1 + B.sp / kmLon / 2, canvas: cv, alpha: 0.5 });
    $('#hzLegend').innerHTML = `<div><i style="background:rgba(60,200,120,.8)"></i>Clear by more than 2°</div><div><i style="background:rgba(240,170,60,.85)"></i>Low clearance</div><div><i style="background:rgba(230,70,60,.85)"></i>Terrain blocks the view</div>${central && H.inside ? '<div><i style="background:rgba(120,120,130,.6)"></i>Outside the path</div>' : ''}`;
  }
  $('.hz-maptools').addEventListener('click', e => { const b = e.target.closest('[data-style]'); if (b) App.setMapStyle(b.dataset.style); });
  $('.hz-maptools [data-style="' + map.layers.style + '"]').setAttribute('aria-pressed', 'true'); $('.hz-maptools [data-style="' + (map.layers.style === 'streets' ? 'terrain' : 'streets') + '"]').setAttribute('aria-pressed', 'false');
  $('#hzZin').addEventListener('click', () => map.setZoom(map.zoom * 1.6)); $('#hzZout').addEventListener('click', () => map.setZoom(map.zoom / 1.6));
  const zoomFor = km => { const deg = km * 2.6 / 111; return clamp(map.ch / deg / Math.max(map.cw / 360, map.ch / 180), 2, 320); };
  $('#hzLegend').innerHTML = '<div>Click the map to move your site. Press <b>Find spots</b> to see where the view is clear.</div>';
  map.on('pick', p => { const s = Calc.siteAt(p.lat, p.lon); App.setSite(s, { keepSearch: true }); });
  map.on('terrain', () => { pano.invalidate(); });

  /* ---- data loading and wiring ---- */
  let loadTok = 0;
  function loadAround(site) {
    const tok = ++loadTok, ld = $('#hzLoading'); ld.hidden = false;
    if (G.BLD && G.LIVE) {
      // the directions the Sun or Moon takes during the eclipse are loaded first
      let focus = null;
      try {
        const a = pano.analyze(), azs = a ? a.marks.map(k => k.az).concat(a.atMax ? [a.atMax.az] : []).map(v => ((v % 360) + 360) % 360).sort((x, y) => x - y) : [];
        if (azs.length) {
          let gi = azs.length - 1, gap = azs[0] + 360 - azs[azs.length - 1];
          for (let i = 0; i < azs.length - 1; i++) if (azs[i + 1] - azs[i] > gap) { gap = azs[i + 1] - azs[i]; gi = i; }
          const az0 = azs[(gi + 1) % azs.length]; let az1 = azs[gi]; if (az1 < az0) az1 += 360;
          focus = { az0, az1 };
        }
      } catch (e) { focus = null; }
      let last = 0;
      const update = () => {
        if (tok !== loadTok) return;
        const now = Date.now(); if (now - last < 250 && G.BLD.state === 'loading') return; last = now;      // redraw at most four times a second
        pano.invalidate(); verdict(); map.request(); App.views.map && App.views.map.request();
      };
      G.BLD.load(site, focus, update).then(() => { last = 0; update(); });
      setTimeout(verdict, 0);
    }
    TS.ensureAround(site.lat, site.lon, 30).then(() => {
      if (tok !== loadTok) return; pano.invalidate(); verdict();
      return TS.ensureAround(site.lat, site.lon, 240);
    }).then(() => { if (tok !== loadTok) return; ld.hidden = true; pano.invalidate(); verdict(); App.emit('terrain'); });
  }
  App.on('event', ev => {
    pano.setEvent(ev, S.an); map.setEvent(ev, S.an, null, null); tb.refresh(); H.cands = null; H.results = []; H.searched = false; map.setOverlay(null); map.setMarkers([]);
    $('#hzFaceLbl').textContent = ev.kind === 'lunar' ? 'Face the Moon' : 'Face the Sun';
    side(); if (S.tab === 'horizon') { face(); verdict(); }
  });
  App.on('site', site => {
    pano.setSite(site); map.setSite(site); tb.refresh();
    if (S.tab === 'horizon') { loadAround(site); map.setView(site.lat, site.lon, Math.max(map.zoom, zoomFor(H.radius)), 'flat'); setTimeout(() => { face(); verdict(); }, 0); }
    else H.needLoad = true;
  });
  App.on('time', t => { pano.setTime(t); map.setTime(t); if (S.tab === 'horizon') tb.update(); });
  App.on('theme', t => { pano.setTheme(t); map.setTheme(t); });
  App.on('tzmode', () => { tb.update(); verdict(); pano.request(); });
  App.on('tab', t => {
    if (t !== 'horizon') return;
    pano.resize(); map.resize(); tb.refresh();
    if (!H.inited || H.needLoad) { H.inited = true; H.needLoad = false; loadAround(S.site); map.setView(S.site.lat, S.site.lon, zoomFor(H.radius), 'flat'); }
    face(); verdict(); side();
  });
  if (S.site) { pano.setSite(S.site); map.setSite(S.site); }
  if (S.time) map.setTime(S.time);
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
