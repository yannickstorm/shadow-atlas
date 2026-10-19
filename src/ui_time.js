/* Shared time control: time bars (Earth / Sky) and the playback loop. */
(function (G) {
'use strict';
const App = G.App, S = App.S, U = G.U, Ecl = G.Ecl, esc = G.esc, $ = App.$;
S.player = { playing: false, speed: 60 };

/* range and markers depend on the tab: Earth shows the global event, Sky focuses on your site */
function globalRange() {
  const an = S.an, ev = S.ev;
  if (ev.kind === 'solar') return [(an.tP1 || an.tGreatest - 2 * 3600000) - 12 * 60000, (an.tP4 || an.tGreatest + 2 * 3600000) + 12 * 60000];
  return [(an.tP1 || an.tU1) - 25 * 60000, (an.tP4 || an.tU4) + 25 * 60000];
}
function localRange() {
  const L = S.loc, an = S.an;
  if (S.ev.kind === 'solar') {
    if (L && L.eclipse && L.visible) { const a = L.c1 || L.tRise || L.tMax - 30 * 60000, b = L.c4 || L.tSet || L.tMax + 30 * 60000; return [a - 12 * 60000, b + 12 * 60000]; }
    return globalRange();
  }
  return globalRange();
}
function globalMarks() {
  const an = S.an, m = [];
  if (S.ev.kind === 'solar') {
    if (an.tP1) m.push(['P1', an.tP1]);
    if (an.tU1) m.push(['U1', an.tU1]);
    m.push(['MAX', an.tGreatest, true]);
    if (an.tU4) m.push(['U4', an.tU4]);
    if (an.tP4) m.push(['P4', an.tP4]);
  } else {
    for (const [n, t] of [['P1', an.tP1], ['U1', an.tU1], ['U2', an.tU2], ['MAX', an.tGreatest], ['U3', an.tU3], ['U4', an.tU4], ['P4', an.tP4]]) if (t) m.push([n, t, n === 'MAX']);
  }
  return m;
}
function localMarks() {
  const L = S.loc, m = [];
  if (S.ev.kind === 'solar' && L && L.eclipse && L.visible) {
    for (const [n, t] of [['C1', L.c1], ['C2', L.c2], ['MAX', L.tMax], ['C3', L.c3], ['C4', L.c4]]) if (t) m.push([n, t, n === 'MAX']);
    return m;
  }
  if (S.ev.kind === 'lunar' && L && L.contacts) { const c = L.contacts; for (const n of ['P1', 'U1', 'U2', 'max', 'U3', 'U4', 'P4']) if (c[n]) m.push([n === 'max' ? 'MAX' : n, c[n].t, n === 'max']); return m; }
  return globalMarks();
}
App.rangeFor = kind => kind === 'sky' ? localRange() : globalRange();
App.marksFor = kind => kind === 'sky' ? localMarks() : globalMarks();
App.activeRange = () => App.rangeFor(S.tab === 'sky' ? 'sky' : 'earth');

class TimeBar {
  constructor(root, kind) {
    this.root = root; this.kind = kind;
    root.innerHTML = `<div class="tb-row"><button class="play" aria-label="Play or pause">${App.icons.play}</button>
      <select class="field tb-speed" aria-label="Playback speed"><option value="1">1×</option><option value="10">10×</option><option value="60" selected>60×</option><option value="300">300×</option><option value="1200">1200×</option></select></div>
      <div class="tb-track"><div class="tb-marks"></div><input class="rng" type="range" min="0" max="1000" step="1" value="0" aria-label="Time"></div>
      <div class="tb-time"><span class="t1 mono"></span><span class="t2 mono"></span><span class="tb-jump"></span><span class="t3"></span></div>`;
    this.track = root.querySelector('.tb-track'); this.play = root.querySelector('.play'); this.rng = root.querySelector('.rng'); this.marks = root.querySelector('.tb-marks'); this.speed = root.querySelector('.tb-speed');
    this.t1 = root.querySelector('.t1'); this.t2 = root.querySelector('.t2'); this.t3 = root.querySelector('.t3'); this.jump = root.querySelector('.tb-jump');
    this.jump.innerHTML = [['−1m', -60], ['−10s', -10], ['+10s', 10], ['+1m', 60]].map(j => `<button class="btn" data-d="${j[1]}" aria-label="Step ${j[0]}">${j[0]}</button>`).join('');
    this.play.addEventListener('click', () => App.togglePlay());
    this.speed.addEventListener('change', () => { S.player.speed = +this.speed.value; App.emit('player'); });
    this.rng.addEventListener('input', () => { const a = this.range[0]; App.setTime(a + (+this.rng.value) * 1000, 'bar'); });
    this.marks.addEventListener('click', e => { const s = e.target.closest('span[data-t]'); if (s) App.setTime(+s.dataset.t); });
    this.jump.addEventListener('click', e => { const b = e.target.closest('button[data-d]'); if (b) App.setTime(S.time + (+b.dataset.d) * 1000); });
    App.on('player', () => this.syncPlay());
    this.refresh();
  }
  refresh() {
    if (!S.ev || !S.an) return;
    this.range = App.rangeFor(this.kind); const [a, b] = this.range;
    this.rng.max = Math.max(1, Math.round((b - a) / 1000)); this.rng.step = 1;
    const mk = App.marksFor(this.kind);
    // group marks closer than ~4% of the bar so their labels never collide; alternate rows for neighbours
    const groups = [];
    for (const m of mk) { const f = (m[1] - a) / (b - a), g = groups[groups.length - 1]; if (g && f - g.f1 < 0.04) { g.items.push(m); g.f1 = f; } else groups.push({ f0: f, f1: f, items: [m] }); }
    let two = false, lastF = -9, lastRow = 1;
    this.marks.innerHTML = groups.map(g => {
      const mx = g.items.find(m => m[2]) || g.items[0], f = (g.f0 + g.f1) / 2;
      const row = f - lastF < 0.08 ? 1 - lastRow : 0; if (row) two = true; lastF = f; lastRow = row;
      const label = g.items.map(m => m[0]).join('·');
      return `<span class="${g.items.some(m => m[2]) ? 'mx' : ''}" data-row="${row}" data-t="${mx[1]}" style="left:calc(8px + (100% - 16px) * ${f.toFixed(5)})" title="${g.items.map(m => m[0] + ' ' + U.hms(m[1], 'UTC') + ' UT').join('  ')}">${label}</span>`;
    }).join('');
    this.track.classList.toggle('two', two);
    this.t3.textContent = this.kind === 'sky' ? 'Contact times follow your site' : 'Global event window';
    this.syncPlay(); this.update();
  }
  syncPlay() { this.play.innerHTML = S.player.playing ? App.icons.pause : App.icons.play; this.speed.value = String(S.player.speed); }
  update() {
    if (!S.ev || !this.range) return;
    const [a, b] = this.range, t = S.time;
    this.rng.value = Math.round(U.clamp((t - a) / 1000, 0, (b - a) / 1000));
    const tz = App.tz();
    this.t1.textContent = U.hms(t, tz) + ' ' + (S.useUT ? 'UT' : U.offsetLabel(t, S.site.tz));
    this.t2.textContent = S.useUT ? '' : U.hms(t, 'UTC') + ' UT';
  }
}
App.TimeBar = TimeBar;

/* ---------- playback ---------- */
let raf = null, last = 0;
function tick(now) {
  if (!S.player.playing) { raf = null; return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const [a, b] = App.activeRange();
  let t = S.time + dt * S.player.speed * 1000;
  if (t > b) t = a; else if (t < a) t = a;
  App.setTime(t, 'play');
  raf = requestAnimationFrame(tick);
}
App.togglePlay = function (force) {
  S.player.playing = force === undefined ? !S.player.playing : force;
  if (S.player.playing) { last = performance.now(); if (!raf) raf = requestAnimationFrame(tick); const [a, b] = App.activeRange(); if (S.time >= b - 1000) App.setTime(a); }
  App.emit('player');
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
