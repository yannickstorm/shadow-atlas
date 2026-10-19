// builds data/catalog.json: raw catalog + countries crossed by the central track
const path='./';
const fs=require('fs');
const A = globalThis.Astronomy = require(path+'data/npm/node_modules/astronomy-engine');
require(path+'src/engine.js');
const E = globalThis.Ecl;
const topo=require(path+'data/npm/node_modules/world-atlas/countries-50m.json');
const tc=require(path+'data/npm/node_modules/topojson-client');
const fc=tc.feature(topo,topo.objects.countries);
const RENAME={'Dem. Rep. Congo':'DR Congo','Bosnia and Herz.':'Bosnia & Herzegovina','United States of America':'United States','Dominican Rep.':'Dominican Republic','Eq. Guinea':'Equatorial Guinea','S. Sudan':'South Sudan','Central African Rep.':'Central African Republic','W. Sahara':'Western Sahara','Solomon Is.':'Solomon Islands','Falkland Is.':'Falkland Islands','Fr. S. Antarctic Lands':'French Southern Lands','N. Cyprus':'Northern Cyprus','Cayman Is.':'Cayman Islands','Faeroe Is.':'Faroe Islands','Czechia':'Czechia','Macedonia':'North Macedonia','eSwatini':'Eswatini','Côte d\'Ivoire':'Ivory Coast','Turks and Caicos Is.':'Turks & Caicos','St. Pierre and Miquelon':'St Pierre & Miquelon','Heard I. and McDonald Is.':'Heard & McDonald Is.','S. Geo. and the Is.':'South Georgia','Br. Indian Ocean Ter.':'British Indian Ocean Terr.','U.S. Virgin Is.':'US Virgin Islands','N. Mariana Is.':'N. Mariana Islands','Marshall Is.':'Marshall Islands','Cook Is.':'Cook Islands','St. Kitts and Nevis':'St Kitts & Nevis','St. Vin. and Gren.':'St Vincent & Grenadines','Antigua and Barb.':'Antigua & Barbuda','Trinidad and Tobago':'Trinidad & Tobago','São Tomé and Principe':'São Tomé & Príncipe','Wallis and Futuna Is.':'Wallis & Futuna','Fr. Polynesia':'French Polynesia','Vatican':'Vatican City','Palestine':'Palestine'};
const countries=[];
for(const f of fc.features){
  const name=RENAME[f.properties.name]||f.properties.name;
  const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  const P=polys.map(rings=>{let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;for(const [x,y] of rings[0]){mnx=Math.min(mnx,x);mxx=Math.max(mxx,x);mny=Math.min(mny,y);mxy=Math.max(mxy,y);}return {rings,b:[mnx,mny,mxx,mxy]};});
  countries.push({name,P});
}
function inRing(x,y,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}return c;}
function countryAt(lon,lat){
  for(let ci=0;ci<countries.length;ci++){
    for(const p of countries[ci].P){
      const b=p.b; if(lon<b[0]||lon>b[2]||lat<b[1]||lat>b[3]) continue;
      if(!inRing(lon,lat,p.rings[0])) continue;
      let hole=false; for(let h=1;h<p.rings.length;h++) if(inRing(lon,lat,p.rings[h])){hole=true;break;}
      if(!hole) return ci;
    }
  }
  return -1;
}
function ocean(lat,lon){
  if(lat<-60) return 'Southern Ocean'; if(lat>70) return 'Arctic Ocean';
  if(lon>=-70&&lon<20) return 'Atlantic Ocean';
  if(lon>=20&&lon<=120) return lat>25?'Asia':'Indian Ocean';
  return 'Pacific Ocean';
}
const raw=require(path+'data/catalog_raw.json');
const names=[]; const nidx=new Map();
function ni(n){ if(!nidx.has(n)){nidx.set(n,names.length);names.push(n);} return nidx.get(n); }
let done=0;
for(const r of raw.solar){
  if(r.type==='P'||!r.dur) { // locate the greatest point only
    if(r.lat!==undefined){ const c=countryAt(r.lon,r.lat); r.at=c>=0?ni(countries[c].name):null; }
    continue;
  }
  const an=E.analyzeSolar(r.t);
  const seen=[]; const set=new Set();
  const pa=an.path;
  for(let i=0;i<pa.t.length;i++){
    const pts=[[pa.lon[i],pa.lat[i]]]; if(pa.nlat[i]!==null) pts.push([pa.nlon[i],pa.nlat[i]]); if(pa.slat[i]!==null) pts.push([pa.slon[i],pa.slat[i]]);
    for(const [lo,la] of pts){ const c=countryAt(lo,la); if(c>=0&&!set.has(c)){set.add(c);seen.push(c);} }
  }
  r.cn=seen.map(c=>ni(countries[c].name));
  r.oc=null;
  if(!seen.length){ r.oc=ocean(r.lat,r.lon); }
  r.at=null; { const c=countryAt(r.lon,r.lat); r.at=c>=0?ni(countries[c].name):null; }
  done++;
}
console.log('central done',done);
const out={names,solar:raw.solar,lunar:raw.lunar};
fs.writeFileSync(path+'data/catalog.json',JSON.stringify(out));
console.log('catalog.json',(fs.statSync(path+'data/catalog.json').size/1e3).toFixed(0),'KB');
for(const s of ['2024-04-08','2027-08-02','2026-08-12','2028-07-22','2030-06-01','2026-02-17','2027-02-06']){const r=raw.solar.find(r=>new Date(r.t).toISOString().startsWith(s));console.log(s,(r.cn||[]).map(i=>names[i]).join(', '),r.oc||'');}
