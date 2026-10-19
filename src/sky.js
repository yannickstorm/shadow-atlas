/* SkyView: horizon-based sky simulation with eclipse close-up. Vectors are in a (north, east, up) frame. */
(function (G) {
'use strict';
const A = G.Astronomy;
const PI = Math.PI, D2R = PI / 180, R2D = 180 / PI;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const SUN_R_KM = 696000, MOON_R_KM = 1737.4, AU_KM = 149597870.7;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* sky colour tables by daylight level L (0 night ... 1 clear day) */
const SKY = [
  [0.00, [4, 6, 16], [12, 16, 34]],
  [0.10, [10, 18, 52], [88, 56, 80]],
  [0.28, [18, 36, 94], [206, 120, 82]],
  [0.52, [50, 98, 180], [196, 182, 176]],
  [1.00, [66, 128, 218], [172, 206, 240]],
];
function skyColors(L) {
  let k = 0; while (k < SKY.length - 2 && L > SKY[k + 1][0]) k++;
  const a = SKY[k], b = SKY[k + 1], t = clamp((L - a[0]) / (b[0] - a[0]), 0, 1);
  return [mix3(a[1], b[1], t), mix3(a[2], b[2], t)];
}
function limitingMag(L) {
  const T = [[0, 6.4], [0.06, 5.6], [0.14, 4.2], [0.24, 3.0], [0.34, 1.6], [0.5, -0.6], [0.75, -3.0], [1, -4.5]];
  for (let i = 0; i < T.length - 1; i++) if (L <= T[i + 1][0]) return lerp(T[i][1], T[i + 1][1], (L - T[i][0]) / (T[i + 1][0] - T[i][0]));
  return -4.5;
}
function starRGB(bv) {
  const P = [[-0.3, [155, 176, 255]], [0.0, [200, 215, 255]], [0.4, [248, 247, 255]], [0.8, [255, 236, 210]], [1.2, [255, 210, 160]], [1.7, [255, 170, 110]], [2.1, [255, 140, 85]]];
  bv = clamp(bv, -0.3, 2.1);
  for (let i = 0; i < P.length - 1; i++) if (bv <= P[i + 1][0]) return mix3(P[i][1], P[i + 1][1], (bv - P[i][0]) / (P[i + 1][0] - P[i][0]));
  return P[P.length - 1][1];
}
const PLANETS = [
  ['Mercury', [190, 185, 178]], ['Venus', [255, 250, 235]], ['Mars', [255, 150, 110]], ['Jupiter', [255, 236, 200]], ['Saturn', [240, 220, 160]],
];

/* ---------- sprites ---------- */
let coronaTex = null;
function makeCorona() {
  if (coronaTex) return coronaTex;
  const S = 640, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data, rnd = rng(2027);
  const streamers = []; for (let i = 0; i < 13; i++) streamers.push({ th: rnd() * PI * 2, w: 0.12 + rnd() * 0.26, a: 0.35 + rnd() * 0.7, len: 1.2 + rnd() * 2.4 });
  const eq = 0.35, scale = S / 2 / 5;    // +-5 solar radii
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - S / 2) / scale, dy = (S / 2 - y - 0.5) / scale, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    if (r < 0.98) continue;
    const q = r - 1;
    let I = 0.95 * Math.exp(-q / 0.07) + 0.5 * Math.exp(-q / 0.35) + 0.26 * Math.exp(-q / 1.2);
    const belt = 0.5 + 0.5 * Math.pow(Math.cos(th - eq), 2);
    let st = 0;
    for (const s of streamers) { let dth = Math.abs(((th - s.th + PI * 3) % (PI * 2)) - PI); dth = Math.min(dth, PI * 2 - dth); const w = s.w / (1 + 0.5 * q); st += s.a * Math.exp(-Math.pow(dth / w, 2)) * Math.exp(-q / s.len); }
    I += 0.55 * st * (0.4 + 0.6 * belt);
    I *= (0.45 + 0.55 * belt) * smooth(0.98, 1.03, r) * (1 - smooth(3.4, 4.95, r));
    const a = clamp(I * 0.9, 0, 1), o = (y * S + x) * 4;
    const k = clamp(q / 3, 0, 1);
    d[o] = 255 - 40 * k; d[o + 1] = 250 - 22 * k; d[o + 2] = 248; d[o + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  coronaTex = c; return c;
}
let moonTex = null;
function makeMoon() {
  if (moonTex) return moonTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), rnd = rng(11);
  ctx.fillStyle = '#b9b4aa'; ctx.fillRect(0, 0, S, S);
  // highland speckle
  for (let i = 0; i < 2600; i++) { const x = rnd() * S, y = rnd() * S, r = 0.5 + rnd() * 2.2, v = 150 + rnd() * 80; ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},0.18)`; ctx.beginPath(); ctx.arc(x, y, r, 0, PI * 2); ctx.fill(); }
  const M = [   // x right = west limb (north-up sky view), y up; r, aspect
    [0.60, 0.38, 0.115, 1.0], [0.25, 0.46, 0.15, 1], [0.31, 0.20, 0.20, 0.85], [0.62, -0.06, 0.15, 1.1], [0.35, -0.18, 0.07, 1], [-0.24, 0.50, 0.27, 0.9], [-0.05, 0.83, 0.20, 0.3],
    [-0.62, 0.08, 0.30, 1.2], [-0.58, -0.38, 0.10, 1], [-0.22, -0.38, 0.17, 1.1], [0.0, 0.25, 0.07, 1], [0.0, 0.0, 0.06, 1], [-0.38, 0.30, 0.10, 1.4],
  ];
  for (const [mx, my, r, asp] of M) {
    const cx = S / 2 + mx * S / 2, cy = S / 2 - my * S / 2, rr = r * S / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, asp);
    const g = ctx.createRadialGradient(0, 0, rr * 0.1, 0, 0, rr * 1.15);
    g.addColorStop(0, 'rgba(70,72,82,0.78)'); g.addColorStop(0.7, 'rgba(78,80,90,0.62)'); g.addColorStop(1, 'rgba(90,90,100,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rr * 1.15, 0, PI * 2); ctx.fill(); ctx.restore();
  }
  // craters and rays
  const craters = [[-0.1, -0.78, 5, 1], [-0.35, 0.16, 3.2, 0.8], [-0.56, 0.14, 2.6, 0.7], [-0.6, 0.34, 2.8, 0.9], [0.28, -0.52, 2.6, 0.6], [-0.3, -0.1, 2.4, 0.5]];
  for (const [mx, my, r, b] of craters) {
    const cx = S / 2 + mx * S / 2, cy = S / 2 - my * S / 2;
    for (let i = 0; i < 18; i++) { const a = rnd() * PI * 2, L = (14 + rnd() * 70) * b; ctx.strokeStyle = `rgba(255,255,250,${0.06 * b})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); ctx.stroke(); }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2); g.addColorStop(0, 'rgba(255,255,250,0.95)'); g.addColorStop(1, 'rgba(255,255,250,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2, 0, PI * 2); ctx.fill();
  }
  // limb darkening
  const lg = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.38)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, S, S);
  moonTex = { canvas: c, data: ctx.getImageData(0, 0, S, S).data, S };
  return moonTex;
}

/* horizon profile from the elevation grid (degrees above astronomical horizon, per azimuth degree) */
function horizonProfile(T, lat, lon, elevM) {
  const out = new Float32Array(360), R = 6371000, e0 = Math.max(elevM, T.at(lat, lon)) + 2;
  const cl = Math.cos(lat * D2R);
  for (let az = 0; az < 360; az++) {
    let best = -2;
    const sa = Math.sin(az * D2R), ca = Math.cos(az * D2R);
    for (let d = 8000; d <= 220000; d *= 1.12) {
      const dlat = d * ca / R * R2D, dlon = d * sa / (R * cl) * R2D;
      const e = T.at(lat + dlat, lon + dlon);
      const ang = Math.atan2(e - e0 - d * d / (2 * R) * 0.86, d) * R2D;
      if (ang > best) best = ang;
    }
    out[az] = Math.max(0, best);
  }
  // light smoothing
  const sm = new Float32Array(360);
  for (let i = 0; i < 360; i++) { let s = 0; for (let k = -2; k <= 2; k++) s += out[(i + k + 360) % 360]; sm[i] = s / 5; }
  return sm;
}

class SkyView {
  constructor(host, DATA, Ecl) {
    this.host = host; this.D = DATA; this.Ecl = Ecl;
    this.cv = document.createElement('canvas'); this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;';
    host.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.inset = document.createElement('canvas'); this.inset.className = 'sky-inset'; host.appendChild(this.inset); this.ictx = this.inset.getContext('2d');
    this.skyTex = document.createElement('canvas'); this.skyTex.width = 200; this.skyTex.height = 130; this.sctx = this.skyTex.getContext('2d');
    this.mwTex = document.createElement('canvas'); this.mwTex.width = 200; this.mwTex.height = 130; this.mctx = this.mwTex.getContext('2d');
    this.opts = { mode: 'dome', fov: 60, az0: 180, alt0: 25, lines: true, names: true, grid: false, planets: true, terrain: true, closeup: true, follow: false, ground: true };
    this.site = null; this.time = Date.now(); this.ev = null; this.an = null; this.theme = 'dark';
    this.cb = {}; this.pending = false;
    this._prepConst();
    this._bind();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.resize();
  }
  on(n, f) { this.cb[n] = f; }
  setTheme(t) { this.theme = t; this.request(); }
  setSite(s) { this.site = s; this.observer = new A.Observer(s.lat, s.lon, s.elev || 0); this.horizon = null; this.request(); }
  setTime(ms) { this.time = ms; this.request(); }
  setEvent(ev, an) { this.ev = ev; this.an = an; this.request(); }
  setOpts(o) { Object.assign(this.opts, o); this.request(); }
  lookAt(az, alt, fov) { this.opts.az0 = az; this.opts.alt0 = clamp(alt, -10, 90); if (fov) this.opts.fov = clamp(fov, 0.4, 120); this.request(); }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.cw = Math.max(60, Math.round(r.width)); this.ch = Math.max(60, Math.round(r.height)); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.cw * this.dpr); this.cv.height = Math.round(this.ch * this.dpr);
    const isz = Math.round(clamp(Math.min(this.cw, this.ch) * 0.3, 120, 220));
    this.isz = isz; this.inset.width = isz * this.dpr; this.inset.height = isz * this.dpr; this.inset.style.width = isz + 'px'; this.inset.style.height = isz + 'px';
    this.request();
  }
  request() { if (this.pending) return; this.pending = true; requestAnimationFrame(() => { this.pending = false; this.render(); }); }

  _prepConst() {
    const lines = this.D.const.lines; this.constLines = [];
    for (const id in lines) for (const seg of lines[id]) {
      const v = new Float32Array(seg.length * 3);
      seg.forEach((p, i) => { const ra = p[0] * D2R, de = p[1] * D2R, c = Math.cos(de); v[i * 3] = c * Math.cos(ra); v[i * 3 + 1] = c * Math.sin(ra); v[i * 3 + 2] = Math.sin(de); });
      this.constLines.push(v);
    }
    this.constLabels = this.D.const.labels.map(l => { const ra = l[2] * D2R, de = l[3] * D2R, c = Math.cos(de); return { name: l[1], v: [c * Math.cos(ra), c * Math.sin(ra), Math.sin(de)] }; });
  }
  _bind() {
    const el = this.cv, ptrs = new Map(); let drag = null, pinch = null;
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, az: this.opts.az0, alt: this.opts.alt0 }; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), f: this.opts.fov }; drag = null; } });
    el.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; this.zoom(pinch.f * pinch.d / Math.hypot(a[0] - b[0], a[1] - b[1])); return; }
      if (drag && this.opts.mode === 'look') {
        const k = this.opts.fov / this.ch * 0.9;
        this.opts.az0 = ((drag.az - (e.clientX - drag.x) * k / Math.max(0.2, Math.cos(this.opts.alt0 * D2R)) + 360) % 360);
        this.opts.alt0 = clamp(drag.alt + (e.clientY - drag.y) * k, -10, 90); this.opts.follow = false; this.cb.opts && this.cb.opts(this.opts); this.request();
      }
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) drag = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { if (this.opts.mode !== 'look') return; e.preventDefault(); this.zoom(this.opts.fov * Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  }
  zoom(f) { this.opts.fov = clamp(f, 0.4, 120); this.cb.opts && this.cb.opts(this.opts); this.request(); }

  /* ---------- astronomy for the current frame ---------- */
  _compute() {
    const ms = this.time, t = A.MakeTime((ms - this.Ecl.J2000_MS) / 86400000), obs = this.observer;
    const rot = A.Rotation_EQJ_HOR(t, obs).rot;
    const ov = A.ObserverVector(t, obs, false);
    const toH = (x, y, z) => [rot[0][0] * x + rot[1][0] * y + rot[2][0] * z, -(rot[0][1] * x + rot[1][1] * y + rot[2][1] * z), rot[0][2] * x + rot[1][2] * y + rot[2][2] * z];   // north, east, up
    const refr = alt => { if (alt < -1.5) return alt; const h = Math.max(alt, -1.5); return alt + (1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R)) / 60; };
    const F = { t, rot, toH, refr };
    const sv = A.GeoVector('Sun', t, true), mv = A.GeoMoon(t);
    const sTop = [sv.x - ov.x, sv.y - ov.y, sv.z - ov.z], mTop = [mv.x - ov.x, mv.y - ov.y, mv.z - ov.z];
    const mk = (v, radiusKm) => {
      const d = Math.hypot(v[0], v[1], v[2]), h = toH(v[0] / d, v[1] / d, v[2] / d);
      const alt = Math.asin(clamp(h[2], -1, 1)) * R2D, az = (Math.atan2(h[1], h[0]) * R2D + 360) % 360;
      return { dirTrue: h, altTrue: alt, az, distKm: d * AU_KM, r: Math.asin(radiusKm / (d * AU_KM)), alt: refr(alt) };
    };
    F.sun = mk(sTop, SUN_R_KM); F.moon = mk(mTop, MOON_R_KM);
    const hs = F.sun.dirTrue, hm = F.moon.dirTrue;
    F.sep = Math.acos(clamp(hs[0] * hm[0] + hs[1] * hm[1] + hs[2] * hm[2], -1, 1));
    F.obsc = this._obsc(F.sun.r, F.moon.r, F.sep);
    F.eclipse = this.ev && this.ev.kind === 'solar';
    // sky brightness
    const Lsun = smooth(-9, 5, F.sun.altTrue);
    let ecl = 1;
    if (F.sun.altTrue > -2) { const o = F.obsc; ecl = 0.27 + 0.73 * Math.pow(Math.max(0, 1 - o), 0.62); if (o <= 0) ecl = 1; }
    F.L = Lsun * ecl; F.Lsun = Lsun;
    F.total = F.obsc > 0.9985 && F.moon.r > F.sun.r * 0.999;
    // celestial / ecliptic north angles (from screen up, clockwise) at the sun
    const poleEq = toH(0, 0, 1), eps = 23.4392911 * D2R, poleEcl = toH(0, -Math.sin(eps), Math.cos(eps));
    F.poleEq = poleEq; F.poleEcl = poleEcl;
    // planets
    F.planets = [];
    if (this.opts.planets) for (const [name, col] of PLANETS) {
      const v = A.GeoVector(name, t, true), vv = [v.x - ov.x, v.y - ov.y, v.z - ov.z], d = Math.hypot(vv[0], vv[1], vv[2]), h = toH(vv[0] / d, vv[1] / d, vv[2] / d);
      let mag = 0; try { mag = A.Illumination(name, t).mag; } catch (e) { }
      const alt = Math.asin(clamp(h[2], -1, 1)) * R2D;
      F.planets.push({ name, col, h, mag, alt: refr(alt), az: (Math.atan2(h[1], h[0]) * R2D + 360) % 360 });
    }
    return F;
  }
  _obsc(rs, rm, d) {
    if (d >= rs + rm) return 0;
    if (d <= Math.abs(rs - rm)) return rm >= rs ? 1 : (rm * rm) / (rs * rs);
    const a1 = Math.acos(clamp((d * d + rs * rs - rm * rm) / (2 * d * rs), -1, 1)), a2 = Math.acos(clamp((d * d + rm * rm - rs * rs) / (2 * d * rm), -1, 1));
    const area = rs * rs * a1 + rm * rm * a2 - 0.5 * Math.sqrt(Math.max(0, (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm)));
    return area / (PI * rs * rs);
  }

  /* ---------- projection ---------- */
  _setupProj() {
    const o = this.opts, W = this.cw, H = this.ch;
    if (o.mode === 'dome') {
      this.cx = W / 2; this.cy = H / 2; this.Rd = Math.min(W, H) / 2 * 0.92;
      this.proj = (v) => { const alt = Math.asin(clamp(v[2], -1, 1)); const r = (PI / 2 - alt) / (PI / 2) * this.Rd; const az = Math.atan2(v[1], v[0]); return [this.cx - r * Math.sin(az), this.cy - r * Math.cos(az), alt > -0.04]; };
      this.pxPerDeg = this.Rd / 90;
    } else {
      const az0 = o.az0 * D2R, alt0 = o.alt0 * D2R;
      const f = [Math.cos(alt0) * Math.cos(az0), Math.cos(alt0) * Math.sin(az0), Math.sin(alt0)];
      const r = [-Math.sin(az0), Math.cos(az0), 0], u = [-Math.sin(alt0) * Math.cos(az0), -Math.sin(alt0) * Math.sin(az0), Math.cos(alt0)];
      this.vf = f; this.vr = r; this.vu = u;
      const scale = (H / 2) / (2 * Math.tan(o.fov * D2R / 4));
      this.scale = scale; this.cx = W / 2; this.cy = H / 2;
      this.proj = (v) => { const d = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]; if (d < -0.98) return [0, 0, false]; const k = 2 / (1 + d); return [this.cx + scale * k * (v[0] * r[0] + v[1] * r[1]), this.cy - scale * k * (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]), true]; };
      this.pxPerDeg = scale * D2R;
    }
  }
  _inv(px, py, clampEdge) {   // screen -> (n,e,u) or null
    const o = this.opts;
    if (o.mode === 'dome') {
      const dx = (px - this.cx) / this.Rd, dy = (this.cy - py) / this.Rd; let r = Math.hypot(dx, dy); if (r > 1.0) { if (!clampEdge) return null; r = 1; }
      const alt = (1 - r) * PI / 2, az = Math.atan2(-dx, dy), c = Math.cos(alt);
      return [c * Math.cos(az), c * Math.sin(az), Math.sin(alt)];
    }
    const X = (px - this.cx) / this.scale, Y = (this.cy - py) / this.scale, s = (X * X + Y * Y) / 4, k = 1 / (1 + s), pf = (1 - s) * k;
    const f = this.vf, r = this.vr, u = this.vu;
    return [f[0] * pf + r[0] * X * k + u[0] * Y * k, f[1] * pf + r[1] * X * k + u[1] * Y * k, f[2] * pf + r[2] * X * k + u[2] * Y * k];
  }

  /* ---------- main draw ---------- */
  render() {
    if (!this.observer || !this.host.offsetWidth) return;
    const F = this._compute(); this.F = F;
    const o = this.opts;
    if (o.mode === 'look' && o.follow) {
      const mid = [(F.sun.dirTrue[0] + F.moon.dirTrue[0]) / 2, (F.sun.dirTrue[1] + F.moon.dirTrue[1]) / 2, (F.sun.dirTrue[2] + F.moon.dirTrue[2]) / 2];
      const tgt = this.ev && this.ev.kind === 'lunar' ? F.moon.dirTrue : mid; const l = Math.hypot(...tgt);
      o.az0 = (Math.atan2(tgt[1], tgt[0]) * R2D + 360) % 360; o.alt0 = Math.asin(tgt[2] / l) * R2D;
    }
    this._setupProj();
    const c = this.ctx, dpr = this.dpr, W = this.cw, H = this.ch, dark = this.theme === 'dark';
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = dark ? '#05080f' : '#dfe6f0'; c.fillRect(0, 0, W, H);
    if (!this.horizon && o.terrain && this.D.terrain) this.horizon = horizonProfile(G.TS && G.TS.hasLayers() ? G.TS : this.D.terrain, this.site.lat, this.site.lon, this.site.elev || 0);
    this._drawSkyTexture(c, F);
    this._drawMilkyWay(c, F);
    if (o.grid) this._drawGrid(c, F);
    if (o.lines) this._drawConst(c, F);
    this._drawStars(c, F);
    this._drawPlanets(c, F);
    this._drawBodies(c, F);
    this._drawGround(c, F);
    this._drawCompass(c, F);
    if (o.closeup) { this.inset.style.display = ''; this._drawCloseup(F); } else this.inset.style.display = 'none';
    this.cb.frame && this.cb.frame(F);
  }

  _drawSkyTexture(c, F) {
    const W = this.skyTex.width, H = this.skyTex.height, img = this.sctx.createImageData(W, H), d = img.data;
    const [Z, Hz] = skyColors(F.L), sunAz = F.sun.az * D2R, sa = F.sun.altTrue;
    const glow = smooth(-12, 6, sa) * (1 - smooth(8, 30, sa));          // sunset/sunrise glow near the Sun
    const totG = F.total ? 1 : smooth(0.97, 0.9995, F.obsc) * 0.7;      // twilight ring during totality
    const sunV = F.sun.dirTrue;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = this._inv((x + 0.5) / W * this.cw, (y + 0.5) / H * this.ch, true), o = (y * W + x) * 4;
      if (!v) { d[o + 3] = 0; continue; }
      const alt = Math.asin(clamp(v[2], -1, 1)) * R2D;
      const t = Math.pow(1 - clamp(alt / 90, 0, 1), 2.4);
      let col = mix3(Z, Hz, t);
      // glow towards the Sun
      const cosd = v[0] * sunV[0] + v[1] * sunV[1] + v[2] * sunV[2], ang = Math.acos(clamp(cosd, -1, 1)) * R2D;
      const gl = glow * Math.exp(-Math.pow(ang / 38, 2)) * (0.5 + 0.5 * (1 - clamp(alt / 40, 0, 1)));
      if (gl > 0.01) col = mix3(col, [255, 150, 80], clamp(gl * 0.7, 0, 0.8));
      const tg = totG * Math.exp(-Math.max(0, alt) / 14);
      if (tg > 0.01) col = mix3(col, [236, 122, 66], clamp(tg * 0.8, 0, 0.8));
      // brightening around the Sun in the daytime sky
      const halo = F.Lsun * Math.exp(-Math.pow(ang / 12, 2)) * 0.22 * (1 - F.obsc);
      col = [col[0] + 255 * halo, col[1] + 255 * halo, col[2] + 250 * halo];
      const dk = 1 - 0.5 * smooth(0.9, 0.9995, F.obsc) * Math.exp(-Math.pow(ang / 30, 2)) * F.Lsun;
      col = [col[0] * dk, col[1] * dk, col[2] * dk];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    this.sctx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    if (this.opts.mode === 'dome') {
      c.save(); c.beginPath(); c.arc(this.cx, this.cy, this.Rd, 0, PI * 2); c.clip(); c.drawImage(this.skyTex, 0, 0, this.cw, this.ch); c.restore();
    } else c.drawImage(this.skyTex, 0, 0, this.cw, this.ch);
  }
  _drawMilkyWay(c, F) {
    if (F.L > 0.12) return;
    const M = this.D.milky, W = this.mwTex.width, H = this.mwTex.height, img = this.mctx.createImageData(W, H), d = img.data, r = F.rot;
    const a = 1 - F.L / 0.12;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = this._inv((x + 0.5) / W * this.cw, (y + 0.5) / H * this.ch), o = (y * W + x) * 4;
      if (!v || v[2] < -0.05) continue;
      // (n,e,u) -> hor frame (n,w,u) -> EQJ via transpose of the EQJ->HOR matrix
      const hx = v[0], hy = -v[1], hz = v[2];
      const ex = r[0][0] * hx + r[0][1] * hy + r[0][2] * hz, ey = r[1][0] * hx + r[1][1] * hy + r[1][2] * hz, ez = r[2][0] * hx + r[2][1] * hy + r[2][2] * hz;
      let ra = Math.atan2(ey, ex); if (ra < 0) ra += PI * 2; const dec = Math.asin(clamp(ez, -1, 1));
      const mx = Math.min(M.w - 1, (ra / (PI * 2) * M.w) | 0), my = Math.min(M.h - 1, ((PI / 2 - dec) / PI * M.h) | 0);
      const val = M.data[my * M.w + mx] / 255;
      d[o] = 170; d[o + 1] = 185; d[o + 2] = 225; d[o + 3] = val * 120 * a;
    }
    this.mctx.putImageData(img, 0, 0);
    c.save(); if (this.opts.mode === 'dome') { c.beginPath(); c.arc(this.cx, this.cy, this.Rd, 0, PI * 2); c.clip(); }
    c.imageSmoothingEnabled = true; c.drawImage(this.mwTex, 0, 0, this.cw, this.ch); c.restore();
  }
  _drawGrid(c, F) {
    const o = this.opts; c.strokeStyle = 'rgba(140,170,230,0.22)'; c.lineWidth = 0.7;
    for (let alt = 0; alt < 90; alt += 15) { c.beginPath(); let pen = false; for (let az = 0; az <= 360; az += 3) { const a = alt * D2R, z = az * D2R, p = this.proj([Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)]); if (p[2]) { if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; } } else pen = false; } c.stroke(); }
    for (let az = 0; az < 360; az += 30) { c.beginPath(); let pen = false; for (let alt = 0; alt <= 90; alt += 3) { const a = alt * D2R, z = az * D2R, p = this.proj([Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)]); if (p[2]) { if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; } } else pen = false; } c.stroke(); }
  }
  _drawConst(c, F) {
    const al = clamp(1 - F.L / 0.45, 0, 1) * 0.4; if (al < 0.02) return;
    c.strokeStyle = `rgba(150,180,240,${al})`; c.lineWidth = 0.9; const r = F.rot;
    for (const v of this.constLines) {
      c.beginPath(); let pen = false, prev = null;
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        const h = [r[0][0] * x + r[1][0] * y + r[2][0] * z, -(r[0][1] * x + r[1][1] * y + r[2][1] * z), r[0][2] * x + r[1][2] * y + r[2][2] * z];
        const p = this.proj(h);
        if (p[2] && h[2] > -0.02) { if (pen && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < this.cw) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); pen = true; prev = p; } else pen = false;
      }
      c.stroke();
    }
    if (this.opts.names && F.L < 0.2 && this.opts.mode === 'dome') {
      c.fillStyle = `rgba(150,180,240,${al * 1.3})`; c.font = '10px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'center';
      for (const l of this.constLabels) { const x = l.v[0], y = l.v[1], z = l.v[2]; const h = [r[0][0] * x + r[1][0] * y + r[2][0] * z, -(r[0][1] * x + r[1][1] * y + r[2][1] * z), r[0][2] * x + r[1][2] * y + r[2][2] * z]; if (h[2] < 0.12) continue; const p = this.proj(h); if (p[2]) c.fillText(l.name.toUpperCase(), p[0], p[1]); }
    }
  }
  _drawStars(c, F) {
    const S = this.D.stars, r = F.rot, lim = limitingMag(F.L), n = S.n;
    if (!S.rgb) { S.rgb = new Array(n); for (let i = 0; i < n; i++) S.rgb[i] = starRGB(S.bv[i]); }
    const names = this.opts.names && F.L < 0.3 ? [] : null;
    for (let i = 0; i < n; i++) {
      const m = S.mag[i]; if (m > lim) break;      // sorted by magnitude
      const x = S.vec[i * 3], y = S.vec[i * 3 + 1], z = S.vec[i * 3 + 2];
      const h = [r[0][0] * x + r[1][0] * y + r[2][0] * z, -(r[0][1] * x + r[1][1] * y + r[2][1] * z), r[0][2] * x + r[1][2] * y + r[2][2] * z];
      if (h[2] < -0.02) continue;
      const p = this.proj(h); if (!p[2]) continue;
      if (p[0] < -10 || p[0] > this.cw + 10 || p[1] < -10 || p[1] > this.ch + 10) continue;
      const vis = clamp((lim - m) / 1.8, 0.15, 1), rad = clamp(0.55 + (lim - m) * 0.34, 0.5, 4.2);
      const col = S.rgb[i];
      // horizon extinction
      const ext = clamp(h[2] * 6, 0.25, 1);
      c.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${vis * ext})`; c.beginPath(); c.arc(p[0], p[1], rad, 0, PI * 2); c.fill();
      if (names && S.names.has(i) && m < 2.0) names.push([p, S.names.get(i)]);
    }
    if (names) { c.fillStyle = 'rgba(200,215,245,0.75)'; c.font = '10px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'left'; for (const [p, nm] of names.slice(0, 24)) c.fillText(nm, p[0] + 5, p[1] - 4); }
  }
  _drawPlanets(c, F) {
    const lim = limitingMag(F.L);
    for (const p of F.planets) {
      if (p.alt < -0.5 || p.mag > lim) continue;
      const q = this.proj(p.h); if (!q[2]) continue;
      const rad = clamp(1.6 + (lim - p.mag) * 0.22, 1.8, 4.6), col = p.col;
      const g = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], rad * 3.2); g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.55)`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(q[0], q[1], rad * 3.2, 0, PI * 2); c.fill();
      c.fillStyle = rgb(col); c.beginPath(); c.arc(q[0], q[1], rad, 0, PI * 2); c.fill();
      if (this.opts.names) { c.fillStyle = 'rgba(230,236,250,0.9)'; c.font = '600 10px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'left'; c.fillText(p.name, q[0] + rad + 5, q[1] + 3); }
    }
  }

  /* orientation helpers: tangent plane at the Sun (screen right/up) */
  _tangent(dirSun) {
    const f = dirSun, az = Math.atan2(f[1], f[0]);
    const r = [-Math.sin(az), Math.cos(az), 0];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    return { r, u };
  }
  _drawBodies(c, F) {
    const o = this.opts, S = F.sun, M = F.moon;
    const ps = this.proj(S.dirTrue), pm = this.proj(M.dirTrue);
    const rS = S.r * R2D * this.pxPerDeg, rM = M.r * R2D * this.pxPerDeg;
    if (this.ev && this.ev.kind === 'lunar') {
      if (pm[2] && M.alt > -2) this._drawLunarBody(c, pm[0], pm[1], Math.max(rM, 5), F, false);
      if (ps[2] && S.alt > -2) { /* sun below horizon in lunar events: nothing */ }
      return;
    }
    if (!ps[2]) return;
    const big = rS > 14;
    if (big) {
      // detailed scene at the true scale
      const tan = this._tangent(S.dirTrue), mv = M.dirTrue;
      const mx = (mv[0] * tan.r[0] + mv[1] * tan.r[1] + mv[2] * tan.r[2]), my = (mv[0] * tan.u[0] + mv[1] * tan.u[1] + mv[2] * tan.u[2]);
      this._solarScene(c, ps[0], ps[1], rS, { mx: mx / S.r, my: my / S.r, ratio: M.r / S.r, obsc: F.obsc, total: F.total, F, tan, bg: skyColors(F.L)[0] });
    } else {
      // marker view: glow + small discs, moon drawn at true offset but with a minimum size
      const glowA = clamp(1 - F.obsc, 0, 1) * smooth(-6, 4, S.alt) * 0.9;
      const gr = Math.max(rS * 9, 26), g = c.createRadialGradient(ps[0], ps[1], 0, ps[0], ps[1], gr);
      g.addColorStop(0, `rgba(255,244,214,${glowA * 0.9})`); g.addColorStop(0.15, `rgba(255,225,160,${glowA * 0.5})`); g.addColorStop(1, 'rgba(255,200,120,0)');
      c.fillStyle = g; c.beginPath(); c.arc(ps[0], ps[1], gr, 0, PI * 2); c.fill();
      const rs2 = Math.max(rS, 3.2);
      if (F.total) { const cg = c.createRadialGradient(ps[0], ps[1], rs2, ps[0], ps[1], rs2 * 4); cg.addColorStop(0, 'rgba(255,250,240,0.85)'); cg.addColorStop(1, 'rgba(255,250,240,0)'); c.fillStyle = cg; c.beginPath(); c.arc(ps[0], ps[1], rs2 * 4, 0, PI * 2); c.fill(); }
      c.fillStyle = F.obsc > 0.999 ? '#fff8e8' : '#fff3c4'; c.beginPath(); c.arc(ps[0], ps[1], rs2, 0, PI * 2); c.fill();
      if (pm[2]) { c.fillStyle = '#07080c'; c.beginPath(); c.arc(pm[0], pm[1], Math.max(rM * (rs2 / Math.max(rS, 1e-6)), 3.0) * (rs2 > rS ? 1 : 1), 0, PI * 2); c.fill(); }
    }
  }
  /* The eclipse scene. (cx, cy) Sun centre, R Sun radius in px; st.mx/my Moon offset in Sun radii (screen right/up). */
  _solarScene(c, cx, cy, R, st, targetCtx) {
    const ctx = c || targetCtx, ratio = st.ratio, mxp = st.mx * R, myp = -st.my * R, Rm = ratio * R;
    const tot = st.total, obsc = st.obsc, F = st.F;
    // orientation of celestial north on screen (clockwise from up)
    const pn = F.poleEq, tan = st.tan, nx = pn[0] * tan.r[0] + pn[1] * tan.r[1] + pn[2] * tan.r[2], ny = pn[0] * tan.u[0] + pn[1] * tan.u[1] + pn[2] * tan.u[2];
    const rotN = Math.atan2(nx, ny);
    const corona = smooth(0.985, 0.9995, obsc) * (ratio >= 0.99 ? 1 : 0);
    ctx.save();
    // glare when not eclipsed
    const glare = clamp(1 - obsc, 0, 1);
    if (glare > 0.01) {
      const gR = R * 14, g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, gR);
      g.addColorStop(0, `rgba(255,246,222,${0.55 * glare})`); g.addColorStop(0.12, `rgba(255,232,170,${0.28 * glare})`); g.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, gR, 0, PI * 2); ctx.fill();
    }
    if (corona > 0.02) {
      const tex = makeCorona(); ctx.save(); ctx.translate(cx, cy); ctx.rotate(rotN); ctx.globalAlpha = corona; ctx.imageSmoothingEnabled = true; ctx.beginPath(); ctx.arc(0, 0, R * 4.9, 0, PI * 2); ctx.clip();
      ctx.drawImage(tex, -R * 5, -R * 5, R * 10, R * 10); ctx.restore();
      const hg = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 2.4); hg.addColorStop(0, `rgba(255,255,255,${0.35 * corona})`); hg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, R * 2.4, 0, PI * 2); ctx.fill();
    }
    // Sun disc on a scratch canvas, then cut by the Moon
    const S = Math.ceil(R * 2.4) | 0, size = Math.max(8, S);
    if (!this._scr) this._scr = document.createElement('canvas');
    const sc = this._scr; const dim = Math.min(2048, Math.ceil(R * 6)); if (sc.width !== dim) { sc.width = dim; sc.height = dim; }
    const s2 = sc.getContext('2d'); s2.setTransform(1, 0, 0, 1, 0, 0); s2.clearRect(0, 0, dim, dim);
    const o = dim / 2;
    const g = s2.createRadialGradient(o, o, 0, o, o, R);
    g.addColorStop(0, 'rgb(255,253,244)'); g.addColorStop(0.55, 'rgb(255,246,214)'); g.addColorStop(0.86, 'rgb(255,226,160)'); g.addColorStop(1, 'rgb(247,176,84)');
    s2.fillStyle = g; s2.beginPath(); s2.arc(o, o, R, 0, PI * 2); s2.fill();
    // chromosphere ring (pink) revealed only where the Moon does not cover
    if (obsc > 0.93 || ratio > 0.95) {
      s2.strokeStyle = 'rgba(255,90,110,0.75)'; s2.lineWidth = Math.max(1.2, R * 0.022); s2.beginPath(); s2.arc(o, o, R * 1.006, 0, PI * 2); s2.stroke();
    }
    s2.globalCompositeOperation = 'destination-out'; s2.fillStyle = '#000'; s2.beginPath(); s2.arc(o + mxp, o + myp, Rm, 0, PI * 2); s2.fill(); s2.globalCompositeOperation = 'source-over';
    // diamond ring: uncovered sliver glow
    const dd = Math.hypot(mxp, myp), sliver = R - (Rm - dd);   // width of uncovered Sun along the line of centres
    if (ratio >= 0.97 && sliver > 0 && sliver < R * 0.06 && dd > 0) {
      const ux = -mxp / dd, uy = -myp / dd, px = o + ux * (R - sliver * 0.4), py = o + uy * (R - sliver * 0.4), k = 1 - sliver / (R * 0.06);
      const dg = s2.createRadialGradient(px, py, 0, px, py, R * (0.12 + 0.55 * k)); dg.addColorStop(0, `rgba(255,255,255,${0.5 + 0.5 * k})`); dg.addColorStop(0.2, `rgba(255,248,230,${0.45 * k})`); dg.addColorStop(1, 'rgba(255,240,210,0)');
      s2.fillStyle = dg; s2.beginPath(); s2.arc(px, py, R * (0.12 + 0.55 * k), 0, PI * 2); s2.fill();
    }
    ctx.drawImage(sc, cx - o, cy - o);
    // Moon silhouette against the corona / near-sky
    if (corona > 0.05) { ctx.globalAlpha = smooth(0.02, 0.4, corona); ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(cx + mxp, cy + myp, Rm, 0, PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    else if (Rm > 3) {
      // faint dark limb of the Moon visible against the bright sky near the Sun
      ctx.strokeStyle = 'rgba(10,14,28,0.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx + mxp, cy + myp, Rm, 0, PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  _drawLunarBody(c, cx, cy, R, F, inset) {
    const ls = this.Ecl.lunarState(this.time), tex = makeMoon(), S = tex.S;
    if (!this._lc) { this._lc = document.createElement('canvas'); this._lc.width = this._lc.height = S; this._lcx = this._lc.getContext('2d'); this._lcImg = this._lcx.createImageData(S, S); }
    const img = this._lcImg, d = img.data, src = tex.data, Rm = ls.moonR;
    const brightMoon = smooth(-2, 6, F.moon.altTrue);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = (x + 0.5 - S / 2) / (S / 2), ny = (S / 2 - y - 0.5) / (S / 2), r2 = nx * nx + ny * ny, o = (y * S + x) * 4;
      if (r2 > 1) { d[o + 3] = 0; continue; }
      // screen x right = west (north-up sky), so east = -nx ; shadow offsets in km
      const e = ls.e - nx * Rm, n = ls.n + ny * Rm, rr = Math.hypot(e, n);
      let sr = src[o], sg = src[o + 1], sb = src[o + 2], k;
      if (rr < ls.k) {
        const depth = clamp((ls.k - rr) / (ls.k * 0.55), 0, 1), edge = 1 - depth;
        const rC = 60 + 150 * Math.pow(edge, 1.6), gC = 20 + 80 * Math.pow(edge, 2.2), bC = 10 + 50 * Math.pow(edge, 2.6);
        k = 0.17 + 0.42 * Math.pow(edge, 1.3);
        sr = (sr / 255) * rC * k * 3.0 + rC * 0.18 * (1 - k * 0.5); sg = (sg / 255) * gC * k * 3.0 + gC * 0.15; sb = (sb / 255) * bC * k * 3.0 + bC * 0.12;
        // bluish-turquoise fringe at the umbral edge
        const fr = smooth(0.82, 1, edge) * 0.35; sb += 70 * fr; sg += 24 * fr;
      } else if (rr < ls.p) {
        const t = (rr - ls.k) / (ls.p - ls.k), f = 0.42 + 0.58 * Math.pow(smooth(0, 1, t), 0.8);
        sr *= f; sg *= f * 0.97; sb *= f * 0.94;
      }
      d[o] = clamp(sr, 0, 255); d[o + 1] = clamp(sg, 0, 255); d[o + 2] = clamp(sb, 0, 255); d[o + 3] = 255;
    }
    this._lcx.putImageData(img, 0, 0);
    // rotation: ecliptic north from screen up
    const pn = F.poleEcl, tan = this._tangent(F.moon.dirTrue), nx = pn[0] * tan.r[0] + pn[1] * tan.r[1] + pn[2] * tan.r[2], ny = pn[0] * tan.u[0] + pn[1] * tan.u[1] + pn[2] * tan.u[2];
    const rot = Math.atan2(nx, ny);
    // halo
    const lit = clamp(1 - Math.max(0, ls.k + ls.moonR - ls.r) / (2 * ls.moonR) * 0.9, 0.08, 1) * brightMoon;
    const hg = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 5); hg.addColorStop(0, `rgba(210,220,255,${0.22 * lit})`); hg.addColorStop(1, 'rgba(210,220,255,0)');
    c.fillStyle = hg; c.beginPath(); c.arc(cx, cy, R * 5, 0, PI * 2); c.fill();
    c.save(); c.translate(cx, cy); c.rotate(rot); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(this._lc, -R, -R, R * 2, R * 2); c.restore();
  }
  _drawGround(c, F) {
    const o = this.opts, dark = this.theme === 'dark';
    if (!o.ground) return;
    const L = F.L, g1 = mix3([8, 10, 14], [64, 70, 60], Math.pow(L, 0.8)), g0 = mix3([4, 5, 8], [34, 38, 32], Math.pow(L, 0.8));
    if (o.mode === 'dome') {
      // outside the horizon circle: dark ring with terrain silhouette ticks
      c.save(); c.beginPath(); c.rect(0, 0, this.cw, this.ch); c.arc(this.cx, this.cy, this.Rd, 0, PI * 2, true); c.fillStyle = dark ? '#03050a' : '#cfd8e6'; c.fill('evenodd'); c.restore();
      if (o.terrain && this.horizon) {
        c.beginPath(); let first = true;
        for (let az = 0; az <= 360; az += 2) {
          const h = this.horizon[az % 360], rr = Math.max(0, (90 - h) / 90) * this.Rd, a = az * D2R, x = this.cx - rr * Math.sin(a), y = this.cy - rr * Math.cos(a);
          if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y);
        }
        for (let az = 360; az >= 0; az -= 6) { const a = az * D2R, x = this.cx - this.Rd * 1.0 * Math.sin(a), y = this.cy - this.Rd * 1.0 * Math.cos(a); c.lineTo(x, y); }
        c.closePath(); c.fillStyle = rgb(g1); c.fill();
      }
      c.strokeStyle = dark ? 'rgba(170,195,255,0.5)' : 'rgba(40,60,110,0.5)'; c.lineWidth = 1.2; c.beginPath(); c.arc(this.cx, this.cy, this.Rd, 0, PI * 2); c.stroke();
      return;
    }
    // look mode: ground = region below the (terrain) horizon curve; stereographic images of circles are circles,
    // so the ground is the interior of the projected curve when the view centre is below the horizon, else the exterior
    const pts = [];
    for (let az = 0; az < 360; az += 1) {
      const h = o.terrain && this.horizon ? this.horizon[az] : 0, a = h * D2R, z = az * D2R;
      const p = this.proj([Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)]);
      pts.push([clamp(p[0], -4e4, 4e4), clamp(p[1], -4e4, 4e4)]);
    }
    c.save(); c.beginPath();
    if (o.alt0 >= 0) c.rect(-5e4, -5e4, 1e5, 1e5);
    pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
    const gg = c.createLinearGradient(0, 0, 0, this.ch);
    gg.addColorStop(0, rgb(g1)); gg.addColorStop(1, rgb(g0));
    c.fillStyle = gg; c.fill('evenodd');
    c.strokeStyle = `rgba(${(g1[0] + 70) | 0},${(g1[1] + 70) | 0},${(g1[2] + 70) | 0},0.45)`; c.lineWidth = 1; c.beginPath();
    pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.stroke();
    c.restore();
  }
  _drawCompass(c, F) {
    const dark = this.theme === 'dark'; c.font = '700 12px "Hanken Grotesk", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const labs = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
    for (const [t, az] of labs) {
      const z = az * D2R;
      if (this.opts.mode === 'dome') {
        const r = this.Rd + 14, x = this.cx - r * Math.sin(z), y = this.cy - r * Math.cos(z);
        c.fillStyle = t.length === 1 ? (dark ? '#f4c25b' : '#b4690e') : (dark ? 'rgba(200,215,245,0.55)' : 'rgba(30,45,90,0.6)'); c.fillText(t, x, y);
      } else {
        const a = 3 * D2R, v = [Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)], p = this.proj(v);
        const fwd = v[0] * this.vf[0] + v[1] * this.vf[1] + v[2] * this.vf[2] > 0.15;
        if (fwd && p[2] && p[0] > 10 && p[0] < this.cw - 10 && p[1] > 0 && p[1] < this.ch - 24) { c.fillStyle = t.length === 1 ? (dark ? '#f4c25b' : '#fbd27a') : 'rgba(230,236,250,0.7)'; c.fillText(t, p[0], p[1] + 14); }
      }
    }
    if (this.opts.mode === 'dome') { c.fillStyle = dark ? 'rgba(200,215,245,0.35)' : 'rgba(30,45,90,0.4)'; c.font = '10px "IBM Plex Mono", monospace'; for (const a of [30, 60]) c.fillText(a + '°', this.cx + 10, this.cy - (90 - a) / 90 * this.Rd); }
  }
  _drawCloseup(F) {
    const c = this.ictx, dpr = this.dpr, S = this.isz;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, S, S);
    c.save(); c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, PI * 2); c.clip();
    const lunar = this.ev && this.ev.kind === 'lunar';
    const [Z, Hz] = skyColors(Math.min(F.L, lunar ? 0.0 : 1));
    const bg = c.createLinearGradient(0, 0, 0, S); bg.addColorStop(0, rgb(lunar ? [5, 8, 18] : mix3(Z, Hz, 0.15))); bg.addColorStop(1, rgb(lunar ? [8, 11, 24] : mix3(Z, Hz, 0.5)));
    c.fillStyle = bg; c.fillRect(0, 0, S, S);
    if (lunar) {
      const ls = this.Ecl.lunarState(this.time); this._drawLunarBody(c, S / 2, S / 2, S * 0.36, F, true);
    } else {
      const tan = this._tangent(F.sun.dirTrue), mv = F.moon.dirTrue;
      let mx = (mv[0] * tan.r[0] + mv[1] * tan.r[1] + mv[2] * tan.r[2]) / F.sun.r, my = (mv[0] * tan.u[0] + mv[1] * tan.u[1] + mv[2] * tan.u[2]) / F.sun.r;
      const dist = Math.hypot(mx, my), view = Math.max(1.25, Math.min(3.6, (dist + F.moon.r / F.sun.r) * 0.9 + 0.5));
      const R = S / 2 / (F.total ? 2.1 : view);
      this._solarScene(c, S / 2, S / 2, R, { mx, my, ratio: F.moon.r / F.sun.r, obsc: F.obsc, total: F.total, F, tan, bg: Z });
    }
    c.restore();
    c.strokeStyle = this.theme === 'dark' ? 'rgba(244,194,91,0.8)' : 'rgba(180,105,14,0.8)'; c.lineWidth = 1.5; c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, PI * 2); c.stroke();
  }
  // direction of Sun for UI helpers
  sunDir() { return this.F ? this.F.sun : null; }
  /* draw the eclipse as seen at time ms into any context (used by the panorama); returns the frame */
  drawGlyph(c, cx, cy, size, ms) {
    if (!this.observer) return null;
    const keep = this.time; this.time = ms;
    let F = null;
    try {
      F = this._compute();
      c.save(); c.beginPath(); c.arc(cx, cy, size / 2, 0, PI * 2); c.clip();
      const lunar = this.ev && this.ev.kind === 'lunar';
      const [Z, Hz] = skyColors(Math.min(F.L, lunar ? 0.0 : 1));
      const bg = c.createLinearGradient(0, cy - size / 2, 0, cy + size / 2); bg.addColorStop(0, rgb(lunar ? [5, 8, 18] : mix3(Z, Hz, 0.15))); bg.addColorStop(1, rgb(lunar ? [8, 11, 24] : mix3(Z, Hz, 0.5)));
      c.fillStyle = bg; c.fillRect(cx - size / 2, cy - size / 2, size, size);
      if (lunar) this._drawLunarBody(c, cx, cy, size * 0.36, F, true);
      else {
        const tan = this._tangent(F.sun.dirTrue), mv = F.moon.dirTrue;
        const mx = (mv[0] * tan.r[0] + mv[1] * tan.r[1] + mv[2] * tan.r[2]) / F.sun.r, my = (mv[0] * tan.u[0] + mv[1] * tan.u[1] + mv[2] * tan.u[2]) / F.sun.r;
        const dist = Math.hypot(mx, my), view = Math.max(1.25, Math.min(3.6, (dist + F.moon.r / F.sun.r) * 0.9 + 0.5));
        const R = size / 2 / (F.total ? 2.1 : view);
        this._solarScene(c, cx, cy, R, { mx, my, ratio: F.moon.r / F.sun.r, obsc: F.obsc, total: F.total, F, tan, bg: Z });
      }
      c.restore();
    } finally { this.time = keep; }
    return F;
  }
  frameAt(ms) { if (!this.observer) return null; const keep = this.time; this.time = ms; try { return this._compute(); } finally { this.time = keep; } }
}
G.SkyView = SkyView; G.horizonProfile = horizonProfile; G.SkyUtil = { skyColors, mix3, rgb };
})(typeof globalThis !== 'undefined' ? globalThis : this);
