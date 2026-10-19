# high-resolution 1x1 degree cells from Terrarium tiles
import numpy as np, math, os, sys, zlib, subprocess, concurrent.futures as cf
from PIL import Image
T='./tiles/'
def tile_xy(lat, lon, z):
    n=2**z; x=(lon+180)/360*n; lr=math.radians(max(-85.05,min(85.05,lat)))
    y=(1-math.log(math.tan(lr)+1/math.cos(lr))/math.pi)/2*n; return x,y
def fetch(z,x,y):
    d=f'{T}z{z}'; os.makedirs(d,exist_ok=True); f=f'{d}/{x}_{y}.png'
    def ok():
        if not os.path.exists(f) or os.path.getsize(f)<100: return False
        try:
            Image.open(f).verify(); return True
        except Exception: return False
    for attempt in range(4):
        if ok(): return f
        tmp=f'{f}.{os.getpid()}.{attempt}.tmp'
        subprocess.run(['curl','-s','-m','60','--retry','3','-o',tmp,f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'])
        if os.path.exists(tmp): os.replace(tmp,f)
    return f
def load(z,x,y):
    im=np.asarray(Image.open(fetch(z,x,y)).convert('RGB')).astype(np.float32)
    return im[...,0]*256+im[...,1]+im[...,2]/256-32768
def cell(lat0, lon0, res, z):
    # lat0, lon0: south-west corner (integers). returns (res+1)x(res+1) int16, row 0 = north edge
    n=2**z
    x0,y0=tile_xy(lat0+1,lon0,z); x1,y1=tile_xy(lat0,lon0+1,z)
    tx0,tx1=int(math.floor(x0)),int(math.floor(x1-1e-9)); ty0,ty1=int(math.floor(y0)),int(math.floor(y1-1e-9))
    tiles={}
    for tx in range(tx0,tx1+1):
        for ty in range(ty0,ty1+1): tiles[(tx,ty)]=None
    with cf.ThreadPoolExecutor(16) as ex:
        for k,f in zip(tiles, ex.map(lambda k: fetch(z,k[0]%n,k[1]), tiles)): pass
    mos=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256),np.float32)
    for (tx,ty) in tiles: mos[(ty-ty0)*256:(ty-ty0+1)*256,(tx-tx0)*256:(tx-tx0+1)*256]=load(z,tx%n,ty)
    lats=lat0+1-np.arange(res+1)/res; lons=lon0+np.arange(res+1)/res
    X=np.array([tile_xy(0,lo,z)[0] for lo in lons])-tx0; Y=np.array([tile_xy(la,0,z)[1] for la in lats])-ty0
    px=X*256-0.5; py=Y*256-0.5
    PX,PY=np.meshgrid(px,py)
    j0=np.clip(np.floor(PX).astype(int),0,mos.shape[1]-2); i0=np.clip(np.floor(PY).astype(int),0,mos.shape[0]-2)
    fx=np.clip(PX-j0,0,1); fy=np.clip(PY-i0,0,1)
    v=(mos[i0,j0]*(1-fx)+mos[i0,j0+1]*fx)*(1-fy)+(mos[i0+1,j0]*(1-fx)+mos[i0+1,j0+1]*fx)*fy
    return np.clip(np.round(v),-12000,9000).astype(np.int32)
def encode(q):
    a=np.zeros_like(q); b=np.zeros_like(q); c=np.zeros_like(q)
    a[:,1:]=q[:,:-1]; b[1:,:]=q[:-1,:]; c[1:,1:]=q[:-1,:-1]
    mx=np.maximum(a,b); mn=np.minimum(a,b)
    pred=np.where(c>=mx,mn,np.where(c<=mn,mx,a+b-c))
    r=(q-pred).ravel().astype(np.int64); z=((r<<1)^(r>>63)).astype(np.uint64)
    out=bytearray()
    for v in z.tolist():
        while v>=0x80: out.append((v&0x7f)|0x80); v>>=7
        out.append(v)
    return zlib.compress(bytes(out),9)
if __name__=='__main__':
    for (la,lo,name) in [(42,0,'Pyrenees'),(46,7,'Alps'),(31,-8,'Atlas'),(25,20,'Sahara'),(25,32,'Nile')]:
        for res,z in [(240,9),(120,8),(60,7)]:
            q=cell(la,lo,res,z)
            for qs in (1,4):
                b=encode(np.round(q/qs).astype(np.int32))
                print(name,res,'q',qs,len(b)//1024,'KB', q.min(), q.max())
