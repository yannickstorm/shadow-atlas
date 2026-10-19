/* UI utilities: formatting, time zones, storage, labels, icons. */
(function (G) {
'use strict';
const U = {};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
U.MONTHS = MONTHS;

/* ---------- time formatting ---------- */
const fmtCache = new Map();
function dtf(tz, opts, key) {
  const k = tz + '|' + key; let f = fmtCache.get(k);
  if (!f) { try { f = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, opts)); } catch (e) { f = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'UTC' }, opts)); } fmtCache.set(k, f); }
  return f;
}
U.hms = (ms, tz) => dtf(tz || 'UTC', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, 'hms').format(new Date(ms));
U.hm = (ms, tz) => dtf(tz || 'UTC', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'hm').format(new Date(ms));
U.dayLocal = (ms, tz) => { const p = dtf(tz || 'UTC', { year: 'numeric', month: 'numeric', day: 'numeric' }, 'ymd').formatToParts(new Date(ms)); const o = {}; p.forEach(x => o[x.type] = +x.value); return o; };
U.offsetMin = (ms, tz) => {
  if (!tz || tz === 'UTC') return 0;
  const p = dtf(tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }, 'full').formatToParts(new Date(ms)), o = {};
  p.forEach(x => o[x.type] = +x.value);
  return Math.round((Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(ms / 1000) * 1000) / 60000);
};
U.offsetLabel = (ms, tz) => { const m = U.offsetMin(ms, tz), s = m < 0 ? '−' : '+', a = Math.abs(m); return 'UTC' + (m === 0 ? '' : s + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : '')); };
U.date = (ms, tz) => { const o = U.dayLocal(ms, tz); return o.day + ' ' + MONTHS[o.month - 1] + ' ' + o.year; };
U.dateLong = (ms, tz) => { const o = U.dayLocal(ms, tz), wd = new Date(Date.UTC(o.year, o.month - 1, o.day)).getUTCDay(); return DAYS[wd] + ' ' + o.day + ' ' + MONTHS_L[o.month - 1] + ' ' + o.year; };
U.dateIso = ms => new Date(ms).toISOString().slice(0, 10);
U.pad = (n, k = 2) => String(n).padStart(k, '0');
U.dur = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return m ? m + 'm ' + U.pad(r) + 's' : r + 's'; };
U.durMin = m => { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + 'h ' + U.pad(m % 60) + 'm' : m + ' min'; };
U.coord = (lat, lon) => Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(lon).toFixed(2) + '°' + (lon >= 0 ? 'E' : 'W');
U.km = v => v >= 100 ? Math.round(v).toLocaleString('en-GB') + ' km' : v.toFixed(1) + ' km';
U.pct = v => (v * 100).toFixed(v >= 0.995 && v < 1 ? 2 : 1) + '%';
U.rel = ms => {
  const d = (ms - Date.now()) / 86400000, a = Math.abs(d);
  const txt = a < 1 ? 'today' : a < 60 ? Math.round(a) + ' days' : a < 700 ? Math.round(a / 30.44) + ' months' : (a / 365.25).toFixed(a < 3650 ? 1 : 0) + ' years';
  return a < 1 ? 'today' : d > 0 ? 'in ' + txt : txt + ' ago';
};
U.clamp = (x, a, b) => x < a ? a : x > b ? b : x;

/* ---------- storage ---------- */
U.store = {
  get(k, d) { try { const v = localStorage.getItem('shadowatlas.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('shadowatlas.' + k, JSON.stringify(v)); } catch (e) { } },
};

/* ---------- labels ---------- */
U.TYPE = {
  solar: { T: ['Total', 'Total solar eclipse'], A: ['Annular', 'Annular solar eclipse'], H: ['Hybrid', 'Hybrid solar eclipse'], P: ['Partial', 'Partial solar eclipse'] },
  lunar: { T: ['Total', 'Total lunar eclipse'], P: ['Partial', 'Partial lunar eclipse'], N: ['Penumbral', 'Penumbral lunar eclipse'] },
};
U.typeShort = ev => U.TYPE[ev.kind][ev.type][0];
U.typeLong = ev => U.TYPE[ev.kind][ev.type][1] + (ev.nc ? ' (non-central)' : '');
U.colorKey = ev => ev.kind === 'solar' ? 's' + ev.type : 'l' + ev.type;
U.color = ev => `var(--c-${U.colorKey(ev)})`;
U.icon = (ev, size = 22) => {
  const k = U.colorKey(ev), c = `var(--c-${k})`;
  const body = {
    sT: `<circle cx="12" cy="12" r="5.2" fill="${c}"/><circle cx="12" cy="12" r="9" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="1.6 2.6" stroke-linecap="round"/>`,
    sA: `<circle cx="12" cy="12" r="7.6" fill="none" stroke="${c}" stroke-width="3.4"/><circle cx="12" cy="12" r="4.4" fill="var(--icon-hole)"/>`,
    sH: `<circle cx="12" cy="12" r="5.4" fill="${c}"/><path d="M12 3.2a8.8 8.8 0 0 1 0 17.6" fill="none" stroke="${c}" stroke-width="2.6"/>`,
    sP: `<path d="M13.5 3.6a8.6 8.6 0 1 0 0 16.8A6.6 6.6 0 0 1 13.5 3.6z" fill="${c}"/>`,
    lT: `<circle cx="12" cy="12" r="8" fill="${c}"/><circle cx="12" cy="12" r="8" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="3"/>`,
    lP: `<circle cx="12" cy="12" r="8" fill="none" stroke="${c}" stroke-width="1.8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="${c}"/>`,
    lN: `<circle cx="12" cy="12" r="8" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.6"/>`,
  }[k];
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
};

/* ---------- geodesy ---------- */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
U.bearing = (lat1, lon1, lat2, lon2) => { const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R; return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360; };
U.dest = (lat, lon, brg, km) => { const d = km / 6371, b = brg * D2R, p1 = lat * D2R, l1 = lon * D2R; const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)); const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2)); return [p2 * R2D, ((l2 * R2D + 540) % 360) - 180]; };
U.compass = az => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];

G.U = U;
})(typeof globalThis !== 'undefined' ? globalThis : this);
