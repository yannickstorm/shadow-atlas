import numpy as np, json, math
g=np.load('../data/grid_0.1250.npy') if False else np.load('./data/grid_0.1250.npy')
H,W=g.shape
land=[]
for la in range(-60,90):
    for lo in range(-180,180):
        i0=int((90-(la+1))/0.125); i1=int((90-la)/0.125); j0=int((lo+180)/0.125); j1=j0+8
        blk=g[i0:i1, j0:j1]
        if (blk>-2).any(): land.append([la,lo])
print('global land cells (lat>-60):', len(land))
json.dump(land, open('./data/landcells.json','w'))
# tiles needed at z8
def txy(lat,lon,z):
    n=2**z; x=(lon+180)/360*n; lr=math.radians(max(-85.05,min(85.05,lat))); y=(1-math.log(math.tan(lr)+1/math.cos(lr))/math.pi)/2*n; return x,y
ts=set()
for la,lo in land:
    x0,y0=txy(la+1,lo,8); x1,y1=txy(la,lo+1,8)
    for x in range(int(x0),int(x1-1e-9)+1):
        for y in range(int(y0),int(y1-1e-9)+1): ts.add((x,y))
print('z8 tiles needed', len(ts))
