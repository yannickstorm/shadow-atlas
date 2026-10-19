/* App-level calculations: cached analyses, local circumstances, places, time zones, path geometry. */
(function (G) {
'use strict';
const A = G.Astronomy, Ecl = G.Ecl;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const cacheFull = new Map(), cacheFast = new Map();
const Calc = {};

Calc.full = function (ev) {
  let a = cacheFull.get(ev.id);
  if (!a) { a = ev.kind === 'solar' ? Ecl.analyzeSolar(ev.t) : Ecl.analyzeLunar(ev.t); cacheFull.set(ev.id, a); }
  return a;
};
Calc.fast = function (ev) {
  if (cacheFull.has(ev.id)) return cacheFull.get(ev.id);
  let a = cacheFast.get(ev.id);
  if (!a) { a = ev.kind === 'solar' ? Ecl.analyzeSolar(ev.t, { noPath: true }) : Ecl.analyzeLunar(ev.t); cacheFast.set(ev.id, a); }
  return a;
};

/* ---------- lunar local circumstances ---------- */
function moonAlt(ms, obs) {
  const t = Ecl.mkTime(ms), eq = A.Equator('Moon', t, obs, true, true);
  return A.Horizon(t, obs, eq.ra, eq.dec, 'normal').altitude;
}
function sunAlt(ms, obs) {
  const t = Ecl.mkTime(ms), eq = A.Equator('Sun', t, obs, true, true);
  return A.Horizon(t, obs, eq.ra, eq.dec, 'normal').altitude;
}
/* A lunar eclipse is seen only while the Moon is above the horizon AND the Sun is below it.
   The "main phase" is the umbral (partial/total) phase, or the penumbral phase for penumbral-only eclipses. */
Calc.lunarLocal = function (an, lat, lon, elev) {
  const obs = new A.Observer(lat, lon, elev || 0);
  const names = [['P1', an.tP1], ['U1', an.tU1], ['U2', an.tU2], ['max', an.tGreatest], ['U3', an.tU3], ['U4', an.tU4], ['P4', an.tP4]];
  const out = { contacts: {}, ob: { lat, lon, elev } };
  for (const [n, t] of names) if (t) out.contacts[n] = { t, alt: moonAlt(t, obs), sun: sunAlt(t, obs) };
  const s0 = an.tU1 || an.tP1, s1 = an.tU4 || an.tP4;
  const okAt = t => { const m = moonAlt(t, obs); return { m, s: sunAlt(t, obs), ok: m > 0 && sunAlt(t, obs) < -0.8 }; };
  let good = 0; const N = 36;
  for (let i = 0; i <= N; i++) if (okAt(s0 + (s1 - s0) * i / N).ok) good++;
  out.fractionUp = good / (N + 1);
  const st = okAt(s0), en = okAt(s1), mx = okAt(an.tGreatest);
  out.altStart = st.m; out.altEnd = en.m; out.altMax = out.contacts.max.alt; out.sunMax = mx.s;
  out.visible = out.fractionUp > 0;
  out.whole = st.ok && en.ok && out.fractionUp > 0.97;
  out.maxUp = mx.ok;
  out.partLabel = !out.visible ? 'not visible'
    : (!st.ok && en.ok) ? (st.m <= 0 ? 'Moon rises' : 'starts in daylight')
    : (st.ok && !en.ok) ? (en.m <= 0 ? 'Moon sets' : 'ends at sunrise')
    : 'partly visible';
  out.whyNot = out.visible ? '' : (mx.m <= 0 ? 'The Moon is below the horizon throughout the eclipse.' : 'The eclipse happens in daylight here.');
  out.eclipse = true; out.kind = an.type === 'T' ? 'total' : an.type === 'P' ? 'partial' : 'penumbral';
  out.mag = an.umbralMag; out.penMag = an.penumbralMag;
  return out;
};
Calc.local = function (ev, an, lat, lon, elev) {
  return ev.kind === 'solar' ? Ecl.local(an, lat, lon, elev) : Calc.lunarLocal(an, lat, lon, elev);
};

/* ---------- places ---------- */
const EXTRAS = [
  ['Tarifa', 'Spain', 36.01, -5.60, 'Europe/Madrid'], ['Abu Simbel', 'Egypt', 22.34, 31.63, 'Africa/Cairo'], ['Valley of the Kings', 'Egypt', 25.74, 32.60, 'Africa/Cairo'],
  ['Siwa Oasis', 'Egypt', 29.20, 25.52, 'Africa/Cairo'], ['Gibraltar', 'Gibraltar', 36.14, -5.35, 'Europe/Gibraltar'], ['Tétouan', 'Morocco', 35.58, -5.37, 'Africa/Casablanca'],
  ['Uluru', 'Australia', -25.34, 131.04, 'Australia/Darwin'], ['Kununurra', 'Australia', -15.77, 128.74, 'Australia/Perth'], ['Snæfellsnes', 'Iceland', 64.85, -23.0, 'Atlantic/Reykjavik'],
  ['Ciudad Real', 'Spain', 38.99, -3.93, 'Europe/Madrid'], ['Teruel', 'Spain', 40.34, -1.11, 'Europe/Madrid'], ['Soria', 'Spain', 41.76, -2.46, 'Europe/Madrid'],
  ['Queenstown', 'New Zealand', -45.03, 168.66, 'Pacific/Auckland'], ['Fiordland', 'New Zealand', -45.4, 167.7, 'Pacific/Auckland'], ['Hurghada', 'Egypt', 27.26, 33.81, 'Africa/Cairo'],
  ['Mount Teide', 'Spain', 28.27, -16.64, 'Atlantic/Canary'], ['Mauna Kea', 'United States', 19.82, -155.47, 'Pacific/Honolulu'], ['Atacama Desert', 'Chile', -23.86, -69.14, 'America/Santiago'],
  ['Patagonia (El Calafate)', 'Argentina', -50.34, -72.26, 'America/Argentina/Rio_Gallegos'], ['Tierra del Fuego (Ushuaia)', 'Argentina', -54.8, -68.3, 'America/Argentina/Ushuaia'],
  ['Svalbard (Longyearbyen)', 'Norway', 78.22, 15.65, 'Arctic/Longyearbyen'], ['Spitsbergen', 'Norway', 78.0, 16.0, 'Arctic/Longyearbyen'],
];
Calc.initPlaces = function (D) {
  const strip = G.strip;
  for (const e of EXTRAS) D.cities.push({ id: D.cities.length, name: e[0], ascii: e[0], country: e[1], lat: e[2], lon: e[3], tz: e[4], pop: 5e4, prov: '', key: strip(e[0]), ckey: strip(e[1]), extra: true });
  Calc.cities = D.cities; Calc.D = D;
};
Calc.searchPlaces = function (q, limit) {
  q = G.strip(q.trim()); if (!q) return [];
  const m = q.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  const out = [];
  if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ custom: true, name: 'Point ' + lat.toFixed(3) + ', ' + lon.toFixed(3), lat, lon }); }
  const starts = [], inc = [], ctry = [];
  for (const c of Calc.cities) {
    if (c.key.startsWith(q)) starts.push(c); else if (c.key.includes(' ' + q) || c.key.includes(q)) inc.push(c); else if (c.ckey === q || c.ckey.startsWith(q)) ctry.push(c);
    if (starts.length > 60 && inc.length > 60) break;
  }
  const by = (a, b) => (b.extra ? 1 : 0) - (a.extra ? 1 : 0) || b.pop - a.pop;
  starts.sort((a, b) => b.pop - a.pop); inc.sort((a, b) => b.pop - a.pop); ctry.sort((a, b) => b.pop - a.pop);
  return out.concat(starts, inc, ctry).slice(0, limit || 8);
};
function dist2(lat1, lon1, lat2, lon2) { const dl = ((lon2 - lon1 + 540) % 360) - 180, c = Math.cos((lat1 + lat2) / 2 * D2R); const dx = dl * c, dy = lat2 - lat1; return dx * dx + dy * dy; }
Calc.nearestCity = function (lat, lon, minPop) {
  let best = null, bd = 1e18;
  for (const c of Calc.cities) { if (minPop && c.pop < minPop) continue; const d = dist2(lat, lon, c.lat, c.lon); if (d < bd) { bd = d; best = c; } }
  return best ? { city: best, km: Math.sqrt(bd) * 111.2 } : null;
};
Calc.tzFor = function (lat, lon) {
  const n = Calc.nearestCity(lat, lon);
  if (n && n.km < 900) return n.city.tz;
  const off = Math.round(lon / 15); return off === 0 ? 'UTC' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off);
};
Calc.elevation = function (lat, lon) { return Math.round(G.TS ? G.TS.at(lat, lon) : Calc.D.terrain.at(lat, lon)); };
Calc.siteAt = function (lat, lon, name) {
  const n = Calc.nearestCity(lat, lon, 15000);
  const el = Math.max(0, Calc.elevation(lat, lon));
  let nm = name;
  if (!nm) nm = n && n.km < 60 ? (n.km < 8 ? n.city.name : 'Near ' + n.city.name) + ', ' + n.city.country : lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°';
  return { name: nm, lat, lon, elev: el, tz: Calc.tzFor(lat, lon) };
};

/* ---------- path geometry ---------- */
Calc.distToPath = function (an, lat, lon) {
  const p = an.path; if (!p) return null;
  let best = 1e18, bi = 0;
  for (let i = 0; i < p.t.length; i++) { const d = dist2(lat, lon, p.lat[i], p.lon[i]); if (d < best) { best = d; bi = i; } }
  // signed side: compare with north limit position
  const km = Math.sqrt(best) * 111.2;
  const dN = p.nlat[bi] === null ? 1e9 : dist2(lat, lon, p.nlat[bi], p.nlon[bi]), dS = p.slat[bi] === null ? 1e9 : dist2(lat, lon, p.slat[bi], p.slon[bi]);
  return { km: Ecl.geoDist(lat, lon, p.lat[bi], p.lon[bi]), idx: bi, side: dN < dS ? 'north' : 'south', t: p.t[bi], halfWidth: p.width[bi] / 2 };
};
Calc.fmt = {};
G.Calc = Calc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
