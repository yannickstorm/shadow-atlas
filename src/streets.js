/* Street map data, loaded on demand from files published next to the page.
   world.txt / towns.txt: worldwide major roads, rivers, lakes, built-up areas, state lines (Natural Earth) and towns.
   sm/*: main roads, rail and towns along eclipse paths 2026-2036; sd/*: minor roads, tracks, paths, hamlets
   along the total eclipses of 2027-2028 (Overture Maps transportation, derived from OpenStreetMap). */
(function (G) {
'use strict';
const MAN = G.__STREETS_MANIFEST || { q: 20000, layers: [] };
const Q = MAN.q || 20000, NC = 180 * 360;
const CLASSES = { sm: [0, 1, 2, 3, 4, 9], sd: [5, 6, 7, 8] };
const ST = G.ST = { version: 0, world: null, towns: null, layers: {}, CLASS_NAMES: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor road', 'street', 'track', 'path', 'railway'] };
for (const L of MAN.layers) ST.layers[L.name] = { name: L.name, block: L.block, files: new Set(L.files), split: new Set(L.split || []), has: new Set(L.cells || []), cells: new Array(NC), loading: new Map() };
const cellKey = (la, lo) => (la + 90) * 360 + (lo + 180);
const wrapLon = lo => ((lo + 180) % 360 + 360) % 360 - 180;

function b64(text) {
  text = text.trim();
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text);
  const bin = atob(text), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const getText = path => fetch(path).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
const TD = new TextDecoder();
function reader(u8) {
  let p = 0;
  const r = {
    u() { let v = 0, s = 1, b; do { b = u8[p++]; v += (b & 0x7f) * s; s *= 128; } while (b & 0x80); return v; },
    z() { const v = r.u(); return v % 2 ? -(v + 1) / 2 : v / 2; },
    b() { return u8[p++]; },
    s() { const n = r.u(), t = TD.decode(u8.subarray(p, p + n)); p += n; return t; },
    get p() { return p; },
  };
  return r;
}

/* ---------- worldwide layer ---------- */
function decodeSection(rd, scale, ox, oy) {
  const n = rd.u(), cls = new Uint8Array(n), off = new Uint32Array(n + 1), bbox = new Float32Array(n * 4), xy = [];
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    cls[i] = rd.b(); const m = rd.u(); off[i] = xy.length / 2;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < m; k++) {
      x += rd.z(); y += rd.z(); const lon = x / scale - ox, lat = y / scale - oy; xy.push(lon, lat);
      if (lon < x0) x0 = lon; if (lon > x1) x1 = lon; if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
    }
    bbox[i * 4] = x0; bbox[i * 4 + 1] = y0; bbox[i * 4 + 2] = x1; bbox[i * 4 + 3] = y1;
  }
  off[n] = xy.length / 2;
  return { n, cls, off, bbox, xy: new Float32Array(xy) };
}
ST.loadWorld = function () {
  if (ST._world) return ST._world;
  ST._world = Promise.all([getText('streets/world.txt').then(t => inflate(b64(t))), getText('streets/towns.txt').then(t => inflate(b64(t)))]).then(([w, t]) => {
    const rd = reader(w);
    const [roads, rivers, adm, lakes, urban] = [0, 1, 2, 3, 4].map(() => decodeSection(rd, 2000, 180, 90));
    ST.world = { roads, rivers, adm, lakes, urban };
    const rt = reader(t), n = rt.u(), towns = new Array(n);
    for (let i = 0; i < n; i++) { const name = rt.s(), lat = rt.u() / 1000 - 90, lon = rt.u() / 1000 - 180, kind = rt.b(), pop = rt.u() * 100; towns[i] = { name, lat, lon, kind, pop }; }
    ST.towns = towns; ST.version++;
    return ST.world;
  }).catch(e => { console.warn('street map: world layer unavailable', e); ST._world = null; return null; });
  return ST._world;
};

/* ---------- path-corridor cells ---------- */
function blockName(L, la, lo) {
  const b = L.block, bl = Math.floor(la / b) * b, bo = Math.floor(lo / b) * b;
  let n = (bl >= 0 ? 'N' : 'S') + String(Math.abs(bl)).padStart(2, '0') + (bo >= 0 ? 'E' : 'W') + String(Math.abs(bo)).padStart(3, '0');
  if (L.split.has(n)) n += (la - bl >= b / 2 ? 'n' : 's') + (lo - bo >= b / 2 ? 'e' : 'w');
  return n;
}
function loadFile(L, name) {
  if (L.loading.has(name)) return L.loading.get(name);
  const pr = getText('streets/' + L.name + '/' + name + '.txt').then(t => {
    const u8 = b64(t), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), count = dv.getUint16(8, true), idx = new Map();
    for (let i = 0; i < count; i++) { const o = 10 + i * 12; idx.set(cellKey(dv.getInt16(o, true), dv.getInt16(o + 2, true)), [dv.getUint32(o + 4, true), dv.getUint32(o + 8, true)]); }
    return { u8, idx };
  }).catch(() => null);
  L.loading.set(name, pr);
  return pr;
}
function decodeCell(raw, layer, la, lo) {
  const rd = reader(raw), nn = rd.u(), names = new Array(nn);
  for (let i = 0; i < nn; i++) names[i] = rd.s();
  const cls = {};
  let px = 0, py = 0;
  for (const c of CLASSES[layer]) {
    const n = rd.u(), name = new Int32Array(n), off = new Uint32Array(n + 1), bbox = new Float32Array(n * 4), xy = [];
    for (let i = 0; i < n; i++) {
      name[i] = rd.u() - 1; const m = rd.u(); off[i] = xy.length / 2;
      let x = px + rd.z(), y = py + rd.z(), x0 = x, x1 = x, y0 = y, y1 = y;
      xy.push(x / Q, y / Q);
      for (let k = 1; k < m; k++) { x += rd.z(); y += rd.z(); xy.push(x / Q, y / Q); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      px = x; py = y;
      bbox[i * 4] = lo + x0 / Q; bbox[i * 4 + 1] = la + y0 / Q; bbox[i * 4 + 2] = lo + x1 / Q; bbox[i * 4 + 3] = la + y1 / Q;
    }
    off[n] = xy.length / 2;
    cls[c] = { n, name, off, bbox, xy: new Float32Array(xy) };     // xy relative to the cell corner (lo, la)
  }
  const np = rd.u(), places = new Array(np);
  for (let i = 0; i < np; i++) { const name = rd.s(), x = rd.u(), y = rd.u(), kind = rd.b(), pop = rd.u() * 100; places[i] = { name, lat: la + y / Q, lon: lo + x / Q, kind, pop }; }
  return { la, lo, layer, names, cls, places };
}
/* load the cells of a layer that cover a box; resolves to true when something new arrived */
ST.ensureBox = async function (layer, lat0, lat1, lon0, lon1, maxCells) {
  const L = ST.layers[layer]; if (!L) return false;
  const jobs = []; let count = 0;
  for (let la = Math.floor(lat0); la <= Math.floor(lat1); la++) {
    if (la < -90 || la > 89) continue;
    for (let lo0 = Math.floor(lon0); lo0 <= Math.floor(lon1); lo0++) {
      const lo = wrapLon(lo0), k = cellKey(la, lo);
      if (L.cells[k] !== undefined) continue;
      if (++count > (maxCells || 400)) break;
      const bn = blockName(L, la, lo); if (!L.has.has(k) || !L.files.has(bn)) { L.cells[k] = null; continue; }
      L.cells[k] = 'loading';
      jobs.push(loadFile(L, bn).then(async f => {
        const e = f && f.idx.get(k);
        if (!e) { L.cells[k] = null; return false; }
        try { L.cells[k] = decodeCell(await inflate(f.u8.subarray(e[0], e[0] + e[1])), layer, la, lo); return true; }
        catch (err) { L.cells[k] = null; return false; }
      }));
    }
  }
  const got = (await Promise.all(jobs)).some(Boolean);
  if (got) ST.version++;
  return got;
};
/* decoded cells of a layer inside a box (only those already loaded) */
ST.cellsIn = function (layer, lat0, lat1, lon0, lon1) {
  const L = ST.layers[layer], out = []; if (!L) return out;
  for (let la = Math.floor(lat0); la <= Math.floor(lat1); la++) {
    if (la < -90 || la > 89) continue;
    for (let lo0 = Math.floor(lon0); lo0 <= Math.floor(lon1); lo0++) {
      const c = L.cells[cellKey(la, wrapLon(lo0))];
      if (c && c !== 'loading') out.push(c);
    }
  }
  return out;
};
/* is there corridor street data at a point? 'detail' | 'main' | null */
ST.coverage = function (lat, lon) {
  const la = Math.floor(lat), lo = wrapLon(Math.floor(lon));
  for (const [name, lv] of [['sd', 'detail'], ['sm', 'main']]) { const L = ST.layers[name]; if (L && L.has.has(cellKey(la, lo))) return lv; }
  return null;
};
ST.hasData = () => Object.keys(ST.layers).length > 0;

/* ---------- street-name search around a point ---------- */
ST.findStreet = async function (query, lat, lon, km) {
  const dl = km / 111, dlo = km / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  await Promise.all(['sm', 'sd'].map(l => ST.ensureBox(l, lat - dl, lat + dl, lon - dlo, lon + dlo, 16)));
  const qn = G.normKey(query); if (!qn) return [];
  const words = G.addrTokens(query); if (!words.length) return [];
  const best = new Map();
  for (const layer of ['sm', 'sd']) for (const cell of ST.cellsIn(layer, lat - dl, lat + dl, lon - dlo, lon + dlo)) {
    const keys = cell.names.map(n => G.normKey(n));
    // every significant word of the query must start a word of the street name ("av andalucia" finds "Avenida de Andalucía")
    const hits = new Set(); cell.names.forEach((n, i) => { const tk = G.addrTokens(n); if (words.every(w => tk.some(t => t.startsWith(w)))) hits.add(i); });
    if (!hits.size) continue;
    for (const c in cell.cls) {
      const C = cell.cls[c];
      for (let i = 0; i < C.n; i++) {
        if (!hits.has(C.name[i])) continue;
        // nearest vertex of this street to the reference point
        let bd = 1e18, bx = 0, by = 0;
        for (let k = C.off[i]; k < C.off[i + 1]; k++) {
          const x = cell.lo + C.xy[k * 2], y = cell.la + C.xy[k * 2 + 1], dx = (x - lon) * Math.cos(lat * Math.PI / 180), dy = y - lat, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bx = x; by = y; }
        }
        const name = cell.names[C.name[i]], exact = keys[C.name[i]] === qn || G.addrTokens(name).join(' ') === words.join(' ');
        const cur = best.get(name);
        const km2 = Math.sqrt(bd) * 111.2;
        if (km2 <= km && (!cur || km2 < cur.km)) best.set(name, { name, lat: by, lon: bx, km: km2, exact, cls: +c });
      }
    }
  }
  return [...best.values()].sort((a, b) => (b.exact - a.exact) || a.km - b.km).slice(0, 6);
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
