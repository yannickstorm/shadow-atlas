import json, zlib, base64, math, struct, unicodedata
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
D='../data/'
out={}
def b64(b): return base64.b64encode(b).decode()
def zc(b): return zlib.compress(b,9)

# ---------- varint helpers
def zig(r): return ((r<<1)^(r>>31)).astype(np.uint32)
def varint(u):
    u=np.asarray(u,dtype=np.uint64).ravel()
    parts=[]
    chunks=[]
    cur=u.copy(); alive=np.ones(len(u),dtype=bool)
    rows=[]
    n=len(u)
    cnt=np.ones(n,dtype=np.int64)
    t=u>>7
    while True:
        m=t>0
        if not m.any(): break
        cnt+=m
        t=t>>7
    total=int(cnt.sum())
    res=np.empty(total,dtype=np.uint8)
    pos=np.concatenate([[0],np.cumsum(cnt)[:-1]])
    cur=u.copy()
    for k in range(int(cnt.max())):
        sel=cnt>k
        byte=(cur[sel]&0x7f).astype(np.uint8)
        more=cnt[sel]>k+1
        byte=np.where(more,byte|0x80,byte).astype(np.uint8)
        res[pos[sel]+k]=byte
        cur=cur>>7
    return res.tobytes()

# ---------- terrain
STEP=0.125; Q=10
g=np.load(D+'grid_0.1250.npy')
q=np.round(g/Q).astype(np.int32)
a=np.zeros_like(q); b=np.zeros_like(q); c=np.zeros_like(q)
a[:,1:]=q[:,:-1]; b[1:,:]=q[:-1,:]; c[1:,1:]=q[:-1,:-1]
mx=np.maximum(a,b); mn=np.minimum(a,b)
pred=np.where(c>=mx,mn,np.where(c<=mn,mx,a+b-c))
r=q-pred
raw=varint(zig(r))
blob=zc(raw)
out['terrain']={'w':q.shape[1],'h':q.shape[0],'q':Q,'step':STEP,'b64':b64(blob)}
print('terrain',len(blob)/1e6,'MB', q.min()*Q, q.max()*Q)

# ---------- borders
t=json.load(open(D+'npm/node_modules/world-atlas/countries-50m.json'))
sx,sy=t['transform']['scale']; tx,ty=t['transform']['translate']
arcs=[]
for arc in t['arcs']:
    x=y=0; pts=[]
    for dx,dy in arc:
        x+=dx; y+=dy
        pts.append((x*sx+tx,y*sy+ty))
    arcs.append(pts)
use=[0]*len(arcs)
def walk(ring_list):
    for ring in ring_list:
        for ai in ring:
            use[ai if ai>=0 else ~ai]+=1
for g_ in t['objects']['countries']['geometries']:
    if g_['type']=='Polygon': walk(g_['arcs'])
    elif g_['type']=='MultiPolygon':
        for poly in g_['arcs']: walk(poly)
def dp(pts,tol):
    if len(pts)<3: return pts
    keep=[False]*len(pts); keep[0]=keep[-1]=True
    stack=[(0,len(pts)-1)]
    while stack:
        i,j=stack.pop()
        x1,y1=pts[i]; x2,y2=pts[j]
        dx=x2-x1; dy=y2-y1; L=math.hypot(dx,dy)
        best=-1; bi=-1
        for k in range(i+1,j):
            px,py=pts[k]
            if L==0: d=math.hypot(px-x1,py-y1)
            else: d=abs(dy*(px-x1)-dx*(py-y1))/L
            if d>best: best=d; bi=k
        if best>tol:
            keep[bi]=True; stack.append((i,bi)); stack.append((bi,j))
    return [p for p,k in zip(pts,keep) if k]
U=0.005
def encode(lines):
    ints=[]
    for ln in lines:
        ln=dp(ln,0.012)
        if len(ln)<2: continue
        ints.append(len(ln)-2)  # >=0
        px=int(round(ln[0][0]/U)); py=int(round(ln[0][1]/U))
        ints.append(('abs',px,py))
        for x,y in ln[1:]:
            nx=int(round(x/U)); ny=int(round(y/U))
            ints.append(('d',nx-px,ny-py)); px,py=nx,ny
    # flatten
    arr=[]
    for it in ints:
        if isinstance(it,int): arr.append(it)
        else: arr.extend(it[1:])
    arr=np.array(arr,dtype=np.int64)
    return arr
# header ints: count then entries. First-point absolute coords are signed; everything signed -> zigzag. counts are non-negative but zigzag costs 1 bit, fine.
def pack_lines(lines):
    arr=encode(lines)
    z=zig(arr.astype(np.int32))
    n=len(lines)
    return zc(struct.pack('<I',n)+varint(z)), len(arr)
coast=[];border=[]
for i,a_ in enumerate(arcs):
    (border if use[i]>=2 else coast).append(a_)
print('arcs',len(coast),len(border))
cb,n1=pack_lines(coast); bb,n2=pack_lines(border)
out['coast']={'u':U,'b64':b64(cb)}; out['border']={'u':U,'b64':b64(bb)}
print('coast',len(cb)/1e3,'KB',n1,' border',len(bb)/1e3,'KB',n2)
# country labels: bbox centre of the biggest ring
labels=[]
def ring_pts(ring):
    pts=[]
    for ai in ring:
        a_=arcs[ai] if ai>=0 else arcs[~ai][::-1]
        pts.extend(a_ if not pts else a_[1:])
    return pts
def poly_area(pts):
    s=0
    for (x1,y1),(x2,y2) in zip(pts,pts[1:]): s+=x1*y2-x2*y1
    return s/2
for g_ in t['objects']['countries']['geometries']:
    name=g_['properties']['name']
    polys=[g_['arcs']] if g_['type']=='Polygon' else g_['arcs']
    best=None;ba=0
    for poly in polys:
        pts=ring_pts(poly[0]); a_=abs(poly_area(pts))
        if a_>ba: ba=a_;best=pts
    if best is None: continue
    xs=[p[0] for p in best]; ys=[p[1] for p in best]
    # centroid by area
    A=0;cx=0;cy=0
    for (x1,y1),(x2,y2) in zip(best,best[1:]):
        cr=x1*y2-x2*y1; A+=cr; cx+=(x1+x2)*cr; cy+=(y1+y2)*cr
    if A!=0: cx/=3*A; cy/=3*A
    else: cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2
    labels.append([name,round(cx,2),round(cy,2),round(ba,1)])
labels.sort(key=lambda r:-r[3])
out['countries']=[[n,x,y,a_] for n,x,y,a_ in labels]
print('labels',len(labels))

# ---------- cities
cm=[c for c in json.load(open(D+'npm/node_modules/city-timezones/data/cityMap.json')) if c.get('timezone') and c.get('country')]
cs=sorted({c['country'] for c in cm}); ci={c:i for i,c in enumerate(cs)}
zs=sorted({c['timezone'] for c in cm}); zi={z:i for i,z in enumerate(zs)}
prov=sorted({c['province'] or '' for c in cm}); pi={p:i for i,p in enumerate(prov)}
rows=[]
for c in cm:
    if not c.get('timezone'): continue
    asc=c['city_ascii'] if c['city_ascii']!=c['city'] else ''
    rows.append([c['city'],asc,ci[c['country']],round(c['lat'],2),round(c['lng'],2),zi[c['timezone']],int(round(c['pop']/1000)),pi[c['province'] or '']])
rows.sort(key=lambda r:-r[6])
cj=json.dumps({'c':cs,'z':zs,'p':prov,'r':rows},ensure_ascii=False,separators=(',',':')).encode()
out['cities']={'b64':b64(zc(cj))}
print('cities',len(rows),len(cj)/1e3,'KB raw',len(zc(cj))/1e3,'KB packed')

# ---------- stars
sj=json.load(open(D+'sky/stars.6.json'))
nm=json.load(open(D+'sky/starnames.json'))
stars=[]
for f in sj['features']:
    ra,dec=f['geometry']['coordinates']; ra%=360
    mag=f['properties']['mag']; bv=float(f['properties']['bv'] or 0.6) if f['properties']['bv']!='' else 0.6
    stars.append((mag,ra,dec,bv,f['id']))
stars.sort()
buf=bytearray()
named=[]
for i,(mag,ra,dec,bv,hid) in enumerate(stars):
    buf+=struct.pack('<HhbB',int(round(ra/360*65536))%65536,int(round(dec/90*32767)),int(round(mag*10)),int(round(max(-0.4,min(2.0,bv))*50+20)))
    info=nm.get(str(hid))
    if info and info.get('name') and mag<=2.7: named.append([i,info['name']])
    elif info and info.get('bayer') and mag<=2.2 : named.append([i,(info['bayer']+' '+info['c'])])
print('stars',len(stars),'named',len(named), [n for n in named][:20])
out['stars']={'n':len(stars),'b64':b64(zc(bytes(buf))),'names':named}
# constellations
cl=json.load(open(D+'sky/constellations.lines.json'))
lines={}
for f in cl['features']:
    segs=[]
    for seg in f['geometry']['coordinates']:
        segs.append([[round(p[0]%360,1),round(p[1],1)] for p in seg])
    lines[f['id']]=segs
cn=json.load(open(D+'sky/constellations.json'))
labs=[]
for f in cn['features']:
    p=f['properties']; x,y=f['geometry']['coordinates']
    labs.append([p['desig'],p['name'],round(x%360,1),round(y,1),int(p.get('rank',3))])
out['const']={'lines':lines,'labels':labs}
print('const',len(json.dumps(lines))/1e3,'KB')

# ---------- milky way raster (equatorial, 0.5 deg)
mw=json.load(open(D+'sky/milkyway.json'))
W,H=720,360
img=Image.new('F',(W,H),0)
def draw_poly(arr,coords,val):
    pts=[(((x%360)/360)*W,((90-y)/180)*H) for x,y in coords]
    # handle wrap: unwrap x continuous
    xs=[]; prev=None
    for x,y in coords:
        x%=360
        if prev is not None:
            while x-prev>180: x-=360
            while x-prev<-180: x+=360
        xs.append(x); prev=x
    for off in (-360,0,360):
        pp=[((x+off)/360*W,(90-y)/180*H) for x,(_,y) in zip(xs,coords)]
        if max(p[0] for p in pp)<0 or min(p[0] for p in pp)>W: continue
        arr.polygon(pp,fill=val)
im=Image.new('L',(W,H),0)
d=ImageDraw.Draw(im)
feats=mw['features']
# lowest level id ol1 outermost; add increments
acc=np.zeros((H,W),dtype=np.float32)
for f in feats:
    lvl=int(f['id'][2:]) if f['id'].startswith('ol') else 1
    layer=Image.new('L',(W,H),0); dl=ImageDraw.Draw(layer)
    geom=f['geometry']
    polys=geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        draw_poly(dl,poly[0],255)
        for hole in poly[1:]: draw_poly(dl,hole,0)
    acc+=np.asarray(layer,dtype=np.float32)/255.0
acc/= max(acc.max(),1)
imf=Image.fromarray((acc*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))
arrm=np.asarray(imf)
mm=(arrm.astype(np.float32)/max(arrm.max(),1)*255).astype(np.uint8)
out['milky']={'w':W,'h':H,'b64':b64(zc(mm.tobytes()))}
print('milky',len(out['milky']['b64'])/1e3,'KB b64')
imf.save('../data/milky_preview.png')

json.dump(out,open(D+'packed.json','w'),separators=(',',':'),ensure_ascii=False)
import os; print('packed.json',os.path.getsize(D+'packed.json')/1e6,'MB')
