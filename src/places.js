/* Worldwide place-name index (cities, towns, villages, municipalities, neighbourhoods; hamlets along eclipse
   paths) from Overture Maps divisions. Sharded by the first character of the normalised name and loaded on demand. */
(function (G) {
'use strict';
const MAN = G.__PLACES_MANIFEST || { shards: {}, countries: [], cnames: [], regions: [] };
const PL = G.PL = { shards: new Map() };
const KIND_LABEL = ['city', 'town', 'village', 'hamlet', 'locality', 'municipality', 'district', 'neighbourhood'];
const KIND_W = [900, 720, 520, 330, 430, 640, 470, 380];
PL.KIND_LABEL = KIND_LABEL;

const SPECIAL = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'đ': 'd', 'ı': 'i', 'þ': 'th', 'ð': 'd', 'ħ': 'h' };
/* same normalisation as the build script: lower case, no accents, letters and digits separated by single spaces */
G.normKey = function (s) {
  s = String(s).toLowerCase().replace(/[ßøæœłđıþðħ]/g, ch => SPECIAL[ch]).normalize('NFD').replace(/\p{Mn}/gu, '');
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
};
// address words without articles and with common abbreviations spelled out
const STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'du', 'des', 'le', 'les', 'l', 'd', 'di', 'da', 'do', 'dos', 'das', 'della', 'delle', 'dei', 'von', 'van', 'der', 'den', 'the', 'of', 'y', 'e', 'et', 'and', 'al', 'a', 'en', 'i']);
const ABBR = Object.assign(Object.create(null), { av: 'avenida', avda: 'avenida', ave: 'avenue', c: 'calle', cl: 'calle', cra: 'carrera', ctra: 'carretera', pza: 'plaza', pl: 'place', pg: 'paseo', po: 'paseo', ch: 'chemin', rte: 'route', bd: 'boulevard', bvd: 'boulevard', blvd: 'boulevard', imp: 'impasse', st: 'street', rd: 'road', ln: 'lane', dr: 'drive', hwy: 'highway', str: 'strasse', r: 'rua', trav: 'travessa', v: 'via', ul: 'ulica', sq: 'square' });
G.addrTokens = s => G.normKey(s).replace(/strasse\b/g, ' strasse').split(' ').filter(w => w && !STOP.has(w)).map(w => ABBR[w] || w);
const shardOf = k => {
  const c = k[0];
  if (c >= 'a' && c <= 'z') return c;
  if (/\p{Nd}/u.test(c)) return '0';
  const cp = k.codePointAt(0);
  return cp < 0x3000 ? 'u' + (cp >> 8).toString(16).padStart(2, '0') : 'w' + (cp >> 12).toString(16).padStart(2, '0');
};

async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function b64(text) {
  text = text.trim();
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text);
  const bin = atob(text), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const TD = new TextDecoder();
function decodeShard(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(0, true); let p = 4;
  const blk = () => { const len = dv.getUint32(p, true), s = p + 4; p = s + len; return u8.subarray(s, s + len); };
  const names = blk(), lat = blk(), lon = blk(), cc = blk(), rg = blk(), kd = blk(), pp = blk();
  const out = { n, name: new Array(n), lat: new Float32Array(n), lon: new Float32Array(n), cc: new Uint16Array(n), rg: new Uint16Array(n), kind: kd, pop: new Float64Array(n), keys: new Array(n) };
  // names are front-coded (shared prefix length, suffix)
  let q = 0, prev = new Uint8Array(0);
  for (let i = 0; i < n; i++) {
    const pre = names[q++]; let len = 0, s = 1, b; do { b = names[q++]; len += (b & 0x7f) * s; s *= 128; } while (b & 0x80);
    const cur = new Uint8Array(pre + len); cur.set(prev.subarray(0, pre)); cur.set(names.subarray(q, q + len), pre); q += len;
    out.name[i] = TD.decode(cur); prev = cur;
  }
  for (let i = 0; i < n; i++) {
    out.lat[i] = (lat[i * 3] | lat[i * 3 + 1] << 8 | lat[i * 3 + 2] << 16) / 1e4 - 90;
    out.lon[i] = (lon[i * 3] | lon[i * 3 + 1] << 8 | lon[i * 3 + 2] << 16) / 1e4 - 180;
  }
  const vr = (arr, dst, mul) => { let q2 = 0; for (let i = 0; i < n; i++) { let v = 0, s = 1, b; do { b = arr[q2++]; v += (b & 0x7f) * s; s *= 128; } while (b & 0x80); dst[i] = v * mul; } };
  vr(cc, out.cc, 1); vr(rg, out.rg, 1); vr(pp, out.pop, 100);
  return out;
}
function loadShard(id) {
  if (!MAN.shards[id]) return Promise.resolve(null);
  if (PL.shards.has(id)) return PL.shards.get(id);
  const pr = fetch('places/' + id + '.txt').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(t => inflate(b64(t))).then(decodeShard).catch(e => { console.warn('place index unavailable', e); PL.shards.delete(id); return null; });
  PL.shards.set(id, pr);
  return pr;
}
const keyAt = (S, i) => S.keys[i] || (S.keys[i] = G.normKey(S.name[i]));
function lowerBound(S, q) {
  let a = 0, b = S.n;
  while (a < b) { const m = (a + b) >> 1; if (keyAt(S, m) < q) a = m + 1; else b = m; }
  return a;
}
const km = (a, b, c, d) => { const x = ((d - b + 540) % 360 - 180) * Math.cos((a + c) / 2 * Math.PI / 180), y = c - a; return Math.sqrt(x * x + y * y) * 111.2; };
PL.describe = function (r) {
  const parts = [];
  if (r.region && r.region !== r.name) parts.push(r.region);
  if (r.country) parts.push(r.country);
  return parts.join(', ');
};
/* places whose normalised name starts with the query; ranked by exact match, size, kind and distance to `near` */
PL.search = async function (query, opts) {
  opts = opts || {};
  const q = G.normKey(query); if (q.length < 2) return [];
  const S = await loadShard(shardOf(q)); if (!S) return [];
  const out = [], near = opts.near;
  for (let i = lowerBound(S, q), seen = 0; i < S.n && seen < 6000; i++, seen++) {
    const k = keyAt(S, i); if (!k.startsWith(q)) break;
    const kind = S.kind[i] & 0x7f, alias = S.kind[i] & 0x80;
    let score = KIND_W[kind] + Math.log10(S.pop[i] + 1) * 70 + (k === q ? 600 : k.startsWith(q + ' ') ? 120 : 0) - (alias ? 10 : 0);
    if (near) { const d = km(near.lat, near.lon, S.lat[i], S.lon[i]); score += 260 * Math.exp(-d / 150); }
    if (opts.country != null && S.cc[i] === opts.country) score += 200;
    out.push({ i, score });
  }
  out.sort((a, b) => b.score - a.score);
  const res = [], taken = [];
  for (const { i } of out) {
    const lat = S.lat[i], lon = S.lon[i], name = S.name[i];
    if (taken.some(t => t.k === keyAt(S, i) && km(t.lat, t.lon, lat, lon) < 4)) continue;
    taken.push({ k: keyAt(S, i), lat, lon });
    res.push({ name, lat, lon, kind: KIND_LABEL[S.kind[i] & 0x7f], pop: S.pop[i], country: MAN.cnames[S.cc[i]] || '', cc: MAN.countries[S.cc[i]] || '', ccIdx: S.cc[i], region: S.rg[i] ? MAN.regions[S.rg[i] - 1] : '', place: true });
    if (res.length >= (opts.limit || 8)) break;
  }
  return res;
};
PL.ready = () => Object.keys(MAN.shards).length > 0;
})(typeof globalThis !== 'undefined' ? globalThis : this);
