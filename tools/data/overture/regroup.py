# pass 1: regroup per-row-group pickles into per-5deg-block pickles
import os, gzip, pickle, collections
from multiprocessing import Pool
os.makedirs('blk', exist_ok=True)
def blk(key):
    la, lo = map(int, key.split(',')); return f'{(la // 5) * 5}_{(lo // 5) * 5}'
def one(fn):
    res = pickle.load(gzip.open('out_seg/' + fn)); out = collections.defaultdict(list)
    for r in res: out[blk(r[0])].append(r)
    return out
if __name__ == '__main__':
    fs = sorted(os.listdir('out_seg')); allb = collections.defaultdict(list)
    with Pool(4) as p:
        for out in p.imap_unordered(one, fs, chunksize=16):
            for k, v in out.items(): allb[k].extend(v)
    for k, v in allb.items(): pickle.dump(v, gzip.open(f'blk/{k}.pkl.gz', 'wb', compresslevel=2))
    print(len(allb), 'blocks', sum(len(v) for v in allb.values()), 'lines')
