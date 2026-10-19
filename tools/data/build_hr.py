import sys, os, json, numpy as np, math, struct
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import hr
B='./'
G=np.load(B+'data/grid_0.1250.npy')
def coarse(lat, lon):
    i=np.clip(((90-lat)/0.125).astype(int),0,G.shape[0]-1); j=(((lon+180)/0.125).astype(int))%G.shape[1]
    return G[i,j]
def work(args):
    layer, la, lo, res, z, q = args
    out=f'{B}data/hr/{layer}/{la}_{lo}.bin'
    if os.path.exists(out): return out
    try:
        v=hr.cell(la, lo, res, z).astype(np.float32)
        lats=la+1-np.arange(res+1)/res; lons=lo+np.arange(res+1)/res
        LO,LA=np.meshgrid(lons,lats)
        ocean=(v<0)&(coarse(LA,LO)<-30)
        v[ocean]=0; v=np.maximum(v,-500)
        qv=np.round(v/q).astype(np.int32)
        b=hr.encode(qv)
        os.makedirs(os.path.dirname(out),exist_ok=True)
        open(out,'wb').write(b); return out
    except Exception as e:
        return 'ERR %s %s %s'%(la,lo,e)
if __name__=='__main__':
    layer=sys.argv[1]
    cells=json.load(open(B+('data/landcells.json' if layer=='m60' else 'data/cells.json')))
    if layer!='m60': cells=[list(map(int,c.split(','))) for c in cells]
    res,z,q=(60,7,4) if layer=='m60' else (240,9,4)
    jobs=[(layer,la,lo,res,z,q) for la,lo in cells if la>=-60]
    n=0
    with ProcessPoolExecutor(6) as ex:
        for r in ex.map(work, jobs, chunksize=4):
            n+=1
            if r.startswith('ERR'): print(r, flush=True)
            if n%500==0: print(layer, n, '/', len(jobs), flush=True)
    print('done', layer, n)
