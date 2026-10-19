import os, struct, json, math, collections
B='./'
LAYERS=[('f240',240,4,10),('m60',60,4,20)]
man={'layers':[]}; files=0; tot=0; biggest=0
for name,res,q,blk in LAYERS:
    groups=collections.defaultdict(list)
    for f in os.listdir(B+'data/hr/'+name):
        la,lo=map(int,f[:-4].split('_'))
        bl=math.floor(la/blk)*blk; bo=math.floor(lo/blk)*blk
        nm=('N' if bl>=0 else 'S')+str(abs(bl)).zfill(2)+('E' if bo>=0 else 'W')+str(abs(bo)).zfill(3)
        groups[nm].append((la,lo,open(B+'data/hr/'+name+'/'+f,'rb').read()))
    os.makedirs(B+'dist/terrain/'+name,exist_ok=True)
    for nm,cells in groups.items():
        hdr=b'SAT1'+struct.pack('<HBBH',res,q,0,len(cells))
        off=len(hdr)+12*len(cells); idx=b''; body=b''
        for la,lo,data in cells:
            idx+=struct.pack('<hhII',la,lo,off+len(body),len(data)); body+=data
        blob=hdr+idx+body
        open(B+f'dist/terrain/{name}/{nm}.bin','wb').write(blob); files+=1; tot+=len(blob); biggest=max(biggest,len(blob))
    man['layers'].append({'name':name,'res':res,'q':q,'block':blk,'blocks':sorted(groups)})
    print(name,len(groups),'files')
json.dump(man,open(B+'data/terrain_manifest.json','w'),separators=(',',':'))
print('files',files,'total MB',tot/1e6,'biggest MB',biggest/1e6, 'manifest KB', os.path.getsize(B+'data/terrain_manifest.json')/1e3)
