# pass 2: per 5-degree block -> per-cell zlib blobs for layers sm (main roads + towns) and sd (minor roads + hamlets)
import os, sys, gzip, pickle, json, zlib, collections, math, numpy as np, shapely
from multiprocessing import Pool
D = './'
A = set(json.load(open(D + 'data/cells_tierA.json'))); B = set(json.load(open(D + 'data/cells.json'))) | A
QI = 40000; QO = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
TOL = {'A_main': 0.00007, 'B_main': 0.00018, 'A_det': 0.00009}
B_MAIN_MAX = int(sys.argv[2]) if len(sys.argv) > 2 else 4      # highest class kept outside tier A
SM = [0, 1, 2, 3, 4, 9]; SD = [5, 6, 7, 8]
KIND = {'city': 0, 'town': 1, 'village': 2, 'hamlet': 3}
OUT = D + 'data/st/'
def vi(out, u):
    while u >= 0x80: out.append((u & 0x7f) | 0x80); u >>= 7
    out.append(u)
def zz(v): return (v << 1) ^ (v >> 63)
def dec(e):
    p = 0
    def rd():
        nonlocal p; v = 0; s = 0
        while True:
            b = e[p]; p += 1; v |= (b & 0x7f) << s; s += 7
            if not b & 0x80: break
        return (v >> 1) ^ -(v & 1)
    def ru():
        nonlocal p; v = 0; s = 0
        while True:
            b = e[p]; p += 1; v |= (b & 0x7f) << s; s += 7
            if not b & 0x80: break
        return v
    n = ru(); x = rd(); y = rd(); pts = [(x, y)]
    for _ in range(n - 1): x += rd(); y += rd(); pts.append((x, y))
    return np.array(pts, dtype=np.float64) / QI
def morton(x, y):
    x = int(x) & 0xffff; y = int(y) & 0xffff; r = 0
    for i in range(16): r |= ((x >> i) & 1) << (2 * i) | ((y >> i) & 1) << (2 * i + 1)
    return r
def encode_cell(groups, classes, places):
    names = {}; out = bytearray(); body = bytearray(); px = py = 0
    for c in classes:
        lines = groups.get(c, [])
        vi(body, len(lines))
        for nm, q in lines:
            ni = 0
            if nm:
                if nm not in names: names[nm] = len(names)
                ni = names[nm] + 1
            vi(body, ni); vi(body, len(q))
            vi(body, zz(int(q[0, 0]) - px)); vi(body, zz(int(q[0, 1]) - py))
            d = np.diff(q, axis=0)
            for dx, dy in d: vi(body, zz(int(dx))); vi(body, zz(int(dy)))
            px, py = int(q[-1, 0]), int(q[-1, 1])
    vi(body, len(places))
    for nm, x, y, k, pop in places:
        b = nm.encode(); vi(body, len(b)); body += b; vi(body, x); vi(body, y); body.append(k); vi(body, min(pop // 100, 200000))
    vi(out, len(names))
    for nm in names: b = nm.encode(); vi(out, len(b)); out += b
    return zlib.compress(bytes(out + body), 9)
PL = None
def load_places():
    global PL
    r = pickle.load(gzip.open('places.pkl.gz')); PL = collections.defaultdict(list)
    for nm, en, la, lo, cc, rg, sub, cls, pop, prom in r['rows']:
        if sub != 'locality' or cls not in KIND: continue
        key = f'{math.floor(la)},{math.floor(lo)}'
        if key in B: PL[key].append((en or nm, la, lo, KIND[cls], pop or 0))
def one(fn):
    rows = pickle.load(gzip.open('blk/' + fn))
    per = collections.defaultdict(lambda: collections.defaultdict(list))
    for key, c, nm, e in rows: per[key][(c, nm)].append(e)
    stats = collections.Counter()
    for key, gs in per.items():
        la, lo = map(int, key.split(',')); tA = key in A
        layers = {'sm': collections.defaultdict(list), 'sd': collections.defaultdict(list)}
        for (c, nm), es in gs.items():
            if not tA and c > B_MAIN_MAX: continue
            tol = TOL['A_main'] if (tA and c in SM) else TOL['B_main'] if c in SM else TOL['A_det']
            ml = shapely.line_merge(shapely.MultiLineString([dec(e) for e in es]))
            parts = list(ml.geoms) if hasattr(ml, 'geoms') else [ml]
            for g in parts:
                q = np.round(shapely.get_coordinates(shapely.simplify(g, tol * 0 + tol * 1, preserve_topology=False)) * QO).astype(np.int64)
                q = q[np.concatenate([[True], np.any(np.diff(q, axis=0) != 0, axis=1)])]
                if len(q) < 2: continue
                layers['sm' if c in SM else 'sd'][c].append((nm, q))
        for L in layers.values():
            for c in L: L[c].sort(key=lambda t: morton(t[1][0, 0] >> 2, t[1][0, 1] >> 2))
        pl = PL.get(key, [])
        sm_pl = [(n, int(round((x - lo) * QO)), int(round((y - la) * QO)), k, p) for n, y, x, k, p in pl if k <= 2]
        sd_pl = [(n, int(round((x - lo) * QO)), int(round((y - la) * QO)), k, p) for n, y, x, k, p in pl if k == 3] if tA else []
        for ln, cls, plc in (('sm', SM, sm_pl), ('sd', SD, sd_pl)):
            if ln == 'sd' and not tA: continue
            blob = encode_cell(layers[ln], cls, plc)
            os.makedirs(OUT + ln, exist_ok=True)
            open(OUT + f'{ln}/{la}_{lo}.bin', 'wb').write(blob); stats[ln] += len(blob)
    return stats
if __name__ == '__main__':
    load_places()
    fs = sorted(os.listdir('blk')); tot = collections.Counter()
    with Pool(4, initializer=load_places) as p:
        for i, s in enumerate(p.imap_unordered(one, fs)):
            tot.update(s)
            if i % 40 == 0: print(i, {k: round(v / 1e6, 1) for k, v in tot.items()}, flush=True)
    print('total MB', {k: round(v / 1e6, 1) for k, v in tot.items()})
