const P='./';
globalThis.Astronomy=require(P+'data/npm/node_modules/astronomy-engine'); require(P+'src/engine.js');
const fs=require('fs'); const cat=require(P+'data/catalog.json');
const npy=fs.readFileSync(P+'data/grid_0.1250.npy'); // float32 1440x2880 with header
const hdrLen=npy.readUInt16LE(8); const off=10+hdrLen; const W=2880,H=1440;
const elev=(lat,lon)=>{const i=Math.min(H-1,Math.max(0,Math.floor((90-lat)/0.125))), j=((Math.floor((lon+180)/0.125))%W+W)%W; return npy.readFloatLE(off+(i*W+j)*4);};
const from=Date.UTC(2026,9,1), to=Date.UTC(+process.argv[2]||2040,0,1), BUF=+(process.argv[3]||1.5);
const all=new Set(); const per=[];
for(const r of cat.solar){ if(r.t<from||r.t>to||!r.dur) continue; if(process.argv[5]&&!process.argv[5].includes(r.type)) continue;
  const an=Ecl.analyzeSolar(r.t); const p=an.path; const cells=new Set();
  for(let i=0;i<p.t.length;i++){ const la=p.lat[i], lo=p.lon[i]; const hw=(p.width[i]||200)/2/111+BUF;
    for(let a=Math.floor(la-hw);a<=Math.floor(la+hw);a++){ const cl=Math.max(0.15,Math.cos(a*Math.PI/180)); const hwl=hw/cl;
      for(let b=Math.floor(lo-hwl);b<=Math.floor(lo+hwl);b++){ const bb=((b+180)%360+360)%360-180; if(a<-90||a>=90) continue;
        // land check: any of 16 samples > 0
        let land=false; for(let u=0;u<4&&!land;u++)for(let v=0;v<4&&!land;v++) if(elev(a+0.125+u*0.25,bb+0.125+v*0.25)>-5) land=true;
        if(land) cells.add(a+','+bb); } } }
  per.push([new Date(r.t).toISOString().slice(0,10), r.type, cells.size]); cells.forEach(c=>all.add(c)); }
console.log(per.map(x=>x.join(' ')).join('\n')); console.log('total unique land cells', all.size);
fs.writeFileSync(process.argv[4], JSON.stringify([...all]));
