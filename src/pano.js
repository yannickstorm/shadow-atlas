/* PanoView: a PeakFinder-style terrain panorama from the observer, ray-marched through the multi-resolution
   terrain, with ridge lines, peak labels and the Sun/Moon path through the eclipse. Cylindrical projection:
   x = azimuth, y = apparent altitude, same scale on both axes (times an optional vertical stretch). */
(function (G) {
'use strict';
const A = G.Astronomy, Ecl = G.Ecl, TS = G.TS;
const PI = Math.PI, D2R = PI / 180, R2D = 180 / PI, RE = 6371000, KREF = 0.13;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const wrap180 = a => ((a % 360) + 540) % 360 - 180;
const refr = h => h < -1.5 ? h : h + (1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R)) / 60;
const RAMP = [[-1, [92, 120, 140]], [0, [104, 118, 82]], [500, [112, 120, 84]], [1200, [128, 120, 92]], [2000, [134, 122, 108]], [2800, [150, 146, 142]], [3400, [206, 210, 216]], [4500, [238, 240, 244]]];
function rampCol(h) {
  if (h <= 0) return RAMP[0][1];
  for (let i = 1; i < RAMP.length - 1; i++) if (h <= RAMP[i + 1][0]) { const a = RAMP[i], b = RAMP[i + 1], t = (h - a[0]) / (b[0] - a[0]); return [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]; }
  return RAMP[RAMP.length - 1][1];
}

class PanoView {
  constructor(host) {
    this.host = host;
    this.cv = document.createElement('canvas'); this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;';
    host.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.tcv = document.createElement('canvas'); this.tctx = this.tcv.getContext('2d');
    this.opts = { az0: 180, fov: 70, altC: 6, vx: 1, eye: 2, labels: true };
    this.site = null; this.ev = null; this.an = null; this.time = Date.now(); this.theme = 'dark';
    this.cb = {}; this.pending = false; this.skyCache = new Map(); this.key = '';
    this._bind();
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
  }
  on(n, f) { this.cb[n] = f; }
  setSite(s) { this.site = s; this.invalidate(); }
  setEvent(ev, an) { this.ev = ev; this.an = an; this.path = null; this.request(); }
  setTime(ms) { this.time = ms; this.request(); }
  setTheme(t) { this.theme = t; this.request(); }
  setOpts(o) {
    const yh = this.yOf(0);
    Object.assign(this.opts, o);
    if ('vx' in o && !('altC' in o)) this.opts.altC = (yh - this.ch * 0.5) / (this.ppd * this.opts.vx);   // keep the horizon where it was
    if ('eye' in o || 'vx' in o) this.invalidate(); else this.request();
  }
  invalidate() { this.skyCache.clear(); this.key = ''; this.path = null; this.request(); }
  resize() { const r = this.host.getBoundingClientRect(); this.cw = Math.max(80, Math.round(r.width)); this.ch = Math.max(80, Math.round(r.height)); this.dpr = Math.min(1.5, window.devicePixelRatio || 1); this.cv.width = Math.round(this.cw * this.dpr); this.cv.height = Math.round(this.ch * this.dpr); this.key = ''; this.request(); }
  request() { if (this.pending) return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.render(); }); }

  /* ---------- geometry ---------- */
  get ppd() { return this.cw / this.opts.fov; }
  xOf(az) { return this.cw / 2 + wrap180(az - this.opts.az0) * this.ppd; }
  yOf(alt) { return this.ch * 0.5 - (alt - this.opts.altC) * this.ppd * this.opts.vx; }
  azOf(x) { return (this.opts.az0 + (x - this.cw / 2) / this.ppd + 360) % 360; }
  altOf(y) { return this.opts.altC + (this.ch * 0.5 - y) / (this.ppd * this.opts.vx); }
  h0() { return (this.ground = this.site ? Math.max(TS.at(this.site.lat, this.site.lon), this.site.elev || 0) : 0) + this.opts.eye; }

  /* one ray: highest apparent elevation angle of terrain toward azimuth az (deg) */
  skyAt(az) {
    const k = Math.round(((az % 360) + 360) % 360 * 10);
    if (this.skyCache.has(k)) return this.skyCache.get(k);
    const r = PanoView.ray(this.site.lat, this.site.lon, this.h0(), k / 10, 250000);
    this.skyCache.set(k, r); return r;
  }
  static ray(lat0, lon0, h0, az, dmax, stopAbove) {
    const sA = Math.sin(az * D2R), cA = Math.cos(az * D2R), cl = Math.cos(lat0 * D2R), hmax = Math.max(TS.hmax || 0, 4500);
    let best = -90, bd = 0, bh = 0;
    for (let d = 30; d < dmax; d += Math.max(20, d * 0.008)) {
      const a = d / RE * R2D, lat = lat0 + a * cA, lon = lon0 + a * sA / cl;
      const h = TS.at(lat, lon);
      const ang = Math.atan((h - h0) / d - d * (1 - KREF) / (2 * RE)) * R2D;
      if (ang > best) { best = ang; bd = d; bh = h; if (stopAbove !== undefined && best > stopAbove) break; }
      if (Math.atan((hmax - h0) / d - d * (1 - KREF) / (2 * RE)) * R2D < best) break;
    }
    return { ang: best, d: bd, h: bh };
  }

  /* ---------- interaction ---------- */
  _bind() {
    const el = this.cv, ptrs = new Map(); let drag = null, pinch = null, moved = 0;
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, az: this.opts.az0, alt: this.opts.altC }; moved = 0; el.style.cursor = 'grabbing'; } if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), f: this.opts.fov }; drag = null; } });
    el.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; this.zoom(pinch.f * pinch.d / Math.hypot(a[0] - b[0], a[1] - b[1])); return; }
      if (!drag) return;
      moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      this.opts.az0 = (drag.az - (e.clientX - drag.x) / this.ppd + 360) % 360;
      this.opts.altC = clamp(drag.alt + (e.clientY - drag.y) / (this.ppd * this.opts.vx), -10, 85);
      this.fast = true; this.request(); clearTimeout(this._st); this._st = setTimeout(() => { this.fast = false; this.request(); }, 150);
    });
    const up = e => {
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
      if (drag && !ptrs.size) { el.style.cursor = 'grab'; if (moved < 5) this._pick(e); drag = null; }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); const r = el.getBoundingClientRect(), az = this.azOf(e.clientX - r.left); this.zoom(this.opts.fov * Math.exp(e.deltaY * 0.0015), az, e.clientX - r.left); }, { passive: false });
  }
  zoom(f, az, px) {
    const yh = this.yOf(0);
    this.opts.fov = clamp(f, 6, 180);
    this.opts.altC = (yh - this.ch * 0.5) / (this.ppd * this.opts.vx);
    if (az !== undefined) this.opts.az0 = (az - (px - this.cw / 2) / this.ppd + 360) % 360;
    this.fast = true; this.request(); clearTimeout(this._st); this._st = setTimeout(() => { this.fast = false; this.request(); }, 150);
    this.cb.view && this.cb.view(this.opts);
  }
  _pick(e) {
    if (!this.dist || !this.cb.pick) return;
    const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const s = this.tw / this.cw, xi = Math.floor(x * s), yi = Math.floor(y * s);
    const d = this.dist[yi * this.tw + xi];
    if (!d) { this.cb.pick(null); return; }
    const az = this.azOf(x), a = d / RE * R2D, cl = Math.cos(this.site.lat * D2R);
    const lat = this.site.lat + a * Math.cos(az * D2R), lon = this.site.lon + a * Math.sin(az * D2R) / cl;
    this.cb.pick({ lat, lon, d, az, elev: TS.at(lat, lon), x, y });
  }

  /* ---------- eclipse path for the current site ---------- */
  _sunPath() {
    if (this.path) return this.path;
    const ev = this.ev, an = this.an, s = this.site; if (!ev || !an || !s) return null;
    let a, b; const pts = [], marks = [];
    if (ev.kind === 'solar') {
      const L = Ecl.local(an, s.lat, s.lon, s.elev || 0);
      if (L.eclipse && L.visible) { a = (L.c1 || L.tMax - 3600000) - 25 * 60000; b = (L.c4 || L.tMax + 3600000) + 25 * 60000; }
      else { a = an.tGreatest - 2.5 * 3600000; b = an.tGreatest + 2.5 * 3600000; }
      const ob = Ecl.makeObserver(s.lat, s.lon, s.elev || 0);
      for (let t = a; t <= b; t += 60000) { const q = Ecl.localAt(an, ob, t); pts.push({ t, alt: refr(q.alt), az: q.az, obsc: q.obsc }); }
      if (L.eclipse) for (const [n, t] of [['C1', L.c1], ['C2', L.c2], ['MAX', L.tMax], ['C3', L.c3], ['C4', L.c4]]) if (t) { const q = Ecl.localAt(an, ob, t); marks.push({ n, t, alt: refr(q.alt), az: q.az }); }
      this.path = { body: 'Sun', pts, marks, L };
    } else {
      const obs = new A.Observer(s.lat, s.lon, s.elev || 0);
      a = an.tP1 - 30 * 60000; b = an.tP4 + 30 * 60000;
      const pos = t => { const tt = Ecl.mkTime(t), eq = A.Equator('Moon', tt, obs, true, true), h = A.Horizon(tt, obs, eq.ra, eq.dec, 'normal'); return { alt: h.altitude, az: h.azimuth }; };
      for (let t = a; t <= b; t += 120000) { const p = pos(t); pts.push({ t, alt: p.alt, az: p.az }); }
      for (const [n, t] of [['P1', an.tP1], ['U1', an.tU1], ['U2', an.tU2], ['MAX', an.tGreatest], ['U3', an.tU3], ['U4', an.tU4], ['P4', an.tP4]]) if (t) { const p = pos(t); marks.push({ n, t, alt: p.alt, az: p.az }); }
      this.path = { body: 'Moon', pts, marks };
    }
    return this.path;
  }
  bodyAt(t) {
    const p = this._sunPath(); if (!p) return null;
    const pts = p.pts; if (t <= pts[0].t) return pts[0]; if (t >= pts[pts.length - 1].t) return pts[pts.length - 1];
    let i = 0; while (i < pts.length - 2 && pts[i + 1].t < t) i++;
    const q = pts[i], r = pts[i + 1], f = (t - q.t) / (r.t - q.t);
    return { t, alt: q.alt + (r.alt - q.alt) * f, az: (q.az + wrap180(r.az - q.az) * f + 360) % 360 };
  }
  /* visibility summary along the body's path */
  analyze() {
    const p = this._sunPath(); if (!p || !this.site) return null;
    const blocked = p.pts.map(q => { const s = this.skyAt(q.az); return { t: q.t, vis: q.alt > Math.max(s.ang, -1) + 0.25, alt: q.alt, sky: s }; });
    const mx = p.marks.find(m => m.n === 'MAX');
    let atMax = null;
    if (mx) { const s = this.skyAt(mx.az); atMax = { alt: mx.alt, az: mx.az, sky: s, margin: mx.alt - Math.max(s.ang, 0), t: mx.t }; }
    const out = { body: p.body, atMax, segs: [], marks: p.marks.map(m => { const s = this.skyAt(m.az); return Object.assign({}, m, { sky: s.ang, vis: m.alt > Math.max(s.ang, -1) + 0.25 }); }) };
    let cur = null;
    for (const q of blocked) { if (q.vis) { if (!cur) out.segs.push(cur = { a: q.t, b: q.t }); cur.b = q.t; } else cur = null; }
    return out;
  }

  /* ---------- render ---------- */
  render() {
    if (!this.site || !this.host.offsetWidth) return;
    const c = this.ctx, W = this.cw, H = this.ch, dpr = this.dpr, o = this.opts;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // lighting from the sky
    const sky = G.App && G.App.views.sky ? G.App.views.sky.frameAt(this.time) : null;
    const L = sky ? sky.L : 1, SU = G.SkyUtil;
    const [Z, Hz] = SU.skyColors(L);
    const g = c.createLinearGradient(0, this.yOf(70), 0, this.yOf(0));
    g.addColorStop(0, SU.rgb(Z)); g.addColorStop(1, SU.rgb(Hz)); c.fillStyle = g; c.fillRect(0, 0, W, H);
    if (sky && sky.total) { const tg = c.createLinearGradient(0, this.yOf(12), 0, this.yOf(0)); tg.addColorStop(0, 'rgba(236,122,66,0)'); tg.addColorStop(1, 'rgba(236,122,66,0.55)'); c.fillStyle = tg; c.fillRect(0, 0, W, this.yOf(0)); }
    this._terrain(L, Hz);
    c.drawImage(this.tcv, 0, 0, W, H);
    this._overlay(c, L);
  }
  _terrain(L, haze) {
    const s = this.fast ? 0.5 : 1, tw = Math.max(40, Math.round(this.cw * this.dpr * s)), th = Math.max(40, Math.round(this.ch * this.dpr * s));
    const key = [tw, th, this.opts.az0.toFixed(3), this.opts.fov.toFixed(3), this.opts.altC.toFixed(3), this.opts.vx, this.opts.eye, this.site.lat, this.site.lon, TS.version || 0, Math.round(L * 40)].join('|');
    if (key === this.key) return;
    this.key = key;
    if (this.tcv.width !== tw || this.tcv.height !== th) { this.tcv.width = tw; this.tcv.height = th; this.img = this.tctx.createImageData(tw, th); this.px = new Uint32Array(this.img.data.buffer); this.dist = new Float32Array(tw * th); }
    this.tw = tw; this.th = th;
    const px = this.px, dist = this.dist; px.fill(0); dist.fill(0);
    const sc = tw / this.cw, ppd = this.ppd * sc, vx = this.opts.vx, yC = th * 0.5, altC = this.opts.altC;
    const lat0 = this.site.lat, lon0 = this.site.lon, h0 = this.h0(), cl = Math.cos(lat0 * D2R), hmax = Math.max(TS.hmax || 0, 4500);
    const lit = 0.18 + 0.82 * L, dark = L < 0.35;
    const hz = haze.map(v => v * (0.35 + 0.65 * L));
    // night: terrain is drawn as moonlit slate, lighter with distance, so ridges stay readable against a dark sky
    const nf = clamp((0.5 - L) / 0.35, 0, 1);
    const ridgeCol = nf > 0.3 ? [214, 226, 248] : [24, 32, 44];
    this.skyline = new Float32Array(tw); this.skyD = new Float32Array(tw); this.skyH = new Float32Array(tw);
    const step = this.fast ? 0.016 : 0.008;
    for (let x = 0; x < tw; x++) {
      const az = (this.opts.az0 + (x + 0.5 - tw / 2) / ppd) * D2R, sA = Math.sin(az), cA = Math.cos(az);
      let ybuf = th, vis = false, pd = 0, ph = h0, best = -90, bd = 0, bh = 0, runStart = true, crest = null;
      for (let d = 25; d < 250000; d += Math.max(18, d * step)) {
        const a = d / RE * R2D, h = TS.at(lat0 + a * cA, lon0 + a * sA / cl);
        const ang = Math.atan((h - h0) / d - d * (1 - KREF) / (2 * RE)) * R2D;
        const y = yC - (ang - altC) * ppd * vx;
        if (y < ybuf) {
          if (crest) { if (d > crest.d * 1.3 + 400 && crest.y - y > 0) this._ridge(px, tw, th, x, crest.y, crest.d, ridgeCol, hz); crest = null; }
          if (ang > best) { best = ang; bd = d; bh = h; }
          const slope = (h - ph) / Math.max(1, d - pd);
          let col = rampCol(h);
          const sh = clamp(0.72 + slope * 1.6, 0.45, 1.25) * lit * (runStart ? 0.82 : 1);
          const f = 1 - Math.exp(-d / 42000);
          let r = col[0] * sh * (1 - f) + hz[0] * f, gg = col[1] * sh * (1 - f) + hz[1] * f, b = col[2] * sh * (1 - f) + hz[2] * f;
          if (nf > 0) {
            const t = clamp(h / 4000, 0, 1), shn = clamp(0.8 + slope * 1.4, 0.6, 1.25) * (runStart ? 0.8 : 1), fn = (1 - Math.exp(-d / 30000)) * 0.85;
            const nr = (46 + 20 * t) * shn * (1 - fn) + 104 * fn, ng = (56 + 22 * t) * shn * (1 - fn) + 116 * fn, nb = (78 + 26 * t) * shn * (1 - fn) + 146 * fn;
            r += (nr - r) * nf; gg += (ng - gg) * nf; b += (nb - b) * nf;
          }
          const c32 = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((gg > 255 ? 255 : gg) << 8) | (r > 255 ? 255 : r);
          const yi = Math.max(0, Math.ceil(y)), yb = Math.min(th, Math.ceil(ybuf));
          for (let yy = yi; yy < yb; yy++) { px[yy * tw + x] = c32; dist[yy * tw + x] = d; }
          ybuf = y; vis = true; runStart = false;
        } else if (vis) {
          // crest of the run that just went out of sight; drawn as a ridge line only if the next visible terrain is well behind it
          crest = { y: ybuf, d: pd }; vis = false; runStart = true;
        }
        pd = d; ph = h;
        if (ybuf <= 0) break;
        if (Math.atan((hmax - h0) / d - d * (1 - KREF) / (2 * RE)) * R2D < best && ybuf < th) break;
      }
      if (vis) this._ridge(px, tw, th, x, ybuf, pd, ridgeCol, hz, true);
      this.skyline[x] = best; this.skyD[x] = bd; this.skyH[x] = bh;
    }
    this.tctx.putImageData(this.img, 0, 0);
  }
  _ridge(px, tw, th, x, y, d, col, hz, sky) {
    const yi = Math.ceil(y); if (yi < 0 || yi >= th) return;
    const f = 1 - Math.exp(-d / (sky ? 90000 : 60000)), a = (sky ? 0.95 : 0.8) * (1 - f * 0.8);
    for (let k = 0; k < 2 && yi + k < th; k++) {
      const i = (yi + k) * tw + x, c = px[i], r0 = c & 255, g0 = (c >> 8) & 255, b0 = (c >> 16) & 255, aa = k ? a * 0.45 : a;
      const r = r0 + (col[0] - r0) * aa, g = g0 + (col[1] - g0) * aa, b = b0 + (col[2] - b0) * aa;
      px[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }
  _overlay(c, L) {
    const W = this.cw, H = this.ch, dark = L < 0.35 || this.theme === 'dark';
    const ink = L < 0.45 ? '232,238,250' : '16,24,44', inkA = a => `rgba(${ink},${a})`;
    const sc = this.tw / W;
    // astronomical horizon
    c.strokeStyle = inkA(0.35); c.setLineDash([4, 5]); c.lineWidth = 1; c.beginPath(); c.moveTo(0, this.yOf(0)); c.lineTo(W, this.yOf(0)); c.stroke(); c.setLineDash([]);
    // azimuth ruler
    const step = this.opts.fov > 120 ? 30 : this.opts.fov > 60 ? 10 : this.opts.fov > 25 ? 5 : 2;
    c.font = '600 11px "IBM Plex Mono", ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    c.fillStyle = 'rgba(8,12,24,0.55)'; c.fillRect(0, H - 22, W, 22);
    const a0 = Math.floor(this.azOf(0) / step) * step;
    for (let k = 0; k <= Math.ceil(this.opts.fov / step) + 1; k++) {
      const az = (a0 + k * step) % 360, x = this.xOf(az); if (x < -20 || x > W + 20) continue;
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.moveTo(x, H - 22); c.lineTo(x, H - 16); c.stroke();
      c.fillStyle = names[az] !== undefined ? '#f4c25b' : 'rgba(235,240,250,0.85)'; c.fillText(names[az] !== undefined ? names[az] : az + '°', x, H - 14);
    }
    // altitude ruler
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    const as = this.opts.fov > 90 ? 10 : this.opts.fov > 35 ? 5 : 2;
    for (let al = Math.ceil(this.altOf(H) / as) * as; al <= this.altOf(0); al += as) { const y = this.yOf(al); if (y > H - 30 || y < 8) continue; c.fillStyle = inkA(0.6); c.fillText(al + '°', 6, y); c.strokeStyle = inkA(0.25); c.beginPath(); c.moveTo(0, y); c.lineTo(4, y); c.stroke(); }
    // peak labels
    if (this.opts.labels && this.skyline) this._labels(c, sc, dark);
    // sun / moon path
    this._path(c, L);
  }
  _labels(c, sc, dark) {
    const W = this.cw, labels = [], used = [];
    const place = (x, yTop, text, sub, strong) => {
      const w = Math.max(c.measureText(text).width, c.measureText(sub).width) + 8, y0 = 56;
      let y = y0; for (const u of used) if (Math.abs(u[0] - x) < (u[1] + w) / 2 + 4) y = Math.max(y, u[2] + 30);
      if (y > yTop - 34) return false;
      used.push([x, w, y]);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y + 26); c.lineTo(x, yTop - 2); c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'top';
      c.font = (strong ? '700 ' : '600 ') + '11.5px "Hanken Grotesk", system-ui, sans-serif';
      c.lineWidth = 3; c.strokeStyle = 'rgba(8,12,24,0.75)'; c.strokeText(text, x, y); c.fillStyle = strong ? '#fff' : 'rgba(240,244,252,0.92)'; c.fillText(text, x, y);
      c.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; c.strokeText(sub, x, y + 13); c.fillStyle = 'rgba(230,236,250,0.8)'; c.fillText(sub, x, y + 13);
      return true;
    };
    // named peaks (Natural Earth) that are actually visible
    const peaks = G.DATA.peaks || [], s = this.site, h0 = this.h0();
    const named = [];
    for (const p of peaks) {
      const d = Ecl.geoDist(s.lat, s.lon, p.lat, p.lon) * 1000; if (d < 500 || d > 250000) continue;
      const az = G.U.bearing(s.lat, s.lon, p.lat, p.lon), x = this.xOf(az); if (x < 10 || x > W - 10) continue;
      const h = Math.max(TS.at(p.lat, p.lon), p.elev * 0.97), ang = Math.atan((h - h0) / d - d * (1 - KREF) / (2 * RE)) * R2D;
      const xi = Math.min(this.tw - 1, Math.max(0, Math.round(x * sc)));
      if (ang < this.skyline[xi] - 0.25) continue;
      named.push({ x, y: this.yOf(Math.max(ang, this.skyline[xi])), text: p.name, sub: p.elev.toLocaleString('en-GB') + ' m · ' + Math.round(d / 1000) + ' km', h: p.elev });
    }
    named.sort((a, b) => b.h - a.h);
    c.font = '600 11.5px "Hanken Grotesk", system-ui, sans-serif';
    let n = 0; for (const l of named) { if (n >= 10) break; if (place(l.x, l.y, l.text, l.sub, true)) n++; }
    // unnamed summits on the skyline: local maxima with some prominence
    const sk = this.skyline, tw = this.tw, win = Math.max(8, Math.round(26 * sc));
    const cands = [];
    for (let x = win; x < tw - win; x++) {
      const v = sk[x]; if (v <= -5) continue; let ok = true, mn = v;
      for (let k = -win; k <= win; k++) { if (sk[x + k] > v) { ok = false; break; } if (sk[x + k] < mn) mn = sk[x + k]; }
      if (ok && v - mn > 0.25 && this.skyD[x] > 800) { cands.push({ x: x / sc, v, prom: v - mn, d: this.skyD[x], h: this.skyH[x] }); x += win; }
    }
    cands.sort((a, b) => b.prom - a.prom);
    let m = 0;
    for (const k of cands) { if (m >= 7) break; if (named.some(l => Math.abs(l.x - k.x) < 30)) continue; if (place(k.x, this.yOf(k.v), Math.round(k.h).toLocaleString('en-GB') + ' m', Math.round(k.d / 1000) + ' km', false)) m++; }
  }
  _path(c, L) {
    const p = this._sunPath(); if (!p) return;
    const W = this.cw, H = this.ch, gold = '#f4c25b';
    // path polyline, dashed where hidden by terrain
    c.lineWidth = 2;
    let prev = null;
    for (const q of p.pts) {
      const x = this.xOf(q.az), y = this.yOf(q.alt), sky = this.skyAt(q.az), vis = q.alt > Math.max(sky.ang, -1) + 0.25;
      if (prev && Math.abs(x - prev.x) < W * 0.5) {
        c.strokeStyle = vis ? 'rgba(244,194,91,0.95)' : 'rgba(244,194,91,0.4)'; c.setLineDash(vis ? [] : [4, 4]);
        c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(x, y); c.stroke();
      }
      prev = { x, y };
    }
    c.setLineDash([]);
    // time ticks every 15 minutes
    const tz = G.App ? G.App.tz() : 'UTC';
    c.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
    for (const q of p.pts) {
      if (q.t % (15 * 60000)) continue; const x = this.xOf(q.az), y = this.yOf(q.alt); if (x < 0 || x > W || y < 0 || y > H) continue;
      c.fillStyle = 'rgba(244,194,91,0.9)'; c.beginPath(); c.arc(x, y, 2, 0, PI * 2); c.fill();
    }
    // contacts; marks closer than ~60 px share one label ("C2·Max·C3 17:21–17:24")
    const groups = [];
    for (const m of p.marks) {
      const x = this.xOf(m.az), y = this.yOf(m.alt); if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
      const sky = this.skyAt(m.az), vis = m.alt > Math.max(sky.ang, -1) + 0.25;
      c.fillStyle = vis ? gold : 'rgba(150,150,150,0.9)'; c.strokeStyle = 'rgba(8,12,24,0.8)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(x, y, m.n === 'MAX' ? 5 : 3.5, 0, PI * 2); c.fill(); c.stroke();
      const g = groups[groups.length - 1], f = g && g.ms[0];
      if (g && Math.hypot(x - f.x, y - f.y) < 60) { g.ms.push({ m, x, y }); g.vis = g.vis || vis; } else groups.push({ ms: [{ m, x, y }], vis });
    }
    for (const g of groups) {
      const a = g.ms[0], b = g.ms[g.ms.length - 1], t0 = G.U.hm(a.m.t, tz), t1 = G.U.hm(b.m.t, tz);
      const lab = g.ms.map(o => o.m.n === 'MAX' ? 'Max' : o.m.n).join('·') + ' ' + (t0 === t1 ? t0 : t0 + '–' + t1);
      const y = Math.min(a.y, b.y), tw = c.measureText(lab).width; let x = Math.min(a.x, b.x) + 8;
      if (x + tw > W - 4) x = Math.max(a.x, b.x) - 8 - tw;
      c.lineWidth = 3; c.strokeStyle = 'rgba(8,12,24,0.75)'; c.strokeText(lab, x, y - 9); c.fillStyle = g.vis ? '#fff' : 'rgba(220,220,220,0.8)'; c.fillText(lab, x, y - 9);
    }
    // body now
    const now = this.bodyAt(this.time); if (!now) return;
    const x = this.xOf(now.az), y = this.yOf(now.alt), sky = this.skyAt(now.az), vis = now.alt > Math.max(sky.ang, -1) + 0.25;
    const onScreen = x > 0 && x < W && y > 0 && y < H;
    if (onScreen) {
      const r = Math.max(5, 0.27 * this.ppd);
      c.fillStyle = p.body === 'Sun' ? 'rgba(255,240,200,0.95)' : 'rgba(220,200,190,0.95)'; c.beginPath(); c.arc(x, y, r, 0, PI * 2); c.fill();
      c.strokeStyle = '#f4c25b'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 5, 0, PI * 2); c.stroke();
      // magnified view of the eclipse right now
      const size = Math.min(150, Math.max(96, H * 0.26)), side = x > W * 0.45 ? -1 : 1, bx = clamp(x + side * size * 0.8, size / 2 + 6, W - size / 2 - 6), by = clamp(y - size * 0.6, size / 2 + 58, H - size / 2 - 30);
      c.strokeStyle = 'rgba(244,194,91,0.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(bx, by); c.stroke();
      const sv = G.App && G.App.views.sky; if (sv) sv.drawGlyph(c, bx, by, size, this.time);
      c.strokeStyle = '#f4c25b'; c.lineWidth = 1.5; c.beginPath(); c.arc(bx, by, size / 2, 0, PI * 2); c.stroke();
      if (!vis) { c.fillStyle = 'rgba(8,12,24,0.7)'; c.beginPath(); c.arc(bx, by, size / 2, 0, PI * 2); c.fill(); c.fillStyle = '#fff'; c.font = '700 12px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(now.alt < 0 && sky.ang < 0.2 ? 'Below horizon' : 'Hidden by terrain', bx, by); }
    } else {
      // arrow toward the body
      const dx = wrap180(now.az - this.opts.az0), up = y < 0;
      c.fillStyle = 'rgba(8,12,24,0.7)'; c.font = '700 12px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'center';
      let ax = clamp(x, 80, W - 80), ay = clamp(y, 64, H - 40);
      const txt = (p.body === 'Sun' ? 'Sun' : 'Moon') + ' ' + now.alt.toFixed(0) + '° · ' + Math.round(now.az) + '° ' + (up ? '↑' : dx > 0 ? '→' : '←');
      const w = c.measureText(txt).width + 16;
      // keep clear of overlay cards (verdict) that sit on top of the canvas
      const rs = (this.cb.avoid && this.cb.avoid()) || [];
      for (const r of rs) if (ax + w / 2 > r.x0 - 6 && ax - w / 2 < r.x1 + 6 && ay + 12 > r.y0 - 6 && ay - 12 < r.y1 + 6) {
        if (r.x0 - 8 - w / 2 >= w / 2 + 4) ax = r.x0 - 8 - w / 2; else ay = Math.min(H - 40, r.y1 + 20);
      }
      c.fillRect(ax - w / 2, ay - 12, w, 24); c.fillStyle = '#f4c25b'; c.textBaseline = 'middle'; c.fillText(txt, ax, ay);
    }
  }
}
G.PanoView = PanoView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
