# Worldwide street-map layer from Natural Earth (roads, urban areas, lakes, rivers, state lines) + towns from Overture.
import json, zlib, base64, gzip, pickle, os, collections
D = './'
NE = D + 'data/ne/'; Q = 2000
def vi(o, u):
    while u >= 0x80: o.append((u & 0x7f) | 0x80); u >>= 7
    o.append(u)
zz = lambda v: (v << 1) ^ (v >> 63)
def lines_of(geom):
    t = geom['type']; c = geom['coordinates']
    if t == 'LineString': return [c]
    if t == 'MultiLineString': return c
    if t == 'Polygon': return c
    if t == 'MultiPolygon': return [r for p in c for r in p]
    return []
import shapely
TOL = 0.0025
def enc_section(out, items):          # items: (cls, [[lon,lat],...])
    vi(out, len(items)); px = py = 0
    for cls, pts in items:
        if len(pts) > 2: pts = shapely.get_coordinates(shapely.simplify(shapely.LineString(pts), TOL, preserve_topology=False)).tolist()
        q = []
        for lon, lat in pts:
            p = (int(round((lon + 180) * Q)), int(round((lat + 90) * Q)))
            if not q or p != q[-1]: q.append(p)
        if len(q) < 2: q = q + q
        out.append(cls); vi(out, len(q))
        for x, y in q: vi(out, zz(x - px)); vi(out, zz(y - py)); px, py = x, y
def load(f): return json.load(open(NE + f + '.geojson'))['features']
roads = []
RC = {'Major Highway': 0, 'Beltway': 0, 'Bypass': 0, 'Secondary Highway': 1, 'Road': 2, 'Unknown': 2, 'Ferry Route': 3, 'Ferry, seasonal': 3}
for f in load('ne_10m_roads'):
    c = RC.get(f['properties'].get('type'))
    if c is None or not f['geometry']: continue
    for l in lines_of(f['geometry']): roads.append((c, l))
rivers = [(min(9, int(f['properties'].get('scalerank') or 9)), l) for f in load('ne_10m_rivers_lake_centerlines') if f['geometry'] for l in lines_of(f['geometry'])]
adm = [(0, l) for f in load('ne_10m_admin_1_states_provinces_lines') if f['geometry'] for l in lines_of(f['geometry'])]
lakes = [(0, l) for f in load('ne_10m_lakes') if f['geometry'] for l in lines_of(f['geometry'])]
urban = [(0, l) for f in load('ne_10m_urban_areas') if f['geometry'] for l in lines_of(f['geometry'])]
out = bytearray()
for sec in (roads, rivers, adm, lakes, urban): enc_section(out, sec)
# towns and cities worldwide for labels
r = pickle.load(gzip.open('places.pkl.gz'))
towns = [(en or nm, la, lo, 0 if cls == 'city' else 1, pop or 0) for nm, en, la, lo, cc, rg, sub, cls, pop, prom in r['rows'] if sub == 'locality' and cls in ('city', 'town')]
towns.sort(key=lambda t: -t[4])
z = zlib.compress(bytes(out), 9); b64 = base64.b64encode(z)
os.makedirs(D + 'dist/streets', exist_ok=True); open(D + 'dist/streets/world.txt', 'wb').write(b64); print('world b64 MB', len(b64) / 1e6)
out = bytearray()
vi(out, len(towns))
for nm, la, lo, k, pop in towns:
    b = nm.encode(); vi(out, len(b)); out += b; vi(out, int(round((la + 90) * 1000))); vi(out, int(round((lo + 180) * 1000))); out.append(k); vi(out, min(pop // 100, 10**6))
z = zlib.compress(bytes(out), 9); b64 = base64.b64encode(z)
os.makedirs(D + 'dist/streets', exist_ok=True); open(D + 'dist/streets/towns.txt', 'wb').write(b64)
print({'roads': len(roads), 'rivers': len(rivers), 'adm': len(adm), 'lakes': len(lakes), 'urban': len(urban), 'towns': len(towns)}, 'raw MB', len(out) / 1e6, 'b64 MB', len(b64) / 1e6)
