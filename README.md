# Shadow Atlas

An eclipse planner in one page: every solar and lunar eclipse from 1900 to 2100 on a globe and a street map, the sky
at your site minute by minute, a PeakFinder-style horizon view that shows whether mountains hide the Sun, and a
vantage-point finder that searches the terrain around you for a clear view of totality.

| Folder / file | What it is |
|---|---|
| `src/` | The app: eclipse engine (Besselian elements, local circumstances), map, sky, horizon panorama, UI |
| `data/` | Data built into the page: terrain grid, coasts, cities, stars, eclipse catalogue (`packed.json`, `catalog.json`) and the manifests of the map bundles used on claude.ai |
| `tools/build.js` | `node tools/build.js OUT_DIR` writes `index.html` (standalone), `shadow-atlas.html` (same file, for the download button) and `artifact.html` (claude.ai artifact body) |
| `tools/data/` | Scripts that made the data and the map bundles (Terrarium elevation, Overture Maps / OpenStreetMap roads and places, Natural Earth). They expect the raw downloads in `data/` |
| `tests/` | `node tests/test_app.js`: headless-Chrome tests (all 913 eclipses, every tab, live address search, street tiles, terrain and buildings, the claude.ai mode). Online services are replaced by the images in `tests/mock/` |

## Where it runs

- **Online:** GitHub Pages deploys `main` (`.github/workflows/pages.yml`); pull requests get a preview at `/pr-<number>/`.
  There the page runs in **live mode**: address search with OpenStreetMap (Nominatim, Photon as a fallback), street
  tiles everywhere (the OpenStreetMap standard map, darkened in the dark theme) and detailed terrain for any place (Terrarium elevation tiles). The Horizon view also loads the buildings within 500 m from OpenStreetMap (OpenFreeMap vector tiles, Overpass as a fallback) and shows when one hides the Sun or Moon; heights come from the height or floor tags, or are estimated from the building type.
- **Offline file:** each release carries `shadow-atlas.html`, the same single file. Open it in a browser, or put it on
  your own server (for example next to the plotter bridge). Live mode needs an internet connection.
- **claude.ai artifact:** claude.ai blocks online map services, so the artifact uses map data shipped next to the page:
  full street detail along the 2027 and 2028 totality paths, main roads along the other paths to 2036, major roads
  and towns elsewhere. Its map button offers the download of the live copy.

## Develop

```
npm install
npm run build        # -> _site/index.html
npm test             # needs Chrome or Chromium (set CHROME=/path/to/chrome if it is not found)
```

To publish a release, push a `v*` tag or run the Pages workflow with a release tag.

Map data © OpenStreetMap contributors (via Overture Maps and the OpenStreetMap tile servers), Natural Earth. Elevation: Terrarium tiles (AWS
Open Data). Astronomy Engine © Don Cross (MIT).
