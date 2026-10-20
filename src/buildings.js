/* Buildings around the site (OpenStreetMap; live mode only). First from OpenFreeMap's vector tiles (pre-made,
   served from a CDN), else from the Overpass API.
   Height comes from the building's height tag, else its number of floors, else a typical height for its type
   (marked as estimated). BLD.angleAt gives how high buildings rise above eye level in a direction. */
(function (G) {
'use strict';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const TYPE_H = { house: 7, detached: 7, semidetached_house: 7, terrace: 8, bungalow: 4, residential: 11, apartments: 14, hotel: 18, commercial: 12, retail: 7, office: 16, industrial: 9, warehouse: 9, church: 18, cathedral: 30, mosque: 14, school: 10, university: 14, hospital: 18, civic: 12, public: 12,
  garage: 3, garages: 3, shed: 3, hut: 3, roof: 4, carport: 3, kiosk: 3, farm_auxiliary: 6, barn: 7, greenhouse: 3, cabin: 4, ruins: 4, yes: 8 };
const BLD = G.BLD = { list: [], ids: new Set(), idx: Array.from({ length: 360 }, () => []), version: 0, state: 'idle', key: '', radius: 500, site: null, focusDone: false };

const num = v => { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); if (!m) return NaN; let x = +m[0]; if (/ft|'/.test(v)) x *= 0.3048; return x; };
function heightOf(t) {
  let h = num(t.height), est = false;
  if (!(h > 0)) { const lv = num(t['building:levels']), rl = num(t['roof:levels']) || 0; if (lv > 0) h = lv * 3 + 1 + rl * 2; }
  if (!(h > 0)) { h = TYPE_H[t.building] || TYPE_H.yes; est = true; }
  const minH = num(t.min_height) || (num(t['building:min_level']) > 0 ? num(t['building:min_level']) * 3 : 0);
  return { h: Math.min(h, 400), minH: minH || 0, est };
}
/* ask the Overpass servers: the first starts at once, the next ones join if it has not answered after a few
   seconds; the first good answer wins and the others are cancelled */
function query(poly, signal) {
  const q = `[out:json][timeout:20];(way["building"](poly:"${poly}");way["building:part"](poly:"${poly}"););out tags geom;`;
  return new Promise((resolve, reject) => {
    const ctrls = [], timers = []; let started = 0, failed = 0, done = false;
    const finish = (ok, v) => { if (done) return; done = true; timers.forEach(clearTimeout); ctrls.forEach(c => c.abort()); ok ? resolve(v) : reject(v); };
    const start = () => {
      if (done || started >= SERVERS.length) return;
      const ac = new AbortController(), url = SERVERS[started++]; ctrls.push(ac);
      fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(j => finish(true, j))
        .catch(e => { if (done) return; if (++failed === SERVERS.length) finish(false, e); else if (failed === started) start(); });   // all started ones failed: try the next now
    };
    if (signal) signal.addEventListener('abort', () => finish(false, new DOMException('aborted', 'AbortError')));
    start();
    for (let i = 1; i < SERVERS.length; i++) timers.push(setTimeout(start, i * 4000));     // a slow server gets company after 4 s
  });
}
/* "lat lon lat lon …" outline of a ring sector around the site (azimuths in degrees, clockwise from north) */
function sector(site, a0, a1, r0, r1) {
  const cl = Math.cos(site.lat * D2R), pts = [], n = Math.max(2, Math.ceil((a1 - a0) / 6));
  const at = (a, r) => [site.lat + Math.cos(a * D2R) * r / 110574, site.lon + Math.sin(a * D2R) * r / (111320 * cl)];
  for (let i = 0; i <= n; i++) pts.push(at(a0 + (a1 - a0) * i / n, r1));
  if (r0 > 0) for (let i = n; i >= 0; i--) pts.push(at(a0 + (a1 - a0) * i / n, r0)); else pts.push([site.lat, site.lon]);
  return pts.map(p => p[0].toFixed(6) + ' ' + p[1].toFixed(6)).join(' ');
}
const inside = P => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > 0) !== (b[1] > 0) && 0 < (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
function addBuilding(site, id, pts, hh, name, type, part) {
  if (BLD.ids.has(id)) return false;
  BLD.ids.add(id);
  const cl = Math.cos(site.lat * D2R);
  const xy = pts.map(p => [(p[1] - site.lon) * 111320 * cl, (p[0] - site.lat) * 110574]);      // metres east / north of the site
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
  const b = { id, pts, xy, h: hh.h, minH: hh.minH, est: hh.est, name: name || '', type: type || 'building', part: !!part, base: G.TS ? G.TS.at(cx, cy) : 0, lat: cx, lon: cy };
  b.home = inside(xy);              // the building you stand at (an address puts the site inside it) is not an obstacle
  BLD.list.push(b);
  if (b.home) return true;
  // index by direction: the 1-degree azimuth buckets the footprint covers, seen from the site
  const az = xy.map(p => Math.atan2(p[0], p[1]) * R2D);
  let lo = az[0], hi = az[0]; const ref = az[0];
  for (const v of az) { let d = v - ref; d -= 360 * Math.round(d / 360); const u = ref + d; if (u < lo) lo = u; if (u > hi) hi = u; }
  for (let k = Math.floor(lo); k <= Math.floor(hi); k++) BLD.idx[((k % 360) + 360) % 360].push(b);
  return true;
}
function addElements(site, j) {
  let n = 0;
  for (const e of j.elements || []) {
    if (!e.geometry || e.geometry.length < 3) continue;
    const t = e.tags || {}; if (t.building === 'no' || t.building === 'roof' && !t.height) continue;
    if (addBuilding(site, 'w' + e.id, e.geometry.map(g => [g.lat, g.lon]), heightOf(t), t.name, t.building || t['building:part'], t['building:part'])) n++;
  }
  return n;
}

/* ---------- OpenFreeMap vector tiles (fast: pre-made, served from a CDN) ---------- */
// minimal Mapbox Vector Tile reader: only the "building" layer, polygons and two numeric properties
function pbf(buf) {
  let p = 0; const u8 = buf;
  const varint = () => { let v = 0, s = 1, b; do { b = u8[p++]; v += (b & 0x7f) * s; s *= 128; } while (b & 0x80); return v; };
  return {
    get pos() { return p; }, set pos(v) { p = v; }, varint,
    key() { const k = varint(); return [k >> 3, k & 7]; },
    bytes() { const n = varint(), s = p; p += n; return u8.subarray(s, s + n); },
    skip(w) { if (w === 0) varint(); else if (w === 1) p += 8; else if (w === 2) p += varint(); else if (w === 5) p += 4; },
    f32() { const v = new DataView(u8.buffer, u8.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; },
    f64() { const v = new DataView(u8.buffer, u8.byteOffset + p, 8).getFloat64(0, true); p += 8; return v; },
  };
}
const TD = new TextDecoder();
function readValue(b) {
  const r = pbf(b); let v = null;
  while (r.pos < b.length) { const [f, w] = r.key();
    if (f === 1) v = TD.decode(r.bytes()); else if (f === 2) v = r.f32(); else if (f === 3) v = r.f64();
    else if (f === 4 || f === 5) v = r.varint(); else if (f === 6) { const z = r.varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; } else if (f === 7) v = !!r.varint(); else r.skip(w); }
  return v;
}
function buildingsFromTile(buf, z, x, y) {
  const r = pbf(buf), out = [];
  while (r.pos < buf.length) {
    const [f, w] = r.key();
    if (f !== 3) { r.skip(w); continue; }
    const lb = r.bytes(), L = pbf(lb); let name = '', extent = 4096; const keys = [], vals = [], feats = [];
    while (L.pos < lb.length) { const [g, w2] = L.key();
      if (g === 1) name = TD.decode(L.bytes()); else if (g === 2) feats.push(L.bytes()); else if (g === 3) keys.push(TD.decode(L.bytes()));
      else if (g === 4) vals.push(readValue(L.bytes())); else if (g === 5) extent = L.varint(); else L.skip(w2); }
    if (name !== 'building') continue;
    const N = 1 << z, toLL = (px, py) => { const X = (x + px / extent) / N, Y = (y + py / extent) / N; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * R2D, X * 360 - 180]; };
    for (const fb of feats) {
      const F = pbf(fb); let id = 0, type = 0, tags = [], geom = [];
      while (F.pos < fb.length) { const [g, w3] = F.key();
        if (g === 1) id = F.varint(); else if (g === 3) type = F.varint();
        else if (g === 2 || g === 4) { const b = F.bytes(), q = pbf(b), arr = []; while (q.pos < b.length) arr.push(q.varint()); if (g === 2) tags = arr; else geom = arr; }
        else F.skip(w3); }
      if (type !== 3) continue;
      const props = {}; for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      // rings: MoveTo(1) LineTo(2) ClosePath(7); keep outer rings (positive area in tile coordinates)
      let i = 0, cx = 0, cy = 0, ring = null;
      const rings = [];
      while (i < geom.length) {
        const cmd = geom[i] & 7, cnt = geom[i] >> 3; i++;
        if (cmd === 7) { if (ring) rings.push(ring); ring = null; continue; }
        for (let k = 0; k < cnt; k++) {
          const dx = geom[i++], dy = geom[i++]; cx += dx % 2 ? -(dx + 1) / 2 : dx / 2; cy += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (cmd === 1) ring = [[cx, cy]]; else ring.push([cx, cy]);
        }
      }
      for (const R of rings) {
        let a = 0; for (let k = 0, j = R.length - 1; k < R.length; j = k++) a += (R[j][0] - R[k][0]) * (R[j][1] + R[k][1]);
        if (a <= 0 || R.length < 3) continue;          // a hole, or degenerate
        const pts = R.map(p => toLL(p[0], p[1])); pts.push(pts[0]);
        const h = +props.render_height, minH = +props.render_min_height || 0;
        out.push({ id: 't' + z + '/' + x + '/' + y + '/' + id + '/' + R[0].join(','), pts, hh: { h: h > 0 ? Math.min(h, 400) : 8, minH, est: !(h > 0) || h === 5 } });
      }
    }
  }
  return out;
}
let tileUrl = null;
async function tileTemplate(signal) {
  if (tileUrl) return tileUrl;
  const j = await fetch('https://tiles.openfreemap.org/planet', { signal }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  if (!j.tiles || !j.tiles[0]) throw new Error('no tile address');
  return (tileUrl = j.tiles[0]);
}
async function loadTiles(site, focus, onUpdate, ac) {
  const tpl = await tileTemplate(ac.signal), z = 14, N = 1 << z, R = BLD.radius;
  const cl = Math.cos(site.lat * D2R), dLat = R / 110574, dLon = R / (111320 * cl);
  const tx = lon => Math.floor((lon + 180) / 360 * N), ty = lat => { const s = Math.sin(lat * D2R); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N); };
  const tiles = [];
  for (let x = tx(site.lon - dLon); x <= tx(site.lon + dLon); x++) for (let y = ty(site.lat + dLat); y <= ty(site.lat - dLat); y++) {
    // priority: the tile under the site, then tiles toward the Sun/Moon, then the rest
    const cLon = (x + 0.5) / N * 360 - 180, cLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / N))) * R2D;
    const az = ((Math.atan2((cLon - site.lon) * cl, cLat - site.lat) * R2D) + 360) % 360;
    let pri = 2; if (x === tx(site.lon) && y === ty(site.lat)) pri = 0;
    else if (focus) { let m = ((focus.az0 + focus.az1) / 2) % 360, d = Math.abs(az - m); d = Math.min(d, 360 - d); if (d <= (focus.az1 - focus.az0) / 2 + 30) pri = 1; }
    tiles.push({ x, y, pri });
  }
  tiles.sort((a, b) => a.pri - b.pri);
  let ok = 0, fail = 0;
  await Promise.all(tiles.map(async (t, i) => {
    try {
      const buf = new Uint8Array(await fetch(tpl.replace('{z}', z).replace('{x}', t.x).replace('{y}', t.y), { signal: ac.signal }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }));
      if (ac.signal.aborted) return;
      const dl = R / 110574 * 1.1, dlo = R / (111320 * cl) * 1.1;
      for (const b of buildingsFromTile(buf, z, t.x, t.y)) {
        const c = b.pts[0]; if (Math.abs(c[0] - site.lat) > dl || Math.abs(c[1] - site.lon) > dlo) continue;
        addBuilding(site, b.id, b.pts, b.hh, '', 'building', false);
      }
      ok++; if (t.pri <= 1 && tiles.filter(q => q.pri <= 1).length === ok) BLD.focusDone = true;
      BLD.version++; if (onUpdate) onUpdate();
    } catch (e) { if (!ac.signal.aborted) fail++; }
  }));
  if (!ok) throw new Error('no building tiles');
  BLD.source = 'OpenFreeMap';
}
/* load the buildings around a site, the directions of the eclipse first (focus: {az0, az1}, degrees clockwise,
   az1 >= az0) and the rest of the circle after; onUpdate runs each time more buildings arrive */
BLD.load = async function (site, focus, onUpdate) {
  if (!G.LIVE || !site) return [];
  const key = site.lat.toFixed(5) + ',' + site.lon.toFixed(5);
  if (key === BLD.key && BLD.state !== 'error') return BLD.list;
  if (BLD.ac) BLD.ac.abort();
  const ac = BLD.ac = new AbortController();
  Object.assign(BLD, { key, state: 'loading', list: [], ids: new Set(), idx: Array.from({ length: 360 }, () => []), site: { lat: site.lat, lon: site.lon }, focus: focus || null, focusDone: false, error: '' });
  BLD.version++;
  try { await loadTiles(site, focus, onUpdate, ac); BLD.focusDone = true; BLD.state = 'ready'; BLD.version++; if (onUpdate) onUpdate(); return BLD.list; }
  catch (e) { if (ac.signal.aborted) return BLD.list; BLD.list = []; BLD.ids = new Set(); BLD.idx = Array.from({ length: 360 }, () => []); BLD.focusDone = false; BLD.source = 'Overpass'; }
  const R = BLD.radius, phases = [];
  if (focus && focus.az1 - focus.az0 < 290) {
    const a0 = focus.az0 - 12, a1 = focus.az1 + 12, rest = 360 - (a1 - a0);
    phases.push([a0, a1, 0, 180, true], [a0, a1, 180, R, true]);
    if (rest > 0) { const m = a1 + rest / 2; phases.push([a1, m, 0, R], [m, a0 + 360, 0, R]); }
  } else phases.push([0, 180, 0, R, true], [180, 360, 0, R, true]);
  let errors = 0, focusLeft = phases.filter(p => p[4]).length;
  for (const [a0, a1, r0, r1, isFocus] of phases) {
    try {
      const j = await query(sector(site, a0, a1, r0, r1), ac.signal);
      if (ac.signal.aborted) return BLD.list;
      addElements(site, j);
    } catch (e) { if (ac.signal.aborted) return BLD.list; errors++; BLD.error = String(e.message || e); }
    if (isFocus && --focusLeft === 0) BLD.focusDone = true;
    BLD.version++;
    if (onUpdate) onUpdate();
  }
  BLD.focusDone = true;
  BLD.state = errors === phases.length ? 'error' : 'ready';
  BLD.version++;
  if (onUpdate) onUpdate();
  return BLD.list;
};
BLD.stats = () => { const n = BLD.list.length, est = BLD.list.filter(b => b.est).length; return { n, est, measured: n - est }; };

/* highest building (angle above the horizontal, degrees) toward an azimuth, seen from eye height h0 (m above sea level) */
BLD.angleAt = function (site, h0, az, halfWidth) {
  if (!BLD.list.length || !BLD.site || Math.abs(site.lat - BLD.site.lat) > 1e-5 || Math.abs(site.lon - BLD.site.lon) > 1e-5) return null;
  const a = az * D2R, ux = Math.sin(a), uy = Math.cos(a);
  let best = null;
  for (const b of BLD.idx[((Math.floor(az) % 360) + 360) % 360]) {
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
