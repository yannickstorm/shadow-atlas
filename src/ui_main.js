/* Application core: state, events, layout, event list, search, header. */
(function (G) {
'use strict';
const A = G.Astronomy, Ecl = G.Ecl, Calc = G.Calc, U = G.U, esc = G.esc;
const App = G.App = { S: {}, L: {}, views: {} };
const S = App.S;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
App.$ = $; App.$$ = $$;

/* ---------- tiny emitter ---------- */
App.on = (n, f) => { (App.L[n] = App.L[n] || []).push(f); };
App.emit = (n, p, q) => { for (const f of App.L[n] || []) { try { f(p, q); } catch (e) { console.error(n, e); } } };
App.toast = msg => { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); };
App.copy = async (text, msg) => {
  try { await navigator.clipboard.writeText(text); App.toast(msg || 'Copied'); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); App.toast(msg || 'Copied'); } catch (e2) { App.toast('Select and copy the text manually'); } ta.remove(); }
};
App.icons = {
  earth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  sky: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><circle cx="12" cy="7" r="1.6" fill="currentColor"/><path d="M5 6l.6 1.4L7 8l-1.4.6L5 10l-.6-1.4L3 8l1.4-.6z" fill="currentColor" stroke="none"/></svg>',
  charts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20V4M4 20h16"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
  horizon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M2.5 19l6-10 4 6 2.5-3.5L21.5 19z"/><circle cx="17" cy="6" r="2"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="3.5"/><path d="M14 4.5a6 6 0 0 1 0 7M4 17h16M4 21h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
};

/* ---------- theme ---------- */
App.effectiveTheme = () => { const d = document.documentElement.dataset.theme; if (d === 'dark' || d === 'light') return d; return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; };
function initTheme() {
  const saved = U.store.get('theme', null);
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  const fire = () => { App.theme = App.effectiveTheme(); App.emit('theme', App.theme); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fire);
  new MutationObserver(fire).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  $('#themeBtn').addEventListener('click', () => {
    const next = App.effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; U.store.set('theme', next);
  });
  App.theme = App.effectiveTheme();
}

/* ---------- tabs & layout ---------- */
const TABS = [['events', 'Events'], ['earth', 'Earth'], ['sky', 'Sky'], ['horizon', 'Horizon'], ['charts', 'Charts'], ['plan', 'Plan']];
App.layout = 'wide';
function buildTabs() {
  const html = narrow => TABS.filter(t => narrow || t[0] !== 'events').map(t => `<button class="tab" role="tab" data-tab="${t[0]}" aria-selected="false">${App.icons[t[0]]}<span>${t[1]}</span></button>`).join('');
  $('#tabsTop').innerHTML = html(false); $('#tabsBottom').innerHTML = html(true);
  document.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && b.classList.contains('tab')) App.setTab(b.dataset.tab); });
}
App.setTab = function (t) {
  if (t === 'events' && App.layout !== 'narrow') t = 'earth';
  S.tab = t; U.store.set('tab', t);
  $$('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  $$('.pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
  if (S.player && S.player.playing) App.emit('range');
  App.emit('tab', t);
};
function placeLayout() {
  const w = window.innerWidth, l = w >= 1240 ? 'wide' : w >= 880 ? 'mid' : 'narrow';
  document.body.dataset.layout = l;
  if (l !== App.layout || !App.layoutInit) {
    App.layout = l; App.layoutInit = true;
    const ev = $('#evPanel'), insp = $('#inspector');
    if (l === 'narrow') $('#paneEvents').appendChild(ev); else $('.rail-ev').appendChild(ev);
    if (l === 'wide') $('#railSite').appendChild(insp); else $('#inspSlot').appendChild(insp);
    if (l !== 'narrow' && S.tab === 'events') App.setTab('earth');
    App.emit('layout', l);
  }
}

/* ---------- event list & filters ---------- */
const F = S.filters = { kind: 'all', types: { T: true, A: true, H: true, P: true, N: true }, preset: 'upcoming', y0: 2026, y1: 2050, text: '', visOnly: false };
const PRESETS = { upcoming: 'Next 25 years', past: 'Past 25 years', all: '1900–2100', custom: 'Custom years' };
App.visKey = () => S.site ? S.site.lat.toFixed(3) + ',' + S.site.lon.toFixed(3) + ',' + Math.round(S.site.elev || 0) : '';
const visCache = new Map();
function searchStr(ev) {
  if (ev._s) return ev._s;
  const d = ev.date, mon = U.MONTHS[d.getUTCMonth()];
  ev._s = [U.dateIso(ev.t), mon, d.getUTCFullYear(), U.typeLong(ev), ev.kind, ev.kind === 'lunar' ? 'moon' : 'sun', (ev.countries || []).join(' '), ev.at || '', ev.oc || '', 'saros ' + ev.saros].join(' ').toLowerCase();
  return ev._s;
}
function inRange(ev) {
  const now = Date.now();
  if (F.preset === 'upcoming') return ev.t >= now - 86400000 && ev.t <= now + 25 * 365.25 * 86400000;
  if (F.preset === 'past') return ev.t <= now && ev.t >= now - 25 * 365.25 * 86400000;
  if (F.preset === 'all') return true;
  const y = ev.date.getUTCFullYear(); return y >= F.y0 && y <= F.y1;
}
function filtered() {
  const toks = F.text.toLowerCase().split(/\s+/).filter(Boolean);
  let list = App.D.events.filter(ev => {
    if (F.kind !== 'all' && ev.kind !== F.kind) return false;
    if (!F.types[ev.type]) return false;
    if (toks.length && !(F.preset === 'all' || true)) return true;
    if (!toks.length && !inRange(ev)) return false;
    if (toks.length) { const s = searchStr(ev); for (const t of toks) if (!s.includes(t)) return false; }
    return true;
  });
  if (F.visOnly) list = list.filter(ev => { const v = visCache.get(App.visKey() + '|' + ev.id); return !v || v.cls !== 'no'; });
  if (F.preset === 'past' && !toks.length) list.reverse();
  return list;
}
function visSummary(ev) {
  const key = App.visKey() + '|' + ev.id, c = visCache.get(key); if (c) return c;
  const s = S.site, an = Calc.fast(ev); let r;
  if (ev.kind === 'solar') {
    const L = Ecl.local(an, s.lat, s.lon, s.elev);
    if (!L.eclipse || !L.visible || L.obscVisible < 0.005) r = { cls: 'no', t: 'not visible', b: '—' };
    else if (!L.sunUpAtMax && L.obscVisible < 0.05) r = { cls: 'no', t: 'only a sliver at ' + (L.setsDuring ? 'sunset' : 'sunrise'), b: '—', L };
    else if (L.kind === 'total' && L.sunUpAtMax) r = { cls: 'yes', b: 'Total', t: U.dur(L.duration), L };
    else if (L.kind === 'annular' && L.sunUpAtMax) r = { cls: 'yes', b: 'Annular', t: U.dur(L.duration), L };
    else r = { cls: 'part', b: U.pct(L.obscVisible), t: L.sunUpAtMax ? 'obscured' : (L.setsDuring ? 'Sun sets' : 'Sun rises'), L };
  } else {
    const L = Calc.lunarLocal(an, s.lat, s.lon, s.elev);
    if (!L.visible) r = { cls: 'no', t: 'not visible', b: '—' };
    else if (!L.maxUp && L.fractionUp < 0.25) r = { cls: 'no', t: 'mostly below the horizon', b: '—', L };
    else if (L.whole) r = { cls: 'yes', b: 'Visible', t: 'whole eclipse', L };
    else r = { cls: 'part', b: 'Partly', t: L.partLabel, L };
  }
  visCache.set(key, r); return r;
}
App.visSummary = visSummary;
function visHtml(ev) {
  const v = visCache.get(App.visKey() + '|' + ev.id);
  return v ? `<b>${esc(v.b)}</b> ${esc(v.t)}` : '';
}
function evFacts(ev) {
  if (ev.kind === 'solar') return ev.dur ? `${U.dur(ev.dur)} · magnitude ${ev.mag.toFixed(3)}` : `magnitude ${ev.mag.toFixed(3)}`;
  if (ev.type === 'T') return `Totality ${U.durMin(ev.dTot)} · umbral ${ev.umb.toFixed(2)}`;
  if (ev.type === 'P') return `Umbral magnitude ${ev.umb.toFixed(2)}`;
  return `Penumbral magnitude ${ev.pen.toFixed(2)}`;
}
function evWhere(ev) {
  if (ev.kind === 'lunar') return `Greatest ${U.hm(ev.t, 'UTC')} UT · Saros ${ev.saros}`;
  if (ev.countries && ev.countries.length) return ev.countries.join(' → ');
  if (ev.oc) return ev.oc;
  return ev.at ? 'Greatest near ' + ev.at : (ev.type === 'P' ? 'Partial: visible from parts of ' + hemisphere(ev) : '');
}
function hemisphere(ev) { return ev.lat === undefined ? 'the Earth' : (ev.lat > 40 ? 'the northern hemisphere' : ev.lat < -40 ? 'the southern hemisphere' : 'the tropics'); }
App.evFacts = evFacts; App.evWhere = evWhere;
let listJobs = [], lastSig = '';
function baseList() {
  const toks = F.text.toLowerCase().split(/\s+/).filter(Boolean);
  let list = App.D.events.filter(ev => {
    if (F.kind !== 'all' && ev.kind !== F.kind) return false;
    if (!F.types[ev.type]) return false;
    if (!toks.length && !inRange(ev)) return false;
    if (toks.length) { const s = searchStr(ev); for (const t of toks) if (!s.includes(t)) return false; }
    return true;
  });
  if (F.preset === 'past' && !toks.length) list.reverse();
  return list;
}
function renderList(force) {
  listJobs.forEach(j => j.stop = true); listJobs = [];
  const key = App.visKey(), box = $('#evList');
  let list = baseList();
  if (F.visOnly) {
    // work out visibility for every candidate first, then show the list once (no flicker, no re-render loop)
    const pending = list.filter(ev => !visCache.has(key + '|' + ev.id));
    if (pending.length) {
      const job = { stop: false }; listJobs.push(job);
      box.innerHTML = `<div class="empty">Checking which eclipses you can see from ${esc(S.site.name.split(',')[0])}…</div>`; $('#evCount').textContent = '…'; lastSig = '';
      const step = () => {
        if (job.stop) return; const t0 = performance.now();
        while (pending.length && performance.now() - t0 < 12) visSummary(pending.shift());
        if (pending.length) setTimeout(step, 0); else { job.stop = true; draw(baseList().filter(ev => (visCache.get(key + '|' + ev.id) || {}).cls !== 'no')); }
      };
      setTimeout(step, 0); return;
    }
    list = list.filter(ev => (visCache.get(key + '|' + ev.id) || {}).cls !== 'no');
  }
  draw(list, force);
}
function draw(list, force) {
  const key = App.visKey(), box = $('#evList');
  $('#evCount').textContent = list.length + ' events';
  const sig = key + '|' + list.map(e => e.id).join(',');
  if (!force && sig === lastSig) return;
  lastSig = sig;
  if (!list.length) { box.innerHTML = '<div class="empty">No eclipses match these filters.</div>'; return; }
  const st = box.scrollTop;
  let html = '', lastYear = null; const counts = {};
  list.forEach(ev => { const y = ev.date.getUTCFullYear(); counts[y] = (counts[y] || 0) + 1; });
  for (const ev of list) {
    const y = ev.date.getUTCFullYear();
    if (y !== lastYear) { html += `<div class="yr"><span>${y}</span><span>${counts[y]}</span></div>`; lastYear = y; }
    const d = ev.date, cached = visCache.get(key + '|' + ev.id);
    html += `<div class="ev" role="option" tabindex="0" data-id="${ev.id}" aria-current="${!!(S.ev && S.ev.id === ev.id)}"><div class="dt">${U.pad(d.getUTCDate())}<small>${U.MONTHS[d.getUTCMonth()]}</small></div><div class="ti">${U.icon(ev, 18)}<span>${esc(U.typeLong(ev))}</span></div><div class="sub">${esc(evFacts(ev))}</div><div class="vis ${cached ? cached.cls : ''}" data-vis="${ev.id}">${visHtml(ev)}</div><div class="where">${esc(evWhere(ev))}</div></div>`;
  }
  box.innerHTML = html; box.scrollTop = st;
  // fill in the visibility badges in the background (the rows already reserve their height)
  const job = { stop: false }; listJobs.push(job);
  const todo = list.filter(ev => !visCache.has(key + '|' + ev.id)).slice(0, 400);
  const step = () => {
    if (job.stop) return; const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 10) {
      const ev = todo.shift(); visSummary(ev);
      const el = box.querySelector(`[data-vis="${ev.id}"]`); if (el) { const v = visCache.get(key + '|' + ev.id); el.className = 'vis ' + v.cls; el.innerHTML = visHtml(ev); }
    }
    if (todo.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
App.renderList = renderList;
function buildFilters() {
  const tl = { T: 'Total', A: 'Annular', H: 'Hybrid', P: 'Partial', N: 'Penumbral' };
  const kindEv = { T: { kind: 'solar', type: 'T' }, A: { kind: 'solar', type: 'A' }, H: { kind: 'solar', type: 'H' }, P: { kind: 'solar', type: 'P' }, N: { kind: 'lunar', type: 'N' } };
  $('#filters').innerHTML = `
    <div class="f-row"><div class="seg" role="group" aria-label="Eclipse kind"><button data-k="all" aria-pressed="true">All</button><button data-k="solar" aria-pressed="false">Solar</button><button data-k="lunar" aria-pressed="false">Lunar</button></div>
      <select class="field" id="fPreset" aria-label="Date range">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="f-row" id="fYears" hidden><input class="field num" id="fY0" type="number" min="1900" max="2100" style="width:84px" aria-label="From year"><span class="dimmer">to</span><input class="field num" id="fY1" type="number" min="1900" max="2100" style="width:84px" aria-label="To year"></div>
    <div class="chips" id="fTypes">${Object.keys(tl).map(k => `<button class="chip" data-type="${k}" aria-pressed="true">${U.icon(kindEv[k], 14)}${tl[k]}</button>`).join('')}</div>
    <div class="f-row"><input class="field" id="fText" type="search" placeholder="Find eclipses: 2027, Spain, annular…" style="flex:1" aria-label="Find eclipses"></div>
    <label class="tog"><input type="checkbox" id="fVis"> Only eclipses visible from my site</label>`;
  const f = $('#filters');
  f.addEventListener('click', e => {
    const k = e.target.closest('[data-k]'); if (k) { F.kind = k.dataset.k; $$('[data-k]', f).forEach(b => b.setAttribute('aria-pressed', b === k)); renderList(); }
    const t = e.target.closest('[data-type]'); if (t) { F.types[t.dataset.type] = !F.types[t.dataset.type]; t.setAttribute('aria-pressed', F.types[t.dataset.type]); renderList(); }
  });
  $('#fPreset').addEventListener('change', e => { F.preset = e.target.value; $('#fYears').hidden = F.preset !== 'custom'; renderList(); });
  $('#fY0').value = F.y0; $('#fY1').value = F.y1;
  for (const id of ['fY0', 'fY1']) $('#' + id).addEventListener('change', e => { F[id === 'fY0' ? 'y0' : 'y1'] = +e.target.value; renderList(); });
  let tm; $('#fText').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { F.text = e.target.value; renderList(); }, 140); });
  $('#fVis').addEventListener('change', e => { F.visOnly = e.target.checked; renderList(true); });
  const list = $('#evList'); let down = null;
  const choose = id => {
    const ev = App.D.byId.get(id); if (!ev) return;
    $$('.ev', list).forEach(x => x.setAttribute('aria-current', x.dataset.id === id));      // instant feedback
    requestAnimationFrame(() => setTimeout(() => { App.selectEvent(ev); if (App.layout === 'narrow') App.setTab('earth'); }, 0));
  };
  list.addEventListener('pointerdown', e => { const el = e.target.closest('.ev'); down = el ? { id: el.dataset.id, x: e.clientX, y: e.clientY } : null; });
  list.addEventListener('click', e => {
    const el = e.target.closest('.ev');
    if (el) return choose(el.dataset.id);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14) choose(down.id);   // press and release landed on different elements
  });
  list.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const el = e.target.closest('.ev'); if (el) { e.preventDefault(); choose(el.dataset.id); } } });
}

/* ---------- event header ---------- */
function renderHead() {
  const ev = S.ev, an = S.an, tz = 'UTC';
  const ct = [];
  ct.push(['Greatest eclipse', U.hms(ev.t, 'UTC') + ' UT']);
  if (ev.kind === 'solar') {
    if (ev.dur) ct.push(['Longest at greatest', U.dur(ev.dur)]);
    ct.push(['Magnitude', ev.mag.toFixed(4)]);
    if (ev.width) ct.push(['Path width', Math.round(ev.width) + ' km']);
    ct.push(['Gamma', ev.gamma.toFixed(4)]);
    if (ev.alt !== undefined) ct.push(['Sun altitude', ev.alt + '°']);
  } else {
    ct.push(['Umbral mag.', ev.umb.toFixed(3)]); ct.push(['Penumbral mag.', ev.pen.toFixed(3)]);
    if (ev.dTot) ct.push(['Totality', U.durMin(ev.dTot)]);
    ct.push(['Partial phase', ev.dPar ? U.durMin(ev.dPar) : '—']); ct.push(['Penumbral', U.durMin(ev.dPen)]);
  }
  ct.push(['Saros', String(ev.saros)]);
  const when = `<b>${U.dateLong(ev.t, 'UTC')}</b> · ${U.rel(ev.t)}`;
  const path = ev.kind === 'solar' ? (ev.countries && ev.countries.length ? 'Path of the central eclipse: ' + ev.countries.join(' → ') : ev.oc ? 'Central path over the ' + ev.oc : ev.type === 'P' ? 'Partial eclipse only: the Moon’s umbral shadow misses the Earth.' : '') : 'Visible wherever the Moon is above the horizon; see the Earth tab for the zones.';
  $('#evHead').innerHTML = `<div class="eh-top"><div class="eh-title">${U.icon(ev, 38)}<div><h1>${esc(U.typeLong(ev))}</h1><div class="when">${when}</div></div></div>
    <div class="eh-actions"><button class="btn sm" id="ehShare">${App.icons.copy}<span>Copy summary</span></button></div></div>
    <div class="facts">${ct.map(c => `<div class="fact"><span>${c[0]}</span><b>${esc(c[1])}</b></div>`).join('')}</div>
    ${path ? `<div class="eh-path">${esc(path)}</div>` : ''}`;
  $('#ehShare').addEventListener('click', () => App.copy([U.typeLong(ev) + ' · ' + U.dateLong(ev.t, 'UTC'), 'Greatest eclipse ' + U.hms(ev.t, 'UTC') + ' UT', evFacts(ev), evWhere(ev)].filter(Boolean).join('\n'), 'Eclipse summary copied'));
  document.title = 'Shadow Atlas';
}

/* ---------- selection ---------- */
const fieldCache = new Map();
App.fieldFor = function (ev, an) {
  if (ev.kind !== 'solar') return null;
  let f = fieldCache.get(ev.id);
  if (!f) { f = { w: 720, h: 360, data: Ecl.magField(an, 720, 360, 6) }; fieldCache.set(ev.id, f); if (fieldCache.size > 6) fieldCache.delete(fieldCache.keys().next().value); }
  return f;
};
App.lunarMapInfo = function (an) {
  const sp = (ms) => { const p = Ecl.subPoint('Moon', ms); return { sd: Math.sin(p.lat * Math.PI / 180), cd: Math.cos(p.lat * Math.PI / 180), sl: Math.sin(p.lon * Math.PI / 180), cl: Math.cos(p.lon * Math.PI / 180) }; };
  return { start: sp(an.tU1 || an.tP1), end: sp(an.tU4 || an.tP4) };
};
App.computeLocal = function () {
  if (!S.ev || !S.site) return null;
  S.loc = Calc.local(S.ev, S.an, S.site.lat, S.site.lon, S.site.elev);
  S.pathInfo = S.ev.kind === 'solar' && S.an.path ? Calc.distToPath(S.an, S.site.lat, S.site.lon) : null;
  return S.loc;
};
App.defaultTime = function () {
  const L = S.loc, an = S.an;
  if (S.ev.kind === 'solar') return L && L.eclipse && L.visible ? (L.sunUpAtMax ? L.tMax : (L.tSet || L.tRise || L.tMax)) : an.tGreatest;
  return L && L.visible ? (L.maxUp ? an.tGreatest : (an.tU1 || an.tP1)) : an.tGreatest;
};
App.selectEvent = function (ev, opts) {
  if (!ev) return;
  S.ev = ev; S.an = Calc.full(ev);
  App.computeLocal();
  S.time = App.defaultTime();
  S.field = App.fieldFor(ev, S.an);
  try { history.replaceState(null, '', '#' + ev.id); } catch (e) { /* sandboxed frame: the hash is optional */ }
  U.store.set('event', ev.id);
  renderHead();
  $$('.ev').forEach(el => el.setAttribute('aria-current', el.dataset.id === ev.id));
  App.emit('event', ev);
  App.emit('time', S.time);
};
App.setSite = function (site, opts) {
  S.site = site; U.store.set('site', site);
  App.computeLocal();
  App.emit('site', site);
  if (!(opts && opts.keepTime) && S.ev) { const t = App.defaultTime(); if (!opts || !opts.noTime) { S.time = t; App.emit('time', t); } }
  renderList();
};
App.setTime = function (ms, src) { S.time = ms; App.emit('time', ms, src); };
App.tz = () => S.useUT || !S.site ? 'UTC' : S.site.tz;
App.fmtT = (ms, withSec = true) => withSec ? U.hms(ms, App.tz()) : U.hm(ms, App.tz());
App.tzLabel = () => S.useUT ? 'UT' : U.offsetLabel(S.time || Date.now(), S.site.tz);

/* ---------- place & address search ---------- */
// words that mark the street part of an address in common languages
const STREET_WORDS = /\b(rue|chemin|ch|avenue|av|ave|boulevard|bd|blvd|route|rte|impasse|allee|place|pl|quai|calle|c|avenida|avda|camino|carrer|carretera|paseo|plaza|rua|travessa|via|viale|corso|piazza|strasse|str|gasse|weg|platz|allee|ring|street|st|road|rd|lane|ln|drive|dr|way|court|ct|crescent|terrace|highway|hwy|sokak|cadde|caddesi|ulica|ul|sharia|shari)\b/;
function parseAddress(q) {
  const raw = q.trim(); if (!raw) return null;
  const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
  let street = null, town = null, number = null;
  if (parts.length >= 2) { street = parts[0]; town = parts.slice(1).join(' '); }
  else {
    const key = G.normKey(raw);
    if (!/\d/.test(raw) && !STREET_WORDS.test(key)) return null;
    street = raw;
  }
  const num = street.match(/^(\d+[a-zA-Z]?)\s+(.+)$/) || street.match(/^(.+?)\s+(\d+[a-zA-Z]?)$/);
  if (num) { if (/^\d/.test(num[1])) { number = num[1]; street = num[2]; } else { street = num[1]; number = num[2]; } }
  if (town) town = town.replace(/\b[A-Z]{0,2}-?\d{4,6}\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { street, town, number, raw };
}
/* live geocoding when the page can reach online services (downloaded copy or your own server) */
const liveCache = new Map(); let liveLast = 0;
async function liveGeocode(q) {
  const key = q.trim().toLowerCase(); if (liveCache.has(key)) return liveCache.get(key);
  const wait = 1100 - (Date.now() - liveLast); if (wait > 0) await new Promise(r => setTimeout(r, wait));   // Nominatim allows one request a second
  liveLast = Date.now();
  const get = (url, ms) => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms); return fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } }).then(r => { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); }); };
  let out = null;
  try {
    const j = await get('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=7&accept-language=en&q=' + encodeURIComponent(q), 7000);
    out = j.map(r => {
      const a = r.address || {}, road = a.road || a.pedestrian || a.footway || a.path || '', num = a.house_number || '';
      const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || '';
      const name = r.name && r.name !== road ? r.name : road ? (num ? road + ' ' + num : road) : (town || r.display_name.split(',')[0]);
      const fine = !!(road || num || /house|building|road|residential|street/.test(r.addresstype || r.type || ''));
      const sub = [town && town !== name ? town : '', a.state, a.country].filter(Boolean).join(', ') || r.display_name.split(', ').slice(1, 4).join(', ');
      return { name, sub, town, lat: +r.lat, lon: +r.lon, street: fine, live: true };
    });
  } catch (e) {
    try {
      const j = await get('https://photon.komoot.io/api/?limit=7&lang=en&q=' + encodeURIComponent(q), 7000);
      out = j.features.map(f => { const p = f.properties || {}, road = p.street || '', num = p.housenumber || '';
        const name = p.name || (road ? (num ? road + ' ' + num : road) : p.city || '');
        return { name, sub: [p.name && road ? road + (num ? ' ' + num : '') : '', p.city && p.city !== name ? p.city : '', p.state, p.country].filter(Boolean).join(', '), town: p.city || '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], street: !!(road || num), live: true }; });
    } catch (e2) { out = null; }
  }
  if (out) liveCache.set(key, out);
  return out;
}
App.searchMore = async function (q) {
  const near = S.site ? { lat: S.site.lat, lon: S.site.lon } : null, out = [];
  if (G.LIVE && q.trim().length >= 3) {
    const live = await liveGeocode(q);
    if (live && live.length) {
      let more = []; try { more = await G.PL.search(q, { near, limit: 3 }); } catch (e) { more = []; }
      return live.concat(more.filter(r => !live.some(l => Math.abs(l.lat - r.lat) < 0.05 && Math.abs(l.lon - r.lon) < 0.05)));
    }
  }
  const A = parseAddress(q);
  if (!A || !A.town) { for (const r of await G.PL.search(q, { near, limit: 7 })) out.push(r); }
  if (A) {
    // street part + town: find the town, then the street in the street map around it
    let towns = [];
    if (A.town) towns = await G.PL.search(A.town, { near, limit: 3 });
    else {
      // "Calle Real 12 Tarifa": try the last one or two words as the town
      const w = A.street.split(/\s+/);
      for (const k of [2, 1]) if (w.length > k) {
        const t = await G.PL.search(w.slice(-k).join(' '), { near, limit: 2 });
        const tail = G.normKey(w.slice(-k).join(' '));
        const exact = t.filter(x => G.normKey(x.name) === tail || (x === t[0] && tail.length >= 4 && G.normKey(x.name).startsWith(tail + ' ')));
        if (exact.length) { towns = exact; A.street = w.slice(0, -k).join(' '); break; }
      }
    }
    const found = [];
    for (const t of towns.slice(0, 2)) {
      if (!G.ST || !G.ST.coverage(t.lat, t.lon)) continue;
      const rad = t.kind === 'city' ? 14 : t.kind === 'town' ? 8 : 5;
      for (const st of await G.ST.findStreet(A.street, t.lat, t.lon, rad))
        found.push({ name: st.name + (A.number ? ' ' + A.number : ''), sub: (t.name + (t.country ? ', ' + t.country : '')) + (A.number ? ' · street located, house numbers are not in the map data' : ''), lat: st.lat, lon: st.lon, street: true, town: t });
    }
    const streets = found.length; out.unshift(...found);
    if (A.town && towns.length) for (const t of towns.slice(0, 2)) if (!out.some(o => o.place && Math.abs(o.lat - t.lat) < 0.01 && Math.abs(o.lon - t.lon) < 0.01)) out.push(t);
    if (!G.LIVE) out.push({ dl: true, name: 'Search any address with OpenStreetMap', sub: 'Download the app: claude.ai blocks online map services.' });
    if (!streets) out.push({ ask: true, name: 'Ask Claude to locate this address', sub: towns.length && !(G.ST && G.ST.coverage(towns[0].lat, towns[0].lon)) ? 'Street-level search covers the 2027 and 2028 totality paths. Claude can give an approximate position elsewhere.' : 'No matching street in the map data. Claude can give an approximate position.', q });
  }
  return out;
};
async function askClaude(q) {
  const use = window.claude && window.claude.use; if (!use) return { error: 'unavailable' };
  let sample = null; try { sample = await window.claude.use('sample'); } catch (e) { sample = null; }
  if (!sample) return { error: 'unavailable' };
  try {
    const r = await sample.json('Give the geographic coordinates of this address or place, from your own knowledge: "' + q.replace(/"/g, "'") + '". Reply with JSON only, in this shape: {"lat": number or null, "lon": number or null, "label": "short name of what you located", "precision": "address" | "street" | "town" | "region" | "unknown"}. Use precision "unknown" and null coordinates when you do not know the place.', { modelTier: 'default' });
    if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number' || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180 || r.precision === 'unknown') return { error: 'unknown' };
    return { lat: r.lat, lon: r.lon, label: String(r.label || q).slice(0, 90), precision: r.precision };
  } catch (e) { return { error: e && e.code || 'upstream_error' }; }
}
/* ---------- live maps: a downloadable copy that may use online map services ---------- */
function initLive() {
  const btn = $('#liveBtn'), pop = $('#livePop');
  if (G.LIVE) { btn.querySelector('.live-dot').hidden = false; btn.title = 'Live maps are on'; }
  const draw = (msg) => {
    pop.innerHTML = G.LIVE
      ? `<h3>Live maps are on</h3><p>Address search uses OpenStreetMap, the street map loads OpenStreetMap tiles everywhere, and terrain comes straight from elevation tiles. You need an internet connection.</p><p class="src">Nominatim · CARTO · AWS Terrarium</p>`
      : `<h3>Live street maps and address search</h3><p>claude.ai blocks online map services, so this page uses the street data built into it: detailed along the 2027 and 2028 totality paths, main roads elsewhere.</p><p>Download the app and open the file in your browser, or put it on your plotter bridge. There it finds any address with OpenStreetMap, shows a full street map everywhere and loads detailed terrain for any place.</p>${msg ? `<p class="src">${esc(msg)}</p>` : ''}<button class="btn primary" id="liveDl">Download the app</button>`;
    const b = $('#liveDl'); if (b) b.addEventListener('click', download);
  };
  async function download() {
    const b = $('#liveDl'); b.disabled = true; b.textContent = 'Preparing…';
    let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (!dl) { draw('Downloads are not available in this view. Open the artifact in your browser and try again.'); return; }
    try {
      const html = await fetch('shadow-atlas.html').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
      await dl.save({ filename: 'Shadow Atlas.html', data: html });
      draw('Saved. Open "Shadow Atlas.html" in your browser to use live maps.');
    } catch (e) { draw(e && e.code === 'declined' ? 'Download cancelled.' : 'The download did not start. Try again in a moment.'); }
  }
  App.openLive = () => { draw(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
  btn.addEventListener('click', () => { if (pop.hidden) App.openLive(); else { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.live-wrap')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
}
function initPlaceSearch() {
  const inp = $('#placeQ'), box = $('#placeRes'); let items = [], sel = -1, status = '', tok = 0, timer = null;
  const subOf = c => c.sub || (c.place ? [c.kind, G.PL.describe(c)].filter(Boolean).join(' · ') : c.custom ? '' : (c.prov && c.prov !== c.name ? c.prov + ', ' : '') + c.country);
  const draw = () => {
    inp.setAttribute('aria-expanded', String(!box.hidden));
    if (!items.length && !status) { box.innerHTML = inp.value.trim() ? '<div class="pr-empty">No matching place. Try a town, an address such as "Calle Real 5, Tarifa", or coordinates like 25.7, 32.65.</div>' : ''; box.hidden = !inp.value.trim(); return; }
    box.hidden = false;
    box.innerHTML = items.map((c, i) => c.dl ? `<div class="pr pr-dl" role="option" data-i="${i}" aria-selected="${i === sel}"><span class="pr-t"><b>${esc(c.name)}</b><span class="dim">${esc(c.sub)}</span></span></div>` : c.ask
      ? `<div class="pr pr-ask" role="option" data-i="${i}" aria-selected="${i === sel}"><span class="pr-t"><b>${esc(c.name)}</b><span class="dim">${esc(c.sub)}</span></span></div>`
      : `<div class="pr" role="option" data-i="${i}" aria-selected="${i === sel}"><span class="pr-t"><b>${esc(c.name)}</b><span class="dim">${esc(subOf(c))}</span></span><small>${c.approx ? 'approx. · ' : ''}${c.lat.toFixed(c.street ? 4 : 2)}, ${c.lon.toFixed(c.street ? 4 : 2)}</small></div>`).join('')
      + (status ? `<div class="pr-empty">${esc(status)}</div>` : '');
  };
  const pick = async c => {
    if (!c) return;
    if (c.dl) { box.hidden = true; inp.blur(); setTimeout(App.openLive, 0); return; }
    if (c.ask) {
      status = 'Asking Claude…'; items = items.filter(x => !x.ask); draw();
      const r = await askClaude(c.q);
      if (r.error) { status = r.error === 'unavailable' || r.error === 'not_granted' ? 'Claude is not available on this page. Click the map to place your site instead.' : r.error === 'rate_limited' ? 'Claude is busy right now. Try again in a minute.' : 'Claude could not locate this address. Try the town name, then click the map.'; draw(); return; }
      status = ''; items = [{ name: r.label, sub: 'Approximate position from Claude (' + r.precision + ' level, no web lookup). Check it on the map.', lat: r.lat, lon: r.lon, approx: true, street: r.precision === 'address' || r.precision === 'street' }].concat(items); sel = 0; draw(); return;
    }
    box.hidden = true; inp.value = ''; inp.blur(); status = '';
    let site;
    if (c.custom) site = Calc.siteAt(c.lat, c.lon);
    else if (c.live) { site = Calc.siteAt(c.lat, c.lon); site.name = c.name + (c.town && c.town !== c.name ? ', ' + c.town : ''); }
    else if (c.place || c.street || c.approx) { site = Calc.siteAt(c.lat, c.lon); site.name = c.street ? c.name + ', ' + (c.town ? c.town.name : site.name.split(',')[0]) : c.approx ? c.name : c.name + ', ' + (c.region && c.region !== c.name ? c.region : c.country); }
    else site = { name: c.name + ', ' + c.country, lat: c.lat, lon: c.lon, elev: Math.max(0, Calc.elevation(c.lat, c.lon)), tz: c.tz };
    App.setSite(site); App.emit('focusSite', site, { zoom: c.street ? 3200 : c.live ? 900 : c.place && (c.kind === 'village' || c.kind === 'hamlet') ? 700 : null }); App.toast('Site set to ' + site.name);
  };
  const run = () => {
    const q = inp.value, my = ++tok;
    items = Calc.searchPlaces(q, 5); sel = items.length ? 0 : -1;
    status = q.trim().length >= 2 && G.PL && G.PL.ready() ? 'Searching towns, villages and streets…' : ''; draw();
    clearTimeout(timer);
    if (!status) return;
    timer = setTimeout(async () => {
      let more = [];
      try { more = await App.searchMore(q); } catch (e) { console.warn(e); }
      if (my !== tok) return;
      const merged = [];
      for (const r of more.filter(x => x.live)) merged.push(r);
      for (const r of more.filter(x => x.street && !x.live)) merged.push(r);
      for (const r of items) merged.push(r);
      for (const r of more.filter(x => !x.street && !x.live)) if (r.ask || r.dl || !merged.some(m => !m.ask && !m.dl && G.normKey(m.name) === G.normKey(r.name) && Math.abs(m.lat - r.lat) < 0.1 && Math.abs(m.lon - r.lon) < 0.1)) merged.push(r);
      items = merged.slice(0, 10); sel = items.length ? 0 : -1; status = ''; draw();
    }, G.LIVE ? 420 : 160);
  };
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(items[sel]); }
    else if (e.key === 'Escape') { box.hidden = true; inp.blur(); }
  });
  box.addEventListener('pointerdown', e => { const r = e.target.closest('.pr'); if (r) { e.preventDefault(); pick(items[+r.dataset.i]); } });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.psearch')) box.hidden = true; });
  inp.addEventListener('focus', () => { if (inp.value.trim()) run(); });
}

/* ---------- boot ---------- */
App.boot = async function () {
  const D = await G.DataInit(); App.D = D; Calc.initPlaces(D);
  initTheme(); buildTabs(); buildFilters(); initPlaceSearch(); initLive();
  const now = new Date(); F.y0 = now.getUTCFullYear(); F.y1 = F.y0 + 25;
  $('#fY0').value = F.y0; $('#fY1').value = F.y1;
  S.useUT = U.store.get('useUT', false);
  S.site = U.store.get('site', null) || { name: 'Luxor, Egypt', lat: 25.70, lon: 32.65, elev: 75, tz: 'Africa/Cairo' };
  if (typeof S.site.elev !== 'number') S.site.elev = Math.max(0, Calc.elevation(S.site.lat, S.site.lon));
  S.saved = U.store.get('saved', []);
  App.layout = null; placeLayout(); window.addEventListener('resize', placeLayout);
  // let the pane modules build their DOM
  for (const f of App.initFns || []) f();
  let id = (location.hash || '').slice(1) || U.store.get('event', null);
  let ev = D.byId.get(id) || D.byId.get('s-2027-08-02');
  S.tab = U.store.get('tab', 'earth'); if (S.tab === 'events' && App.layout !== 'narrow') S.tab = 'earth';
  App.setTab(S.tab);
  renderList();
  App.selectEvent(ev);
  App.emit('site', S.site);
  const ld = $('#loading'); if (ld) { ld.style.opacity = '0'; setTimeout(() => ld.remove(), 450); }
  App.ready = true;
};
App.initFns = [];
})(typeof globalThis !== 'undefined' ? globalThis : this);
