# Overture divisions -> compact place table (pickle): name, en name, lat, lon, country, region, class, population, prominence
import pickle, gzip, collections, numpy as np, shapely, pyarrow.parquet as pq, pyarrow.compute as pc
from rr import RangeFile, list_keys, BASE
k, s = list_keys('release/2026-09-23.1/theme=divisions/type=division/')[0]
pf = pq.ParquetFile(RangeFile(BASE + k, s))
rows = []; regions = {}; countries = {}
for j in range(pf.metadata.num_row_groups):
    t = pf.read_row_group(j, columns=['subtype', 'class', 'names.primary', 'names.common', 'country', 'region', 'population', 'cartography.prominence', 'geometry'])
    sub = t.column('subtype').to_pylist(); cls = t.column('class').to_pylist()
    nm = t.column('names').combine_chunks()
    prim = nm.field('primary').to_pylist(); common = nm.field('common').to_pylist()
    cc = t.column('country').to_pylist(); rg = t.column('region').to_pylist(); pop = t.column('population').to_pylist()
    prom = t.column('cartography').combine_chunks().field('prominence').to_pylist()
    geo = shapely.from_wkb(t.column('geometry').to_numpy(zero_copy_only=False))
    xy = shapely.get_coordinates(shapely.centroid(geo))
    for i in range(len(sub)):
        en = None
        if common[i]:
            d = dict(common[i]); en = d.get('en')
        if sub[i] == 'region' and rg[i]: regions[rg[i]] = en or prim[i]
        if sub[i] == 'country' and cc[i]: countries[cc[i]] = en or prim[i]
        if sub[i] in ('locality', 'neighborhood', 'macrohood', 'localadmin') and prim[i]:
            rows.append((prim[i], en if en and en != prim[i] else None, round(float(xy[i, 1]), 5), round(float(xy[i, 0]), 5), cc[i], rg[i], sub[i], cls[i], pop[i] or 0, prom[i] or 0))
    if j % 32 == 0: print(j, len(rows), flush=True)
pickle.dump({'rows': rows, 'regions': regions, 'countries': countries}, gzip.open('places.pkl.gz', 'wb', compresslevel=4))
print('rows', len(rows), collections.Counter((r[6], r[7]) for r in rows).most_common(12))
