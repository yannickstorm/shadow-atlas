/* MapView: topographic globe and flat map with eclipse overlays. Two stacked canvases:
   base (per-pixel raster, reduced resolution) and over (vector overlay at device resolution). */
(function (G) {
'use strict';
const W_ = v => v.cw, H_ = v => v.ch;
const D2R = Math.PI / 180, R2D = 180 / Math.PI, PI = Math.PI;
const BA = 1 - 1 / 298.257223563, BA2 = BA * BA;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* ---------- hypsometric palettes ---------- */
const PALETTES = {
  dark: {
    stops: [[-10500, '#071230'], [-7000, '#0a1c44'], [-4000, '#102d5c'], [-2000, '#1b4a7a'], [-600, '#2d6e97'], [-120, '#4a93aa'], [-1, '#6bb0b8'],
      [0, '#6f8f66'], [150, '#86a176'], [500, '#b7b585'], [1000, '#cbbd88'], [1800, '#c19f6c'], [2800, '#a5795a'], [3800, '#8c6a58'], [5000, '#9a8a84'], [6500, '#dcd6d2'], [8800, '#fbf9f7']],
    ice: [236, 242, 250], nightMin: 0.22, nightTint: [0.78, 0.86, 1.12],
    plainLand: '#3a4a47', plainSea: '#0c1730', bg: '#060b1a',
  },
  light: {
    stops: [[-10500, '#5f86ad'], [-7000, '#6f96b9'], [-4000, '#86abc8'], [-2000, '#9dc0d6'], [-600, '#b2d1e1'], [-120, '#c6dfea'], [-1, '#d3e7ee'],
      [0, '#c6d1ae'], [150, '#d3d9b4'], [500, '#e4dcb6'], [1000, '#e3cf9f'], [1800, '#d6b784'], [2800, '#bf9672'], [3800, '#a77f66'], [5000, '#aa9a92'], [6500, '#e6e1dd'], [8800, '#ffffff']],
    ice: [248, 250, 253], nightMin: 0.42, nightTint: [0.80, 0.88, 1.08],
    plainLand: '#dfe3d3', plainSea: '#c9dcea', bg: '#dbe6ef',
  },
};
/* street-map style: flat land and water with soft hill shading; roads coloured by class (OpenStreetMap conventions) */
const STREET = {
  light: { land: [242, 239, 233], water: [170, 211, 223], river: '#8fc3d8', urban: '#e6e0d6', adm: 'rgba(120,96,140,0.45)', label: '#262b33', halo: 'rgba(255,255,255,0.9)', ferry: 'rgba(70,120,190,0.55)',
    road: [['#e892a2', '#b44f69'], ['#f9b29c', '#c06a4c'], ['#fcd6a4', '#b98a4a'], ['#f7fabf', '#a3a463'], ['#ffffff', '#b5ada0'], ['#ffffff', '#bdb6aa'], ['#ffffff', '#c9c2b6'], ['#9d7646', null], ['#d9705c', null], ['#7c7f86', null]] },
  dark: { land: [30, 36, 47], water: [16, 36, 58], river: '#2c587a', urban: '#2a303c', adm: 'rgba(190,170,220,0.35)', label: '#e8ecf4', halo: 'rgba(6,11,26,0.85)', ferry: 'rgba(120,170,230,0.5)',
    road: [['#c45f78', '#2a1018'], ['#b8694f', '#24120c'], ['#a98352', '#20160b'], ['#8e8a52', '#1b1a0b'], ['#5d6678', '#12161e'], ['#4f5869', '#12161e'], ['#475061', '#12161e'], ['#8b6a43', null], ['#b0645a', null], ['#8a8f99', null]] },
};
// class -> [min pixels per degree to draw, base width at 1000 px/deg]
const ROAD_VIS = [[25, 3], [25, 2.6], [40, 2.4], [80, 2], [250, 1.6], [600, 1.25], [1500, 1.05], [900, 1], [2500, 0.8], [250, 1.2]];
const ROAD_ORDER = [8, 7, 6, 5, 9, 4, 3, 2, 1, 0];
const LUT_MIN = -11000, LUT_STEP = 20, LUT_N = 1000;
function buildLUT(p) {
  const r = new Uint8Array(LUT_N), g = new Uint8Array(LUT_N), b = new Uint8Array(LUT_N);
  const st = p.stops.map(s => [s[0], hex(s[1])]);
  for (let i = 0; i < LUT_N; i++) {
    const e = LUT_MIN + i * LUT_STEP;
    let k = 0; while (k < st.length - 2 && e > st[k + 1][0]) k++;
    const a = st[k], c = st[k + 1], t = clamp((e - a[0]) / (c[0] - a[0]), 0, 1);
    r[i] = a[1][0] + (c[1][0] - a[1][0]) * t; g[i] = a[1][1] + (c[1][1] - a[1][1]) * t; b[i] = a[1][2] + (c[1][2] - a[1][2]) * t;
  }
  return { r, g, b };
}
const LUTS = { dark: buildLUT(PALETTES.dark), light: buildLUT(PALETTES.light) };

const EVT_COLORS = { T: '#ffcf5c', A: '#ff8f3f', H: '#4fd1c1', P: '#8aa0d6' };

class MapView {
  constructor(host, DATA, Ecl) {
    this.host = host; this.D = DATA; this.Ecl = Ecl;
    this.base = document.createElement('canvas'); this.over = document.createElement('canvas');
    for (const c of [this.base, this.over]) { c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'; host.appendChild(c); }
    this.over.style.touchAction = 'none'; this.over.style.cursor = 'grab';
    this.bctx = this.base.getContext('2d', { willReadFrequently: false }); this.octx = this.over.getContext('2d');
    this.theme = 'dark';
    this.mode = 'globe';
    this.lat0 = 25; this.lon0 = 20; this.zoom = 1;
    this.layers = { relief: true, borders: true, grid: true, cities: true, contours: true, tint: true, labels: true, daynight: true, style: 'streets' };
    this.ev = null; this.an = null; this.field = null; this.site = null; this.time = Date.now();
    this.dirtyGeo = true; this.dirtyBase = true; this.pending = false; this.interacting = false;
    this.cb = {};
    this.bw = 0; this.bh = 0;
    this._bindEvents();
    this.ro = new ResizeObserver(() => { this.resize(); });
    this.ro.observe(host);
    this.resize();
  }
  /* ----- state setters ----- */
  setTheme(t) { this.theme = t; this.dirtyBase = true; this.request(); }
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m; this.zoom = 1; this.dirtyGeo = true; this.request();
  }
  setLayers(o) { Object.assign(this.layers, o); this.dirtyBase = true; this.request(); }
  setEvent(ev, an, field, lunarInfo) { this.ev = ev; this.an = an; this.field = field; this.lunar = lunarInfo || null; this.dirtyBase = true; this.request(); }
  setTime(ms) { this.time = ms; this.request(); }
  setSite(s) { this.site = s; this.request(); }
  setView(lat, lon, zoom, mode) {
    if (mode && mode !== this.mode) { this.mode = mode; this.dirtyGeo = true; }
    this.lat0 = clamp(lat, -85, 85); this.lon0 = ((lon + 540) % 360) - 180; if (zoom) this.zoom = zoom;
    this.dirtyGeo = true; this.request();
  }
  on(name, f) { this.cb[name] = f; }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.cw = Math.max(50, Math.round(r.width)); this.ch = Math.max(50, Math.round(r.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.over.width = Math.round(this.cw * this.dpr); this.over.height = Math.round(this.ch * this.dpr);
    this.dirtyGeo = true; this.request();
  }
  request() { if (this.pending) return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.render(); }); }

  /* ----- projection ----- */
  get R() { return Math.min(this.cw, this.ch) / 2 * 0.9 * this.zoom; }
  get ppd() { return Math.max(this.cw / 360, this.ch / 180) * this.zoom; }
  get stdPar() { return this.lat0 * D2R * smooth(1.5, 5, this.zoom); }
  project(lat, lon) {   // -> [x, y, visible(1/0), depth]
    if (this.mode === 'globe') {
      const p0 = this.lat0 * D2R, l0 = this.lon0 * D2R, p = lat * D2R, l = lon * D2R, R = this.R;
      const dl = l - l0, cp = Math.cos(p), z = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(dl);
      return [this.cw / 2 + R * cp * Math.sin(dl), this.ch / 2 - R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(dl)), z > 0 ? 1 : 0, z];
    }
    let dl = ((lon - this.lon0 + 540) % 360) - 180;
    const cs = Math.cos(this.stdPar), ppd = this.ppd;
    return [this.cw / 2 + dl * cs * ppd, this.ch / 2 - (lat - this.lat0) * ppd, 1, 1];
  }
  unproject(px, py) {    // css px -> [lat, lon] or null
    if (this.mode === 'globe') {
      const R = this.R, x = (px - this.cw / 2) / R, y = (this.ch / 2 - py) / R, r2 = x * x + y * y;
      if (r2 > 1) return null;
      const z = Math.sqrt(1 - r2), p0 = this.lat0 * D2R, s0 = Math.sin(p0), c0 = Math.cos(p0);
      const sp = z * s0 + y * c0;
      return [Math.asin(sp) * R2D, ((this.lon0 + Math.atan2(x, z * c0 - y * s0) * R2D + 540) % 360) - 180];
    }
    const cs = Math.cos(this.stdPar), ppd = this.ppd;
    const lat = this.lat0 + (this.ch / 2 - py) / ppd;
    if (lat > 90 || lat < -90) return null;
    return [lat, ((this.lon0 + (px - this.cw / 2) / (ppd * cs) + 540) % 360) - 180];
  }

  /* ----- interaction ----- */
  _bindEvents() {
    const el = this.over, ptrs = new Map();
    let drag = null, pinch = null, moved = 0;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const r = el.getBoundingClientRect();
      if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, grab: this.unproject(e.clientX - r.left, e.clientY - r.top), lat0: this.lat0, lon0: this.lon0 }; moved = 0; el.style.cursor = 'grabbing'; }
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom }; drag = null; }
    });
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.setZoom(pinch.z * d / pinch.d); return;
      }
      if (drag) {
        moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
        this.interacting = true;
        if (this.mode === 'globe') this._dragGlobe(drag, px, py);
        else {
          const ppd = this.ppd, cs = Math.cos(this.stdPar);
          this.lon0 = ((drag.lon0 - (e.clientX - drag.x) / (ppd * cs) + 540) % 360) - 180;
          this.lat0 = clamp(drag.lat0 + (e.clientY - drag.y) / ppd, -85, 85);
        }
        this.dirtyGeo = true; this.request(); this._settle();
        this.cb.view && this.cb.view(this);
      } else if (this.cb.hover) {
        const u = this.unproject(px, py); this.cb.hover(u ? { lat: u[0], lon: u[1], x: px, y: py } : null);
      }
    });
    const up = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (drag && ptrs.size === 0) {
        el.style.cursor = 'grab';
        if (moved < 5 && this.cb.pick) { const r = el.getBoundingClientRect(); const u = this.unproject(e.clientX - r.left, e.clientY - r.top); if (u) this.cb.pick({ lat: u[0], lon: u[1] }); }
        drag = null;
      }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { this.cb.hover && this.cb.hover(null); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const before = this.unproject(px, py);
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0016), before, px, py);
    }, { passive: false });
    el.addEventListener('dblclick', e => {
      const r = el.getBoundingClientRect(); const u = this.unproject(e.clientX - r.left, e.clientY - r.top);
      if (u) { this.lat0 = clamp(u[0], -85, 85); this.lon0 = u[1]; this.setZoom(this.zoom * 1.8); }
    });
  }
  _dragGlobe(drag, px, py) {
    // degrees per pixel at the globe centre; longitude rotates about the polar axis, latitude tilts the view
    const k = R2D / this.R;
    if (drag.lx === undefined) { drag.lx = drag.x - this.over.getBoundingClientRect().left; drag.ly = drag.y - this.over.getBoundingClientRect().top; }
    const dx = px - drag.lx, dy = py - drag.ly; drag.lx = px; drag.ly = py;
    this.lat0 = clamp(this.lat0 + dy * k, -88, 88);
    this.lon0 = ((this.lon0 - dx * k + 540) % 360) - 180;
  }
  setZoom(z, anchor, px, py) {
    const max = this.mode === 'globe' ? 14 : (G.ST && G.ST.hasData() && this.layers.style === 'streets' ? 9000 : 320), min = this.mode === 'globe' ? 0.7 : 1;
    this.zoom = clamp(z, min, max);
    if (anchor && this.mode === 'flat') {      // keep anchor under cursor
      const cs = Math.cos(this.stdPar), ppd = this.ppd;
      this.lat0 = clamp(anchor[0] + (py - this.ch / 2) / ppd, -85, 85);
      this.lon0 = ((anchor[1] - (px - this.cw / 2) / (ppd * cs) + 540) % 360) - 180;
    }
    this.interacting = true; this.dirtyGeo = true; this.request(); this._settle();
    this.cb.view && this.cb.view(this);
  }
  _settle() { clearTimeout(this._st); this._st = setTimeout(() => { this.interacting = false; this.dirtyGeo = true; this.request(); }, 140); }

  /* ----- base raster ----- */
  _buildGeo() {
    const fast = this.interacting;
    const maxDim = fast ? 460 : 1100;
    const sc = Math.min(1, maxDim / Math.max(this.cw, this.ch));
    const bw = Math.max(40, Math.round(this.cw * sc)), bh = Math.max(40, Math.round(this.ch * sc));
    if (bw !== this.bw || bh !== this.bh) {
      this.bw = bw; this.bh = bh; const N = bw * bh;
      this.base.width = bw; this.base.height = bh;
      this.img = this.bctx.createImageData(bw, bh); this.px32 = new Uint32Array(this.img.data.buffer);
      this.A = { valid: new Uint8Array(N), sLon: new Float32Array(N), cLon: new Float32Array(N), rs: new Float32Array(N), rc: new Float32Array(N), lat: new Float32Array(N), lon: new Float32Array(N),
        r: new Uint8Array(N), g: new Uint8Array(N), b: new Uint8Array(N), mag: new Float32Array(N), cls: new Uint8Array(N) };
    }
    this.sc = sc;
    const A = this.A, T = this.D.terrain, tw = T.w, th = T.h, tstep = T.step, elev = T.elev, shade = T.shade;
    const lut = LUTS[this.theme], pal = PALETTES[this.theme];
    const relief = this.layers.relief, ice = pal.ice;
    const pl = hex(pal.plainLand), ps = hex(pal.plainSea);
    const streets = this.layers.style === 'streets', SP = STREET[this.theme];
    const globe = this.mode === 'globe';
    const cx = bw / 2, cy = bh / 2;
    const Rb = this.R * sc, p0 = this.lat0 * D2R, l0 = this.lon0 * D2R, s0 = Math.sin(p0), c0 = Math.cos(p0), cl0 = Math.cos(l0), sl0 = Math.sin(l0);
    const ppdB = this.ppd * sc, csB = Math.cos(this.stdPar);
    const F = this.field, doTint = this.layers.tint && F && this.ev && this.ev.kind === 'solar';
    const zlb = this.mode === 'globe' ? this.zoom : this.ppd / (this.cw / 360), tintK = zlb > 3 ? 0.45 : 1;
    const fw = F ? F.w : 0, fh = F ? F.h : 0, fd = F ? F.data : null;
    const lun = this.lunar && this.layers.tint ? this.lunar : null;
    // high-resolution local relief when zoomed in on a flat map
    const TSX = G.TS, local = !globe && relief && TSX && TSX.hasLayers() && this.ppd >= 28;
    this.localRaster = null;
    if (local) {
      const N = bw * bh;
      if (!this.LE || this.LE.length !== N) { this.LE = new Float32Array(N); this.LS = new Float32Array(N); }
      const LE = this.LE, LS = this.LS;
      let k = 0;
      for (let py = 0; py < bh; py++) { const lat = this.lat0 + (cy - py - 0.5) / ppdB; for (let px = 0; px < bw; px++) LE[k++] = (lat < 90 && lat > -90) ? TSX.at(lat, this.lon0 + (px + 0.5 - cx) / (ppdB * csB)) : 0; }
      const az = 315 * D2R, zen = 42 * D2R, lx = Math.sin(zen) * Math.sin(az), ly = Math.sin(zen) * Math.cos(az), lz = Math.cos(zen);
      const mY = 111320 / ppdB, zf = 1.15 + clamp(Math.log2(Math.max(1, mY / 120)), 0, 2.5) * 0.55;
      for (let py = 0; py < bh; py++) {
        const lat = this.lat0 + (cy - py - 0.5) / ppdB, mX = Math.max(1, 111320 * Math.cos(lat * D2R) / (ppdB * csB));
        const pu = py > 0 ? py - 1 : py, pd = py < bh - 1 ? py + 1 : py;
        for (let px = 0; px < bw; px++) {
          const pl = px > 0 ? px - 1 : px, pr = px < bw - 1 ? px + 1 : px, o = py * bw;
          const gx = (LE[o + pr] - LE[o + pl]) / ((pr - pl) * mX) * zf, gy = (LE[pu * bw + px] - LE[pd * bw + px]) / ((pd - pu) * mY) * zf;
          LS[o + px] = clamp((-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1), 0, 1);
        }
      }
      this.localRaster = { E: LE, bw, bh, sc };
      const vb = this._viewBounds(), key = [vb.lat0, vb.lat1, vb.lon0, vb.lon1].map(v => Math.floor(v * 4)).join(',');
      if (key !== this._tsKey) { this._tsKey = key; const before = TSX.loaded || 0; TSX.ensureBox(vb.lat0 - 0.1, vb.lat1 + 0.1, vb.lon0 - 0.1, vb.lon1 + 0.1).then(() => { if ((TSX.loaded || 0) !== before) { this.dirtyBase = true; this.request(); this.cb.terrain && this.cb.terrain(); } }); }
    }
    let i = 0;
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++, i++) {
        let latR, lonDeg, sp, cp, sLon, cLon;
        if (globe) {
          const x = (px + 0.5 - cx) / Rb, y = (cy - py - 0.5) / Rb, r2 = x * x + y * y;
          if (r2 >= 1) { A.valid[i] = 0; continue; }
          const z = Math.sqrt(1 - r2);
          sp = z * s0 + y * c0; cp = Math.sqrt(Math.max(0, 1 - sp * sp));
          const xp = z * c0 - y * s0;
          const a = Math.atan2(x, xp);
          lonDeg = (l0 + a) * R2D;
          const hh = Math.sqrt(x * x + xp * xp) || 1, sa = x / hh, ca = xp / hh;
          sLon = sa * cl0 + ca * sl0; cLon = ca * cl0 - sa * sl0;
          latR = Math.asin(sp);
        } else {
          const lat = this.lat0 + (cy - py - 0.5) / ppdB;
          if (lat >= 90 || lat <= -90) { A.valid[i] = 0; continue; }
          lonDeg = this.lon0 + (px + 0.5 - cx) / (ppdB * csB);
          latR = lat * D2R; sp = Math.sin(latR); cp = Math.cos(latR);
          const lr = lonDeg * D2R; sLon = Math.sin(lr); cLon = Math.cos(lr);
        }
        A.valid[i] = 1;
        const latDeg = latR * R2D;
        let ld = ((lonDeg + 180) % 360 + 360) % 360 - 180;
        // terrain sample
        let u = (ld + 180) / tstep - 0.5, v = (90 - latDeg) / tstep - 0.5;
        if (u < 0) u += tw;
        if (v < 0) v = 0; else if (v > th - 1.0001) v = th - 1.0001;
        const j0 = u | 0, i0 = v | 0, fu = u - j0, fv = v - i0, j1 = j0 + 1 >= tw ? 0 : j0 + 1;
        const k00 = i0 * tw + j0, k01 = i0 * tw + j1, k10 = k00 + tw, k11 = k01 + tw;
        const w00 = (1 - fu) * (1 - fv), w01 = fu * (1 - fv), w10 = (1 - fu) * fv, w11 = fu * fv;
        const e = local ? this.LE[i] : elev[k00] * w00 + elev[k01] * w01 + elev[k10] * w10 + elev[k11] * w11;
        let R, Gc, B;
        if (this.tilesOn) { R = Gc = B = 255; }            // street tiles are drawn on top; the base only carries the shading
        else if (streets) {
          const s = relief ? (local ? this.LS[i] : (shade[k00] * w00 + shade[k01] * w01 + shade[k10] * w10 + shade[k11] * w11) / 255) : 0.743;
          if (e > 0) { const m = 1 + 0.62 * (s - 0.743); R = SP.land[0] * m; Gc = SP.land[1] * m; B = SP.land[2] * m; }
          else { R = SP.water[0]; Gc = SP.water[1]; B = SP.water[2]; }
          if (e > 0 && (latDeg < -63 || (latDeg > 59 && ld > -75 && ld < -10 && e > 300))) { R = ice[0]; Gc = ice[1]; B = ice[2]; }
        } else if (relief) {
          let li = ((e - LUT_MIN) / LUT_STEP) | 0; if (li < 0) li = 0; else if (li >= LUT_N) li = LUT_N - 1;
          R = lut.r[li]; Gc = lut.g[li]; B = lut.b[li];
          const s = local ? this.LS[i] : (shade[k00] * w00 + shade[k01] * w01 + shade[k10] * w10 + shade[k11] * w11) / 255;
          // polar ice sheets
          if (e > 0 && (latDeg < -63 || (latDeg > 59 && ld > -75 && ld < -10 && e > 300))) { R = ice[0] * 0.92; Gc = ice[1] * 0.92; B = ice[2] * 0.95; }
          const m = e > 0 ? 1 + 1.5 * (s - 0.743) : 1 + 0.9 * (s - 0.743);
          R *= m; Gc *= m; B *= m;
        } else if (e > 0) { R = pl[0]; Gc = pl[1]; B = pl[2]; } else { R = ps[0]; Gc = ps[1]; B = ps[2]; }
        // magnitude tint (solar partial region)
        if (doTint) {
          let fx = (ld + 180) / 360 * fw - 0.5, fy = (90 - latDeg) / 180 * fh - 0.5;
          if (fx < 0) fx += fw; if (fy < 0) fy = 0; else if (fy > fh - 1.001) fy = fh - 1.001;
          const a0 = fx | 0, b0 = fy | 0, ax = fx - a0, by = fy - b0, a1 = a0 + 1 >= fw ? 0 : a0 + 1;
          const mg = (fd[b0 * fw + a0] * (1 - ax) + fd[b0 * fw + a1] * ax) * (1 - by) + (fd[(b0 + 1) * fw + a0] * (1 - ax) + fd[(b0 + 1) * fw + a1] * ax) * by;
          A.mag[i] = mg;
          const al = smooth(-0.01, 0.03, mg) * (0.06 + 0.17 * clamp(mg, 0, 1)) * tintK;
          if (al > 0) { R += (150 - R) * al; Gc += (110 - Gc) * al; B += (255 - B) * al; }
        }
        if (lun) {
          // 0 none, 1 whole partial/total phase visible, 2 rises during, 3 sets during
          const sphi = sp, cphi = cp;
          const up = (t) => sphi * t.sd + cphi * t.cd * (cLon * t.cl + sLon * t.sl) > 0.0145 * -1 ? 1 : 0;   // moon altitude > -0.8 deg
          const a = up(lun.start), b = up(lun.end);
          const cls = a && b ? 1 : (!a && b) ? 2 : (a && !b) ? 3 : 0;
          A.cls[i] = cls;
          const al = cls === 1 ? 0.34 : cls ? 0.26 : 0;
          if (al) { const c = cls === 1 ? [255, 120, 90] : cls === 2 ? [255, 190, 120] : [190, 150, 255]; R += (c[0] - R) * al; Gc += (c[1] - Gc) * al; B += (c[2] - B) * al; }
        }
        A.r[i] = R > 255 ? 255 : R; A.g[i] = Gc > 255 ? 255 : Gc; A.b[i] = B > 255 ? 255 : B;
        A.sLon[i] = sLon; A.cLon[i] = cLon;
        const qq = Math.sqrt(cp * cp + BA2 * sp * sp);
        A.rs[i] = BA2 * sp / qq; A.rc[i] = cp / qq;
        A.lat[i] = latDeg;
      }
    }
    this.dirtyGeo = false; this.dirtyBase = false;
  }

  /* ----- per-time shading pass ----- */
  _timePass() {
    const A = this.A, N = this.bw * this.bh, px32 = this.px32, pal = PALETTES[this.theme];
    const nt = pal.nightTint, dn = this.layers.daynight;
    const Ecl = this.Ecl, ev = this.ev, an = this.an;
    const nightMin = (this.ev && this.ev.kind === 'lunar') ? Math.max(pal.nightMin, 0.62) : pal.nightMin;
    const outside = hex(pal.bg);
    const outsideCol = (255 << 24) | (outside[2] << 16) | (outside[1] << 8) | outside[0];
    let mode = 0, E, sd, cd, sMu, cMu, tx, ty;
    if (ev && ev.kind === 'solar' && an && an.poly) {
      mode = 1; E = new Float64Array(Ecl.NQ); Ecl.evalInto(an.poly, this.time, E);
      sd = Math.sin(E[2]); cd = Math.cos(E[2]); sMu = Math.sin(E[3]); cMu = Math.cos(E[3]);
    } else if (ev && ev.kind === 'lunar') {
      mode = 2;
      const sun = Ecl.subPoint('Sun', this.time), moon = Ecl.subPoint('Moon', this.time);
      this.sunPt = sun; this.moonPt = moon;
      sd = Math.sin(sun.lat * D2R); cd = Math.cos(sun.lat * D2R); sMu = Math.sin(sun.lon * D2R); cMu = Math.cos(sun.lon * D2R);
      tx = { sd: Math.sin(moon.lat * D2R), cd: Math.cos(moon.lat * D2R), sl: Math.sin(moon.lon * D2R), cl: Math.cos(moon.lon * D2R) };
    } else {
      mode = 3;
      const sun = Ecl.subPoint('Sun', this.time); this.sunPt = sun;
      sd = Math.sin(sun.lat * D2R); cd = Math.cos(sun.lat * D2R); sMu = Math.sin(sun.lon * D2R); cMu = Math.cos(sun.lon * D2R);
    }
    const zl = this.mode === 'globe' ? this.zoom : this.ppd / (this.cw / 360);
    const shStr = this.layers.shadow === false ? 0 : this.mode === 'flat' && this.ppd >= 300 ? 0.22 : (zl > 6 ? 0.42 : zl > 2.5 ? 0.52 : 0.62);
    const x0 = mode === 1 ? E[0] : 0, y0 = mode === 1 ? E[1] : 0, l1 = mode === 1 ? E[4] : 0, l2 = mode === 1 ? E[5] : 0, tf1 = mode === 1 ? E[6] : 0, tf2 = mode === 1 ? E[7] : 0;
    for (let i = 0; i < N; i++) {
      if (!A.valid[i]) { px32[i] = outsideCol; continue; }
      let r = A.r[i], g = A.g[i], b = A.b[i];
      const rs = A.rs[i], rc = A.rc[i], sL = A.sLon[i], cL = A.cLon[i];
      let br = 1, zeta;
      if (mode === 1) {
        // h = mu + lon (mu = Greenwich hour angle of the shadow axis); lon = east longitude
        const sh = sMu * cL + cMu * sL, ch = cMu * cL - sMu * sL;
        const xi = rc * sh, eta = rs * cd - rc * sd * ch;
        zeta = rs * sd + rc * cd * ch;
        if (zeta > 0) {
          const uu = xi - x0, vv = eta - y0, L1 = l1 - zeta * tf1;
          if (Math.abs(uu) < L1 && Math.abs(vv) < L1) {
            const m = Math.sqrt(uu * uu + vv * vv);
            if (m < L1) {
              const L2 = l2 - zeta * tf2, al2 = L2 < 0 ? -L2 : L2;
              let ob;
              if (m <= al2) ob = L2 < 0 ? 1 : (L1 + L2 > 0 ? Math.pow((L1 - L2) / (L1 + L2), 2) : 1);
              else {
                const rS = (L1 + L2) / 2, rM = (L1 - L2) / 2;
                const a1 = Math.acos(clamp((m * m + rS * rS - rM * rM) / (2 * m * rS), -1, 1)), a2 = Math.acos(clamp((m * m + rM * rM - rS * rS) / (2 * m * rM), -1, 1));
                const area = rS * rS * a1 + rM * rM * a2 - 0.5 * Math.sqrt(Math.max(0, (-m + rS + rM) * (m + rS - rM) * (m - rS + rM) * (m + rS + rM)));
                ob = area / (PI * rS * rS);
              }
              br = 1 - shStr * Math.pow(ob, 1.5);
            }
          }
        }
      } else {
        const ch = cMu * cL + sMu * sL;      // cos(lon - lonSun)
        zeta = rs * sd + rc * cd * ch;
        if (mode === 2) {
          const cm = tx.cl * cL + tx.sl * sL;
          const malt = rs * tx.sd + rc * tx.cd * cm;
          if (malt > 0 && zeta < 0.02) br *= 1.12;
          if (malt > 0) { b = b + (255 - b) * 0.06; }
        }
      }
      if (dn) {
        const day = smooth(-0.10, 0.06, zeta);
        const f = nightMin + (1 - nightMin) * day;
        const tn = 1 - day;
        r *= br * (f * (1 + (nt[0] - 1) * tn)); g *= br * (f * (1 + (nt[1] - 1) * tn)); b *= br * (f * (1 + (nt[2] - 1) * tn));
      } else { r *= br; g *= br; b *= br; }
      px32[i] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
    }
    this.bctx.putImageData(this.img, 0, 0);
  }

  /* ----- main render ----- */
  render() {
    if (!this.host.offsetWidth) return;
    const tiles = !!(G.LIVE && this.layers.style === 'streets' && this.mode === 'flat' && this.ppd >= 10 && !this._tilesFailed);
    if (tiles !== this.tilesOn) { this.tilesOn = tiles; this.dirtyBase = true; }
    if (this.dirtyGeo || this.dirtyBase) {
      this._buildGeo();
    }
    this._timePass();
    this._drawOverlay();
  }

  /* vector overlay */
  _drawOverlay() {
    const c = this.octx, W = this.cw, H = this.ch, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const dark = this.theme === 'dark';
    const ink = dark ? '255,255,255' : '14,21,48';
    this._occupied = [];
    const globe = this.mode === 'globe';
    // globe limb + atmosphere
    if (globe) {
      const R = this.R, cx = W / 2, cy = H / 2;
      const g = c.createRadialGradient(cx, cy, R * 0.985, cx, cy, R * 1.06);
      g.addColorStop(0, dark ? 'rgba(120,170,255,0.30)' : 'rgba(90,140,210,0.28)'); g.addColorStop(1, 'rgba(120,170,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R * 1.06, 0, PI * 2); c.fill();
      c.strokeStyle = dark ? 'rgba(160,190,255,0.35)' : 'rgba(40,70,130,0.35)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, R, 0, PI * 2); c.stroke();
    }
    const view = this._viewBounds();
    if (this.layers.grid) this._drawGraticule(c, ink, view);
    if (this.layers.style === 'streets') this._drawStreets(c, view);
    if (this.layers.contours && !globe && this.ppd >= 14 && !(this.tilesOn && this.ppd >= 300)) this._drawContours(c, this.layers.style === 'streets' ? (dark ? '214,190,150' : '150,110,60') : ink, view);
    this._drawImageOverlay(c);
    if (this.layers.borders) this._drawLines(c, ink, view);
    // event overlays
    if (this.ev && this.ev.kind === 'solar' && this.an) this._drawSolar(c, view);
    if (this.ev && this.ev.kind === 'lunar') this._drawLunar(c);
    if (this.layers.labels) this._drawCountryLabels(c, ink);
    if (this.layers.style === 'streets') this._drawPlaces(c);
    if (this.layers.cities && !(this.layers.style === 'streets' && G.ST && G.ST.towns && (globe ? this.zoom : this.ppd / (this.cw / 360)) >= 4)) this._drawCities(c, ink);
    this._drawMarkers(c);
    if (this.layers.style === 'streets') this._drawAttribution(c);
    if (this.site) this._drawSite(c);
    if (this.hoverPt) this._drawHover(c);
  }
  _viewBounds() {
    // approx lat/lon bounds visible (flat) or null (globe)
    if (this.mode === 'globe') return null;
    const cs = Math.cos(this.stdPar), halfLon = Math.min(180, (this.cw / 2) / (this.ppd * cs));
    const halfLat = Math.min(90, (this.ch / 2) / this.ppd);
    return { lat0: this.lat0 - halfLat, lat1: this.lat0 + halfLat, lon0: this.lon0 - halfLon, lon1: this.lon0 + halfLon };
  }
  _strokePath(c, pts, closePath) {   // pts: array of [lat, lon]; handles globe clipping & wrap
    const globe = this.mode === 'globe';
    let pen = false, prev = null;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = this.project(pts[i][0], pts[i][1]);
      if (globe) {
        if (prev) {
          if (prev[2] !== p[2]) {          // crossing the limb: interpolate
            const t = prev[3] / (prev[3] - p[3]);
            const q = this._limbPoint(pts[i - 1], pts[i], t);
            if (prev[2]) { c.lineTo(q[0], q[1]); pen = false; } else { c.moveTo(q[0], q[1]); pen = true; }
          }
        }
        if (p[2]) { if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; } }
        else pen = false;
      } else {
        if (prev && Math.abs(p[0] - prev[0]) > this.cw * 0.6) pen = false;
        if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; }
      }
      prev = p;
    }
    c.stroke();
  }
  _limbPoint(a, b, t) {
    const va = this._vec(a), vb = this._vec(b);
    const v = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
    const l = Math.hypot(v[0], v[1], v[2]);
    const lat = Math.asin(v[2] / l) * R2D, lon = Math.atan2(v[1], v[0]) * R2D;
    const p = this.project(lat, lon); return p;
  }
  _vec(a) { const p = a[0] * D2R, l = a[1] * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; }

  _drawGraticule(c, ink, view) {
    const globe = this.mode === 'globe';
    const span = globe ? 180 / this.zoom : Math.min(this.cw / this.ppd, 360);
    let step = span > 150 ? 30 : span > 70 ? 15 : span > 35 ? 10 : span > 14 ? 5 : span > 6 ? 2 : span > 2.5 ? 1 : span > 1 ? 0.5 : 0.25;
    c.lineWidth = 0.6; c.strokeStyle = `rgba(${ink},0.13)`;
    const lat0 = view ? Math.floor(view.lat0 / step) * step : -90, lat1 = view ? view.lat1 : 90;
    const lon0 = view ? Math.floor(view.lon0 / step) * step : -180, lon1 = view ? view.lon1 : 180;
    for (let lat = Math.max(-90, lat0); lat <= Math.min(90, lat1); lat += step) {
      if (Math.abs(lat) > 89.9) continue;
      const pts = []; for (let lo = (globe ? -180 : lon0 - step); lo <= (globe ? 180 : lon1 + step); lo += globe ? 4 : Math.max(step / 2, 0.5)) pts.push([lat, lo]);
      this._strokePath(c, pts);
    }
    for (let lon = lon0 - step; lon <= (globe ? 180 : lon1 + step); lon += step) {
      if (globe && lon < -180) continue;
      const pts = []; for (let la = -90; la <= 90; la += globe ? 4 : Math.max(1, step / 2)) pts.push([la, lon]);
      if (!globe) { /* clip to view lat range */ const a = Math.max(-90, view.lat0 - 1), b = Math.min(90, view.lat1 + 1); pts.length = 0; for (let la = a; la <= b; la += Math.max(0.1, (b - a) / 60)) pts.push([la, lon]); }
      this._strokePath(c, pts);
    }
    // equator emphasised
    c.strokeStyle = `rgba(${ink},0.22)`; c.lineWidth = 0.8;
    const eq = []; for (let lo = -180; lo <= 180; lo += 4) eq.push([0, lo]); this._strokePath(c, eq);
  }
  _drawLines(c, ink, view) {
    const D = this.D, globe = this.mode === 'globe';
    const zoomLevel = globe ? this.zoom : this.ppd / (this.cw / 360);
    const lw = clamp(0.6 + Math.log2(Math.max(1, zoomLevel)) * 0.12, 0.6, 1.4);
    const draw = (lines, style, width, dash) => {
      c.strokeStyle = style; c.lineWidth = width; c.setLineDash(dash || []); c.lineJoin = 'round';
      for (const ln of lines) {
        const b = ln.bbox;
        if (view) {
          if (b[3] < view.lat0 - 1 || b[1] > view.lat1 + 1) continue;
          let vis = false;
          for (const sh of [-360, 0, 360]) if (b[2] + sh >= view.lon0 - 1 && b[0] + sh <= view.lon1 + 1) { vis = true; break; }
          if (!vis) continue;
        }
        const pts = ln.pts, n = pts.length / 2;
        const stride = globe ? Math.max(1, Math.floor(1.8 / Math.max(1, this.zoom * 0.7))) : 1;
        const arr = [];
        for (let i = 0; i < n; i += stride) arr.push([pts[i * 2 + 1], pts[i * 2]]);
        if ((n - 1) % stride) arr.push([pts[(n - 1) * 2 + 1], pts[(n - 1) * 2]]);
        this._strokePath(c, arr);
      }
      c.setLineDash([]);
    };
    if (this.layers.borders) {
      draw(D.border, `rgba(${ink},0.28)`, lw * 0.8, [3, 3]);
      draw(D.coast, `rgba(${ink},${this.theme === 'dark' ? 0.55 : 0.5})`, lw);
    }
  }
  _drawContours(c, ink, view) {
    if (this.localRaster) return this._drawLocalContours(c, ink);
    const T = this.D.terrain, step = T.step;
    const cellPx = step * this.ppd * Math.cos(this.stdPar);
    const interval = cellPx > 60 ? 100 : cellPx > 28 ? 200 : cellPx > 12 ? 500 : 1000;
    const j0 = Math.floor((view.lon0 + 180) / step) - 1, j1 = Math.ceil((view.lon1 + 180) / step) + 1;
    const i0 = Math.max(0, Math.floor((90 - view.lat1) / step) - 1), i1 = Math.min(T.h - 2, Math.ceil((90 - view.lat0) / step) + 1);
    const el = T.elev, w = T.w;
    c.lineWidth = 0.6; c.lineJoin = 'round';
    const proj = (jj, ii) => this.project(90 - (ii + 0.5) * step, -180 + (jj + 0.5) * step);
    let minE = 1e9, maxE = -1e9;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const e = el[i * w + ((j % w) + w) % w]; if (e < minE) minE = e; if (e > maxE) maxE = e; }
    if (maxE < 0) return;
    const lo = Math.max(interval, Math.ceil(Math.max(minE, 0) / interval) * interval), hi = maxE;
    let count = 0;
    for (let L = lo; L <= hi && count < 60; L += interval, count++) {
      const major = (L % (interval * 5)) === 0;
      c.strokeStyle = major ? `rgba(${ink},0.42)` : `rgba(${ink},0.22)`; c.lineWidth = major ? 0.9 : 0.5;
      c.beginPath();
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const jj = ((j % w) + w) % w, jn = (jj + 1) % w;
          const a = el[i * w + jj], b = el[i * w + jn], d = el[(i + 1) * w + jj], e2 = el[(i + 1) * w + jn];
          let code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (e2 > L ? 2 : 0) | (d > L ? 1 : 0);
          if (code === 0 || code === 15) continue;
          // corners: a(top-left) b(top-right) e2(bottom-right) d(bottom-left)
          const lerp = (v0, v1) => (L - v0) / (v1 - v0);
          const top = [j + lerp(a, b), i], right = [j + 1, i + lerp(b, e2)], bottom = [j + lerp(d, e2), i + 1], left = [j, i + lerp(a, d)];
          const seg = (p, q) => {
            const P = this.project(90 - (p[1] + 0.5) * step, -180 + (p[0] + 0.5) * step), Q = this.project(90 - (q[1] + 0.5) * step, -180 + (q[0] + 0.5) * step);
            if (Math.abs(P[0] - Q[0]) < this.cw * 0.5) { c.moveTo(P[0], P[1]); c.lineTo(Q[0], Q[1]); }
          };
          switch (code) {
            case 1: case 14: seg(left, bottom); break;
            case 2: case 13: seg(bottom, right); break;
            case 3: case 12: seg(left, right); break;
            case 4: case 11: seg(top, right); break;
            case 5: seg(left, top); seg(bottom, right); break;
            case 6: case 9: seg(top, bottom); break;
            case 7: case 8: seg(left, top); break;
            case 10: seg(left, bottom); seg(top, right); break;
          }
        }
      }
      c.stroke();
    }
    this.contourInterval = interval;
  }

  _drawLocalContours(c, ink) {
    const { E, bw, bh, sc } = this.localRaster, st = 2;
    const mpp = 111320 / this.ppd;
    const interval = mpp < 25 ? 20 : mpp < 60 ? 50 : mpp < 150 ? 100 : mpp < 400 ? 200 : 500;
    let mn = 1e9, mx = -1e9; for (let i = 0; i < E.length; i += 5) { if (E[i] < mn) mn = E[i]; if (E[i] > mx) mx = E[i]; }
    const lo = Math.max(interval, Math.ceil(Math.max(mn, 0) / interval) * interval);
    c.lineJoin = 'round';
    let count = 0;
    for (let L = lo; L <= mx && count < 80; L += interval, count++) {
      const major = (L % (interval * 5)) === 0;
      c.strokeStyle = major ? `rgba(${ink},0.45)` : `rgba(${ink},0.2)`; c.lineWidth = major ? 0.9 : 0.5;
      c.beginPath();
      for (let y = 0; y + st < bh; y += st) for (let x = 0; x + st < bw; x += st) {
        const a = E[y * bw + x], b = E[y * bw + x + st], e2 = E[(y + st) * bw + x + st], d = E[(y + st) * bw + x];
        const code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (e2 > L ? 2 : 0) | (d > L ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const lp = (v0, v1) => (L - v0) / (v1 - v0) * st;
        const P = (px, py) => [(px + 0.5) / sc, (py + 0.5) / sc];
        const top = P(x + lp(a, b), y), right = P(x + st, y + lp(b, e2)), bottom = P(x + lp(d, e2), y + st), left = P(x, y + lp(a, d));
        const seg = (p, q) => { c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); };
        switch (code) {
          case 1: case 14: seg(left, bottom); break; case 2: case 13: seg(bottom, right); break; case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break; case 5: seg(left, top); seg(bottom, right); break; case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break; case 10: seg(left, bottom); seg(top, right); break;
        }
      }
      c.stroke();
    }
    this.contourInterval = interval;
  }
  /* ----- street map ----- */
  _ppdNow() { return this.mode === 'globe' ? this.R * D2R : this.ppd; }
  _drawStreets(c, view) {
    if (this.tilesOn) { this._drawTiles(c, view); return; }
    const ST = G.ST; if (!ST) return;
    if (!ST.world && !ST._world) ST.loadWorld().then(() => { this._stKey = null; this.request(); });
    const globe = this.mode === 'globe', ppd = this._ppdNow();
    if (!globe && view) {
      if (ppd >= 60) this._needCells('sm', view);
      if (ppd >= 600) this._needCells('sd', view);
    }
    if (globe && this.interacting) return;           // the globe redraws its roads once it settles
    const o = this._stView;
    if (!globe && this.interacting && o && o.mode === 'flat' && o.cw === this.cw && o.ch === this.ch && this.stc) {
      // while dragging or zooming, move the last drawing instead of redrawing every road
      const csN = Math.cos(this.stdPar), sx = csN * ppd / (o.cs * o.ppd), sy = ppd / o.ppd, cx = this.cw / 2, cy = this.ch / 2;
      const dLon = ((o.lon0 - this.lon0 + 540) % 360) - 180, dLat = o.lat0 - this.lat0;
      const tx = cx - cx * sx + dLon * csN * ppd, ty = cy - cy * sy - dLat * ppd;
      c.drawImage(this.stc, tx, ty, this.cw * sx, this.ch * sy);
      return;
    }
    const key = [this.mode, this.lat0.toFixed(6), this.lon0.toFixed(6), this.zoom.toFixed(5), this.cw, this.ch, this.dpr, this.theme, ST.version, this.layers.borders].join('|');
    if (key !== this._stKey) { this._stKey = key; this._renderStreets(view, ppd); this._stView = { mode: this.mode, lat0: this.lat0, lon0: this.lon0, ppd, cs: Math.cos(this.stdPar), cw: this.cw, ch: this.ch }; }
    c.drawImage(this.stc, 0, 0, this.cw, this.ch);
  }
  _needCells(layer, view) {
    const k = [view.lat0, view.lat1, view.lon0, view.lon1].map(v => Math.floor(v * 8)).join(',');
    if (this['_nk' + layer] === k) return; this['_nk' + layer] = k;
    G.ST.ensureBox(layer, view.lat0 - 0.05, view.lat1 + 0.05, view.lon0 - 0.05, view.lon1 + 0.05).then(got => { if (got) { this.request(); this.cb.streets && this.cb.streets(); } });
  }
  _renderStreets(view, ppd) {
    const W = this.cw, H = this.ch, dpr = this.dpr, ST = G.ST, w = ST.world, S = STREET[this.theme], globe = this.mode === 'globe';
    if (!this.stc) { this.stc = document.createElement('canvas'); this.stx = this.stc.getContext('2d'); }
    if (this.stc.width !== Math.round(W * dpr) || this.stc.height !== Math.round(H * dpr)) { this.stc.width = Math.round(W * dpr); this.stc.height = Math.round(H * dpr); }
    const c = this.stx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.lineJoin = 'round'; c.lineCap = 'round';
    this.stLabels = [];
    if (globe) { if (w && this.zoom >= 2.2) this._streetsGlobe(c, w, S); return; }
    const cs = Math.cos(this.stdPar), kx = cs * ppd, cx = W / 2, cy = H / 2, lon0 = this.lon0, lat0 = this.lat0;
    const shiftFor = lon => { const d = lon - lon0; return ((d + 540) % 360) - 180 - d; };
    const inView = (b, i, sh) => !(b[i + 2] + sh < view.lon0 || b[i] + sh > view.lon1 || b[i + 3] < view.lat0 || b[i + 1] > view.lat1);
    // worldwide lines/areas (absolute lon/lat)
    const pathWorld = (sec, filter, close) => {
      for (let i = 0; i < sec.n; i++) {
        if (filter && !filter(i)) continue;
        const sh = shiftFor((sec.bbox[i * 4] + sec.bbox[i * 4 + 2]) / 2); if (!inView(sec.bbox, i * 4, sh)) continue;
        const a = sec.off[i], b = sec.off[i + 1], xy = sec.xy;
        if (b - a < 2) continue;
        if ((sec.bbox[i * 4 + 2] - sec.bbox[i * 4]) * kx < 0.6 && (sec.bbox[i * 4 + 3] - sec.bbox[i * 4 + 1]) * ppd < 0.6) continue;
        c.moveTo(cx + (xy[a * 2] + sh - lon0) * kx, cy - (xy[a * 2 + 1] - lat0) * ppd);
        for (let k = a + 1; k < b; k++) c.lineTo(cx + (xy[k * 2] + sh - lon0) * kx, cy - (xy[k * 2 + 1] - lat0) * ppd);
        if (close) c.closePath();
      }
    };
    const smCells = ppd >= 60 ? ST.cellsIn('sm', view.lat0, view.lat1, view.lon0, view.lon1) : [];
    const sdCells = ppd >= 600 ? ST.cellsIn('sd', view.lat0, view.lat1, view.lon0, view.lon1) : [];
    const covered = new Set(smCells.map(cl => cl.la * 1000 + cl.lo));
    if (w) {
      if (ppd >= 9) { c.fillStyle = S.urban; c.beginPath(); pathWorld(w.urban, null, true); c.fill('evenodd'); }
      if (ppd >= 2) { c.fillStyle = `rgb(${S.water})`; c.beginPath(); pathWorld(w.lakes, null, true); c.fill('evenodd'); }
      if (ppd >= 3) {
        c.strokeStyle = S.river;
        for (const [lo, hi, lw] of [[0, 4, 1.6], [5, 7, 1.1], [8, 9, 0.8]]) {
          if (ppd < 6 && lo > 4) continue;
          c.lineWidth = lw * clamp(Math.pow(ppd / 60, 0.3), 0.7, 2.2); c.beginPath(); pathWorld(w.rivers, i => w.rivers.cls[i] >= lo && w.rivers.cls[i] <= hi); c.stroke();
        }
      }
      if (ppd >= 7 && this.layers.borders) { c.strokeStyle = S.adm; c.lineWidth = 0.8; c.setLineDash([4, 3]); c.beginPath(); pathWorld(w.adm); c.stroke(); c.setLineDash([]); }
      // major roads where no detailed roads are loaded
      if (ppd >= 6) {
        const skip = i => { const la = Math.floor((w.roads.bbox[i * 4 + 1] + w.roads.bbox[i * 4 + 3]) / 2), lo = Math.floor((w.roads.bbox[i * 4] + w.roads.bbox[i * 4 + 2]) / 2); return !covered.has(la * 1000 + lo); };
        const f = clamp(Math.pow(ppd / 1000, 0.45), 0.5, 4.5);
        for (const [cl, rc, min, wd] of [[2, 3, 22, 1.4], [1, 2, 10, 1.9], [0, 0, 6, 2.4]]) {
          if (ppd < min) continue;
          if (ppd >= 120) { c.strokeStyle = S.road[rc][1] || S.road[rc][0]; c.lineWidth = wd * f + 1.2; c.beginPath(); pathWorld(w.roads, i => w.roads.cls[i] === cl && skip(i)); c.stroke(); }
          c.strokeStyle = ppd < 120 && this.theme === 'light' ? S.road[rc][1] : S.road[rc][0]; c.lineWidth = Math.max(1, wd * f); c.beginPath(); pathWorld(w.roads, i => w.roads.cls[i] === cl && skip(i)); c.stroke();
        }
        if (ppd >= 20) { c.strokeStyle = S.ferry; c.lineWidth = 1; c.setLineDash([5, 4]); c.beginPath(); pathWorld(w.roads, i => w.roads.cls[i] === 3); c.stroke(); c.setLineDash([]); }
      }
    }
    // detailed roads along the eclipse paths
    const f = clamp(Math.pow(ppd / 1000, 0.4), 0.5, 3.4), cased = ppd >= 400;
    const pathCells = (cells, cl) => {
      for (const cell of cells) {
        const C = cell.cls[cl]; if (!C || !C.n) continue;
        const sh = shiftFor(cell.lo + 0.5), X0 = cx + (cell.lo + sh - lon0) * kx, Y0 = cy - (cell.la - lat0) * ppd, xy = C.xy, bb = C.bbox;
        for (let i = 0; i < C.n; i++) {
          if (!inView(bb, i * 4, sh)) continue;
          const a = C.off[i], b = C.off[i + 1];
          c.moveTo(X0 + xy[a * 2] * kx, Y0 - xy[a * 2 + 1] * ppd);
          for (let k = a + 1; k < b; k++) c.lineTo(X0 + xy[k * 2] * kx, Y0 - xy[k * 2 + 1] * ppd);
        }
      }
    };
    const cellsFor = cl => cl >= 5 && cl <= 8 ? sdCells : smCells;
    if (cased) for (const cl of ROAD_ORDER) {
      const [min, bw] = ROAD_VIS[cl], col = S.road[cl]; if (ppd < min || !col[1]) continue;
      c.strokeStyle = col[1]; c.lineWidth = bw * f + (cl <= 4 ? 1.6 : 1.2); c.beginPath(); pathCells(cellsFor(cl), cl); c.stroke();
    }
    for (const cl of ROAD_ORDER) {
      const [min, bw] = ROAD_VIS[cl], col = S.road[cl]; if (ppd < min) continue;
      c.strokeStyle = !cased && col[1] && this.theme === 'light' ? col[1] : col[0];
      c.lineWidth = cl === 7 || cl === 8 ? Math.max(0.8, bw * f * 0.55) : cased ? bw * f : Math.max(cl <= 2 ? 1.5 : 1.1, bw * f);
      if (cl === 7) c.setLineDash([5, 3]); else if (cl === 8) c.setLineDash([2, 3]); else if (cl === 9) c.setLineDash([7, 4]);
      c.beginPath(); pathCells(cellsFor(cl), cl); c.stroke(); c.setLineDash([]);
    }
    // street names along the lines
    if (ppd >= 2600) this._streetNames(c, [...smCells, ...sdCells], view, kx, ppd, shiftFor, S);
  }
  _streetNames(c, cells, view, kx, ppd, shiftFor, S) {
    const W = this.cw, H = this.ch, cx = W / 2, cy = H / 2, boxes = [], used = new Map();
    c.font = '500 10.5px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    let n = 0;
    for (const cl of [0, 1, 2, 3, 4, 5, 6]) {
      for (const cell of cells) {
        const C = cell.cls[cl]; if (!C) continue;
        const sh = shiftFor(cell.lo + 0.5), X0 = cx + (cell.lo + sh - this.lon0) * kx, Y0 = cy - (cell.la - this.lat0) * ppd;
        for (let i = 0; i < C.n && n < 140; i++) {
          if (C.name[i] < 0) continue;
          const a = C.off[i], b = C.off[i + 1];
          // longest on-screen run of nearly straight segments
          let best = 0, bi = -1, bj = -1, rs = -1, rl = 0, ra = 0;
          for (let k = a; k < b - 1; k++) {
            const x1 = X0 + C.xy[k * 2] * kx, y1 = Y0 - C.xy[k * 2 + 1] * ppd, x2 = X0 + C.xy[k * 2 + 2] * kx, y2 = Y0 - C.xy[k * 2 + 3] * ppd;
            const off = Math.min(x1, x2) < 10 || Math.max(x1, x2) > W - 10 || Math.min(y1, y2) < 10 || Math.max(y1, y2) > H - 10;
            const L = Math.hypot(x2 - x1, y2 - y1), an = Math.atan2(y2 - y1, x2 - x1);
            let da = Math.abs(an - ra); if (da > PI) da = 2 * PI - da;
            if (off) { rs = -1; continue; }
            if (rs < 0 || da > 0.35) { rs = k; rl = 0; ra = an; }
            rl += L; if (rl > best) { best = rl; bi = rs; bj = k + 1; }
          }
          if (bi < 0) continue;
          const name = cell.names[C.name[i]], tw = c.measureText(name).width;
          if (best < tw + 16) continue;
          const x1 = X0 + C.xy[bi * 2] * kx, y1 = Y0 - C.xy[bi * 2 + 1] * ppd, x2 = X0 + C.xy[bj * 2] * kx, y2 = Y0 - C.xy[bj * 2 + 1] * ppd;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const prev = used.get(name); if (prev && prev.some(p => Math.hypot(p[0] - mx, p[1] - my) < 260)) continue;
          let ang = Math.atan2(y2 - y1, x2 - x1); if (ang > PI / 2) ang -= PI; else if (ang < -PI / 2) ang += PI;
          const hw = Math.abs(Math.cos(ang)) * tw / 2 + 7, hh = Math.abs(Math.sin(ang)) * tw / 2 + 7;
          if (boxes.some(o => Math.abs(o[0] - mx) < o[2] + hw && Math.abs(o[1] - my) < o[3] + hh)) continue;
          boxes.push([mx, my, hw, hh]); used.set(name, (prev || []).concat([[mx, my]])); n++;
          c.save(); c.translate(mx, my); c.rotate(ang);
          c.lineWidth = 3; c.strokeStyle = S.halo; c.strokeText(name, 0, 0); c.fillStyle = S.label; c.fillText(name, 0, 0); c.restore();
        }
      }
    }
  }
  _streetsGlobe(c, w, S) {
    // worldwide layer on the globe: lakes, rivers and major roads on the visible hemisphere
    const vis = (sec, i) => { const p = this.project((sec.bbox[i * 4 + 1] + sec.bbox[i * 4 + 3]) / 2, (sec.bbox[i * 4] + sec.bbox[i * 4 + 2]) / 2); return p[2] && p[0] > -40 && p[0] < this.cw + 40 && p[1] > -40 && p[1] < this.ch + 40; };
    const line = (sec, i) => { const a = sec.off[i], b = sec.off[i + 1], pts = []; for (let k = a; k < b; k++) pts.push([sec.xy[k * 2 + 1], sec.xy[k * 2]]); return pts; };
    c.strokeStyle = S.river; c.lineWidth = 0.9;
    for (let i = 0; i < w.rivers.n; i++) if (w.rivers.cls[i] <= (this.zoom > 5 ? 7 : 4) && vis(w.rivers, i)) this._strokePath(c, line(w.rivers, i));
    if (this.zoom >= 3) for (const [cl, rc, wd] of [[1, 2, 0.9], [0, 0, 1.3]]) {
      c.strokeStyle = S.road[rc][0]; c.lineWidth = wd;
      for (let i = 0; i < w.roads.n; i++) if (w.roads.cls[i] === cl && vis(w.roads, i)) this._strokePath(c, line(w.roads, i));
    }
  }
  _drawPlaces(c) {
    if (this.tilesOn) return;                            // the street tiles carry their own labels
    const ST = G.ST; if (!ST || !ST.towns) return;
    const globe = this.mode === 'globe', ppd = this._ppdNow(), S = STREET[this.theme];
    if (ppd < 12) return;
    const view = this._viewBounds(), dark = this.theme === 'dark';
    const list = [];
    const minPop = ppd < 25 ? 5e5 : ppd < 50 ? 1.5e5 : ppd < 120 ? 4e4 : ppd < 300 ? 1e4 : 0;
    for (const t of ST.towns) { if (t.pop < minPop && !(t.kind === 0 && ppd >= 40)) continue; list.push(t); if (list.length > 4000) break; }
    if (!globe && view && ppd >= 300) {
      for (const cell of ST.cellsIn('sm', view.lat0, view.lat1, view.lon0, view.lon1)) for (const p of cell.places) if (p.kind <= 1 || ppd >= 700) list.push(p);
      if (ppd >= 1500) for (const cell of ST.cellsIn('sd', view.lat0, view.lat1, view.lon0, view.lon1)) for (const p of cell.places) list.push(p);
    }
    list.sort((a, b) => a.kind - b.kind || b.pop - a.pop);
    let n = 0; const max = ppd < 100 ? 40 : 110, seen = new Set();
    for (const t of list) {
      if (n >= max) break;
      const q = this.project(t.lat, t.lon); if (!q[2]) continue;
      if (globe && q[3] < 0.2) continue;
      if (q[0] < 6 || q[0] > this.cw - 6 || q[1] < 6 || q[1] > this.ch - 6) continue;
      const k = t.name + Math.round(q[0] / 30) + ',' + Math.round(q[1] / 30); if (seen.has(k)) continue; seen.add(k);
      const big = t.kind === 0 || t.pop > 5e5;
      c.font = big ? '700 12.5px "Hanken Grotesk", system-ui, sans-serif' : t.kind === 1 ? '600 11.5px "Hanken Grotesk", system-ui, sans-serif' : t.kind === 2 ? '500 10.5px "Hanken Grotesk", system-ui, sans-serif' : 'italic 500 10px "Hanken Grotesk", system-ui, sans-serif';
      c.textBaseline = 'middle';
      const col = t.kind >= 3 ? (dark ? 'rgba(220,226,238,0.75)' : 'rgba(60,64,72,0.8)') : S.label;
      if (ppd < 900 || t.kind <= 1) {
        if (this._label(c, t.name, q[0] + 5, q[1], col, 'left')) { c.fillStyle = col; c.beginPath(); c.arc(q[0], q[1], big ? 2.6 : 1.9, 0, PI * 2); c.fill(); n++; }
      } else if (this._label(c, t.name, q[0], q[1], col, 'center')) n++;
    }
  }
  /* live street tiles: OpenStreetMap's standard map (no key needed); darkened with a filter in the dark theme */
  _tileUrl(z, x, y) { return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`; }
  _tile(z, x, y) {
    if (!this.tileCache) { this.tileCache = new Map(); this.tileProv = 0; this.tileErr = 0; this.tileOk = 0; }
    const key = z + '/' + x + '/' + y;
    let t = this.tileCache.get(key);
    if (t) return t.ok ? t.img : null;
    const img = new Image(); t = { img, ok: false }; this.tileCache.set(key, t);
    img.onload = () => { t.ok = true; this.tileOk++; this.request(); };
    img.onerror = () => {
      this.tileErr++;
      if (!this.tileOk && this.tileErr > 6) { this._tilesFailed = true; this.dirtyBase = true; this.request(); }   // offline: back to the built-in street map
    };
    img.src = this._tileUrl(z, x, y);
    if (this.tileCache.size > 900) { const k0 = this.tileCache.keys().next().value; this.tileCache.delete(k0); }
    return null;
  }
  _drawTiles(c, view) {
    const W = this.cw, H = this.ch, cx = W / 2, cy = H / 2, ppd = this.ppd, cs = Math.cos(this.stdPar), kx = cs * ppd;
    const z = clamp(Math.round(Math.log2(360 * kx / 256) + 0.15), 1, 19), N = 1 << z;
    const mY = lat => { const s = Math.sin(clamp(lat, -85.05, 85.05) * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * PI); };
    const tLat = y => Math.atan(Math.sinh(PI * (1 - 2 * y / N))) * R2D;
    const x0 = Math.floor((view.lon0 + 180) / 360 * N), x1 = Math.floor((view.lon1 + 180) / 360 * N);
    const y0 = clamp(Math.floor(mY(view.lat1) * N), 0, N - 1), y1 = clamp(Math.floor(mY(view.lat0) * N), 0, N - 1);
    c.save(); c.imageSmoothingEnabled = true;
    if (this.theme === 'dark') c.filter = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.6)';
    for (let ty = y0; ty <= y1; ty++) {
      const latT = tLat(ty), latB = tLat(ty + 1), sy = cy - (latT - this.lat0) * ppd, ey = cy - (latB - this.lat0) * ppd;
      for (let tx = x0; tx <= x1; tx++) {
        const lonL = tx / N * 360 - 180, sx = cx + (lonL - this.lon0) * kx, w = 360 / N * kx;
        const wx = ((tx % N) + N) % N;
        let img = this._tile(z, wx, ty), sub = null;
        if (!img) for (let d = 1; d <= 4 && z - d >= 1; d++) {        // while loading, stretch a coarser tile that is already here
          const pz = z - d, px = wx >> d, py = ty >> d, k = pz + '/' + px + '/' + py, t = this.tileCache.get(k);
          if (t && t.ok) { const f = 1 << d, s = t.img.naturalWidth / f; img = t.img; sub = [(wx - px * f) * s, (ty - py * f) * s, s, s]; break; }
        }
        if (!img) { c.fillStyle = this.theme === 'dark' ? '#1a1f2a' : '#efece6'; c.fillRect(sx, sy, w + 0.5, ey - sy + 0.5); continue; }
        if (sub) c.drawImage(img, sub[0], sub[1], sub[2], sub[3], sx, sy, w + 0.5, ey - sy + 0.5);
        else c.drawImage(img, sx, sy, w + 0.5, ey - sy + 0.5);
      }
    }
    // day/night and the Moon's shadow, carried by the base raster, darken the tiles
    c.filter = 'none'; c.globalCompositeOperation = 'multiply'; c.drawImage(this.base, 0, 0, W, H);
    c.restore();
  }
  _drawAttribution(c) {
    const ppd = this._ppdNow(); if (ppd < 6) return;
    const t = this.tilesOn ? '© OpenStreetMap contributors' : G.ST && G.ST.coverage && this.mode === 'flat' && ppd >= 60 && G.ST.coverage(this.lat0, this.lon0) ? '© OpenStreetMap contributors · Overture Maps · Natural Earth' : 'Natural Earth · Overture Maps';
    c.font = '500 9.5px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    const w = c.measureText(t).width + 10;
    c.fillStyle = this.theme === 'dark' ? 'rgba(6,11,26,0.6)' : 'rgba(255,255,255,0.7)'; c.fillRect(this.cw - w, this.ch - 15, w, 15);
    c.fillStyle = this.theme === 'dark' ? 'rgba(230,236,248,0.75)' : 'rgba(30,36,48,0.75)'; c.fillText(t, this.cw - 5, this.ch - 2);
  }
  setOverlay(ov) { this.overlayImg = ov; this.request(); }
  setMarkers(list) { this.markers = list; this.request(); }
  _drawImageOverlay(c) {
    const ov = this.overlayImg; if (!ov || this.mode !== 'flat') return;
    const a = this.project(ov.lat1, ov.lon0), b = this.project(ov.lat0, ov.lon1);
    c.save(); c.globalAlpha = ov.alpha || 0.55; c.imageSmoothingEnabled = true; c.drawImage(ov.canvas, a[0], a[1], b[0] - a[0], b[1] - a[1]); c.restore();
  }
  _drawMarkers(c) {
    if (!this.markers) return;
    c.font = '700 11px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const m of this.markers) {
      const q = this.project(m.lat, m.lon); if (!q[2]) continue;
      c.fillStyle = m.color || '#4cc790'; c.strokeStyle = 'rgba(8,12,24,0.85)'; c.lineWidth = 2;
      c.beginPath(); c.arc(q[0], q[1] - 12, 10, 0, PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(q[0] - 4, q[1] - 4); c.lineTo(q[0], q[1]); c.lineTo(q[0] + 4, q[1] - 4); c.fillStyle = m.color || '#4cc790'; c.fill();
      c.fillStyle = '#08101e'; c.fillText(String(m.label), q[0], q[1] - 12);
    }
  }
  /* ----- solar overlay ----- */
  _drawSolar(c, view) {
    const an = this.an, ev = this.ev, col = EVT_COLORS[an.type] || EVT_COLORS.P;
    const globe = this.mode === 'globe';
    const dark = this.theme === 'dark';
    // partial region isolines of magnitude
    if (this.layers.tint && this.field) this._drawMagLines(c, dark);
    if (an.path && an.path.t.length > 1) {
      const p = an.path;
      // umbral band as quads, drawn opaque on a scratch canvas then composited translucent (no seams)
      if (!this._scratch) this._scratch = document.createElement('canvas');
      const sc = this._scratch; if (sc.width !== this.over.width || sc.height !== this.over.height) { sc.width = this.over.width; sc.height = this.over.height; }
      const s2 = sc.getContext('2d'); s2.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); s2.clearRect(0, 0, W_(this), H_(this));
      s2.fillStyle = col; s2.strokeStyle = col; s2.lineWidth = 1.2; s2.lineJoin = 'round';
      for (let i = 0; i < p.t.length - 1; i++) {
        if (p.nlat[i] === null || p.nlat[i + 1] === null || p.slat[i] === null || p.slat[i + 1] === null) continue;
        const a = this.project(p.nlat[i], p.nlon[i]), b = this.project(p.nlat[i + 1], p.nlon[i + 1]), d = this.project(p.slat[i + 1], p.slon[i + 1]), e = this.project(p.slat[i], p.slon[i]);
        if (globe && !(a[2] && b[2] && d[2] && e[2])) continue;
        if (!globe && (Math.abs(a[0] - b[0]) > this.cw * 0.4)) continue;
        s2.beginPath(); s2.moveTo(a[0], a[1]); s2.lineTo(b[0], b[1]); s2.lineTo(d[0], d[1]); s2.lineTo(e[0], e[1]); s2.closePath(); s2.fill(); s2.stroke();
      }
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = Math.min(this.layers.bandAlpha || 0.46, this.layers.style === 'streets' && !globe && this.ppd >= 40 ? 0.22 : 1); c.drawImage(sc, 0, 0); c.restore();
      // limits
      c.strokeStyle = col; c.lineWidth = 1.2;
      const nl = [], sl = [], cl = [];
      for (let i = 0; i < p.t.length; i++) { if (p.nlat[i] !== null) nl.push([p.nlat[i], p.nlon[i]]); if (p.slat[i] !== null) sl.push([p.slat[i], p.slon[i]]); cl.push([p.lat[i], p.lon[i]]); }
      this._strokePath(c, nl); this._strokePath(c, sl);
      c.strokeStyle = dark ? '#fff' : '#101a33'; c.lineWidth = 1.1; c.setLineDash([5, 4]); this._strokePath(c, cl); c.setLineDash([]);
      // time ticks
      const zl = globe ? this.zoom : this.ppd / (this.cw / 360);
      const stepMin = zl > 14 ? 2 : zl > 5 ? 5 : zl > 2.2 ? 10 : 20;
      const t0 = Math.ceil(p.t[0] / (stepMin * 60000)) * stepMin * 60000;
      c.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; c.textBaseline = 'middle';
      for (let t = t0; t <= p.t[p.t.length - 1]; t += stepMin * 60000) {
        let bi = 0, bd = 1e18; for (let i = 0; i < p.t.length; i++) { const d = Math.abs(p.t[i] - t); if (d < bd) { bd = d; bi = i; } }
        const q = this.project(p.lat[bi], p.lon[bi]); if (!q[2]) continue;
        const dd = new Date(t), lab = String(dd.getUTCHours()).padStart(2, '0') + ':' + String(dd.getUTCMinutes()).padStart(2, '0');
        c.fillStyle = dark ? '#fff' : '#101a33'; c.beginPath(); c.arc(q[0], q[1], 2.2, 0, PI * 2); c.fill();
        if (zl > 1.8 || stepMin >= 20) { if (this._label(c, lab, q[0] + 6, q[1] - 8, dark ? 'rgba(255,255,255,.88)' : 'rgba(16,26,51,.9)', 'left')) {} }
      }
    }
    // greatest eclipse
    if (an.lat !== undefined) {
      const g = this.project(an.lat, an.lon);
      if (g[2]) {
        c.strokeStyle = col; c.lineWidth = 2; c.fillStyle = dark ? '#0b1020' : '#fff';
        c.beginPath(); c.arc(g[0], g[1], 6, 0, PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.arc(g[0], g[1], 2, 0, PI * 2); c.fillStyle = col; c.fill();
      }
    }
    // current shadow centre
    const E = new Float64Array(this.Ecl.NQ);
    if (an.poly) {
      this.Ecl.evalInto(an.poly, this.time, E);
      let g = this.Ecl.fpToGeo(E, E[0], E[1]);
      if (g) {
        const q = this.project(g.lat, g.lon);
        if (q[2]) {
          c.strokeStyle = dark ? '#fff' : '#101a33'; c.lineWidth = 1.5; c.beginPath(); c.arc(q[0], q[1], 9, 0, PI * 2); c.stroke();
          c.beginPath(); c.moveTo(q[0] - 14, q[1]); c.lineTo(q[0] - 6, q[1]); c.moveTo(q[0] + 6, q[1]); c.lineTo(q[0] + 14, q[1]); c.moveTo(q[0], q[1] - 14); c.lineTo(q[0], q[1] - 6); c.moveTo(q[0], q[1] + 6); c.lineTo(q[0], q[1] + 14); c.stroke();
        }
      }
    }
  }
  _drawMagLines(c, dark) {
    const F = this.field; if (!F) return;
    if (!F.lines) F.lines = this._isolines(F, [0, 0.25, 0.5, 0.75]);
    const levels = [0, 0.25, 0.5, 0.75];
    c.lineJoin = 'round';
    F.lines.forEach((set, k) => {
      const lev = levels[k];
      c.strokeStyle = lev === 0 ? (dark ? 'rgba(190,170,255,0.75)' : 'rgba(90,70,200,0.75)') : (dark ? 'rgba(190,170,255,0.38)' : 'rgba(90,70,200,0.4)');
      c.lineWidth = lev === 0 ? 1.1 : 0.8; c.setLineDash(lev === 0 ? [] : [2, 3]);
      for (const seg of set) this._strokePath(c, seg);
      c.setLineDash([]);
    });
    // labels once per level
    if (this.zoom > 1.1 || this.mode === 'flat') {
      c.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
      F.lines.forEach((set, k) => {
        if (k === 0) return;
        let best = null, bl = 0;
        for (const seg of set) { if (seg.length > bl) { const mid = seg[Math.floor(seg.length / 2)]; const q = this.project(mid[0], mid[1]); if (q[2] && q[0] > 20 && q[0] < this.cw - 20 && q[1] > 14 && q[1] < this.ch - 14) { bl = seg.length; best = q; } } }
        if (best) this._label(c, levels[k].toFixed(2), best[0], best[1], dark ? 'rgba(200,185,255,.95)' : 'rgba(70,50,170,.95)', 'center');
      });
    }
  }
  _isolines(F, levels) {
    const w = F.w, h = F.h, d = F.data, res = [];
    for (const L of levels) {
      const segs = [];
      const key = (x, y) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4);
      const edges = [];
      for (let i = 0; i < h - 1; i++) for (let j = 0; j < w; j++) {
        const jn = (j + 1) % w;
        const a = d[i * w + j], b = d[i * w + jn], e = d[(i + 1) * w + jn], f = d[(i + 1) * w + j];
        if (a < -0.5 || b < -0.5 || e < -0.5 || f < -0.5) { if (L === 0) { /* border of eclipse visibility due to horizon: treat -1 as just below zero */ } }
        const code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (e > L ? 2 : 0) | (f > L ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const lerp = (v0, v1) => clamp((L - v0) / (v1 - v0), 0, 1);
        const P = (x, y) => [x, y];
        const top = P(j + lerp(a, b), i), right = P(j + 1, i + lerp(b, e)), bottom = P(j + lerp(f, e), i + 1), left = P(j, i + lerp(a, f));
        const add = (p, q) => edges.push([p, q]);
        switch (code) {
          case 1: case 14: add(left, bottom); break; case 2: case 13: add(bottom, right); break; case 3: case 12: add(left, right); break;
          case 4: case 11: add(top, right); break; case 5: add(left, top); add(bottom, right); break; case 6: case 9: add(top, bottom); break;
          case 7: case 8: add(left, top); break; case 10: add(left, bottom); add(top, right); break;
        }
      }
      // chain edges into polylines
      const toGeo = p => [90 - (p[1] + 0.5) * 180 / h, -180 + (p[0] + 0.5) * 360 / w];
      const map = new Map();
      edges.forEach((e, idx) => { for (const end of [0, 1]) { const k = key(e[end][0], e[end][1]); if (!map.has(k)) map.set(k, []); map.get(k).push([idx, end]); } });
      const used = new Uint8Array(edges.length);
      for (let s = 0; s < edges.length; s++) {
        if (used[s]) continue; used[s] = 1;
        let chain = [edges[s][0], edges[s][1]];
        for (const dir of [1, 0]) {
          for (;;) {
            const tip = dir ? chain[chain.length - 1] : chain[0], k = key(tip[0], tip[1]);
            const cand = (map.get(k) || []).find(([idx]) => !used[idx]);
            if (!cand) break; used[cand[0]] = 1;
            const other = edges[cand[0]][1 - cand[1]];
            if (dir) chain.push(other); else chain.unshift(other);
          }
        }
        if (chain.length > 3) segs.push(chain.map(toGeo));
      }
      res.push(segs);
    }
    return res;
  }

  /* ----- lunar overlay ----- */
  _drawLunar(c) {
    const dark = this.theme === 'dark';
    if (!this.moonPt) return;
    const m = this.moonPt, q = this.project(m.lat, m.lon);
    // horizon circle of the Moon (altitude 0)
    const pts = []; for (let a = 0; a <= 360; a += 4) {
      const az = a * D2R, d = 90 * D2R, p1 = m.lat * D2R, l1 = m.lon * D2R;
      const lat = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az));
      const lon = l1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(lat));
      pts.push([lat * R2D, lon * R2D]);
    }
    c.strokeStyle = dark ? 'rgba(255,200,170,0.7)' : 'rgba(170,70,30,0.7)'; c.lineWidth = 1.2; c.setLineDash([6, 4]); this._strokePath(c, pts); c.setLineDash([]);
    if (q[2]) {
      c.fillStyle = '#e8d9c4'; c.strokeStyle = dark ? '#fff' : '#101a33'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(q[0], q[1], 7, 0, PI * 2); c.fill(); c.stroke();
    }
    if (this.sunPt) {
      const s = this.project(this.sunPt.lat, this.sunPt.lon);
      if (s[2]) { c.fillStyle = '#ffcf5c'; c.beginPath(); c.arc(s[0], s[1], 5, 0, PI * 2); c.fill(); c.strokeStyle = dark ? '#fff' : '#101a33'; c.lineWidth = 1; c.stroke(); }
    }
  }

  /* ----- labels, cities, site ----- */
  _label(c, text, x, y, color, align) {
    c.font = c.font || '11px sans-serif';
    const w = c.measureText(text).width + 6, h = 13;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x - 2, y0 = y - h / 2;
    for (const o of this._occupied) if (x0 < o[2] && x0 + w > o[0] && y0 < o[3] && y0 + h > o[1]) return false;
    this._occupied.push([x0, y0, x0 + w, y0 + h]);
    c.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    c.lineWidth = 3; c.strokeStyle = this.theme === 'dark' ? 'rgba(6,11,26,0.85)' : 'rgba(255,255,255,0.88)'; c.lineJoin = 'round';
    c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y);
    return true;
  }
  _drawCountryLabels(c, ink) {
    const zl = this.mode === 'globe' ? this.zoom : this.ppd / (this.cw / 360);
    if (zl > 9) return;
    const dark = this.theme === 'dark';
    c.font = '600 10px "Hanken Grotesk", system-ui, sans-serif'; c.textBaseline = 'middle';
    const minArea = zl < 1.3 ? 90 : zl < 2.5 ? 25 : zl < 5 ? 6 : 0;
    let n = 0;
    for (const k of this.D.countries) {
      if (k.area < minArea) continue; if (n > 70) break;
      const q = this.project(k.lat, k.lon); if (!q[2]) continue;
      if (this.mode === 'globe' && q[3] < 0.25) continue;
      if (q[0] < 0 || q[0] > this.cw || q[1] < 0 || q[1] > this.ch) continue;
      if (this._label(c, k.name.toUpperCase(), q[0], q[1], dark ? 'rgba(255,255,255,0.5)' : 'rgba(14,21,48,0.55)', 'center')) n++;
    }
  }
  _drawCities(c, ink) {
    const zl = this.mode === 'globe' ? this.zoom : this.ppd / (this.cw / 360);
    if (zl < 1.7) return;
    const dark = this.theme === 'dark';
    const minPop = zl < 2.5 ? 3e6 : zl < 4 ? 1e6 : zl < 7 ? 4e5 : zl < 14 ? 1.2e5 : zl < 40 ? 3e4 : 0;
    const max = zl < 4 ? 14 : zl < 14 ? 34 : 70;
    c.font = '500 11px "Hanken Grotesk", system-ui, sans-serif'; c.textBaseline = 'middle';
    let n = 0;
    for (const ct of this.D.cities) {
      if (ct.pop < minPop) break; if (n >= max) break;
      const q = this.project(ct.lat, ct.lon); if (!q[2]) continue;
      if (q[0] < 4 || q[0] > this.cw - 4 || q[1] < 4 || q[1] > this.ch - 4) continue;
      c.fillStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(14,21,48,0.9)';
      c.beginPath(); c.arc(q[0], q[1], ct.pop > 1e6 ? 2.4 : 1.8, 0, PI * 2); c.fill();
      if (this._label(c, ct.name, q[0] + 5, q[1], dark ? 'rgba(255,255,255,0.92)' : 'rgba(14,21,48,0.92)', 'left')) n++;
    }
  }
  /* arrow from the site toward the Sun (solar eclipse or no event) or the Moon (lunar eclipse) at the current time */
  _drawBodyArrow(c, s, q) {
    const A = G.Astronomy; if (!A || !isFinite(this.time)) return;
    const body = this.ev && this.ev.kind === 'lunar' ? 'Moon' : 'Sun';
    let hz;
    try {
      const tt = this.Ecl.mkTime(this.time), ob = new A.Observer(s.lat, s.lon, s.elev || 0), eq = A.Equator(body, tt, ob, true, true);
      hz = A.Horizon(tt, ob, eq.ra, eq.dec, 'normal');
    } catch (e) { return; }
    this.bodyDir = { body, az: hz.azimuth, alt: hz.altitude, t: this.time };
    // screen direction of the azimuth: project a point a short way along the great circle
    const az = hz.azimuth * D2R, d = 0.02 * D2R, p1 = s.lat * D2R, l1 = s.lon * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az));
    const l2 = l1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    const q2 = this.project(p2 * R2D, l2 * R2D);
    let dx = q2[0] - q[0], dy = q2[1] - q[1]; const n = Math.hypot(dx, dy); if (!(n > 1e-9)) return;
    dx /= n; dy /= n;
    const up = hz.altitude > -0.8, L = 74, x0 = q[0] + dx * 15, y0 = q[1] + dy * 15, x1 = q[0] + dx * L, y1 = q[1] + dy * L;
    const col = body === 'Sun' ? '#ffb020' : (this.theme === 'dark' ? '#cfd8ea' : '#55607a');
    c.save(); c.lineCap = 'round';
    c.strokeStyle = this.theme === 'dark' ? 'rgba(6,11,26,0.75)' : 'rgba(255,255,255,0.9)'; c.lineWidth = 6; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = col; c.lineWidth = 3; c.setLineDash(up ? [] : [5, 5]); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.setLineDash([]);
    const hx = -dy, hy = dx, hl = 11;
    c.fillStyle = col; c.beginPath(); c.moveTo(x1 + dx * 4, y1 + dy * 4); c.lineTo(x1 - dx * hl + hx * 6, y1 - dy * hl + hy * 6); c.lineTo(x1 - dx * hl - hx * 6, y1 - dy * hl - hy * 6); c.closePath(); c.fill();
    // body symbol at the tip
    const bx = x1 + dx * 13, by = y1 + dy * 13;
    c.beginPath(); c.arc(bx, by, 6, 0, PI * 2); c.fillStyle = up ? col : 'rgba(128,128,128,0.6)'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = this.theme === 'dark' ? 'rgba(6,11,26,0.85)' : 'rgba(255,255,255,0.95)'; c.stroke();
    c.font = '600 11px "Hanken Grotesk", system-ui, sans-serif'; c.textBaseline = 'middle';
    const txt = body + ' ' + Math.round(hz.altitude) + '° · ' + Math.round(hz.azimuth) + '°' + (up ? '' : ' (below horizon)');
    const right = dx >= 0, tx = bx + (right ? 10 : -10);
    c.textAlign = right ? 'left' : 'right'; c.lineWidth = 3; c.strokeStyle = this.theme === 'dark' ? 'rgba(6,11,26,0.85)' : 'rgba(255,255,255,0.92)';
    c.strokeText(txt, tx, by); c.fillStyle = this.theme === 'dark' ? '#f2f4f8' : '#1e2430'; c.fillText(txt, tx, by);
    c.restore();
  }
  _drawSite(c) {
    const s = this.site, q = this.project(s.lat, s.lon);
    if (!q[2]) return;
    if (this.layers.bodyArrow !== false) this._drawBodyArrow(c, s, q);
    const dark = this.theme === 'dark', acc = dark ? '#f4c25b' : '#b4690e';
    c.strokeStyle = acc; c.lineWidth = 2; c.fillStyle = dark ? '#0b1020' : '#fff';
    c.beginPath(); c.arc(q[0], q[1], 7, 0, PI * 2); c.fill(); c.stroke();
    c.fillStyle = acc; c.beginPath(); c.arc(q[0], q[1], 3, 0, PI * 2); c.fill();
    c.strokeStyle = acc + '66'; c.lineWidth = 1; c.beginPath(); c.arc(q[0], q[1], 13, 0, PI * 2); c.stroke();
    c.font = '700 11px "Hanken Grotesk", system-ui, sans-serif'; c.textBaseline = 'middle';
    const prev = this._occupied; this._occupied = [];
    this._label(c, s.name || 'Your site', q[0] + 12, q[1] - 12, acc, 'left');
    this._occupied = prev;
  }
  _drawHover(c) {
    const q = this.project(this.hoverPt.lat, this.hoverPt.lon); if (!q[2]) return;
    c.strokeStyle = this.theme === 'dark' ? 'rgba(255,255,255,.7)' : 'rgba(14,21,48,.7)'; c.lineWidth = 1;
    c.beginPath(); c.arc(q[0], q[1], 5, 0, PI * 2); c.stroke();
  }
  setHover(p) { this.hoverPt = p; this.request(); }
  // fit view to an array of [lat, lon]
  fitPoints(pts, pad) {
    if (!pts.length) return;
    let la0 = 90, la1 = -90; const lons = [];
    for (const p of pts) { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lons.push(p[1]); }
    // lon range via circular mean
    let sx = 0, sy = 0; for (const l of lons) { sx += Math.cos(l * D2R); sy += Math.sin(l * D2R); }
    const lm = Math.atan2(sy, sx) * R2D; let dmax = 0; for (const l of lons) dmax = Math.max(dmax, Math.abs(((l - lm + 540) % 360) - 180));
    const latC = (la0 + la1) / 2, latSpan = (la1 - la0) + 6, lonSpan = dmax * 2 + 6;
    if (this.mode === 'globe') { this.lat0 = clamp(latC, -75, 75); this.lon0 = lm; const span = Math.max(latSpan, lonSpan * Math.cos(latC * D2R)); this.zoom = clamp(150 / Math.max(span, 20) * (pad || 1), 0.9, 4); }
    else {
      this.lat0 = latC; this.lon0 = lm;
      const cs = Math.cos(latC * D2R);
      const zLon = this.cw / (lonSpan * cs) / (Math.max(this.cw / 360, this.ch / 180)), zLat = this.ch / latSpan / (Math.max(this.cw / 360, this.ch / 180));
      this.zoom = clamp(Math.min(zLon, zLat) * 0.9 * (pad || 1), 1, 320);
    }
    this.dirtyGeo = true; this.request(); this.cb.view && this.cb.view(this);
  }
}
G.MapView = MapView; G.EVT_COLORS = EVT_COLORS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
