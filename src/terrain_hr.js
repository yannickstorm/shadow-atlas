/* Multi-resolution terrain: 1x1 degree cells shipped as bundle files next to the page and loaded on demand.
   Layers: f240 (1/240 deg, ~460 m) along eclipse paths, m60 (1/60 deg, ~1.9 km) on all land, and the
   built-in 1/8 deg grid as the last fallback. */
(function (G) {
'use strict';
const MAN = G.__TERRAIN_MANIFEST || { layers: [] };
/* Live mode: outside claude.ai (a downloaded copy, or one served from your own machine) the page may reach
   online map services, so terrain, street tiles and address search come straight from them. */
G.LIVE = (function () {
  try {
    if (typeof window === 'undefined' || window.claude) return false;
    if (/(^|\.)(claude\.ai|claude\.site|claudeusercontent\.com|anthropic\.com)$/.test(location.hostname)) return false;
    if (localStorage.getItem('sa-offline') === '1') return false;
    return true;
  } catch (e) { return false; }
})();
const NC = 180 * 360;
const TS = G.TS = { layers: [], hmax: 0, listeners: [] };
for (const L of MAN.layers) TS.layers.push({ name: L.name, res: L.res, q: L.q, block: L.block, blocks: new Set(L.blocks), cells: new Array(NC), files: new Map() });
const key = (la, lo) => (la + 90) * 360 + (((lo + 180) % 360) + 360) % 360;
const blockName = (L, la, lo) => { const b = L.block, bl = Math.floor(la / b) * b, bo = Math.floor(lo / b) * b; return (bl >= 0 ? 'N' : 'S') + String(Math.abs(bl)).padStart(2, '0') + (bo >= 0 ? 'E' : 'W') + String(Math.abs(bo)).padStart(3, '0'); };

async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function decodeCell(raw, n, q) {
  const N = n * n, out = new Float32Array(N), Q = new Int32Array(N); let p = 0;
  for (let k = 0; k < N; k++) {
    let v = 0, s = 0, b;
    do { b = raw[p++]; v += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80);
    const r = (v % 2 === 0) ? v / 2 : -(v + 1) / 2;
    const i = (k / n) | 0, j = k - i * n;
    const a = j > 0 ? Q[k - 1] : 0, bb = i > 0 ? Q[k - n] : 0, c = (i > 0 && j > 0) ? Q[k - n - 1] : 0;
    const mx = a > bb ? a : bb, mn = a > bb ? bb : a;
    Q[k] = (c >= mx ? mn : c <= mn ? mx : a + bb - c) + r;
    out[k] = Q[k] * q;
  }
  return out;
}
function loadFile(L, name) {
  if (L.files.has(name)) return L.files.get(name);
  // bundles ship as base64 text because the host serves only web media types
  const pr = fetch('terrain/' + L.name + '/' + name + '.txt').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(b64 => {
    let u8;
    if (Uint8Array.fromBase64) u8 = Uint8Array.fromBase64(b64.trim());
    else { const bin = atob(b64.trim()); u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); }
    const buf = u8.buffer;
    const dv = new DataView(buf), count = dv.getUint16(8, true), idx = new Map();
    for (let i = 0; i < count; i++) { const o = 10 + i * 12; idx.set(key(dv.getInt16(o, true), dv.getInt16(o + 2, true)), [dv.getUint32(o + 4, true), dv.getUint32(o + 8, true)]); }
    return { buf, idx };
  }).catch(() => null);
  L.files.set(name, pr);
  return pr;
}
/* ---------- live terrain: Terrarium elevation tiles (AWS Open Data), resampled into 1x1 degree cells ---------- */
const LIVE_Z = 9, tileCache = new Map();
const mercY = lat => { const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
function liveTile(x, y) {
  const k = x + ',' + y; if (tileCache.has(k)) return tileCache.get(k);
  const pr = new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 256; const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0); const d = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        res(e);
      } catch (err) { res(null); }
    };
    img.onerror = () => res(null);
    img.src = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + LIVE_Z + '/' + x + '/' + y + '.png';
  });
  tileCache.set(k, pr);
  return pr;
}
async function liveCell(la, lo, res) {
  const N = 1 << LIVE_Z, S = N * 256, n = res + 1;
  const gx0 = (lo + 180) / 360 * S, gx1 = (lo + 1 + 180) / 360 * S, gy0 = mercY(la + 1) * S, gy1 = mercY(la) * S;
  const tx0 = Math.floor(gx0 / 256), tx1 = Math.floor((gx1 - 1e-6) / 256), ty0 = Math.floor(gy0 / 256), ty1 = Math.min(N - 1, Math.floor((gy1 - 1e-6) / 256));
  const tiles = new Map();
  await Promise.all([...Array((tx1 - tx0 + 1) * (ty1 - ty0 + 1)).keys()].map(async i => {
    const tx = tx0 + i % (tx1 - tx0 + 1), ty = ty0 + Math.floor(i / (tx1 - tx0 + 1));
    tiles.set(tx + ',' + ty, await liveTile(((tx % N) + N) % N, ty));
  }));
  if ([...tiles.values()].some(t => !t)) return null;
  const out = new Float32Array(n * n);
  const px = (gx, gy) => {
    gx = Math.max(gx0, Math.min(gx1 - 0.001, gx)); gy = Math.max(gy0, Math.min(gy1 - 0.001, gy));
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), t = tiles.get(tx + ',' + ty);
    const fx = Math.min(254.999, Math.max(0, gx - tx * 256 - 0.5)), fy = Math.min(254.999, Math.max(0, gy - ty * 256 - 0.5));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = j * 256 + i;
    return (t[o] * (1 - u) + t[o + 1] * u) * (1 - v) + (t[o + 256] * (1 - u) + t[o + 257] * u) * v;
  };
  for (let r = 0; r < n; r++) {
    const gy = mercY(la + 1 - r / res) * S;
    for (let c = 0; c < n; c++) out[r * n + c] = px((lo + c / res + 180) / 360 * S, gy);
  }
  return out;
}
/* make sure all cells in a lat/lon box are decoded (both layers). Resolves to the number of cells now available. */
TS.ensureBox = async function (lat0, lat1, lon0, lon1) {
  const jobs = [];
  if (G.LIVE && TS.layers.length && !TS.liveFailed) {
    const L = TS.layers[0], cells = [];
    for (let la = Math.floor(lat0); la <= Math.floor(lat1); la++) {
      if (la < -85 || la > 84) continue;
      for (let lo = Math.floor(lon0); lo <= Math.floor(lon1); lo++) { const lon = ((lo + 180) % 360 + 360) % 360 - 180, k = key(la, lon); if (L.cells[k] === undefined) cells.push([la, lon, k]); }
    }
    if (cells.length > 90) return TS.version || 0;            // too large an area for live downloads; the coarse grid covers it
    let failed = 0;
    await Promise.all(cells.map(async ([la, lon, k]) => {
      L.cells[k] = 'loading';
      const data = await liveCell(la, lon, L.res);
      if (!data) { L.cells[k] = undefined; failed++; return; }
      let mx = -1e9; for (let i = 0; i < data.length; i += 7) if (data[i] > mx) mx = data[i];
      if (mx > TS.hmax) TS.hmax = mx;
      L.cells[k] = data; TS.loaded = (TS.loaded || 0) + 1;
    }));
    if (failed && failed === cells.length && !TS.loaded) TS.liveFailed = true;      // offline: fall back to the bundled files
    else { TS.version = TS.loaded || 0; return TS.version; }
  }
  for (const L of TS.layers) {
    const want = [];
    for (let la = Math.floor(lat0); la <= Math.floor(lat1); la++) {
      if (la < -90 || la > 89) continue;
      for (let lo = Math.floor(lon0); lo <= Math.floor(lon1); lo++) {
        const lon = ((lo + 180) % 360 + 360) % 360 - 180, k = key(la, lon);
        if (L.cells[k] !== undefined) continue;
        const bn = blockName(L, la, lon); if (!L.blocks.has(bn)) { L.cells[k] = null; continue; }
        want.push([la, lon, k, bn]);
      }
    }
    for (const [la, lon, k, bn] of want) {
      jobs.push(loadFile(L, bn).then(async f => {
        if (L.cells[k] !== undefined) return;
        const e = f && f.idx.get(k);
        if (!e) { L.cells[k] = null; return; }
        L.cells[k] = 'loading';
        const raw = await inflate(new Uint8Array(f.buf, e[0], e[1]));
        const data = decodeCell(raw, L.res + 1, L.q);
        let mx = -1e9; for (let i = 0; i < data.length; i += 7) if (data[i] > mx) mx = data[i];
        if (mx > TS.hmax) TS.hmax = mx;
        L.cells[k] = data; TS.loaded = (TS.loaded || 0) + 1;
      }));
    }
  }
  await Promise.all(jobs);
  TS.version = TS.loaded || 0;
  return TS.version;
};
TS.ensureAround = (lat, lon, km) => { const dl = km / 111, dlo = km / (111 * Math.max(0.15, Math.cos(lat * Math.PI / 180))); return TS.ensureBox(lat - dl, lat + dl, lon - dlo, lon + dlo); };
/* bilinear elevation in metres, best available layer */
TS.at = function (lat, lon) {
  if (lon >= 180) lon -= 360; else if (lon < -180) lon += 360;
  const la = Math.floor(lat), lo = Math.floor(lon), k = (la + 90) * 360 + (lo + 180);
  for (let li = 0; li < TS.layers.length; li++) {
    const L = TS.layers[li], c = L.cells[k];
    if (!c || c === 'loading') continue;
    const n = L.res, w = n + 1;
    let fy = (la + 1 - lat) * n, fx = (lon - lo) * n;
    let i0 = fy | 0, j0 = fx | 0; if (i0 >= n) i0 = n - 1; if (j0 >= n) j0 = n - 1;
    const ty = fy - i0, tx = fx - j0, o = i0 * w + j0;
    return (c[o] * (1 - tx) + c[o + 1] * tx) * (1 - ty) + (c[o + w] * (1 - tx) + c[o + w + 1] * tx) * ty;
  }
  return G.DATA.terrain.at(lat, lon);
};
/* which resolution is available at a point: 'fine', 'medium' or 'coarse' */
TS.quality = function (lat, lon) {
  const k = (Math.floor(lat) + 90) * 360 + (((Math.floor(lon) + 180) % 360) + 360) % 360;
  for (const L of TS.layers) { const c = L.cells[k]; if (c && c !== 'loading') return L.res >= 200 ? 'fine' : 'medium'; }
  return 'coarse';
};
TS.hasLayers = () => TS.layers.length > 0;
TS.resLabel = q => q === 'fine' ? 'about 460 m' : q === 'medium' ? 'about 1.9 km' : 'about 14 km';
})(typeof globalThis !== 'undefined' ? globalThis : this);
