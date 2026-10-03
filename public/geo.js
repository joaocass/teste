/* Malha oficial do IBGE → caminhos SVG. Substitui os contornos desenhados à mão
   (mapPaths.js, usado só como reserva se a malha não carregar).
   Também calcula, para cada UF, o ponto de rótulo (centro do maior círculo
   inscrito) e decide quais UFs são pequenas demais e ganham rótulo externo. */
const GEO_LABELS = {};   // uf -> {x,y,r}
const UF_BY_CODE = {11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'};

function dpSimplify(pts, tol){
  if(pts.length<4) return pts;
  const keep=new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const st=[[0,pts.length-1]];
  while(st.length){
    const [a,b]=st.pop(); let md=0, mi=-1;
    const [ax,ay]=pts[a], [bx,by]=pts[b], dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy||1e-9;
    for(let i=a+1;i<b;i++){
      let t=((pts[i][0]-ax)*dx+(pts[i][1]-ay)*dy)/L; t=Math.max(0,Math.min(1,t));
      const px=ax+t*dx-pts[i][0], py=ay+t*dy-pts[i][1], d=px*px+py*py;
      if(d>md){ md=d; mi=i; }
    }
    if(md>tol*tol){ keep[mi]=1; st.push([a,mi],[mi,b]); }
  }
  return pts.filter((_,i)=>keep[i]);
}
function ringArea(r){ let a=0; for(let i=0,j=r.length-1;i<r.length;j=i++) a+=(r[j][0]*r[i][1]-r[i][0]*r[j][1]); return a/2; }
function inRing(x,y,r){ let c=false; for(let i=0,j=r.length-1;i<r.length;j=i++){ if(((r[i][1]>y)!==(r[j][1]>y)) && x<(r[j][0]-r[i][0])*(y-r[i][1])/(r[j][1]-r[i][1])+r[i][0]) c=!c; } return c; }
function distRing(x,y,r){ let m=1e9; for(let i=0,j=r.length-1;i<r.length;j=i++){
  const ax=r[j][0], ay=r[j][1], dx=r[i][0]-ax, dy=r[i][1]-ay, L=dx*dx+dy*dy||1e-9;
  let t=((x-ax)*dx+(y-ay)*dy)/L; t=Math.max(0,Math.min(1,t));
  const px=ax+t*dx-x, py=ay+t*dy-y, d=px*px+py*py; if(d<m) m=d; } return Math.sqrt(m); }
/* Busca em grade refinada o ponto interno mais distante da borda (pólo de inacessibilidade). */
function labelPoint(ring){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; ring.forEach(p=>{ x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]); y0=Math.min(y0,p[1]); y1=Math.max(y1,p[1]); });
  let best={x:(x0+x1)/2,y:(y0+y1)/2,r:-1}, cx=best.x, cy=best.y, w=Math.max(x1-x0,y1-y0)/2;
  for(let it=0; it<5; it++){
    const n=14, step=2*w/n; let b=best;
    for(let i=0;i<=n;i++) for(let j=0;j<=n;j++){
      const x=cx-w+i*step, y=cy-w+j*step; if(!inRing(x,y,ring)) continue;
      const d=distRing(x,y,ring); if(d>b.r) b={x,y,r:d};
    }
    best=b; cx=b.x; cy=b.y; w=step*1.2;
  }
  return best;
}
function buildFromGeoJSON(gj){
  const S=12, lat0=-14*Math.PI/180, k=Math.cos(lat0);
  const proj=c=>[c[0]*k*S, -c[1]*S];
  const out={}, labels={};
  gj.features.forEach(f=>{
    const code=parseInt((f.properties&&(f.properties.codarea||f.properties.CD_UF||f.properties.id))||f.id,10), uf=UF_BY_CODE[code]; if(!uf) return;
    const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d='', main=null, mainA=0;
    polys.forEach(poly=>poly.forEach((ring,ri)=>{
      let pts=dpSimplify(ring.map(proj), .12); if(pts.length<4) return;
      d+='M'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join('L')+'Z';
      if(ri===0){ const a=Math.abs(ringArea(pts)); if(a>mainA){ mainA=a; main=pts; } }
    }));
    out[uf]=d; if(main) labels[uf]=labelPoint(main);
  });
  return {paths:out, labels};
}
async function loadGeoMap(){
  try{
    const r=await fetch('/api/geo'); if(!r.ok) throw new Error('HTTP '+r.status);
    const {paths,labels}=buildFromGeoJSON(await r.json());
    if(Object.keys(paths).length<27) throw new Error('malha incompleta');
    Object.keys(PATHS).forEach(k=>delete PATHS[k]); Object.assign(PATHS,paths); Object.assign(GEO_LABELS,labels);
    return true;
  }catch(e){ console.warn('Malha do IBGE indisponível, usando contornos locais:', e.message); return false; }
}
