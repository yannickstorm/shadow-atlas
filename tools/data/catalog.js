const path='./';
const fs=require('fs');
const A = globalThis.Astronomy = require(path+'data/npm/node_modules/astronomy-engine');
require(path+'src/engine.js');
const E = globalThis.Ecl;
const OFF={solar:44,lunar:208};
const Y0=1900, Y1=2100;
const out={solar:[],lunar:[]};
let t0=Date.now();
let ev=A.SearchGlobalSolarEclipse(new A.AstroTime(new Date(Date.UTC(Y0,0,1))));
while(ev.peak.date.getUTCFullYear()<Y1+1){
  if(ev.peak.date.getUTCFullYear()>=Y1+1) break;
  const an=E.analyzeSolar(ev.peak.date.getTime());
  const r={t:Math.round(an.tGreatest/1000)*1000, type:an.type, gamma:+an.gamma.toFixed(4), mag:+an.magnitude.toFixed(4)};
  if(an.lat!==undefined){ r.lat=+an.lat.toFixed(2); r.lon=+an.lon.toFixed(2);}
  if(an.central){ r.dur=Math.round(an.duration); r.width=Math.round(an.width); r.alt=Math.round(an.sunAlt); r.durMax=Math.round(an.durationMax);}
  if(an.nonCentral) r.nc=1;
  r.saros=E.sarosNumber(an.tGreatest,'solar',OFF);
  r.p1=an.tP1?Math.round(an.tP1/1000)*1000:null; r.p4=an.tP4?Math.round(an.tP4/1000)*1000:null;
  out.solar.push(r);
  ev=A.NextGlobalSolarEclipse(ev.peak);
}
console.log('solar',out.solar.length,(Date.now()-t0)/1000,'s');
t0=Date.now();
let le=A.SearchLunarEclipse(new A.AstroTime(new Date(Date.UTC(Y0,0,1))));
while(le.peak.date.getUTCFullYear()<Y1+1){
  const an=E.analyzeLunar(le.peak.date.getTime());
  const r={t:Math.round(an.tGreatest/1000)*1000,type:an.type,umb:+an.umbralMag.toFixed(4),pen:+an.penumbralMag.toFixed(4),gamma:+an.gamma.toFixed(4),dTot:+an.durTotal.toFixed(1),dPar:+an.durPartial.toFixed(1),dPen:+an.durPenumbral.toFixed(1)};
  r.saros=E.sarosNumber(an.tGreatest,'lunar',OFF);
  r.aeKind=le.kind;
  out.lunar.push(r);
  le=A.NextLunarEclipse(le.peak);
}
console.log('lunar',out.lunar.length,(Date.now()-t0)/1000,'s');
fs.writeFileSync(path+'data/catalog_raw.json',JSON.stringify(out));
const types={};out.solar.forEach(r=>types[r.type]=(types[r.type]||0)+1);console.log(types);
const lt={};out.lunar.forEach(r=>lt[r.type+'/'+r.aeKind]=(lt[r.type+'/'+r.aeKind]||0)+1);console.log(lt);
const sr=out.solar.map(r=>r.saros);console.log('solar saros range',Math.min(...sr),Math.max(...sr));
const lr=out.lunar.map(r=>r.saros);console.log('lunar saros range',Math.min(...lr),Math.max(...lr));
console.log(out.solar.filter(r=>r.nc).length,'non-central');
console.log(out.solar.slice(120,125));
