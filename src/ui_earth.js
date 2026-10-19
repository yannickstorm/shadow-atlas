/* Earth pane: topographic globe / map with the eclipse overlays. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, Calc = G.Calc, esc = G.esc, $ = App.$, $$ = App.$$;
const D2R = Math.PI / 180;

App.initFns.push(function () {
  const pane = $('#paneEarth');
  pane.innerHTML = `
    <div class="map-wrap" id="mapHost">
      <div class="ovl o-tl" id="mapTL">
        <div class="seg glass" role="group" aria-label="Projection"><button data-mode="globe" aria-pressed="true">Globe</button><button data-mode="flat" aria-pressed="false">Map</button></div>
        <button class="mini-btn" id="mZoomIn" aria-label="Zoom in">${App.icons.plus}</button>
        <button class="mini-btn" id="mZoomOut" aria-label="Zoom out">${App.icons.minus}</button>
        <button class="mini-btn" id="mFit" aria-label="Fit the eclipse" title="Fit the eclipse">${App.icons.fit}</button>
        <button class="mini-btn" id="mSite" aria-label="Centre on your site" title="Centre on your site">${App.icons.pin}</button>
        <div style="position:relative"><button class="mini-btn" id="mLayers" aria-label="Layers" aria-expanded="false" title="Layers">${App.icons.layers}</button>
          <div class="menu glass" id="mMenu" hidden></div></div>
      </div>
      <div class="ovl o-tr"><div class="glass hover-card" id="mapHover"></div></div>
      <div class="ovl o-bl"><div class="glass legend" id="mapLegend"></div></div>
    </div>
    <div class="timebar" id="tbEarth"></div>`;
  const host = $('#mapHost');
  const map = new G.MapView(host, App.D, Ecl); App.views.map = map;
  map.setTheme(App.theme);
  const tb = new App.TimeBar($('#tbEarth'), 'earth'); App.views.tbEarth = tb;

  /* layers menu */
  const LAYERS = [['relief', 'Relief shading'], ['borders', 'Coast & borders'], ['grid', 'Graticule'], ['cities', 'Cities'], ['contours', 'Elevation contours'], ['tint', 'Partial-eclipse zones'], ['daynight', 'Day / night'], ['labels', 'Country names'], ['bodyArrow', 'Sun / Moon direction']];
  const menu = $('#mMenu');
  const style0 = U.store.get('mapStyle', 'streets');
  map.setLayers({ style: style0 });
  menu.innerHTML = `<div class="menu-h">Map style</div><div class="seg" role="group" aria-label="Map style" id="mStyle"><button data-style="streets" aria-pressed="${style0 === 'streets'}">Streets</button><button data-style="terrain" aria-pressed="${style0 === 'terrain'}">Terrain</button></div>`
    + LAYERS.map(l => `<label class="tog"><input type="checkbox" data-layer="${l[0]}" checked> ${l[1]}</label>`).join('');
  menu.addEventListener('change', e => { const k = e.target.dataset.layer; if (k) map.setLayers({ [k]: e.target.checked }); });
  menu.addEventListener('click', e => { const b = e.target.closest('[data-style]'); if (b) App.setMapStyle(b.dataset.style); });
  App.setMapStyle = st => {
    U.store.set('mapStyle', st);
    for (const v of [App.views.map, App.views.hzMap]) if (v) { v.setLayers({ style: st }); if (st !== 'streets' && v.mode === 'flat' && v.zoom > 320) v.setZoom(320); }
    $$('[data-style]').forEach(x => x.setAttribute('aria-pressed', x.dataset.style === st));
  };
  $('#mLayers').addEventListener('click', () => { menu.hidden = !menu.hidden; $('#mLayers').setAttribute('aria-expanded', !menu.hidden); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#mMenu') && !e.target.closest('#mLayers')) { menu.hidden = true; } });

  $('#mapTL').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (b) { map.setMode(b.dataset.mode); $$('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b)); setTimeout(fit, 0); }
  });
  $('#mZoomIn').addEventListener('click', () => map.setZoom(map.zoom * 1.6));
  $('#mZoomOut').addEventListener('click', () => map.setZoom(map.zoom / 1.6));
  $('#mFit').addEventListener('click', fit);
  $('#mSite').addEventListener('click', () => focus(S.site));

  function focus(site, zoom) {
    if (!site) return;
    const streets = map.layers.style === 'streets' && G.ST && G.ST.hasData();
    if (zoom && streets) { map.setView(site.lat, site.lon, zoom, 'flat'); $$('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === 'flat')); return; }
    if (map.mode === 'globe') map.setView(site.lat, site.lon, Math.max(map.zoom, 2.6));
    else map.setView(site.lat, site.lon, Math.max(map.zoom, streets && G.ST.coverage(site.lat, site.lon) ? 220 : 9));
  }
  function fit() {
    const an = S.an, ev = S.ev; if (!an) return;
    if (ev.kind === 'solar' && an.path && an.path.t.length) {
      const pts = []; for (let i = 0; i < an.path.t.length; i += 12) pts.push([an.path.lat[i], an.path.lon[i]]); pts.push([an.lat, an.lon]);
      map.fitPoints(pts, 1);
    } else if (ev.kind === 'solar') {
      map.setView(an.lat !== undefined ? an.lat : 0, an.lon !== undefined ? an.lon : 0, map.mode === 'globe' ? 1.1 : 1.6);
    } else {
      const p = Ecl.subPoint('Moon', an.tGreatest); map.setView(p.lat * 0.6, p.lon, map.mode === 'globe' ? 1.05 : 1.2);
    }
  }
  App.fitEarth = fit; App.focusMap = focus;

  /* legend */
  function legend() {
    const ev = S.ev; if (!ev) return;
    const c = U.color(ev);
    $('#mapLegend').innerHTML = ev.kind === 'solar'
      ? `<div><i style="background:${c}"></i>${ev.type === 'A' ? 'Path of annularity' : ev.type === 'H' ? 'Path of totality / annularity' : ev.type === 'P' ? 'Partial only (no central path)' : 'Path of totality'}</div><div><i class="dash"></i>Centre line · UT ticks</div><div><i style="background:rgba(150,110,255,.5)"></i>Partial eclipse visible (lines 0 · .25 · .5 · .75 magnitude)</div>`
      : `<div><i style="background:rgba(255,120,90,.7)"></i>Whole eclipse visible</div><div><i style="background:rgba(255,190,120,.7)"></i>Moon rises during the eclipse</div><div><i style="background:rgba(190,150,255,.7)"></i>Moon sets during the eclipse</div><div><i class="dash"></i>Moon on the horizon right now</div>`;
  }

  /* hover card */
  let hoverReq = null, hoverInfo = null;
  const hc = $('#mapHover');
  const idle = () => { hc.innerHTML = `<div class="hc-t">EXPLORE</div><div class="hc-v">Click the map to set your site</div><div class="hc-r">Drag to rotate · scroll to zoom</div>`; };
  idle();
  map.on('hover', info => { hoverInfo = info; if (!hoverReq) hoverReq = requestAnimationFrame(updateHover); });
  function updateHover() {
    hoverReq = null; const info = hoverInfo;
    if (!info || !S.ev) { map.setHover(null); idle(); return; }
    map.setHover(info);
    const lat = info.lat, lon = info.lon, el = Calc.elevation(lat, lon), place = Calc.nearestCity(lat, lon, 20000);
    let rows = [], head = '';
    const near = place && place.km < 90 ? ' · near ' + place.city.name : '';
    if (S.ev.kind === 'solar') {
      const L = Ecl.local(S.an, lat, lon, Math.max(0, el));
      if (!L.eclipse) { head = 'No eclipse here'; rows = [['Elevation', el + ' m']]; }
      else if (!L.visible) { head = 'Sun below the horizon'; rows = [['Elevation', el + ' m']]; }
      else {
        head = L.kind === 'total' ? 'Total · ' + U.dur(L.duration) : L.kind === 'annular' ? 'Annular · ' + U.dur(L.duration) : 'Partial · ' + U.pct(L.obscVisible);
        rows = [['Maximum', U.hm(L.sunUpAtMax ? L.tMax : (L.tSet || L.tRise || L.tMax), 'UTC') + ' UT'], ['Magnitude', L.magVisible.toFixed(3)], ['Sun altitude', L.sunUpAtMax ? L.altMax.toFixed(0) + '°' : 'rise / set'], ['Elevation', el + ' m']];
      }
    } else {
      const L = Calc.lunarLocal(S.an, lat, lon, Math.max(0, el));
      head = !L.visible ? (L.altMax > 0 ? 'Eclipse in daylight here' : 'Moon below the horizon') : L.whole ? 'Whole eclipse visible' : 'Partly visible: ' + L.partLabel;
      rows = [['Moon altitude at max', L.altMax.toFixed(0) + '°'], ['Elevation', el + ' m']];
    }
    hc.innerHTML = `<div class="hc-t">${esc(U.coord(lat, lon))}${esc(near)}</div><div class="hc-v">${esc(head)}</div>${rows.map(r => `<div class="hc-r"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')}`;
  }
  map.on('pick', p => { const site = Calc.siteAt(p.lat, p.lon); App.setSite(site); App.toast('Site set: ' + site.name); });

  let lastKind = null;
  App.on('event', ev => {
    if (lastKind !== ev.kind) { map.setMode(ev.kind === 'lunar' ? 'flat' : 'globe'); $$('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === map.mode)); lastKind = ev.kind; }
    map.setEvent(ev, S.an, S.field, ev.kind === 'lunar' ? App.lunarMapInfo(S.an) : null);
    legend(); fit(); tb.refresh();
  });
  App.on('site', site => { map.setSite(site); tb.refresh(); });
  App.on('time', t => { map.setTime(t); tb.update(); });
  App.on('theme', t => map.setTheme(t));
  App.on('tab', t => { if (t === 'earth') { map.resize(); tb.refresh(); } });
  App.on('focusSite', (site, o) => { if (S.tab === 'earth') focus(site, o && o.zoom); });
  App.on('tzmode', () => tb.update());
  if (S.site) map.setSite(S.site);
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
