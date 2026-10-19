# Extract roads from Overture transportation segments for eclipse-path cells.
# Tier A cells (eclipses to end of 2028): all drivable roads, tracks, paths, rail. Tier B (to 2036): main roads.
# Output: one pickle.gz per row group: list of (cellkey, cls, name, bytes) with coords quantised to 1/40000 deg.
import sys, os, json, gzip, pickle, time, math, numpy as np, shapely, pyarrow.parquet as pq, pyarrow.compute as pc
from concurrent.futures import ProcessPoolExecutor as ThreadPoolExecutor, as_completed
from rr import RangeFile, BASE
D = './'
OUT = D + 'tools/ov/out_seg/'; os.makedirs(OUT, exist_ok=True)
A = set(json.load(open(D + 'data/cells_tierA.json'))); B = set(json.load(open(D + 'data/cells.json'))) | A
CLS = {'motorway': 0, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'unclassified': 5, 'residential': 6, 'living_street': 6, 'track': 7, 'path': 8}
RAIL = {'standard_gauge', 'narrow_gauge', 'unknown'}
Q = 40000
cells_ll = [tuple(map(int, c.split(','))) for c in B]
def hits(r):  # row group bbox [n, xmin, ymin, xmax, ymax] touches any wanted cell
    x0, y0, x1, y1 = math.floor(r[1]), math.floor(r[2]), math.floor(r[3]), math.floor(r[4])
    if (x1 - x0 + 1) * (y1 - y0 + 1) > 4000: return any(x0 <= lo <= x1 and y0 <= la <= y1 for la, lo in cells_ll)
    return any(f'{la},{lo}' in B for la in range(y0, y1 + 1) for lo in range(x0, x1 + 1))
idx = json.load(open('seg_index.json'))
jobs = [(fi, k, s, j) for fi, (k, s, rgs) in enumerate(idx) for j, r in enumerate(rgs) if hits(r)]
jobs = [j for j in jobs if not os.path.exists(OUT + f'{j[0]:03d}_{j[3]:03d}.pkl.gz')]
print('row groups to read', len(jobs), flush=True)
def zz(v): return (v << 1) ^ (v >> 63)
def enc(xy, la, lo):
    q = np.round((xy - [lo, la]) * Q).astype(np.int64)
    q = q[np.concatenate([[True], np.any(np.diff(q, axis=0) != 0, axis=1)])]
    if len(q) < 2: return None
    d = np.diff(q, axis=0); out = bytearray()
    def vi(u):
        while u >= 0x80: out.append((u & 0x7f) | 0x80); u >>= 7
        out.append(u)
    vi(len(q)); vi(zz(int(q[0, 0]))); vi(zz(int(q[0, 1])))
    for dx, dy in d: vi(zz(int(dx))); vi(zz(int(dy)))
    return bytes(out)
def one(job):
    fi, k, s, j = job
    for a in range(5):
        try:
            f = RangeFile(BASE + k, s); pf = pq.ParquetFile(f)
            t = pf.read_row_group(j, columns=['subtype', 'class', 'names.primary', 'geometry'])
            break
        except Exception as e:
            if a == 4: raise
            time.sleep(2 + a * 3)
    sub = t.column('subtype').to_pylist(); cls = t.column('class').to_pylist()
    keep = []
    for i, (s_, c) in enumerate(zip(sub, cls)):
        if s_ == 'road' and c in CLS: keep.append((i, CLS[c]))
        elif s_ == 'rail' and c in RAIL: keep.append((i, 9))
    res = []
    if keep:
        ii = np.array([x[0] for x in keep]); geo = t.column('geometry').take(ii).to_numpy(zero_copy_only=False)
        names = t.column('names').combine_chunks().field('primary').take(ii).to_pylist()
        g = shapely.from_wkb(geo)
        for (i, c), gg, nm in zip(keep, g, names):
            if gg is None or gg.geom_type != 'LineString': continue
            xy = shapely.get_coordinates(gg)
            la, lo = math.floor(xy[0, 1]), math.floor(xy[0, 0]); key = f'{la},{lo}'
            if key not in B: continue
            if key not in A and c > 4: continue
            tol = 0.00006 if key in A else 0.00012
            xy = shapely.get_coordinates(shapely.simplify(gg, tol, preserve_topology=False))
            e = enc(xy, la, lo)
            if e: res.append((key, c, nm if c <= 7 else None, e))
    with gzip.open(OUT + f'{fi:03d}_{j:03d}.pkl.gz.tmp', 'wb', compresslevel=3) as fh: pickle.dump(res, fh)
    os.replace(OUT + f'{fi:03d}_{j:03d}.pkl.gz.tmp', OUT + f'{fi:03d}_{j:03d}.pkl.gz')
    return len(res), f.bytes_read
if __name__ == '__main__':
    t0 = time.time(); done = 0; mb = 0; n = 0
    with ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(one, j) for j in jobs]
        for fu in as_completed(futs):
            try: c, b = fu.result()
            except Exception as e: print('ERR', e, flush=True); continue
            done += 1; mb += b / 1e6; n += c
            if done % 100 == 0: print(f'{done}/{len(jobs)} rg, {mb:.0f} MB, {n} lines, {time.time()-t0:.0f}s', flush=True)
    print('done', done, 'lines', n, 'MB', round(mb), 'secs', round(time.time() - t0), flush=True)
