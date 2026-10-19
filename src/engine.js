/* Eclipse engine: Besselian elements, path, local circumstances, magnitude field, lunar shadow.
   Sun and Moon vectors come from Astronomy Engine (MIT, Don Cross). */
(function (G) {
'use strict';
const A = G.Astronomy;
const PI = Math.PI, TAU = 2 * Math.PI, D2R = PI / 180, R2D = 180 / PI;
const DAY = 86400000, J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const RE_KM = 6378.137;                 // equatorial radius, km
const AU_ER = 149597870.7 / RE_KM;      // astronomical unit in Earth radii
const FLAT = 1 / 298.257223563;
const BA = 1 - FLAT;                    // b/a
const BA2 = BA * BA;
const SUN_R = 696000;                   // km
const K_PEN = 0.2725076, K_UMB = 0.272281;
const HORIZON_ZETA = Math.sin(-0.833 * D2R);

/* ---------- Delta T (seconds) ---------- */
function deltaT(y) {
  let t;
  if (y < 1900) return A.DeltaT_EspenakMeeus((y - 2000) * 365.2425);
  if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t ** 3; }
  if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2026) {
    const T = [[2005, 64.69], [2010, 66.07], [2015, 67.64], [2018, 68.97], [2020, 69.36], [2022, 69.29], [2024, 69.20], [2026, 69.20]];
    for (let i = 0; i < T.length - 1; i++) if (y <= T[i + 1][0]) { const f = (y - T[i][0]) / (T[i + 1][0] - T[i][0]); return T[i][1] + (T[i + 1][1] - T[i][1]) * f; }
  }
  if (y < 2050) { t = y - 2026; return 69.2 + 0.2 * t + 0.006 * t * t; }
  const em = -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - Math.min(y, 2150));
  const em50 = -20 + 32 * (2.3) ** 2 - 0.5628 * 100;
  const mine50 = 69.2 + 0.2 * 24 + 0.006 * 576;
  const fade = Math.max(0, 1 - (y - 2050) / 100);
  return em - (em50 - mine50) * fade;
}
A.SetDeltaTFunction(function (ut) { return deltaT(2000 + ut / 365.2425); });

const mkTime = ms => A.MakeTime((ms - J2000_MS) / DAY);
const norm2pi = a => { a %= TAU; return a < 0 ? a + TAU : a; };
const wrapPi = a => { a %= TAU; if (a > PI) a -= TAU; else if (a < -PI) a += TAU; return a; };

/* ---------- Besselian elements ---------- */
function elementsAt(ms) {
  const time = mkTime(ms);
  const rot = A.Rotation_EQJ_EQD(time);
  const s = A.RotateVector(rot, A.GeoVector('Sun', time, true));
  const m = A.RotateVector(rot, A.GeoMoon(time));
  const sx = s.x * AU_ER, sy = s.y * AU_ER, sz = s.z * AU_ER;
  const mx = m.x * AU_ER, my = m.y * AU_ER, mz = m.z * AU_ER;
  let zx = sx - mx, zy = sy - my, zz = sz - mz;
  const D = Math.hypot(zx, zy, zz);           // Earth radii
  zx /= D; zy /= D; zz /= D;
  const d = Math.asin(zz);
  const ra = Math.atan2(zy, zx);
  const gast = A.SiderealTime(time) * 15 * D2R;
  const mu = gast - ra;
  // y axis: celestial north projected on the fundamental plane; x = y cross z (east)
  let yx = -zz * zx, yy = -zz * zy, yz = 1 - zz * zz;
  const yl = Math.hypot(yx, yy, yz); yx /= yl; yy /= yl; yz /= yl;
  const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
  const x = mx * xx + my * xy + mz * xz;
  const y = mx * yx + my * yy + mz * yz;
  const zM = mx * zx + my * zy + mz * zz;
  const sunR = SUN_R / RE_KM;
  const sf1 = (sunR + K_PEN) / D, sf2 = (sunR - K_UMB) / D;
  const tf1 = sf1 / Math.sqrt(1 - sf1 * sf1), tf2 = sf2 / Math.sqrt(1 - sf2 * sf2);
  const l1 = zM * tf1 + K_PEN / Math.sqrt(1 - sf1 * sf1);
  const l2 = zM * tf2 - K_UMB / Math.sqrt(1 - sf2 * sf2);
  return { x, y, d, mu, l1, l2, tf1, tf2 };
}

const NQ = 8, QN = ['x', 'y', 'd', 'mu', 'l1', 'l2', 'tf1', 'tf2'];
const DEG = 8, NNODE = 33;
function fitElements(t0, halfH) {
  const half = halfH * 3600000;
  const nodes = [];
  for (let i = 0; i < NNODE; i++) nodes.push(Math.cos(PI * (i + 0.5) / NNODE));
  const order = nodes.map((tau, i) => i).sort((a, b) => nodes[a] - nodes[b]);
  const vals = new Array(NNODE);
  let prevMu = null;
  for (const i of order) {
    const e = elementsAt(t0 + nodes[i] * half);
    if (prevMu !== null) e.mu = prevMu + wrapPi(e.mu - prevMu);
    prevMu = e.mu;
    vals[i] = e;
  }
  // mu may be offset by 2pi multiple from the t0 value: normalise so that mu(t0) is within [0,2pi)
  const coef = new Float64Array(NQ * (DEG + 1));
  for (let q = 0; q < NQ; q++) {
    for (let k = 0; k <= DEG; k++) {
      let s = 0;
      for (let i = 0; i < NNODE; i++) s += vals[i][QN[q]] * Math.cos(k * Math.acos(nodes[i]));
      coef[q * (DEG + 1) + k] = (k === 0 ? 1 : 2) * s / NNODE;
    }
  }
  return { t0, half, coef };
}
function evalInto(P, ms, out) {
  const tau = (ms - P.t0) / P.half, c = P.coef, W = DEG + 1;
  const t2 = 2 * tau;
  for (let q = 0; q < NQ; q++) {
    const o = q * W;
    let b1 = 0, b2 = 0;
    for (let k = DEG; k >= 1; k--) { const b0 = c[o + k] + t2 * b1 - b2; b2 = b1; b1 = b0; }
    out[q] = c[o] + tau * b1 - b2;
  }
  return out;
}
// Clenshaw with c0 stored as full coefficient (not halved): value = c0 + sum_{k>=1} c_k T_k. The fit above stores c0 with weight 1/N, so fine.
function evalEl(P, ms) { const o = new Float64Array(NQ); evalInto(P, ms, o); return o; }
const IX = 0, IY = 1, ID = 2, IMU = 3, IL1 = 4, IL2 = 5, ITF1 = 6, ITF2 = 7;

/* ---------- observer ---------- */
function makeObserver(latDeg, lonDeg, elevM) {
  const phi = latDeg * D2R, u = Math.atan(BA * Math.tan(phi));
  const h = (elevM || 0) / (RE_KM * 1000);
  return { lat: phi, lon: lonDeg * D2R, rs: BA * Math.sin(u) + h * Math.sin(phi), rc: Math.cos(u) + h * Math.cos(phi), latDeg, lonDeg, elev: elevM || 0 };
}
const E1 = new Float64Array(NQ), E2 = new Float64Array(NQ);
function obsState(P, ob, ms, E, out) {
  evalInto(P, ms, E);
  const h = E[IMU] + ob.lon, sd = Math.sin(E[ID]), cd = Math.cos(E[ID]), ch = Math.cos(h), sh = Math.sin(h);
  const xi = ob.rc * sh, eta = ob.rs * cd - ob.rc * sd * ch, zeta = ob.rs * sd + ob.rc * cd * ch;
  const u = xi - E[IX], v = eta - E[IY];
  out.m = Math.hypot(u, v); out.u = u; out.v = v; out.zeta = zeta;
  out.L1 = E[IL1] - zeta * E[ITF1]; out.L2 = E[IL2] - zeta * E[ITF2];
  out.h = h; out.d = E[ID];
  return out;
}
function sunAltAz(ob, d, h) {
  const sl = Math.sin(ob.lat), cl = Math.cos(ob.lat), sd = Math.sin(d), cd = Math.cos(d);
  const alt = Math.asin(sl * sd + cl * cd * Math.cos(h));
  const az = norm2pi(Math.atan2(-cd * Math.sin(h), sd * cl - cd * sl * Math.cos(h)));
  return { alt: alt * R2D, az: az * R2D };
}
function magObs(L1, L2, m) {
  const rs = (L1 + L2) / 2, rm = (L1 - L2) / 2;
  if (m >= rs + rm) return { mag: (rs + rm - m) / (2 * rs), obsc: 0 };
  const dd = Math.abs(rs - rm);
  if (m <= dd) return { mag: rm / rs, obsc: rm >= rs ? 1 : (rm * rm) / (rs * rs) };
  const mag = (rs + rm - m) / (2 * rs);
  const a1 = Math.acos(Math.max(-1, Math.min(1, (m * m + rs * rs - rm * rm) / (2 * m * rs))));
  const a2 = Math.acos(Math.max(-1, Math.min(1, (m * m + rm * rm - rs * rs) / (2 * m * rm))));
  const area = rs * rs * a1 + rm * rm * a2 - 0.5 * Math.sqrt(Math.max(0, (-m + rs + rm) * (m + rs - rm) * (m - rs + rm) * (m + rs + rm)));
  return { mag, obsc: area / (PI * rs * rs) };
}

/* ---------- root finding ---------- */
function goldenMin(f, a, b, tol) {
  const g = 0.6180339887498949;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  while (b - a > tol) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}
function bisect(f, a, b, tol) {      // f(a), f(b) of opposite sign
  let fa = f(a);
  for (let i = 0; i < 60 && b - a > tol; i++) {
    const c = (a + b) / 2, fc = f(c);
    if ((fc < 0) === (fa < 0)) { a = c; fa = fc; } else b = c;
  }
  return (a + b) / 2;
}

/* ---------- local circumstances for a solar eclipse ---------- */
function local(an, latDeg, lonDeg, elevM) {
  const P = an.poly, ob = makeObserver(latDeg, lonDeg, elevM);
  const S = { }, lo = P.t0 - P.half, hi = P.t0 + P.half;
  const fm = ms => obsState(P, ob, ms, E1, S).m;
  // coarse scan
  const N = 48; let best = Infinity, bi = 0, ok = false;
  for (let i = 0; i <= N; i++) {
    const t = lo + (hi - lo) * i / N; obsState(P, ob, t, E1, S);
    const g = S.m - S.L1;
    if (g < best) { best = g; bi = i; }
  }
  if (best > 0.12) return { eclipse: false };
  const tmax = goldenMin(fm, lo + (hi - lo) * Math.max(0, bi - 1) / N, lo + (hi - lo) * Math.min(N, bi + 1) / N, 20);
  obsState(P, ob, tmax, E1, S);
  if (S.m >= S.L1) return { eclipse: false };
  const f1 = ms => { obsState(P, ob, ms, E1, S); return S.m - S.L1; };
  const f2 = ms => { obsState(P, ob, ms, E1, S); return S.m - Math.abs(S.L2); };
  const r = { eclipse: true, ob };
  r.tMax = tmax;
  r.c1 = f1(lo) > 0 ? bisect(f1, lo, tmax, 10) : null;
  r.c4 = f1(hi) > 0 ? bisect(f1, tmax, hi, 10) : null;
  obsState(P, ob, tmax, E1, S);
  const central = S.m < Math.abs(S.L2);
  r.kind = central ? (S.L2 < 0 ? 'total' : 'annular') : 'partial';
  if (central) { r.c2 = bisect(f2, r.c1 || lo, tmax, 10); r.c3 = bisect(f2, tmax, r.c4 || hi, 10); r.duration = (r.c3 - r.c2) / 1000; }
  const mo = magObs(S.L1, S.L2, S.m);
  r.mag = mo.mag; r.obsc = mo.obsc; r.sepAtMax = S.m;
  const aa = sunAltAz(ob, S.d, S.h); r.altMax = aa.alt; r.azMax = aa.az;
  // horizon handling
  const zt = ms => { obsState(P, ob, ms, E1, S); return S.zeta - HORIZON_ZETA; };
  const c1 = r.c1 ?? lo, c4 = r.c4 ?? hi;
  r.sunUpAtMax = zt(tmax) > 0;
  r.risesDuring = false; r.setsDuring = false;
  if (!r.sunUpAtMax) {
    // find whether sun is up at some part of the eclipse
    if (zt(c1) > 0) { r.setsDuring = true; r.tSet = bisect(zt, c1, tmax, 10); }
    else if (zt(c4) > 0) { r.risesDuring = true; r.tRise = bisect(zt, tmax, c4, 10); }
    const te = r.setsDuring ? r.tSet : r.risesDuring ? r.tRise : null;
    if (te !== null) { obsState(P, ob, te, E1, S); const m2 = magObs(S.L1, S.L2, S.m); r.magVisible = m2.mag; r.obscVisible = m2.obsc; }
    else { r.visible = false; r.magVisible = 0; r.obscVisible = 0; }
    if (te !== null) r.visible = true;
  } else { r.visible = true; r.magVisible = r.mag; r.obscVisible = r.obsc; }
  // sun position at each contact
  r.contacts = {};
  for (const [nm, t] of [['c1', r.c1], ['c2', r.c2], ['max', r.tMax], ['c3', r.c3], ['c4', r.c4]]) {
    if (t == null) continue;
    obsState(P, ob, t, E1, S);
    const a = sunAltAz(ob, S.d, S.h);
    // position angle of the contact point on the Sun's limb, from celestial north towards east
    const pa = norm2pi(Math.atan2(-S.u, -S.v)) * R2D;
    r.contacts[nm] = { t, alt: a.alt, az: a.az, pa, mag: magObs(S.L1, S.L2, S.m).mag };
  }
  return r;
}
// instantaneous state at a site for charts: mag, obsc, alt, az
function localAt(an, ob, ms) {
  const S = {}; obsState(an.poly, ob, ms, E1, S);
  const mo = S.m >= S.L1 ? { mag: 0, obsc: 0 } : magObs(S.L1, S.L2, S.m);
  const aa = sunAltAz(ob, S.d, S.h);
  return { mag: Math.max(0, mo.mag), obsc: mo.obsc, alt: aa.alt, az: aa.az, sep: S.m, L1: S.L1, L2: S.L2, u: S.u, v: S.v };
}

/* ---------- fundamental plane -> geodetic ---------- */
function fpToGeo(E, xi, eta, zeta0) {
  const sd = Math.sin(E[ID]), cd = Math.cos(E[ID]);
  const Aq = cd * cd + sd * sd / BA2;
  const Bq = 2 * eta * cd * sd * (1 / BA2 - 1);
  const Cq = xi * xi + eta * eta * sd * sd + eta * eta * cd * cd / BA2 - 1;
  const disc = Bq * Bq - 4 * Aq * Cq;
  if (disc < 0) return null;
  const zeta = (-Bq + Math.sqrt(disc)) / (2 * Aq);
  const X = zeta * cd - eta * sd, Z = eta * cd + zeta * sd, Y = xi;
  const p = Math.hypot(X, Y);
  const lat = Math.atan2(Z, p * BA2);
  const lon = wrapPi(Math.atan2(Y, X) - E[IMU]);
  return { lat: lat * R2D, lon: lon * R2D, zeta };
}

/* ---------- full solar analysis ---------- */
function analyzeSolar(peakMs, opts) {
  const t0 = Math.round(peakMs / 60000) * 60000;
  const poly = fitElements(t0, 3.6);
  const an = { poly, t0 };
  const E = new Float64Array(NQ);
  const dist = ms => { evalInto(poly, ms, E); return Math.hypot(E[IX], E[IY]); };
  const tg = goldenMin(dist, t0 - 40 * 60000, t0 + 40 * 60000, 100);
  evalInto(poly, tg, E);
  const gamma = Math.hypot(E[IX], E[IY]) * (E[IY] >= 0 ? 1 : -1);
  an.tGreatest = tg; an.gamma = gamma;
  an.l1 = E[IL1]; an.l2g = E[IL2];
  // global penumbral contacts on the (nearly spherical) Earth
  const gp = ms => { evalInto(poly, ms, E); return Math.hypot(E[IX], E[IY]) - (1 + E[IL1]); };
  if (gp(tg) < 0) {
    an.tP1 = gp(poly.t0 - poly.half) > 0 ? bisect(gp, poly.t0 - poly.half, tg, 50) : poly.t0 - poly.half;
    an.tP4 = gp(poly.t0 + poly.half) > 0 ? bisect(gp, tg, poly.t0 + poly.half, 50) : poly.t0 + poly.half;
  }
  if (opts && opts.noPath) {
    const hit = (() => { evalInto(poly, tg, E); const sd = Math.sin(E[ID]), cd = Math.cos(E[ID]); const xi = E[IX], eta = E[IY];
      const Aq = cd * cd + sd * sd / BA2, Bq = 2 * eta * cd * sd * (1 / BA2 - 1), Cq = xi * xi + eta * eta * sd * sd + eta * eta * cd * cd / BA2 - 1; return Bq * Bq - 4 * Aq * Cq >= 0; })();
    an.central = hit; an.fast = true; return an;
  }
  // central line
  const STEP = 30000;
  const pts = [];
  const axisHits = ms => { evalInto(poly, ms, E); const sd = Math.sin(E[ID]), cd = Math.cos(E[ID]); const xi = E[IX], eta = E[IY];
    const Aq = cd * cd + sd * sd / BA2, Bq = 2 * eta * cd * sd * (1 / BA2 - 1), Cq = xi * xi + eta * eta * sd * sd + eta * eta * cd * cd / BA2 - 1;
    return Bq * Bq - 4 * Aq * Cq; };
  let tStart = null, tEnd = null;
  if (axisHits(tg) >= 0) {
    const lo = poly.t0 - poly.half, hi = poly.t0 + poly.half;
    tStart = axisHits(lo) < 0 ? bisect(axisHits, lo, tg, 20) : lo;
    tEnd = axisHits(hi) < 0 ? bisect(axisHits, tg, hi, 20) : hi;
  }
  an.central = tStart !== null;
  if (an.central) {
    const times = [];
    for (let t = tStart; t < tEnd; t += STEP) times.push(t);
    times.push(tEnd);
    const path = { t: [], lat: [], lon: [], dur: [], width: [], alt: [], l2: [], nlat: [], nlon: [], slat: [], slon: [], mag: [] };
    const Et = new Float64Array(NQ), Ea = new Float64Array(NQ);
    for (const t of times) {
      evalInto(poly, t, Et);
      const g = fpToGeo(Et, Et[IX], Et[IY]);
      if (!g) continue;
      const L2 = Et[IL2] - g.zeta * Et[ITF2], L1 = Et[IL1] - g.zeta * Et[ITF1];
      // relative velocity of shadow vs ground point (finite difference in time, fixed ground point)
      const dt = 2000;
      const ob = makeObserver(g.lat, g.lon, 0);
      const so = {}, s2 = {};
      obsState(poly, ob, t - dt, Ea, so); obsState(poly, ob, t + dt, Ea, s2);
      const du = (s2.u - so.u) / (2 * dt / 3600000), dv = (s2.v - so.v) / (2 * dt / 3600000);   // Earth radii per hour
      const n = Math.hypot(du, dv);
      const dur = n > 0 ? 2 * Math.abs(L2) / n * 3600 : 0;
      // limits
      const px = -dv / n, py = du / n;
      const lim = [];
      for (const sgn of [1, -1]) {
        let zeta = g.zeta, gg = null;
        for (let it = 0; it < 4; it++) {
          const L2z = Math.abs(Et[IL2] - zeta * Et[ITF2]);
          gg = fpToGeo(Et, Et[IX] + sgn * L2z * px, Et[IY] + sgn * L2z * py);
          if (!gg) break; zeta = gg.zeta;
        }
        lim.push(gg);
      }
      let nl = lim[0], sl = lim[1];
      if (nl && sl && nl.lat < sl.lat) { const tmp = nl; nl = sl; sl = tmp; }
      const sa = sunAltAz(ob, Et[ID], Et[IMU] + g.lon * D2R);
      let w = 0;
      if (nl && sl) w = geoDist(nl.lat, nl.lon, sl.lat, sl.lon);
      path.t.push(t); path.lat.push(g.lat); path.lon.push(g.lon); path.dur.push(dur); path.width.push(w); path.alt.push(sa.alt); path.l2.push(L2);
      path.nlat.push(nl ? nl.lat : null); path.nlon.push(nl ? nl.lon : null); path.slat.push(sl ? sl.lat : null); path.slon.push(sl ? sl.lon : null);
      path.mag.push((L1 - L2) / (L1 + L2));
    }
    // path width: distance from each limit point to the nearest point of the opposite limit (perpendicular to the track)
    for (let i = 0; i < path.t.length; i++) {
      if (path.nlat[i] === null || path.slat[i] === null) continue;
      let best = path.width[i];
      for (let j = Math.max(0, i - 30); j <= Math.min(path.t.length - 1, i + 30); j++) {
        if (path.slat[j] !== null) best = Math.min(best, geoDist(path.nlat[i], path.nlon[i], path.slat[j], path.slon[j]));
        if (path.nlat[j] !== null) best = Math.min(best, geoDist(path.slat[i], path.slon[i], path.nlat[j], path.nlon[j]));
      }
      path.width[i] = best;
    }
    an.path = path;
    // type from sign of L2 along path (ignore the very ends where the geometry is degenerate)
    let neg = 0, pos = 0;
    for (let i = 0; i < path.l2.length; i++) { if (path.l2[i] < 0) neg++; else pos++; }
    an.type = neg && pos ? 'H' : neg ? 'T' : 'A';
    // greatest eclipse
    evalInto(poly, tg, E);
    const gg = fpToGeo(E, E[IX], E[IY]);
    const L1 = E[IL1] - gg.zeta * E[ITF1], L2 = E[IL2] - gg.zeta * E[ITF2];
    an.lat = gg.lat; an.lon = gg.lon;
    an.magnitude = (L1 - L2) / (L1 + L2);
    // duration/width at greatest from nearest path point
    let bi = 0, bd = Infinity;
    for (let i = 0; i < path.t.length; i++) { const dd = Math.abs(path.t[i] - tg); if (dd < bd) { bd = dd; bi = i; } }
    an.duration = path.dur[bi]; an.width = path.width[bi]; an.sunAlt = path.alt[bi];
    an.durationMax = Math.max(...path.dur);
  } else {
    // partial (or non-central): greatest point on the limb
    evalInto(poly, tg, E);
    const m = Math.hypot(E[IX], E[IY]);
    const xi = E[IX] / m, eta = E[IY] / m;
    // on the limb zeta ~ 0: adjust inward slightly
    let g = null;
    for (let f = 0.9999; f > 0.9 && !g; f -= 0.0007) g = fpToGeo(E, xi * f, eta * f);
    if (g) { an.lat = g.lat; an.lon = g.lon; }
    const L1 = E[IL1], L2 = E[IL2];
    an.magnitude = Math.max(0, (L1 - (m - 1)) / (L1 + L2));
    an.type = 'P';
    an.nonCentral = (m - 1) < Math.abs(L2);
    if (an.nonCentral) an.type = L2 < 0 ? 'T' : 'A';
    an.duration = 0;
  }
  if (an.tP1 !== undefined) { an.tU1 = tStart; an.tU4 = tEnd; }
  return an;
}

function geoDist(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ---------- magnitude field (best magnitude seen anywhere on a lat/lon grid) ---------- */
// returns Float32Array nlat x nlon (row 0 = +90) of max magnitude with the Sun above the horizon; -1 when never up / never eclipsed
function magField(an, nlon, nlat, stepMin, rowCb) {
  const P = an.poly, E = new Float64Array(NQ);
  const t1 = (an.tP1 ?? an.tGreatest - 3 * 3600000) - 60000, t2 = (an.tP4 ?? an.tGreatest + 3 * 3600000) + 60000;
  const nt = Math.max(8, Math.ceil((t2 - t1) / (stepMin * 60000)));
  const dtm = (t2 - t1) / nt;
  // per-time cached quantities
  const T = [];
  for (let i = 0; i <= nt; i++) {
    evalInto(P, t1 + i * dtm, E);
    T.push({ x: E[IX], y: E[IY], sd: Math.sin(E[ID]), cd: Math.cos(E[ID]), mu: E[IMU], l1: E[IL1], l2: E[IL2], t1: E[ITF1], t2: E[ITF2] });
  }
  const out = new Float32Array(nlon * nlat).fill(-1);
  const cosL = new Float64Array(nlon * (nt + 1)), sinL = new Float64Array(nlon * (nt + 1));
  for (let j = 0; j < nlon; j++) {
    const lon = (-180 + (j + 0.5) * 360 / nlon) * D2R;
    for (let i = 0; i <= nt; i++) { const h = T[i].mu + lon; cosL[j * (nt + 1) + i] = Math.cos(h); sinL[j * (nt + 1) + i] = Math.sin(h); }
  }
  const vals = new Float64Array(nt + 1);
  for (let r = 0; r < nlat; r++) {
    const lat = (90 - (r + 0.5) * 180 / nlat) * D2R;
    const u = Math.atan(BA * Math.tan(lat)), rs = BA * Math.sin(u), rc = Math.cos(u);
    for (let j = 0; j < nlon; j++) {
      let best = -1, bi = -1;
      const base = j * (nt + 1);
      for (let i = 0; i <= nt; i++) {
        const q = T[i], ch = cosL[base + i], sh = sinL[base + i];
        const zeta = rs * q.sd + rc * q.cd * ch;
        if (zeta < HORIZON_ZETA) { vals[i] = -2; continue; }
        const xi = rc * sh, eta = rs * q.cd - rc * q.sd * ch;
        const uu = xi - q.x, vv = eta - q.y;
        const m = Math.sqrt(uu * uu + vv * vv);
        const L1 = q.l1 - zeta * q.t1, L2 = q.l2 - zeta * q.t2;
        let mag;
        if (m >= Math.abs(L2)) mag = (L1 - m) / (L1 + L2); else mag = (L1 - L2) / (L1 + L2);
        vals[i] = mag;
        if (mag > best) { best = mag; bi = i; }
      }
      if (bi >= 0) {
        // parabolic refinement between neighbours that are also valid
        if (bi > 0 && bi < nt && vals[bi - 1] > -2 && vals[bi + 1] > -2) {
          const a = vals[bi - 1], b = vals[bi], c = vals[bi + 1], den = a - 2 * b + c;
          if (den < 0) best = b - 0.125 * (c - a) * (c - a) / den;
        }
        out[r * nlon + j] = best;
      }
    }
    if (rowCb) rowCb(r);
  }
  return out;
}

/* ---------- lunar eclipses ---------- */
const MOON_R_KM = 1737.4;
const SHADOW_R = 6448;      // Earth radius plus atmospheric allowance (km), tuned to published umbral magnitudes
const EQJ_POLE_ECL = [0, -Math.sin(23.4392911 * D2R), Math.cos(23.4392911 * D2R)];
function lunarState(ms) {
  const time = mkTime(ms);
  const s = A.GeoVector('Sun', time, true), m = A.GeoMoon(time);
  const sl = Math.hypot(s.x, s.y, s.z), AUKM = 149597870.7;
  const ax = [-s.x / sl, -s.y / sl, -s.z / sl];            // unit vector along the shadow axis
  const u = (m.x * ax[0] + m.y * ax[1] + m.z * ax[2]) ;     // au along axis
  const px = u * ax[0] - m.x, py = u * ax[1] - m.y, pz = u * ax[2] - m.z;   // from moon to axis
  const r = Math.hypot(px, py, pz) * AUKM;
  const uu = u / sl;     // ratio of distance behind Earth to Sun distance
  const k = SUN_R - (1 + uu) * (SUN_R - SHADOW_R);
  const p = -SUN_R + (1 + uu) * (SUN_R + SHADOW_R);
  // offsets in the sky frame: east (increasing ecliptic longitude) and north (ecliptic)
  let ex = EQJ_POLE_ECL[1] * ax[2] - EQJ_POLE_ECL[2] * ax[1], ey = EQJ_POLE_ECL[2] * ax[0] - EQJ_POLE_ECL[0] * ax[2], ez = EQJ_POLE_ECL[0] * ax[1] - EQJ_POLE_ECL[1] * ax[0];
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = ay_(ax, [ex, ey, ez]);
  const e = (m.x * ex + m.y * ey + m.z * ez) * AUKM, n = (m.x * nx[0] + m.y * nx[1] + m.z * nx[2]) * AUKM;
  const dist = Math.hypot(m.x, m.y, m.z) * AUKM;
  return { r, k, p, e, n, dist, moonR: MOON_R_KM * 1 };
}
function ay_(a, e) { return [a[1] * e[2] - a[2] * e[1], a[2] * e[0] - a[0] * e[2], a[0] * e[1] - a[1] * e[0]]; }

function analyzeLunar(peakMs) {
  const t0 = Math.round(peakMs / 60000) * 60000;
  const f = ms => lunarState(ms).r;
  const tg = goldenMin(f, t0 - 40 * 60000, t0 + 40 * 60000, 200);
  const g = lunarState(tg);
  const Rm = g.moonR;
  const an = { t0, tGreatest: tg, rMin: g.r, kMin: g.k, pMin: g.p };
  an.umbralMag = (g.k + Rm - g.r) / (2 * Rm);
  an.penumbralMag = (g.p + Rm - g.r) / (2 * Rm);
  // gamma-like: distance of Moon's centre from the axis in units of the shadow's umbral radius is unwieldy; give Earth radii signed by moon north/south of axis
  an.gamma = (g.n >= 0 ? 1 : -1) * g.r / RE_KM;
  const W = 4.5 * 3600000;
  const con = (off) => ms => { const s = lunarState(ms); return s.r - (s.k + off * s.moonR); };
  const conP = (off) => ms => { const s = lunarState(ms); return s.r - (s.p + off * s.moonR); };
  an.tP1 = null; an.tP4 = null; an.tU1 = null; an.tU4 = null; an.tU2 = null; an.tU3 = null;
  if (an.penumbralMag > 0) {
    const fp = conP(1); an.tP1 = bisect(fp, tg - W, tg, 200); an.tP4 = bisect(fp, tg, tg + W, 200);
  }
  if (an.umbralMag > 0) {
    const fu = con(1); an.tU1 = bisect(fu, tg - W, tg, 200); an.tU4 = bisect(fu, tg, tg + W, 200);
    if (an.umbralMag >= 1) { const ft = con(-1); an.tU2 = bisect(ft, tg - W, tg, 200); an.tU3 = bisect(ft, tg, tg + W, 200); }
  }
  an.type = an.umbralMag >= 1 ? 'T' : an.umbralMag > 0 ? 'P' : 'N';   // total / partial / penumbral
  an.durTotal = an.tU2 ? (an.tU3 - an.tU2) / 60000 : 0;
  an.durPartial = an.tU1 ? (an.tU4 - an.tU1) / 60000 : 0;
  an.durPenumbral = an.tP1 ? (an.tP4 - an.tP1) / 60000 : 0;
  return an;
}

/* sub-lunar and sub-solar points (degrees) for the lunar visibility map */
function subPoint(body, ms) {
  const time = mkTime(ms);
  const v = body === 'Moon' ? A.GeoMoon(time) : A.GeoVector('Sun', time, true);
  const rot = A.Rotation_EQJ_EQD(time), w = A.RotateVector(rot, v);
  const r = Math.hypot(w.x, w.y, w.z);
  const dec = Math.asin(w.z / r), ra = Math.atan2(w.y, w.x);
  const gast = A.SiderealTime(time) * 15 * D2R;
  return { lat: dec * R2D, lon: wrapPi(ra - gast) * R2D };
}

/* ---------- saros ---------- */
const SAROS_A = { solar: 0, lunar: 0 };
function lunationIndex(ms, full) {
  const jd = ms / DAY + 2440587.5;
  return Math.round((jd - 2451550.09766 - (full ? 14.765294 : 0)) / 29.530588861);
}
function sarosNumber(ms, kind, offsets) {
  const k = lunationIndex(ms, kind === 'lunar');
  const a = offsets[kind];
  // k = a + 135 n (mod 223) -> n = (k - a) * 135^-1 mod 223 ; 135^-1 mod 223 = 5 (135*5 = 675 = 3*223 + 6) -> compute generically
  let inv = 1; for (let i = 1; i < 223; i++) if ((135 * i) % 223 === 1) { inv = i; break; }
  let n = (((k - a) % 223) + 223) % 223 * inv % 223;
  return n;
}

G.Ecl = { deltaT, mkTime, elementsAt, fitElements, evalEl, evalInto, makeObserver, local, localAt, analyzeSolar, magField, analyzeLunar, lunarState,
  subPoint, geoDist, sunAltAz, fpToGeo, lunationIndex, sarosNumber, magObs, obsState, RE_KM, K_PEN, K_UMB, IX, IY, ID, IMU, IL1, IL2, ITF1, ITF2, NQ,
  MOON_R_KM, J2000_MS, HORIZON_ZETA };
})(typeof globalThis !== 'undefined' ? globalThis : this);
