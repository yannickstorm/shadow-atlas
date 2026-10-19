// Builds Shadow Atlas into a folder:
//   node tools/build.js OUT_DIR
//   OUT_DIR/index.html          standalone page (GitHub Pages, or opened as a file): live maps, address search, terrain
//   OUT_DIR/shadow-atlas.html   the same file, fetched by the page's download button
//   OUT_DIR/artifact.html       body-only copy for a claude.ai artifact (uses the bundled map data)
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), OUT = path.resolve(process.argv[2] || 'dist');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const order = ['engine', 'data', 'terrain_hr', 'streets', 'places', 'calc', 'ui_util', 'charts', 'map', 'sky', 'pano', 'ui_main', 'ui_time', 'ui_earth', 'ui_sky', 'ui_horizon', 'ui_site', 'ui_charts', 'ui_plan'];
const ae = fs.readFileSync(path.join(ROOT, 'node_modules/astronomy-engine/astronomy.browser.min.js'), 'utf8');
const head = `<title>Shadow Atlas</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
${rd('src/style.css')}
body[data-layout="wide"] #inspCard { display: none; }
</style>
`;
const body = `${rd('src/shell.html')}
<script>window.__PACKED=${rd('data/packed.json')};window.__CATALOG=${rd('data/catalog.json')};window.__TERRAIN_MANIFEST=${rd('data/terrain_manifest.json')};window.__STREETS_MANIFEST=${rd('data/streets_manifest.json')};window.__PLACES_MANIFEST=${rd('data/places_manifest.json')};</script>
<script>/* Astronomy Engine (c) Don Cross, MIT licence */\n${ae}</script>
${order.map(m => `<script>/* ${m} */\n${rd('src/' + m + '.js')}</script>`).join('\n')}
<script>App.boot().catch(function(e){console.error(e);var l=document.getElementById('loading');if(l)l.innerHTML='<p>Could not start: '+String(e&&e.message||e)+'</p>';});</script>
`;
const full = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${head}</head><body>${body}</body></html>`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), full);
fs.writeFileSync(path.join(OUT, 'shadow-atlas.html'), full);
fs.writeFileSync(path.join(OUT, 'artifact.html'), head + body);
console.log(OUT + '/index.html', (full.length / 1e6).toFixed(2), 'MB');
