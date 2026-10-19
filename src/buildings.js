/* Buildings around the site (OpenStreetMap via the Overpass API, live mode only).
   Height comes from the building's height tag, else its number of floors, else a typical height for its type
   (marked as estimated). BLD.angleAt gives how high buildings rise above eye level in a direction. */
(function (G) {
'use strict';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const TYPE_H = { house: 7, detached: 7, semidetached_house: 7, terrace: 8, bungalow: 4, residential: 11, apartments: 14, hotel: 18, commercial: 12, retail: 7, office: 16, industrial: 9, warehouse: 9, church: 18, cathedral: 30, mosque: 14, school: 10, university: 14, hospital: 18, civic: 12, public: 12,
  garage: 3, garages: 3, shed: 3, hut: 3, roof: 4, carport: 3, kiosk: 3, farm_auxiliary: 6, barn: 7, greenhouse: 3, cabin: 4, ruins: 4, yes: 8 };
const BLD = G.BLD = { list: [], version: 0, state: 'idle', key: '', radius: 500, site: null };

const num = v => { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); if (!m) return NaN; let x = +m[0]; if (/ft|'/.test(v)) x *= 0.3048; return x; };
function heightOf(t) {
  let h = num(t.height), est = false;
  if (!(h > 0)) { const lv = num(t['building:levels']), rl = num(t['roof:levels']) || 0; if (lv > 0) h = lv * 3 + 1 + rl * 2; }
  if (!(h > 0)) { h = TYPE_H[t.building] || TYPE_H.yes; est = true; }
  const minH = num(t.min_height) || (num(t['building:min_level']) > 0 ? num(t['building:min_level']) * 3 : 0);
  return { h: Math.min(h, 400), minH: minH || 0, est };
}
async function query(lat, lon, r, signal) {
  const q = `[out:json][timeout:25];(way["building"](around:${r},${lat.toFixed(6)},${lon.toFixed(6)});way["building:part"](around:${r},${lat.toFixed(6)},${lon.toFixed(6)}););out tags geom;`;
  let err;
  for (const url of SERVERS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (signal && signal.aborted) throw e; err = e; }
  }
  throw err || new Error('no Overpass server answered');
}
/* load the buildings around a site; resolves to the list (empty when not available) */
BLD.load = async function (site) {
  if (!G.LIVE || !site) return [];
  const key = site.lat.toFixed(4) + ',' + site.lon.toFixed(4);
  if (key === BLD.key && BLD.state !== 'error') return BLD.list;
  if (BLD.ac) BLD.ac.abort();
  const ac = BLD.ac = new AbortController();
  BLD.key = key; BLD.state = 'loading'; BLD.list = []; BLD.site = { lat: site.lat, lon: site.lon }; BLD.version++;
  try {
    const j = await query(site.lat, site.lon, BLD.radius, ac.signal);
    if (ac.signal.aborted) return BLD.list;
    const cl = Math.cos(site.lat * D2R), out = [];
    for (const e of j.elements || []) {
      if (!e.geometry || e.geometry.length < 3) continue;
      const t = e.tags || {}; if (t.building === 'no' || t.building === 'roof' && !t.height) continue;
      const hh = heightOf(t), pts = e.geometry.map(g => [g.lat, g.lon]);
      // local metres east/north of the site
      const xy = pts.map(p => [(p[1] - site.lon) * 111320 * cl, (p[0] - site.lat) * 110574]);
      let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
      out.push({ pts, xy, h: hh.h, minH: hh.minH, est: hh.est, name: t.name || '', type: t.building || t['building:part'] || 'building', part: !!t['building:part'], base: G.TS ? G.TS.at(cx, cy) : 0, lat: cx, lon: cy });
    }
    // the building you stand at (an address puts the site inside its footprint) is not an obstacle
    const inside = P => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > 0) !== (b[1] > 0) && 0 < (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    for (const b of out) if (inside(b.xy)) b.home = true;
    BLD.list = out; BLD.state = 'ready';
  } catch (e) { if (!ac.signal.aborted) { BLD.state = 'error'; BLD.error = String(e.message || e); } }
  BLD.version++;
  return BLD.list;
};
BLD.stats = () => { const n = BLD.list.length, est = BLD.list.filter(b => b.est).length; return { n, est, measured: n - est }; };

/* highest building (angle above the horizontal, degrees) toward an azimuth, seen from eye height h0 (m above sea level) */
BLD.angleAt = function (site, h0, az, halfWidth) {
  if (!BLD.list.length || !BLD.site || Math.abs(site.lat - BLD.site.lat) > 1e-5 || Math.abs(site.lon - BLD.site.lon) > 1e-5) return null;
  const a = az * D2R, ux = Math.sin(a), uy = Math.cos(a);
  let best = null;
  for (const b of BLD.list) {
    if (b.home) continue;
    // distance along the sight line where it crosses the footprint: test each edge against the ray
    let dmin = Infinity;
    const P = b.xy;
    for (let i = 0; i < P.length - 1; i++) {
      const x1 = P[i][0], y1 = P[i][1], x2 = P[i + 1][0], y2 = P[i + 1][1];
      // ray: t*(ux,uy), t>0; segment: p1 + s*(p2-p1), 0<=s<=1
      const ex = x2 - x1, ey = y2 - y1, den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (x1 * ey - y1 * ex) / den, s = (x1 * uy - y1 * ux) / den;
      if (t > 0.5 && s >= 0 && s <= 1 && t < dmin) dmin = t;
    }
    if (!isFinite(dmin)) continue;
    const top = b.base + b.h, ang = Math.atan((top - h0) / dmin) * R2D;
    if (top - h0 <= 0) continue;
    if (!best || ang > best.ang) best = { ang, d: dmin, top, h: b.h, est: b.est, name: b.name, type: b.type, b };
  }
  return best;
};
BLD.label = r => (r.name ? r.name : r.type === 'yes' || r.type === 'building' ? 'A building' : 'A ' + r.type.replace(/_/g, ' ') + ' building') + ` (${Math.round(r.h)} m${r.est ? ', estimated' : ''})`;
})(typeof globalThis !== 'undefined' ? globalThis : this);
