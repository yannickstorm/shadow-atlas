/* Inspector: the selected site, its circumstances and warnings. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, Calc = G.Calc, esc = G.esc, $ = App.$, $$ = App.$$;

function solarRows(L) {
  const rows = [], tz = App.tz();
  const nm = { c1: 'Partial begins', c2: L.kind === 'annular' ? 'Annularity begins' : 'Totality begins', max: 'Maximum', c3: L.kind === 'annular' ? 'Annularity ends' : 'Totality ends', c4: 'Partial ends' };
  for (const k of ['c1', 'c2', 'max', 'c3', 'c4']) {
    const c = L.contacts[k]; if (!c) continue;
    rows.push({ k, label: k === 'max' ? 'Maximum' : (k.toUpperCase() + ' · ' + nm[k]), t: c.t, alt: c.alt, az: c.az, mx: k === 'max', pa: c.pa });
  }
  if (L.setsDuring) rows.push({ label: 'Sun sets', t: L.tSet, alt: -0.8, az: null });
  if (L.risesDuring) rows.push({ label: 'Sun rises', t: L.tRise, alt: -0.8, az: null });
  rows.sort((a, b) => a.t - b.t);
  return rows;
}
function lunarRows(L) {
  const nm = { P1: 'Penumbral begins', U1: 'Partial begins', U2: 'Totality begins', max: 'Maximum', U3: 'Totality ends', U4: 'Partial ends', P4: 'Penumbral ends' };
  const rows = [];
  for (const k of ['P1', 'U1', 'U2', 'max', 'U3', 'U4', 'P4']) { const c = L.contacts[k]; if (c) rows.push({ k, label: k === 'max' ? 'Maximum' : k + ' · ' + nm[k], t: c.t, alt: c.alt, mx: k === 'max', moon: true }); }
  return rows;
}
App.contactRows = () => S.loc && S.loc.eclipse ? (S.ev.kind === 'solar' ? solarRows(S.loc) : lunarRows(S.loc)) : [];

App.initFns.push(function () {
  App.on('event', render); App.on('site', render); App.on('tzmode', render);
  document.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-t]'); if (tr && tr.closest('#inspector')) { App.setTime(+tr.dataset.t); if (S.tab === 'earth' || S.tab === 'charts' || S.tab === 'plan') { /* keep tab */ } }
    if (e.target.closest('#inSave')) saveSite();
    if (e.target.closest('#inMax')) { const r = App.contactRows().find(x => x.mx); if (r) { App.setTime(r.t); } }
    if (e.target.closest('#inSky')) App.setTab('sky');
    if (e.target.closest('#inMap')) { App.setTab('earth'); App.focusMap && App.focusMap(S.site); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tzmode]'); if (t) { S.useUT = t.dataset.tzmode === 'ut'; U.store.set('useUT', S.useUT); App.emit('tzmode'); }
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'coordForm') {
      e.preventDefault(); const f = e.target, lat = +f.lat.value, lon = +f.lon.value, el = +f.elev.value;
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { App.toast('Enter latitude −90…90 and longitude −180…180'); return; }
      const site = Calc.siteAt(lat, lon); if (isFinite(el)) site.elev = el; App.setSite(site); App.emit('focusSite', site);
    }
  });
});
function saveSite() {
  const s = S.site, id = s.lat.toFixed(3) + ',' + s.lon.toFixed(3);
  if (S.saved.find(x => x.id === id)) { App.toast('Already in your plan'); return; }
  S.saved.push({ id, name: s.name, lat: s.lat, lon: s.lon, elev: s.elev, tz: s.tz, note: '' }); U.store.set('saved', S.saved);
  App.toast('Saved to your plan'); App.emit('saved');
}
App.saveSite = saveSite;

function render() {
  if (!S.ev || !S.site) return;
  const s = S.site, L = S.loc, ev = S.ev, tzSeg = S.useUT ? 'ut' : 'local';
  let v = { cls: 'none', v1: 'No eclipse', v2: 'The Moon’s shadow does not reach this location.' };
  const compass = az => az == null ? '' : U.compass(az);
  if (ev.kind === 'solar') {
    if (L.eclipse && L.visible) {
      if (L.kind === 'total' && L.sunUpAtMax) v = { cls: 'good', v1: 'Total · ' + U.dur(L.duration), v2: `Magnitude ${L.mag.toFixed(3)} · Sun ${L.altMax.toFixed(0)}° high in the ${compass(L.azMax)}` };
      else if (L.kind === 'annular' && L.sunUpAtMax) v = { cls: 'good', v1: 'Annular · ' + U.dur(L.duration), v2: `Magnitude ${L.mag.toFixed(3)} · Sun ${L.altMax.toFixed(0)}° high in the ${compass(L.azMax)}` };
      else if (L.sunUpAtMax) v = { cls: 'part', v1: 'Partial · ' + U.pct(L.obsc), v2: `Magnitude ${L.mag.toFixed(3)} · Sun ${L.altMax.toFixed(0)}° high in the ${compass(L.azMax)}` };
      else v = { cls: 'part', v1: 'Partial · ' + U.pct(L.obscVisible), v2: L.setsDuring ? 'The Sun sets while the eclipse is under way.' : 'The Sun rises while the eclipse is under way.' };
    } else if (L.eclipse) v = { cls: 'none', v1: 'Not visible', v2: 'The eclipse happens while the Sun is below the horizon here.' };
  } else if (L.eclipse && L.visible) {
    v = L.whole ? { cls: 'good', v1: 'Whole eclipse visible', v2: `Moon ${L.altMax.toFixed(0)}° high at maximum` } : { cls: 'part', v1: 'Partly visible', v2a: L.partLabel, v2: (L.partLabel.charAt(0).toUpperCase() + L.partLabel.slice(1)) + '. ' + (L.maxUp ? 'The maximum is visible.' : 'The maximum is not visible from here.') };
  } else if (L.eclipse) v = { cls: 'none', v1: 'Not visible', v2: L.whyNot };
  const rows = App.contactRows(), tz = App.tz();
  const tzl = S.useUT ? 'UT' : U.offsetLabel(ev.t, s.tz);
  const table = rows.length ? `<table class="ctab"><thead><tr><th>Contact</th><th>${S.useUT ? 'UT' : 'Local'} time</th><th>${ev.kind === 'solar' ? 'Sun alt' : 'Moon alt'}</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.mx ? 'mx' : ''}" data-t="${r.t}" title="Show this moment"><td>${esc(r.label)}</td><td>${U.hms(r.t, tz)}</td><td>${r.alt < 0 ? '<small>' + r.alt.toFixed(0) + '°</small>' : r.alt.toFixed(0) + '°'}</td></tr>`).join('')}</tbody></table>` : '';
  const kv = []; const warn = [];
  if (ev.kind === 'solar' && L.eclipse) {
    kv.push(['Magnitude', L.mag.toFixed(4)], ['Obscuration', U.pct(L.obsc)]);
    if (L.duration) kv.push(['Duration', U.dur(L.duration)]);
    if (L.sunUpAtMax) kv.push(['Sun at maximum', `${L.altMax.toFixed(1)}° · ${Math.round(L.azMax)}° ${compass(L.azMax)}`]);
    const pi = S.pathInfo;
    if (pi && S.an.central) {
      const inside = pi.km <= pi.halfWidth;
      kv.push([inside ? 'Off the centre line' : 'To the path', U.km(inside ? pi.km : pi.km - pi.halfWidth)]);
      kv.push(['Path width here', Math.round(pi.halfWidth * 2) + ' km']);
      if (!inside) warn.push(`You are ${U.km(pi.km - pi.halfWidth)} outside the path of ${ev.type === 'A' ? 'annularity' : 'totality'}. Move ${pi.side === 'north' ? 'south' : 'north'} toward the centre line for the full show.`);
      else if (pi.halfWidth > 0 && pi.km / pi.halfWidth > 0.85) warn.push('You are close to the edge of the path: totality is short here. Moving towards the centre line adds seconds.');
    }
    if (L.sunUpAtMax && L.altMax < 15) warn.push(`The Sun is only ${L.altMax.toFixed(0)}° high at maximum. Check the horizon in the Plan tab.`);
  }
  if (ev.kind === 'lunar' && L.eclipse) {
    kv.push(['Umbral magnitude', L.mag.toFixed(3)], ['Penumbral magnitude', L.penMag.toFixed(3)], ['Moon at maximum', L.altMax.toFixed(0) + '°'], ['Main phase visible', Math.round(L.fractionUp * 100) + '%']);
  }
  kv.push(['Elevation', Math.round(s.elev) + ' m'], ['Time zone', esc(s.tz.replace(/_/g, ' '))]);
  $('#inspector').innerHTML = `<div class="insp">
    <div><h3>Your site</h3><div class="site-name" style="margin-top:8px">${esc(s.name)}</div><div class="site-meta"><span>${U.coord(s.lat, s.lon)}</span><span>${Math.round(s.elev)} m</span><span>${esc(tzl)}</span></div></div>
    <div class="verdict ${v.cls}"><div class="v1">${esc(v.v1)}</div><div class="v2">${esc(v.v2)}</div></div>
    <div class="f-row" style="justify-content:space-between"><div class="seg" role="group" aria-label="Time display"><button data-tzmode="local" aria-pressed="${tzSeg === 'local'}">Local</button><button data-tzmode="ut" aria-pressed="${tzSeg === 'ut'}">UT</button></div><span class="dimmer" style="font-size:12px">Tap a row to jump to it</span></div>
    ${table}
    <div class="kv">${kv.map(k => `<div><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>
    ${warn.map(w => `<div class="note">${esc(w)}</div>`).join('')}
    <div class="row-btns"><button class="btn primary" id="inSave">${App.icons.pin}Save to plan</button><button class="btn" id="inSky">${App.icons.sky}View the sky</button><button class="btn" id="inMap">${App.icons.earth}On the map</button></div>
    <details><summary class="dim" style="cursor:pointer;font-size:12.5px">Edit coordinates</summary>
      <form id="coordForm" class="f-row" style="margin-top:8px"><label class="dim" style="font-size:12px">Lat <input class="field num" name="lat" type="number" step="any" value="${s.lat.toFixed(4)}" style="width:92px"></label><label class="dim" style="font-size:12px">Lon <input class="field num" name="lon" type="number" step="any" value="${s.lon.toFixed(4)}" style="width:96px"></label><label class="dim" style="font-size:12px">Elev m <input class="field num" name="elev" type="number" step="1" value="${Math.round(s.elev)}" style="width:76px"></label><button class="btn sm" type="submit">Apply</button></form></details>
    ${ev.kind === 'solar' ? '<div class="note safety"><b>Eyes first.</b> Look at the Sun only through ISO 12312-2 eclipse glasses or a certified solar filter. Remove them only during the brief totality, never for annular or partial phases.</div>' : ''}
  </div>`;
}
App.renderInspector = render;
})(typeof globalThis !== 'undefined' ? globalThis : this);
