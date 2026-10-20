#!/usr/bin/env node
/* Browser tests for Shadow Atlas, driven through headless Chrome.

   Run:  npm run build && npm test        (needs Chrome or Chromium; set CHROME to its path if it is not found)

   Online services are replaced by local stand-ins (tests/mock), so the tests run offline and the same way
   every time: Nominatim answers with a fixed address, map and elevation tiles are fixed images. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..'), SITE = path.join(ROOT, '_site'), MOCK = path.join(__dirname, 'mock');
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));
const failures = [];
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures.push(msg); };

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.txt': 'text/plain', '.png': 'image/png', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    const f = path.join(SITE, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// a minimal Mapbox Vector Tile with a "building" layer, made from the same buildings as overpass.json
const OVERPASS = JSON.parse(fs.readFileSync(path.join(MOCK, 'overpass.json'), 'utf8'));
function mvtTile(z, x, y) {
  const N = 2 ** z, ext = 4096, mercY = lat => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const vi = n => { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
  const zz = n => n >= 0 ? n * 2 : -n * 2 - 1, fld = (f, w) => vi(f * 8 + w), lenf = (f, b) => [...fld(f, 2), ...vi(b.length), ...b];
  const str = t => [...Buffer.from(t)], dbl = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...b]; };
  const feats = [], vals = [];
  OVERPASS.elements.forEach((e, i) => {
    const g = e.geometry.slice(0, -1).map(p => [Math.round(((p.lon + 180) / 360 * N - x) * ext), Math.round((mercY(p.lat) * N - y) * ext)]);
    const cx = g.reduce((a, p) => a + p[0], 0) / g.length, cy = g.reduce((a, p) => a + p[1], 0) / g.length;
    if (cx < 0 || cx >= ext || cy < 0 || cy >= ext) return;
    let a = 0; for (let k = 0, j = g.length - 1; k < g.length; j = k++) a += (g[j][0] - g[k][0]) * (g[j][1] + g[k][1]);
    if (a < 0) g.reverse();                                     // outer rings have positive area
    const t = e.tags, h = +t.height || (+t['building:levels'] ? +t['building:levels'] * 3.66 : 5);
    vals.push(h);
    const geom = [1 + (1 << 3), zz(g[0][0]), zz(g[0][1]), 2 + ((g.length - 1) << 3)];
    for (let k = 1; k < g.length; k++) geom.push(zz(g[k][0] - g[k - 1][0]), zz(g[k][1] - g[k - 1][1]));
    geom.push(7 + (1 << 3));
    const packed = arr => arr.flatMap(vi);
    feats.push(lenf(2, [...fld(1, 0), ...vi(i + 1), ...lenf(2, packed([0, vals.length - 1])), ...fld(3, 0), 3, ...lenf(4, packed(geom))]));
  });
  const layer = [...fld(15, 0), 2, ...lenf(1, str('building')), ...feats.flat(), ...lenf(3, str('render_height')), ...vals.flatMap(v => lenf(4, [...fld(3, 1), ...dbl(v)])), ...fld(5, 0), ...vi(ext)];
  return Buffer.from(lenf(3, layer));
}
// stand-ins for the online services the page uses outside claude.ai
async function mockServices(ctx, hits, opts = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await ctx.route(/^https:\/\//, route => {
    const u = route.request().url(), host = new URL(u).hostname; hits[host] = (hits[host] || 0) + 1;
    if (u.includes('elevation-tiles')) return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: fs.readFileSync(path.join(MOCK, 'terr.png')) });
    if (host === 'tile.openstreetmap.org') return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: fs.readFileSync(path.join(MOCK, 'street.png')) });
    if (host === 'nominatim.openstreetmap.org') return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([
      { lat: '36.0135', lon: '-5.6046', name: '', display_name: '12, Calle Sancho IV el Bravo, Tarifa, Cádiz, Andalusia, 11380, Spain', addresstype: 'building',
        address: { house_number: '12', road: 'Calle Sancho IV el Bravo', town: 'Tarifa', state: 'Andalusia', country: 'Spain' } }]) });
    if (u === 'https://tiles.openfreemap.org/planet') return opts.tilesDown ? route.fulfill({ status: 503, headers: cors, body: '' })
      : route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'] }) });
    if (host === 'tiles.openfreemap.org') {
      // the tile under the site answers at once, the others after 4 s
      const m = u.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/), [z, x, y] = m.slice(1).map(Number);
      hits.tiles = (hits.tiles || []).concat([[z, x, y]]);
      const reply = () => route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: cors, body: mvtTile(z, x, y) });
      return hits.tiles.length === 1 ? reply() : new Promise(r => setTimeout(r, 4000)).then(reply).catch(() => {});
    }
    if (u.includes('/api/interpreter')) {
      // the first request answers at once, later ones take 4 s: buildings toward the Sun must show before the rest arrives
      const n = hits.overpassN = (hits.overpassN || 0) + 1;
      hits.overpass = (hits.overpass || []).concat([decodeURIComponent((route.request().postData() || '').replace(/^data=/, '').replace(/\+/g, ' '))]);
      const reply = () => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: fs.readFileSync(path.join(MOCK, 'overpass.json')) });
      return n === 1 ? reply() : new Promise(r => setTimeout(r, 4000)).then(reply).catch(() => {});
    }
    return route.abort();      // fonts and anything else: not needed for the tests
  });
}

async function page(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, colorScheme: opts.scheme || 'dark' });
  const hits = {}; await mockServices(ctx, hits, opts);
  if (opts.hosted) await ctx.addInitScript(() => { window.claude = { use: async () => null }; });   // what the claude.ai viewer provides
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message + ' ' + String(e.stack || '').split('\n')[1]));
  await p.goto(opts.url + '#s-2027-08-02'); await p.waitForFunction(() => window.App && App.ready, null, { timeout: 30000 });
  return { p, ctx, hits, errors };
}

(async () => {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) { console.error('Build first: npm run build'); process.exit(2); }
  if (!CHROME) { console.error('Chrome not found; set CHROME=/path/to/chrome'); process.exit(2); }
  const srv = await serve(), url = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  console.log('Catalogue and views');
  {
    const { p, ctx, errors } = await page(browser, { url });
    const bad = await p.evaluate(() => {
      const out = [];
      for (const ev of App.D.events) {
        try { App.selectEvent(ev); if (App.S.ev !== ev || !App.S.an || !App.S.loc) out.push(ev.id); } catch (e) { out.push(ev.id + ': ' + e.message); }
      }
      return out;
    });
    check(bad.length === 0, `all ${await p.evaluate(() => App.D.events.length)} eclipses open (${bad.slice(0, 3).join(', ') || 'none failed'})`);
    await p.evaluate(() => App.selectEvent(App.D.byId.get('s-2027-08-02')));
    for (const tab of ['earth', 'sky', 'horizon', 'charts', 'plan']) {
      await p.evaluate(t => App.setTab(t), tab); await p.waitForTimeout(700);
      check(await p.evaluate(t => !document.querySelector(`[data-pane="${t}"]`).hidden, tab), `${tab} tab shows`);
    }
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }

  console.log('Live maps (outside claude.ai)');
  {
    const { p, ctx, hits, errors } = await page(browser, { url });
    check(await p.evaluate(() => globalThis.LIVE === true), 'live mode is on');
    await p.fill('#placeQ', 'Calle Sancho IV el Bravo 12, Tarifa'); await p.waitForTimeout(2500);
    const first = await p.$eval('#placeRes .pr', e => e.innerText).catch(() => '');
    check(/Sancho IV/.test(first), 'address search lists the OpenStreetMap result first');
    await p.click('#placeRes .pr[data-i="0"]'); await p.waitForTimeout(3000);
    const st = await p.evaluate(() => ({ name: App.S.site.name, lat: App.S.site.lat, tiles: App.views.map.tilesOn, mode: App.views.map.mode, zoom: App.views.map.zoom }));
    check(/Sancho IV el Bravo 12, Tarifa/.test(st.name) && Math.abs(st.lat - 36.0135) < 1e-3, `site set to the address (${st.name})`);
    check(st.mode === 'flat' && st.zoom > 1000 && st.tiles, 'map zooms to street level with street tiles');
    check((hits['tile.openstreetmap.org'] || 0) > 0, 'OpenStreetMap street tiles requested');
    await p.evaluate(() => App.setTab('horizon')); await p.waitForTimeout(1500);
    const early = await p.evaluate(() => ({ state: BLD.state, n: BLD.list.length, verdict: document.querySelector('#hzVerdict').innerText }));
    check(early.n > 0 && /a building hides the sun/.test(early.verdict) && /\(60 m\)/.test(early.verdict), 'the tower shows from the first building tile, before the others arrive');
    const N = 2 ** 14, sx = Math.floor((-5.6046 + 180) / 360 * N), s0 = Math.sin(36.0135 * Math.PI / 180), sy = Math.floor((0.5 - Math.log((1 + s0) / (1 - s0)) / (4 * Math.PI)) * N);
    check(hits.tiles && hits.tiles[0][1] === sx && hits.tiles[0][2] === sy, `the tile under the site is requested first (${hits.tiles ? hits.tiles.length : 0} tiles)`);
    check(!hits.overpassN, 'no Overpass request needed');
    await p.waitForTimeout(12000);
    const t = await p.evaluate(() => ({ q: TS.quality(App.S.site.lat, App.S.site.lon), n: TS.loaded || 0 }));
    check(t.q === 'fine' && t.n > 0, `detailed terrain loaded from elevation tiles (${t.n} cells)`);
    const bl = await p.evaluate(() => ({ state: BLD.state, n: BLD.list.length, home: BLD.list.filter(b => b.home).length, verdict: document.querySelector('#hzVerdict').innerText }));
    check(bl.state === 'ready' && bl.n >= 4 && bl.home >= 1, `buildings loaded from vector tiles (${bl.n}, the one at the site ignored)`);
    check(/Blocked: a building hides the sun/.test(bl.verdict) && /60 m/.test(bl.verdict), 'verdict names the building that blocks the Sun');
    check(await p.evaluate(() => App.views.pano.bOn === true), 'buildings drawn in the panorama');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }

  console.log('Buildings when the tile service is down (Overpass fallback)');
  {
    const { p, ctx, hits, errors } = await page(browser, { url, tilesDown: true });
    await p.evaluate(() => { App.setSite(Object.assign(Calc.siteAt(36.0135, -5.6046), { name: 'Tarifa test' })); App.setTab('horizon'); });
    await p.waitForTimeout(1500);
    const early = await p.evaluate(() => ({ state: BLD.state, n: BLD.list.length, verdict: document.querySelector('#hzVerdict').innerText }));
    check(early.state === 'loading' && early.n > 0 && /Torre de prueba/.test(early.verdict), 'buildings toward the Sun show while the rest is still loading');
    const firstPoly = (hits.overpass || [''])[0].match(/poly:"([^"]+)"/), pts = firstPoly ? firstPoly[1].trim().split(/\s+/).map(Number) : [];
    let east = -1, west = 1; for (let i = 1; i < pts.length; i += 2) { east = Math.max(east, pts[i] + 5.6046); west = Math.min(west, pts[i] + 5.6046); }
    check(east > 0.0015 && west > -0.0002, 'the first Overpass request covers only the Sun\'s direction (east of the site)');
    await p.waitForTimeout(14000);
    const bl = await p.evaluate(() => ({ state: BLD.state, n: BLD.list.length, verdict: document.querySelector('#hzVerdict').innerText }));
    check(bl.state === 'ready' && bl.n === 4 && /Torre de prueba \(60 m\)/.test(bl.verdict), 'all buildings loaded from Overpass, the tower named');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }

  console.log('Inside claude.ai (bundled maps, download offer)');
  {
    const { p, ctx, errors } = await page(browser, { url, hosted: true, viewport: { width: 390, height: 844 } });
    check(await p.evaluate(() => globalThis.LIVE === false), 'live mode is off');
    await p.fill('#placeQ', 'Rue du Midi 5, Lausanne'); await p.waitForTimeout(2000);
    check(await p.$('#placeRes .pr-dl') !== null, 'address search offers the download for live search');
    await p.click('#placeRes .pr-dl'); await p.waitForTimeout(400);
    check(await p.$eval('#livePop', e => !e.hidden && /Download the app/.test(e.innerText)), 'download panel opens');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
