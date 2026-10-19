/* Sky pane: horizon simulation with HUD and controls. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, Calc = G.Calc, esc = G.esc, $ = App.$, $$ = App.$$;

App.initFns.push(function () {
  const pane = $('#paneSky');
  pane.innerHTML = `
    <div class="sky-wrap" id="skyHost">
      <div class="ovl o-tl" id="skyTL">
        <div class="seg glass" role="group" aria-label="Sky view"><button data-sm="dome" aria-pressed="true">All-sky</button><button data-sm="look" aria-pressed="false">Look</button></div>
        <button class="btn glass sm" id="skyZoomSun" title="Zoom in on the Sun and Moon">${App.icons.sun}<span id="skyZoomLbl">Zoom to Sun</span></button>
        <div class="glass" id="fovBox" style="padding:4px 10px;display:flex;gap:8px;align-items:center" hidden><span class="dim" style="font-size:12px">Field</span><input id="skyFov" class="rng" type="range" min="0" max="100" value="60" style="width:130px" aria-label="Field of view"><span class="mono dim" id="skyFovVal" style="font-size:12px;min-width:44px"></span></div>
      </div>
      <div class="ovl o-tr"><div class="glass hud" id="skyHud"></div></div>
      <div class="sky-ctl" id="skyCtl"></div>
    </div>
    <div class="timebar" id="tbSky"></div>`;
  const host = $('#skyHost');
  const sky = new G.SkyView(host, App.D, Ecl); App.views.sky = sky; sky.setTheme(App.theme);
  const tb = new App.TimeBar($('#tbSky'), 'sky'); App.views.tbSky = tb;
  const OPTS = [['lines', 'Constellations'], ['names', 'Names'], ['grid', 'Alt-az grid'], ['planets', 'Planets'], ['terrain', 'Terrain horizon'], ['closeup', 'Close-up']];
  const ctl = $('#skyCtl');
  const drawCtl = () => { ctl.innerHTML = OPTS.map(o => `<button class="chip glass" data-opt="${o[0]}" aria-pressed="${!!sky.opts[o[0]]}">${o[1]}</button>`).join(''); };
  drawCtl();
  ctl.addEventListener('click', e => { const b = e.target.closest('[data-opt]'); if (!b) return; const k = b.dataset.opt; sky.setOpts({ [k]: !sky.opts[k] }); b.setAttribute('aria-pressed', !!sky.opts[k]); });
  $('#skyTL').addEventListener('click', e => { const b = e.target.closest('[data-sm]'); if (b) setMode(b.dataset.sm); });
  function setMode(m) {
    sky.setOpts({ mode: m }); $$('[data-sm]').forEach(x => x.setAttribute('aria-pressed', x.dataset.sm === m));
    $('#fovBox').hidden = m !== 'look';
    if (m === 'look' && !sky._lookInit) { sky._lookInit = true; zoomSun(60); }
  }
  const fovFromSlider = v => 0.5 * Math.pow(240, v / 100);      // 0.5° .. 120°
  const sliderFromFov = f => 100 * Math.log(f / 0.5) / Math.log(240);
  const fov = $('#skyFov'), fovv = $('#skyFovVal');
  fov.addEventListener('input', () => { sky.zoom(fovFromSlider(+fov.value)); });
  sky.on('opts', o => { fov.value = sliderFromFov(o.fov); fovv.textContent = o.fov < 10 ? o.fov.toFixed(1) + '°' : Math.round(o.fov) + '°'; });
  function zoomSun(f) {
    sky.setOpts({ mode: 'look', follow: true, fov: f || (S.ev && S.ev.kind === 'lunar' ? 3 : 2.4) });
    $$('[data-sm]').forEach(x => x.setAttribute('aria-pressed', x.dataset.sm === 'look')); $('#fovBox').hidden = false;
    fov.value = sliderFromFov(sky.opts.fov); fovv.textContent = sky.opts.fov.toFixed(1) + '°';
  }
  $('#skyZoomSun').addEventListener('click', () => zoomSun());
  fov.value = sliderFromFov(sky.opts.fov); fovv.textContent = Math.round(sky.opts.fov) + '°';

  /* HUD */
  const hud = $('#skyHud');
  sky.on('frame', F => {
    const ev = S.ev; if (!ev) return;
    const compass = az => U.compass(az);
    let html = '';
    const mk = App.marksFor('sky'), next = mk.find(m => m[1] > S.time + 500);
    const cd = next ? `<div>Next: <b>${next[0] === 'MAX' ? 'Maximum' : next[0]}</b> in ${fmtCd(next[1] - S.time)}</div>` : '';
    if (ev.kind === 'solar') {
      const rs = F.sun.r, rm = F.moon.r, mag = F.sep >= rs + rm ? 0 : F.sep <= Math.abs(rs - rm) ? rm / rs : (rs + rm - F.sep) / (2 * rs);
      const phase = F.obsc <= 0.0005 ? 'No eclipse at this moment' : F.total ? 'Totality' : (rm < rs && F.sep < rs - rm) ? 'Annular' : 'Partial eclipse';
      html = `<div class="big">${phase}</div><div>Obscuration <b>${U.pct(F.obsc)}</b> · mag <b>${mag.toFixed(3)}</b></div><div>Sun alt <b>${F.sun.altTrue.toFixed(1)}°</b> az <b>${Math.round(F.sun.az)}° ${compass(F.sun.az)}</b></div><div>Moon–Sun gap <b>${(F.sep * 180 / Math.PI).toFixed(3)}°</b></div>${cd}`;
      if (F.sun.altTrue < 0) html += `<div style="color:var(--warn)">Sun below the horizon</div>`;
    } else {
      const ls = Ecl.lunarState(S.time), um = (ls.k + ls.moonR - ls.r) / (2 * ls.moonR), pm = (ls.p + ls.moonR - ls.r) / (2 * ls.moonR);
      const phase = um >= 1 ? 'Totality' : um > 0 ? 'Partial eclipse' : pm > 0 ? 'Penumbral phase' : 'No eclipse at this moment';
      html = `<div class="big">${phase}</div><div>Umbral mag <b>${Math.max(um, 0).toFixed(3)}</b> · penumbral <b>${Math.max(pm, 0).toFixed(3)}</b></div><div>Moon alt <b>${F.moon.altTrue.toFixed(1)}°</b> az <b>${Math.round(F.moon.az)}° ${compass(F.moon.az)}</b></div>${cd}`;
      if (F.moon.altTrue < 0) html += `<div style="color:var(--warn)">Moon below the horizon</div>`;
    }
    hud.innerHTML = html;
  });
  function fmtCd(ms) { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'h ' : '') + U.pad(m) + 'm ' + U.pad(s % 60) + 's'; }

  App.on('event', ev => {
    sky.setEvent(ev, S.an); $('#skyZoomLbl').textContent = ev.kind === 'lunar' ? 'Zoom to Moon' : 'Zoom to Sun';
    sky.opts.follow = sky.opts.follow && sky.opts.mode === 'look'; tb.refresh();
  });
  App.on('site', site => { sky.setSite(site); tb.refresh(); });
  App.on('time', t => { sky.setTime(t); if (S.tab === 'sky') tb.update(); });
  App.on('theme', t => sky.setTheme(t));
  App.on('tab', t => { if (t === 'sky') { sky.resize(); tb.refresh(); sky.setTime(S.time); } });
  App.on('tzmode', () => tb.update());
  App.on('terrain', () => { sky.horizon = null; sky.request(); });
  if (S.site) sky.setSite(S.site);
});
})(typeof globalThis !== 'undefined' ? globalThis : this);
