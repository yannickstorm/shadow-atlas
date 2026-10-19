# Build a row-group bbox index for an Overture theme/type (footers only) -> json
import sys, json, pyarrow.parquet as pq
from concurrent.futures import ThreadPoolExecutor
from rr import RangeFile, list_keys, BASE
prefix, out = sys.argv[1], sys.argv[2]
keys = list_keys(prefix)
def one(ks):
    k, s = ks
    for a in range(4):
        try:
            md = pq.ParquetFile(RangeFile(BASE + k, s)).metadata
            break
        except Exception as e:
            if a == 3: raise
    rgs = []
    for j in range(md.num_row_groups):
        rg = md.row_group(j); d = {rg.column(i).path_in_schema: rg.column(i).statistics for i in range(rg.num_columns)}
        rgs.append([rg.num_rows, d['bbox.xmin'].min, d['bbox.ymin'].min, d['bbox.xmax'].max, d['bbox.ymax'].max])
    return [k, s, rgs]
with ThreadPoolExecutor(8) as ex: res = list(ex.map(one, keys))
json.dump(res, open(out, 'w'))
print(len(res), 'files', sum(len(r[2]) for r in res), 'row groups')
