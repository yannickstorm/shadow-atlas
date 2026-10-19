/* Data decoding: terrain grid, coast/border lines, cities, stars, Milky Way, catalogue. */
(function (G) {
'use strict';
const PK = G.__PACKED, CAT = G.__CATALOG;
const D2R = Math.PI / 180;

async function inflate(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function varints(u8, start, count) {
  const out = new Int32Array(count); let p = start;
  for (let i = 0; i < count; i++) {
    let v = 0, s = 0, b;
    do { b = u8[p++]; v += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80);
    out[i] = (v % 2 === 0) ? v / 2 : -(v + 1) / 2;
  }
  return { out, end: p };
}

/* ---------- terrain ---------- */
class Terrain {
  constructor(w, h, step, elev) {
    this.w = w; this.h = h; this.step = step; this.elev = elev;
    this.shade = new Uint8Array(w * h);
    this.patches = [];
    this.buildShade();
  }
  buildShade() {
    const { w, h, step, elev, shade } = this;
    const R = 6371000, dphi = step * D2R;
    const az = 315 * D2R, zen = 42 * D2R;
    const lx = Math.sin(zen) * Math.sin(az), ly = Math.sin(zen) * Math.cos(az), lz = Math.cos(zen);
    for (let i = 0; i < h; i++) {
      const lat = (90 - (i + 0.5) * step) * D2R;
      const dy = R * dphi * 2, dx = Math.max(R * Math.cos(lat) * dphi * 2, R * dphi * 0.2);
      const i0 = Math.max(0, i - 1), i1 = Math.min(h - 1, i + 1);
      for (let j = 0; j < w; j++) {
        const jm = (j + w - 1) % w, jp = (j + 1) % w;
        const e0 = elev[i * w + j];
        const zf = e0 > 0 ? 9 : 5;
        const gx = (elev[i * w + jp] - elev[i * w + jm]) / dx * zf;
        const gy = (elev[i0 * w + j] - elev[i1 * w + j]) / dy * zf;      // north is up (row 0)
        const nl = Math.sqrt(gx * gx + gy * gy + 1);
        let s = (-gx * lx - gy * ly + lz) / nl;
        s = Math.max(0, Math.min(1, s));
        shade[i * w + j] = Math.round(s * 255);
      }
    }
  }
  // bilinear elevation (m)
  at(lat, lon) {
    const { w, h, step, elev } = this;
    let u = (lon + 180) / step - 0.5, v = (90 - lat) / step - 0.5;
    u = ((u % w) + w) % w;
    if (v < 0) v = 0; else if (v > h - 1.0001) v = h - 1.0001;
    const j0 = Math.floor(u), i0 = Math.floor(v), fu = u - j0, fv = v - i0, j1 = (j0 + 1) % w;
    const a = elev[i0 * w + j0], b = elev[i0 * w + j1], c = elev[(i0 + 1) * w + j0], d = elev[(i0 + 1) * w + j1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
}

/* ---------- lines ---------- */
async function decodeLines(obj) {
  const u8 = await inflate(obj.b64);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(0, true);
  // total ints unknown: decode incrementally
  const U = obj.u;
  const lines = []; let p = 4;
  const rd = () => { let v = 0, s = 0, b; do { b = u8[p++]; v += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80); return (v % 2 === 0) ? v / 2 : -(v + 1) / 2; };
  for (let k = 0; k < n; k++) {
    const cnt = rd() + 2;
    let x = rd(), y = rd();
    const pts = new Float32Array(cnt * 2);
    pts[0] = x * U; pts[1] = y * U;
    let mnx = pts[0], mxx = pts[0], mny = pts[1], mxy = pts[1];
    for (let i = 1; i < cnt; i++) {
      x += rd(); y += rd();
      const lx = x * U, ly = y * U;
      pts[i * 2] = lx; pts[i * 2 + 1] = ly;
      if (lx < mnx) mnx = lx; if (lx > mxx) mxx = lx; if (ly < mny) mny = ly; if (ly > mxy) mxy = ly;
    }
    lines.push({ pts, bbox: [mnx, mny, mxx, mxy] });
  }
  return lines;
}

/* ---------- cities ---------- */
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function decodeCities(obj) {
  const u8 = await inflate(obj.b64);
  const J = JSON.parse(new TextDecoder().decode(u8));
  const list = J.r.map((r, i) => ({
    id: i, name: r[0], ascii: r[1] || r[0], country: J.c[r[2]], lat: r[3], lon: r[4], tz: J.z[r[5]], pop: r[6] * 1000, prov: J.p[r[7]],
    key: strip(r[0] + ' ' + (r[1] || '')), ckey: strip(J.c[r[2]]),
  }));
  return list;
}

/* ---------- stars ---------- */
async function decodeStars(obj) {
  const u8 = await inflate(obj.b64);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = obj.n;
  const ra = new Float32Array(n), dec = new Float32Array(n), mag = new Float32Array(n), bv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    ra[i] = dv.getUint16(o, true) / 65536 * 360 * D2R;
    dec[i] = dv.getInt16(o + 2, true) / 32767 * 90 * D2R;
    mag[i] = dv.getInt8(o + 4) / 10;
    bv[i] = (dv.getUint8(o + 5) - 20) / 50;
  }
  // unit vectors (J2000 equatorial)
  const vec = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = Math.cos(dec[i]); vec[i * 3] = c * Math.cos(ra[i]); vec[i * 3 + 1] = c * Math.sin(ra[i]); vec[i * 3 + 2] = Math.sin(dec[i]); }
  const names = new Map(obj.names.map(a => [a[0], a[1]]));
  return { n, ra, dec, mag, bv, vec, names };
}

async function init() {
  const D = {};
  const [tU8, coast, border, cities, stars, milky] = await Promise.all([
    inflate(PK.terrain.b64), decodeLines(PK.coast), decodeLines(PK.border), decodeCities(PK.cities), decodeStars(PK.stars), inflate(PK.milky.b64),
  ]);
  const { w, h, q, step } = PK.terrain, N = w * h;
  const { out: res } = varints(tU8, 0, N);
  const elev = new Float32Array(N);
  const Q = new Int32Array(N);
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const k = i * w + j;
      const a = j > 0 ? Q[k - 1] : 0, b = i > 0 ? Q[k - w] : 0, c = (i > 0 && j > 0) ? Q[k - w - 1] : 0;
      const mx = a > b ? a : b, mn = a > b ? b : a;
      const pred = c >= mx ? mn : c <= mn ? mx : a + b - c;
      const v = pred + res[k];
      Q[k] = v; elev[k] = v * q;
    }
  }
  D.terrain = new Terrain(w, h, step, elev);
  D.coast = coast; D.border = border; D.cities = cities; D.stars = stars;
  D.milky = { w: PK.milky.w, h: PK.milky.h, data: milky };
  D.countries = PK.countries.map(c => ({ name: c[0], lon: c[1], lat: c[2], area: c[3] }));
  D.const = PK.const;
  D.peaks = (PK.peaks || []).map(p => ({ name: p[0], lat: p[1], lon: p[2], elev: p[3] }));
  // catalogue
  const names = CAT.names;
  const fix = (r, kind) => {
    r.kind = kind; r.date = new Date(r.t);
    const d = r.date; r.id = (kind === 'solar' ? 's' : 'l') + '-' + d.toISOString().slice(0, 10);
    if (r.cn) r.countries = r.cn.map(i => names[i]);
    r.at = r.at != null ? names[r.at] : null;
    return r;
  };
  D.solar = CAT.solar.map(r => fix(r, 'solar'));
  D.lunar = CAT.lunar.map(r => fix(r, 'lunar'));
  D.events = D.solar.concat(D.lunar).sort((a, b) => a.t - b.t);
  D.byId = new Map(D.events.map(e => [e.id, e]));
  G.DATA = D;
  return D;
}
G.DataInit = init;
G.strip = strip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
