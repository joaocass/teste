let DATA = {};
let selectedUF = null;
let editingIndex = null;   // índice da pesquisa em edição (null = modo "adicionar nova")
let method = 'ponderada';   // 'ponderada' (credibilidade+recência) | 'simples' (média pura) | 'ajustada' (+ efeito de casa)
let scenario = 'base';      // 'base' | 'lula' (+margem de erro p/ Lula) | 'flavio' (+margem de erro p/ Flávio)
let mapMode = 'atual';      // 'atual' (intenção de voto) | 'variacao' (Δ p.p. vs 2022)
const ELECTION_DAY = '2026-10-25'; // 2º turno das eleições de 2026 — horizonte das projeções

/* ---------- Parâmetros do agregador estatístico -----------------------
   Valores usados pelos mesmos princípios que agregadores de pesquisa reais
   (FiveThirtyEight, RealClearPolitics, Split Ticket etc.) usam: ponderação
   por recência/credibilidade, correção de "efeito de casa" por instituto,
   e intervalo de confiança a partir da dispersão entre pesquisas. */
const STALE_DAYS_THRESHOLD = 45; // pesquisa mais recente do estado com mais dias que isso => "dado desatualizado"
const DECISIVE_MARGIN = 5;       // |Lula - Flávio| abaixo disso => "estado decisivo" (corrida apertada)
const Z95 = 1.96;                // valor crítico normal para intervalo de confiança de 95%
const FALLBACK_MOE = 3.0;        // margem de erro (p.p.) usada no cenário nos estados com 1 pesquisa só (sem dispersão calculável)
const SCN_LABEL = {base:'média das pesquisas', lula:'margem de erro a favor de Lula', flavio:'margem de erro a favor de Flávio'};
/* Regressão local (LOESS/LOWESS, Cleveland 1979 — en.wikipedia.org/wiki/Local_regression) */
const LOESS_SPAN = 0.6;          // fração dos pontos usada em cada ajuste local (0-1): menor = curva mais sensível
const LOESS_DEGREE = 1;          // grau do polinômio local: 1 (linear) ou 2 (quadrático)
const LOESS_ROBUST_ITERS = 2;    // iterações robustas (pesos bisquare) contra pontos fora da curva
/* Simulação de Monte Carlo (probabilidade de vitória) */
const MC_SIMS = 10000;
const MC_STATE_SD = 2.5;         // erro idiossincrático de cada estado (p.p., 1 desvio-padrão), além do erro-padrão entre pesquisas
const MC_REGION_SD = 1.5;        // choque comum a todos os estados de uma região
const MC_NATIONAL_SD = 2.0;      // choque nacional (todos os estados juntos): erro sistemático das pesquisas
const MC_DRIFT_PER_SQRT_DAY = 0.15; // incerteza extra por oscilação da opinião até a eleição (p.p. × √dias)
const MC_NOPOLL_SD = 7.0;        // estados sem pesquisa: centro = 2022, com incerteza alta
let HOUSE_EFFECTS = {};          // cache: {instituto: viés médio em p.p. frente ao consenso}, recalculado a cada refresh()

/* ---------- Decaimento por recência ----------------------------------
   Quanto mais antiga a pesquisa, menor o peso dela na média. Usamos uma
   meia-vida: a cada RECENCY_HALF_LIFE_DAYS dias, o peso da pesquisa cai
   pela metade. Um piso (RECENCY_FLOOR) evita que pesquisas muito antigas
   sejam descartadas por completo — elas ainda contam como um sinal fraco. */
const RECENCY_HALF_LIFE_DAYS = 120;
const RECENCY_FLOOR = 0.12;

function daysBetween(iso, ref) {
  const a = new Date(iso + 'T00:00:00');
  const b = ref || new Date();
  return Math.max(0, Math.round((b - a) / 86400000));
}
function recencyWeight(iso) {
  const d = daysBetween(iso, new Date());
  const w = Math.pow(0.5, d / RECENCY_HALF_LIFE_DAYS);
  return Math.max(RECENCY_FLOOR, w);
}

function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){ if(!d) return '—'; const [y,m,dd]=d.split('-'); return dd+'/'+m+'/'+y; }
function fmtPP(v){
  const sign = v > 0.05 ? '+' : (v < -0.05 ? '' : '±');
  return sign + v.toFixed(1) + ' p.p.';
}
/* ---------- Ícones (sprite SVG único, ver index.html) ------------------- */
function icon(name, cls){ return '<svg class="icon'+(cls?(' '+cls):'')+'" aria-hidden="true" focusable="false"><use href="#i-'+name+'"></use></svg>'; }
function trendIcon(dir){ return icon(dir==='up'?'trend-up':dir==='down'?'trend-down':'trend-flat','filled'); }
function signalIcon(tier){
  const bars = tier==='alta'?3 : tier==='moderada'?2 : 1;
  const rects = [
    '<rect x="3" y="14" width="4" height="7" rx="1"/>',
    '<rect x="10" y="9" width="4" height="12" rx="1"/>',
    '<rect x="17" y="3" width="4" height="18" rx="1"/>'
  ].map((r,i)=> i<bars ? r : r.replace('/>',' class="dim"/>')).join('');
  return '<svg class="icon signal" aria-hidden="true" viewBox="0 0 24 24">'+rects+'</svg>';
}
function ppClass(v){ return v > 0.05 ? 'up' : (v < -0.05 ? 'down' : 'flat'); }
function ppArrow(v){ return trendIcon(v > 0.05 ? 'up' : (v < -0.05 ? 'down' : 'flat')); }

function setSync(state, msg){
  const b=document.getElementById('syncBadge'), l=document.getElementById('syncLabel');
  b.classList.remove('on','err');
  if(state==='on'){ b.classList.add('on'); l.textContent='Sincronizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
  else if(state==='err'){ b.classList.add('err'); l.textContent=msg||'Erro de conexão'; }
  else { l.textContent='Conectando ao MongoDB…'; }
}

async function fetchStates(){
  const res = await fetch('/api/states');
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
/* ---------- Autenticação ------------------------------------------------
   O token fica só em memória (variável abaixo): F5, nova aba ou outro
   dispositivo = pede a senha de novo. Dentro da mesma página, só na 1ª ação. */
let authToken = null;
function setAuthUI(){ const b=document.getElementById('lockBtn'); if(b) b.hidden=!authToken; }
function askPassword(msg){
  return new Promise(resolve=>{
    const ov=document.createElement('div'); ov.className='modal-overlay'; ov.style.zIndex=80;
    ov.innerHTML='<div class="modal" role="dialog" aria-modal="true" aria-labelledby="authTitle" style="width:min(400px,100%)">'+
      '<div class="modal-head"><h3 id="authTitle">Acesso restrito</h3></div>'+
      '<p style="margin:0 0 16px;font-size:14px;line-height:20px;color:var(--on-var)">'+(msg||'Digite a senha para adicionar, editar ou apagar pesquisas.')+'</p>'+
      '<div id="authForm"><label for="authPw">Senha</label><input id="authPw" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200"></div>'+
      '<p id="authErr" role="alert" style="min-height:20px;margin:8px 0 0;font-size:13px;color:var(--lula,#b3261e)"></p>'+
      '<div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button id="authCancel" type="button" class="ghostbtn">Cancelar</button><button id="authOk" type="button" class="primarybtn">Entrar</button></div></div>';
    document.body.appendChild(ov);
    const pw=ov.querySelector('#authPw'), err=ov.querySelector('#authErr'), ok=ov.querySelector('#authOk');
    const done=v=>{ ov.remove(); resolve(v); };
    const submit=async ()=>{
      if(!pw.value) { pw.focus(); return; }
      ok.disabled=true; ok.textContent='Verificando…'; err.textContent='';
      try{
        const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw.value})});
        const j=await r.json().catch(()=>({}));
        pw.value='';
        if(r.ok && j.token){ authToken=j.token; setAuthUI(); return done(true); }
        err.textContent=j.error||'Não foi possível entrar.';
      }catch(e){ err.textContent='Sem conexão com o servidor.'; }
      ok.disabled=false; ok.textContent='Entrar'; pw.focus();
    };
    ok.addEventListener('click',submit);
    ov.querySelector('#authCancel').addEventListener('click',()=>done(false));
    ov.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } else if(e.key==='Escape') done(false); });
    pw.focus();
  });
}
async function ensureAuth(){ return authToken ? true : askPassword(); }
async function authFetch(url, opts){
  opts = opts || {};
  for(let attempt=0; attempt<2; attempt++){
    if(!authToken && !(await askPassword())) throw new Error('operação cancelada');
    const res = await fetch(url, {...opts, headers:{...(opts.headers||{}), 'Authorization':'Bearer '+authToken}});
    if(res.status===401){ authToken=null; setAuthUI(); if(attempt===0) continue; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }
  throw new Error('não autorizado');
}
const JSON_H = {'Content-Type':'application/json'};
function addPoll(uf, poll){ return authFetch('/api/states/'+uf+'/polls', {method:'POST', headers:JSON_H, body:JSON.stringify(poll)}); }
function editPoll(uf, index, poll){ return authFetch('/api/states/'+uf+'/polls/'+index, {method:'PUT', headers:JSON_H, body:JSON.stringify(poll)}); }
function removePoll(uf, index){ return authFetch('/api/states/'+uf+'/polls/'+index, {method:'DELETE'}); }
function resetAll(){ return authFetch('/api/reset', {method:'POST'}); }

/* ---------- Efeito de casa (house effects) -----------------------------
   Técnica padrão de agregadores de pesquisa (FiveThirtyEight, Split
   Ticket, RealClearPolitics): para cada pesquisa de um instituto num
   estado, compara-se o resultado dela com a média ponderada das
   pesquisas de TODOS OS OUTROS institutos naquele mesmo estado. A
   diferença média (ponderada por credibilidade × recência) é o "viés de
   casa" do instituto — o quanto ele tende a ficar sistematicamente acima
   ou abaixo do consenso. Só é calculável quando há pelo menos 2
   institutos diferentes pesquisando o mesmo estado. */
function houseEffects(){
  const acc = {}; // instituto -> {sumW, sumDevW}
  for(const uf in DATA){
    const polls = ((DATA[uf] && DATA[uf].polls) || []).filter(p=>p.date);
    if(polls.length < 2) continue;
    polls.forEach(p=>{
      const others = polls.filter(o=>o.inst!==p.inst);
      if(!others.length) return; // instituto sozinho no estado: sem consenso alheio pra comparar
      let sw=0, sl=0;
      others.forEach(o=>{ const w=o.cred*recencyWeight(o.date); sw+=w; sl+=o.lula*w; });
      if(!sw) return;
      const otherAvg = sl/sw;
      const w = p.cred*recencyWeight(p.date);
      const a = acc[p.inst] || (acc[p.inst]={sumW:0,sumDevW:0,n:0});
      a.sumW += w; a.sumDevW += (p.lula-otherAvg)*w; a.n++;
    });
  }
  const out = {};
  for(const inst in acc){ out[inst] = acc[inst].sumW ? acc[inst].sumDevW/acc[inst].sumW : 0; }
  return out;
}

/* ---------- Médias por estado ---------- */
function stateAvgBase(uf){
  const polls = (DATA[uf] && DATA[uf].polls) || [];
  if(!polls.length) return {lula:50, opp:50, has:false, effN:0};
  if(method==='simples'){
    const l = polls.reduce((a,p)=>a+p.lula,0)/polls.length;
    return {lula:l, opp:100-l, has:true, effN:polls.length};
  }
  let sumW=0, sumL=0;
  polls.forEach(p=>{
    const rw = p.date ? recencyWeight(p.date) : 1;
    const w = p.cred * rw;
    let val = p.lula;
    if(method==='ajustada') val -= (HOUSE_EFFECTS[p.inst] || 0); // remove o viés sistemático do instituto
    sumW += w; sumL += val * w;
  });
  const l = sumW ? clampPct(sumL/sumW) : 50;
  return {lula:l, opp:100-l, has:true, effN: polls.length};
}

/* Margem de erro prevista do estado (IC95% entre pesquisas); fallback quando só há 1 pesquisa. */
function scenarioMoe(uf){ const d = stateDispersion(uf); return d.moe!==null ? d.moe : FALLBACK_MOE; }
function scenarioShift(uf){ return scenario==='lula' ? scenarioMoe(uf) : scenario==='flavio' ? -scenarioMoe(uf) : 0; }
/* Média do estado já sob o cenário escolhido: soma/subtrai a margem de erro de CADA estado. */
function stateAvg(uf){
  const a = stateAvgBase(uf);
  if(!a.has || scenario==='base') return a;
  const l = clampPct(a.lula + scenarioShift(uf));
  return {...a, lula:l, opp:100-l};
}

/* ---------- Dispersão, intervalo de confiança e "confiança da amostra" -
   Sem acesso ao tamanho amostral de cada pesquisa, a forma honesta de
   estimar incerteza é tratar cada pesquisa do estado como um ponto de uma
   meta-amostra (a mesma lógica de meta-análise de efeitos aleatórios):
   calcula-se o desvio-padrão ponderado das pesquisas em torno da média do
   estado, e o erro-padrão da média é esse desvio dividido pela raiz do
   número de pesquisas. O IC95% = ±1,96×erro-padrão. Isso é uma medida de
   QUANTO AS PESQUISAS DISCORDAM ENTRE SI, não de erro amostral de uma
   pesquisa individual — mas é exatamente o que um agregador consegue
   estimar a partir dos dados que tem. */
function stateDispersion(uf){
  const polls = ((DATA[uf] && DATA[uf].polls) || []);
  const n = polls.length;
  if(n===0) return {n:0, tier:'sem-dados', divergence:null, moe:null, stdDev:null};
  if(n===1) return {n:1, tier:'preliminar', divergence:0, moe:null, stdDev:null};
  const vals = polls.map(p=>p.lula);
  const divergence = Math.max(...vals) - Math.min(...vals);
  const avg = stateAvgBase(uf).lula;
  let sumW=0, sumWD=0;
  polls.forEach(p=>{
    const w = p.cred*(p.date?recencyWeight(p.date):1);
    sumW += w; sumWD += w*(p.lula-avg)*(p.lula-avg);
  });
  const variance = sumW ? sumWD/sumW : 0;
  const stdDev = Math.sqrt(variance);
  const sem = stdDev / Math.sqrt(n);
  const moe = Z95 * sem;
  const tier = n>=8 ? 'alta' : n>=4 ? 'moderada' : 'baixa';
  return {n, tier, divergence, moe, stdDev};
}
const TIER_LABEL = {'sem-dados':'Sem pesquisas','preliminar':'Dado preliminar (1 pesquisa)','baixa':'Confiança baixa','moderada':'Confiança moderada','alta':'Confiança alta'};

/* ---------- Tendência simples: primeira pesquisa cadastrada do estado
   frente à mais recente (independente da regressão usada na projeção
   nacional — aqui é só um "de onde veio, pra onde foi"). */
function stateTrendSimple(uf){
  const polls = statePollsSorted(uf);
  if(polls.length < 2) return null;
  const from = polls[0], to = polls[polls.length-1];
  const delta = to.lula - from.lula;
  return {delta, from, to, dir: delta>0.5?'up':delta<-0.5?'down':'flat'};
}

/* ---------- Selo de dado desatualizado ---------- */
function stateStale(uf){
  const polls = statePollsSorted(uf);
  if(!polls.length) return {stale:false, days:null};
  const last = polls[polls.length-1].date;
  const days = daysBetween(last, new Date());
  return {stale: days > STALE_DAYS_THRESHOLD, days, lastDate:last};
}
/* Variação em pontos percentuais de Lula frente ao resultado oficial de 2022 do estado. */
function stateDelta(uf){
  const base = BASELINE_2022[uf];
  const avg = stateAvg(uf);
  if(!base || !avg.has) return null;
  return avg.lula - base.lula;
}

function mix(hexA,hexB,t){
  const a=hexA.match(/\w\w/g).map(x=>parseInt(x,16));
  const b=hexB.match(/\w\w/g).map(x=>parseInt(x,16));
  const c=a.map((v,i)=>Math.round(v+(b[i]-v)*t));
  return '#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');
}
function colorFor(lula){
  const margin=lula-50;
  const t=Math.max(-1,Math.min(1,margin/25));
  return t>=0 ? mix('#eceff1','#b3261e',t) : mix('#eceff1','#0b57d0',-t);
}
function colorForDelta(delta){
  // Escala divergente: verde = Lula avançou vs 2022, dourado = recuou.
  const t = Math.max(-1, Math.min(1, delta/12));
  return t>=0 ? mix('#eceff1','#146c2e',t) : mix('#eceff1','#b26a00',-t);
}

/* ---------- Curva suave (Catmull-Rom -> Bézier cúbica) -----------------
   Conecta os mesmos pontos de dados com curvas em vez de segmentos retos
   — o traço fica bem mais legível quando há muitos pontos, no mesmo
   estilo usado por agregadores de pesquisa profissionais (Economist,
   FiveThirtyEight etc.), sem inventar nenhum valor: a curva ainda passa
   exatamente por cada ponto real. Com 1-2 pontos cai para reta simples. */
function smoothLinePath(pts){
  const n = pts.length;
  if(n===0) return '';
  if(n===1) return 'M'+pts[0].x.toFixed(1)+','+pts[0].y.toFixed(1);
  if(n===2) return 'M'+pts[0].x.toFixed(1)+','+pts[0].y.toFixed(1)+' L'+pts[1].x.toFixed(1)+','+pts[1].y.toFixed(1);
  let d = 'M'+pts[0].x.toFixed(1)+','+pts[0].y.toFixed(1)+' ';
  for(let i=0;i<n-1;i++){
    const p0 = pts[i===0?0:i-1], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2<n?i+2:n-1];
    const c1x = p1.x + (p2.x - p0.x)/6, c1y = p1.y + (p2.y - p0.y)/6;
    const c2x = p2.x - (p3.x - p1.x)/6, c2y = p2.y - (p3.y - p1.y)/6;
    d += 'C'+c1x.toFixed(1)+','+c1y.toFixed(1)+' '+c2x.toFixed(1)+','+c2y.toFixed(1)+' '+p2.x.toFixed(1)+','+p2.y.toFixed(1)+' ';
  }
  return d;
}
/* Mesma spline, mas fechando no eixo da base para servir de área preenchida. */
function smoothAreaPath(pts, baseY){
  if(!pts.length) return '';
  const line = smoothLinePath(pts);
  const first = pts[0], last = pts[pts.length-1];
  return line+' L'+last.x.toFixed(1)+','+baseY+' L'+first.x.toFixed(1)+','+baseY+' Z';
}

/* ---------- Exportação de gráficos SVG como PNG -------------------------
   Não depende de nenhuma lib externa: clona o SVG, "achata" o estilo de
   cada elemento (resolve as variáveis CSS/():root para a cor final que
   está sendo exibida na tela, via getComputedStyle) para que o desenho
   fique idêntico mesmo fora do documento, desenha num <canvas> em alta
   resolução (2.5x) com título/subtítulo/legenda no estilo de um relatório
   de agregador de pesquisas, e dispara o download. */
/* Vírgula decimal (pt-BR) em todo texto visível: troca "62.5" por "62,5" (1–2 casas; "10.000" fica intacto). */
const _decRe=/(\d)\.(\d{1,2})(?!\d)/g; let _decQ=false;
function localizeDecimals(){
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>/^(script|style|textarea)$/i.test(n.parentNode.nodeName)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let n; while((n=w.nextNode())){ const t=n.nodeValue.replace(_decRe,'$1,$2'); if(t!==n.nodeValue) n.nodeValue=t; }
}
new MutationObserver(()=>{ if(_decQ) return; _decQ=true; requestAnimationFrame(()=>{ _decQ=false; localizeDecimals(); }); }).observe(document.body,{childList:true,subtree:true,characterData:true});
const EXPORT_STYLE_PROPS = ['fill','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','stroke-opacity','fill-opacity','opacity','font-family','font-size','font-weight','font-style','text-anchor','letter-spacing','paint-order','dominant-baseline'];
function inlineComputedStyles(srcEl, dstEl){
  if(srcEl.nodeType===1){
    const cs = getComputedStyle(srcEl);
    let style='';
    EXPORT_STYLE_PROPS.forEach(p=>{ const v=cs.getPropertyValue(p); if(v) style += p+':'+v+';'; });
    if(style) dstEl.setAttribute('style', style);
  }
  const a = srcEl.children, b = dstEl.children;
  for(let i=0;i<a.length;i++) inlineComputedStyles(a[i], b[i]);
}
function svgToImage(svgEl, vb, bg){
  const clone = svgEl.cloneNode(true);
  inlineComputedStyles(svgEl, clone);
  clone.querySelectorAll('#timeHoverLayer,[data-hover]').forEach(n=>n.remove());
  clone.removeAttribute('class');
  clone.setAttribute('viewBox', vb.join(' '));
  clone.setAttribute('width', vb[2]); clone.setAttribute('height', vb[3]);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
  r.setAttribute('x',vb[0]); r.setAttribute('y',vb[1]); r.setAttribute('width',vb[2]); r.setAttribute('height',vb[3]); r.setAttribute('fill',bg);
  clone.insertBefore(r, clone.firstChild);
  const uri = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(clone));
  return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=uri; });
}
function layoutLines(ctx, text, maxW){
  const out=[]; let line='';
  (text||'').split(' ').forEach(w=>{ const t=line?line+' '+w:w; if(ctx.measureText(t).width>maxW && line){ out.push(line); line=w; } else line=t; });
  if(line) out.push(line); return out;
}
/* Exporta o SVG como PNG sem cortes: o recorte é a união do viewBox com o
   getBBox() real do conteúdo (+margem), e a tela de saída se ajusta ao
   tamanho do título, subtítulo (quebra de linha automática) e legenda. */
async function exportChartPNG(svgId, filename, opts){
  opts = opts || {};
  opts.subtitle = (opts.subtitle||'').replace(_decRe,'$1,$2');
  const svgEl = document.getElementById(svgId); if(!svgEl) return;
  const btn = opts.button, label = btn ? btn.innerHTML : null;
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Gerando…'; }
    let [x0,y0,w0,h0] = (svgEl.getAttribute('viewBox')||'0 0 800 400').trim().split(/\s+/).map(Number);
    let x1=x0+w0, y1=y0+h0;
    try{ const b=svgEl.getBBox(); if(b.width>0 && b.height>0){ x0=Math.min(x0,b.x-10); y0=Math.min(y0,b.y-10); x1=Math.max(x1,b.x+b.width+10); y1=Math.max(y1,b.y+b.height+10); } }catch(e){}
    const vb=[x0,y0,x1-x0,y1-y0], bg=opts.bg||'#ffffff', scale=opts.scale||3, M=28;
    const W=Math.max(Math.ceil(vb[2])+2*M, 820), FONT='Roboto, Arial, sans-serif';
    const m=document.createElement('canvas').getContext('2d');
    m.font='400 13px '+FONT; const sub=opts.subtitle ? layoutLines(m,opts.subtitle,W-2*M) : [];
    m.font='500 12px '+FONT;
    const rows=[]; let row=[], rx=0;
    (opts.legend||[]).forEach(it=>{ const iw=26+m.measureText(it.label).width+24; if(rx+iw>W-2*M && row.length){ rows.push(row); row=[]; rx=0; } row.push({...it,x:rx}); rx+=iw; });
    if(row.length) rows.push(row);
    const headH = opts.title ? 28+26+sub.length*19+14 : 0, legH = rows.length*26+(rows.length?16:0), footH=40, imgH=Math.ceil(vb[3])+32;
    const H = headH+imgH+legH+footH;
    const img = await svgToImage(svgEl, vb, bg);
    const cv=document.createElement('canvas'); cv.width=Math.round(W*scale); cv.height=Math.round(H*scale);
    const ctx=cv.getContext('2d'); ctx.scale(scale,scale); ctx.fillStyle=bg; ctx.fillRect(0,0,W,H); ctx.textBaseline='top';
    if(opts.title){
      ctx.fillStyle='#202124'; ctx.font='500 20px '+FONT; ctx.fillText(opts.title,M,24);
      ctx.fillStyle='#5f6368'; ctx.font='400 13px '+FONT; sub.forEach((l,i)=>ctx.fillText(l,M,54+i*19));
      ctx.strokeStyle='#dadce0'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,headH-.5); ctx.lineTo(W,headH-.5); ctx.stroke();
    }
    ctx.drawImage(img,(W-vb[2])/2,headH+16,vb[2],vb[3]);
    let y=headH+imgH+8; ctx.font='500 12px '+FONT; ctx.textBaseline='middle';
    rows.forEach(r=>{ r.forEach(it=>{ ctx.fillStyle=it.color; ctx.beginPath(); ctx.arc(M+it.x+6,y+9,6,0,7); ctx.fill(); ctx.fillStyle='#202124'; ctx.fillText(it.label,M+it.x+20,y+9); }); y+=26; });
    ctx.strokeStyle='#dadce0'; ctx.beginPath(); ctx.moveTo(0,H-footH+.5); ctx.lineTo(W,H-footH+.5); ctx.stroke();
    ctx.fillStyle='#80868b'; ctx.font='400 11px '+FONT; ctx.fillText(opts.watermark||'Painel independente de acompanhamento eleitoral · não oficial · gerado em '+fmtDate(todayISO()),M,H-footH/2);
    const a=document.createElement('a'); a.href=cv.toDataURL('image/png'); a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    toast('Imagem salva: '+filename);
  }catch(err){ console.error(err); toast('Não foi possível gerar o PNG: '+err.message,'err'); }
  finally{ if(btn){ btn.disabled=false; btn.innerHTML=label; } }
}
let _toastT;
function toast(msg,kind){ const el=document.getElementById('toast'); if(!el) return; el.textContent=msg; el.className='show '+(kind||''); clearTimeout(_toastT); _toastT=setTimeout(()=>{ el.className=''; },3400); }
function toastUndo(msg, poll, uf){
  const el=document.getElementById('toast'); if(!el||!poll) return toast(msg);
  el.textContent=msg+' '; const b=document.createElement('button'); b.type='button'; b.className='undo'; b.textContent='Desfazer'; el.appendChild(b);
  el.className='show'; clearTimeout(_toastT); _toastT=setTimeout(()=>{ el.className=''; },8000);
  b.addEventListener('click', async ()=>{ el.className=''; try{ const {inst,date,lula,opp,cred}=poll; await addPoll(uf,{inst,date,lula,opp,cred}); await refresh(); toast('Pesquisa restaurada.'); }catch(err){ toast('Não foi possível desfazer: '+err.message,'err'); } });
}
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight){
  const words = text.split(' ');
  let line = '', ly = y;
  for(const w of words){
    const test = line + w + ' ';
    if(ctx.measureText(test).width > maxWidth && line){
      ctx.fillText(line, x, ly); line = w+' '; ly += lineHeight;
    } else line = test;
  }
  if(line) ctx.fillText(line, x, ly);
}

function buildSVG(){
  const svg=document.getElementById('brmap');
  svg.innerHTML='';
  for(const uf in PATHS){
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',PATHS[uf]);
    p.setAttribute('class','state');
    p.setAttribute('id','st-'+uf);
    p.addEventListener('click',()=>{ selectTab('map'); openPanel(uf); });
    p.addEventListener('mousemove',e=>showMapTip(e,uf));
    p.addEventListener('mouseleave',hideMapTip);
    svg.appendChild(p);
  }
  const NS='http://www.w3.org/2000/svg', EXT=['RN','PB','PE','AL','SE','ES','RJ'];
  const mk=(n,at)=>{ const e=document.createElementNS(NS,n); for(const k in at) e.setAttribute(k,at[k]); svg.appendChild(e); return e; };
  try{
    const ext=[];
    Object.keys(PATHS).forEach(u=>{
      const el=document.getElementById('st-'+u), bb=el.getBBox(), g=GEO_LABELS[u];
      if(g){
        if(g.r<7 && EXT.includes(u)){ ext.push({u,x:g.x,y:g.y,right:bb.x+bb.width}); return; }
        const fs=Math.max(4.2,Math.min(6.5,g.r*1.5));
        mk('text',{x:g.x,y:g.y,class:'maplabel',style:'font-size:'+fs.toFixed(1)+'px'}).textContent=u;
      } else if(bb.width>=9 && bb.height>=8){
        mk('text',{x:bb.x+bb.width/2,y:bb.y+bb.height/2,class:'maplabel'}).textContent=u;
      }
    });
    /* Rótulos externos alinhados em coluna, com linha-guia, ordenados de cima p/ baixo sem sobreposição */
    const groups=[ext.filter(e=>['RN','PB','PE','AL','SE'].includes(e.u)), ext.filter(e=>['ES','RJ'].includes(e.u))];
    groups.forEach(grp=>{
      grp.sort((p,q)=>p.y-q.y); if(!grp.length) return;
      const colX=Math.max(...grp.map(e=>e.right))+16, gap=9.5; let prev=-1e9;
      grp.forEach(e=>{ e.ly=Math.max(e.y,prev+gap); prev=e.ly; });
      const shift=(grp.reduce((a,e)=>a+(e.y-e.ly),0)/grp.length); grp.forEach(e=>e.ly+=shift*0.5);
      grp.forEach(e=>{
        mk('polyline',{points:e.x+','+e.y+' '+(colX-5)+','+e.ly+' '+(colX-2)+','+e.ly,class:'maplead'});
        mk('circle',{cx:e.x,cy:e.y,r:.9,class:'maplead-dot'});
        mk('text',{x:colX,y:e.ly,class:'maplabel maplabel-ext'}).textContent=e.u;
      });
    });
  }catch(e){ console.warn(e); }
  try{ const b=svg.getBBox(); if(b.width>10){ const pd=6; svg.setAttribute('viewBox',(b.x-pd)+' '+(b.y-pd)+' '+(b.width+2*pd)+' '+(b.height+2*pd)); } }catch(e){}
  const sel=document.getElementById('ufSelect');
  if(sel && !sel.options.length){
    sel.innerHTML='<option value="">Selecione um estado…</option>'+Object.keys(NAMES).sort((x,y)=>NAMES[x].localeCompare(NAMES[y],'pt-BR')).map(u=>'<option value="'+u+'">'+NAMES[u]+' ('+u+')</option>').join('');
    sel.addEventListener('change',()=>{ if(sel.value){ selectTab('map'); openPanel(sel.value); } });
  }
}
function showMapTip(e,uf){
  const tip=document.getElementById('mapTip'), wrap=document.getElementById('mapWrap'); if(!tip||!wrap) return;
  const a=stateAvg(uf), d=stateDelta(uf), r=wrap.getBoundingClientRect();
  tip.hidden=false;
  tip.innerHTML='<span class="tt-date">'+NAMES[uf]+' ('+uf+')</span>'+(a.has
    ? '<span class="tt-lula">● Lula '+a.lula.toFixed(1)+'%</span><br><span class="tt-opp">● Flávio '+a.opp.toFixed(1)+'%</span>'+(d===null?'':'<br>'+fmtPP(d)+' vs 2022')
    : 'Sem pesquisas cadastradas');
  tip.style.left=Math.min(Math.max(e.clientX-r.left,70),r.width-70)+'px';
  tip.style.top=Math.max(e.clientY-r.top-10,40)+'px';
}
function hideMapTip(){ const t=document.getElementById('mapTip'); if(t) t.hidden=true; }
/* Watermark decorativo no cabeçalho: reaproveita os MESMOS contornos dos
   estados usados no mapa interativo (nenhum dado novo), só que desenhados
   em conjunto, bem sutis, como textura de fundo — reforça a identidade
   "mapa" do produto em vez de um ícone genérico. */
function buildWatermark(){
  const svg=document.getElementById('brmap-watermark');
  if(!svg) return;
  for(const uf in PATHS){
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',PATHS[uf]);
    svg.appendChild(p);
  }
}
function renderMap(){
  for(const uf in PATHS){
    const avg=stateAvg(uf);
    const el=document.getElementById('st-'+uf);
    if(mapMode==='variacao'){
      const d = stateDelta(uf);
      el.setAttribute('fill', d===null ? 'var(--border-strong,#cdbf9c)' : colorForDelta(d));
      const titleEl = el.querySelector('title');
      if(titleEl) titleEl.textContent = NAMES[uf] + (d===null ? ' — sem dados' : ' — ' + fmtPP(d) + ' vs 2022');
    } else {
      el.setAttribute('fill', avg.has ? colorFor(avg.lula) : 'var(--border-strong,#cdbf9c)');
      const titleEl = el.querySelector('title');
      if(titleEl) titleEl.textContent = NAMES[uf];
    }
    el.classList.toggle('sel', uf===selectedUF);
  }
  const gv = mapMode==='variacao';
  document.getElementById('legend').innerHTML =
    '<div class="gradlegend"><div class="gradbar" style="background:linear-gradient(90deg,'+(gv?'#b26a00,#eceff1,#146c2e':'#0b57d0,#eceff1,#b3261e')+')"></div>'+
    '<div class="gradlab">'+(gv?'<span>Lula −12 p.p.</span><span>igual a 2022</span><span>Lula +12 p.p.</span>':'<span>Flávio 75%</span><span>empate</span><span>Lula 75%</span>')+'</div></div>'+
    '<div class="gradlab nodata"><span class="swatch" style="background:var(--border-strong)"></span>Sem pesquisas</div>';
}
function renderBar(){
  let sumL=0,sumO=0,sumW=0;
  for(const uf in DATA){
    const avg=stateAvg(uf);
    if(!avg.has) continue;
    const w=DATA[uf].weight;
    sumL+=avg.lula*w; sumO+=avg.opp*w; sumW+=w;
  }
  const lead=document.getElementById('lead');
  if(sumW===0){
    document.getElementById('seg-lula').style.width='50%';
    document.getElementById('seg-opp').style.width='50%';
    document.getElementById('seg-lula').textContent='';
    document.getElementById('seg-opp').textContent='';
    lead.innerHTML='Adicione pesquisas para calcular a média nacional.';
    return;
  }
  const lula=sumL/sumW, opp=sumO/sumW;
  document.getElementById('seg-lula').style.width=lula+'%';
  document.getElementById('seg-opp').style.width=opp+'%';
  document.getElementById('seg-lula').textContent=lula.toFixed(1)+'%';
  document.getElementById('seg-opp').textContent=opp.toFixed(1)+'%';
  const cov = (sumW*100).toFixed(0);
  const scn = scenario==='base' ? '' : ' · cenário: '+SCN_LABEL[scenario];
  if(lula>opp) lead.innerHTML='<b>Lula</b> venceria com '+lula.toFixed(1)+'% x '+opp.toFixed(1)+'% <span class="muted">('+cov+'% do peso nacional coberto'+scn+')</span>';
  else if(opp>lula) lead.innerHTML='<b>Flávio</b> venceria com '+opp.toFixed(1)+'% x '+lula.toFixed(1)+'% <span class="muted">('+cov+'% do peso nacional coberto'+scn+')</span>';
  else lead.textContent='Empate técnico';
}
function renderRank(){
  const rows=[];
  for(const uf in DATA){ rows.push({uf, avg: stateAvg(uf), delta: stateDelta(uf), stale: stateStale(uf), disp: stateDispersion(uf)}); }
  rows.sort((a,b)=>b.avg.lula-a.avg.lula);
  document.getElementById('rankList').innerHTML = rows.map(r=>{
    const w = r.avg.has ? r.avg.lula : 50;
    const color = r.avg.has ? colorFor(r.avg.lula) : 'var(--border-strong,#cdbf9c)';
    const label = r.avg.has ? r.avg.lula.toFixed(1)+'%' : 'sem dados';
    const delta = r.delta===null ? '' : '<span class="ppbadge '+ppClass(r.delta)+'">'+ppArrow(r.delta)+' '+fmtPP(r.delta)+'</span>';
    const staleFlag = r.stale.stale ? '<span class="stalebadge" title="Pesquisa mais recente há '+r.stale.days+' dias">'+icon('clock')+' desatualizado</span>' : '';
    const tierFlag = r.disp.tier==='preliminar' ? '<span class="tierbadge preliminar" title="Apenas 1 pesquisa cadastrada">1 pesquisa</span>' : '';
    return '<div class="rowbar clickable" data-uf="'+r.uf+'" tabindex="0" role="button"><div class="uf">'+r.uf+'</div><div class="track"><div class="fill" style="width:'+w+'%;background:'+color+'"></div></div><div class="pct">'+label+'</div><div class="deltacell">'+delta+tierFlag+staleFlag+'</div></div>';
  }).join('');
  renderDecisive();
}

/* ---------- Estados decisivos (painel na aba Ranking) ------------------ */
function renderDecisive(){
  const el = document.getElementById('decisiveList');
  if(!el) return;
  const list = decisiveStates();
  if(!list.length){ el.innerHTML = '<p class="empty">Nenhum estado com pesquisa está abaixo da margem de '+DECISIVE_MARGIN+' p.p. no momento.</p>'; return; }
  el.innerHTML = list.map(d=>{
    return '<div class="decisivecard clickable" data-uf="'+d.uf+'" tabindex="0" role="button"><div class="dc-uf">'+NAMES[d.uf]+' <span class="muted">('+d.uf+')</span></div>'+
      '<div class="dc-bar"><div class="dc-fill" style="width:'+d.avg.lula+'%;background:'+colorFor(d.avg.lula)+'"></div></div>'+
      '<div class="dc-nums"><span>Lula '+d.avg.lula.toFixed(1)+'%</span><span class="muted">margem '+d.margin.toFixed(1)+' p.p.</span><span>Flávio '+d.avg.opp.toFixed(1)+'%</span></div></div>';
  }).join('');
}
/* ---------- Projeções matemáticas até o dia da eleição ----------------
   Dois modelos de regressão sobre a série consolidada nacional de Lula:
   1) Tendência linear simples (mínimos quadrados / OLS) — dá o mesmo peso
      a todas as pesquisas ao longo do tempo.
   2) Tendência ponderada por recência — mínimos quadrados ponderados,
      usando o mesmo decaimento por meia-vida das médias (pesquisas
      recentes pesam mais), o que captura melhor um "momentum" recente. */
function daysBetweenDates(aISO,bISO){
  return (new Date(bISO+'T00:00:00') - new Date(aISO+'T00:00:00')) / 86400000;
}
function olsRegression(xs,ys){
  const n=xs.length;
  const xbar=xs.reduce((a,b)=>a+b,0)/n, ybar=ys.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  for(let i=0;i<n;i++){ num += (xs[i]-xbar)*(ys[i]-ybar); den += (xs[i]-xbar)**2; }
  const slope = den ? num/den : 0;
  return {slope, intercept: ybar - slope*xbar};
}
function weightedRegression(xs,ys,ws){
  let sw=0,swx=0,swy=0,swxx=0,swxy=0;
  for(let i=0;i<xs.length;i++){
    const w=ws[i];
    sw+=w; swx+=w*xs[i]; swy+=w*ys[i]; swxx+=w*xs[i]*xs[i]; swxy+=w*xs[i]*ys[i];
  }
  const den = sw*swxx - swx*swx;
  const slope = den ? (sw*swxy - swx*swy)/den : 0;
  const intercept = sw ? (swy - slope*swx)/sw : (ys[ys.length-1]||50);
  return {slope, intercept};
}
function clampPct(v){ return Math.max(0, Math.min(100, v)); }

/* ---------- Correlação de Pearson: 2022 oficial × cenário atual (2026) -
   Técnica padrão de agregadores para checar o quanto o padrão estadual
   de uma eleição anterior "se repete" na atual: r perto de +1 significa
   que os estados que já eram fortes pra Lula em 2022 continuam sendo os
   mais fortes agora (mesma ordem relativa); perto de 0 significa que o
   padrão embaralhou; negativo significa que ele se inverteu. */
function pearsonCorrelation(xs, ys){
  const n = xs.length;
  if(n < 2) return null;
  const xbar = xs.reduce((a,b)=>a+b,0)/n, ybar = ys.reduce((a,b)=>a+b,0)/n;
  let sxy=0, sxx=0, syy=0;
  for(let i=0;i<n;i++){ const dx=xs[i]-xbar, dy=ys[i]-ybar; sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy; }
  if(sxx===0 || syy===0) return 0;
  return sxy / Math.sqrt(sxx*syy);
}
/* Pontos {uf, x:2022%, y:atual%, delta, n} para todo estado com pesquisa. */
function correlationPoints(){
  const out=[];
  for(const uf in DATA){
    const base = BASELINE_2022[uf];
    const avg = stateAvg(uf);
    if(!base || !avg.has) continue;
    out.push({uf, x:base.lula, y:avg.lula, delta:avg.lula-base.lula, n:(DATA[uf].polls||[]).length});
  }
  return out;
}

/* Ordena as pesquisas de UM estado por data (só as que têm data). */
function statePollsSorted(uf){
  return ((DATA[uf] && DATA[uf].polls) || []).filter(p=>p.date).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
}

/* Projeção de UM estado até o dia da eleição, por modelo ('ols'|'wls').
   - 0 pesquisas no estado  -> assume o resultado oficial de 2022 (sem sinal, sem mudança).
   - 1 pesquisa no estado   -> não dá pra estimar tendência; mantém o valor mais recente.
   - 2+ pesquisas no estado -> regressão sobre a série própria do estado, extrapolada até 25/10. */
function stateProjectionBase(uf, modelKey){
  const polls = statePollsSorted(uf);
  const base = BASELINE_2022[uf];
  if(polls.length===0) return base ? base.lula : 50;
  if(polls.length===1) return polls[0].lula;
  const t0 = polls[0].date;
  const xs = polls.map(p=>daysBetweenDates(t0,p.date));
  const ys = polls.map(p=>p.lula);
  const xTarget = Math.max(daysBetweenDates(t0, ELECTION_DAY), xs[xs.length-1]); // nunca projeta "para trás"
  const reg = modelKey==='ols'
    ? olsRegression(xs,ys)
    : weightedRegression(xs,ys, polls.map(p=>recencyWeight(p.date)));
  return clampPct(reg.intercept + reg.slope*xTarget);
}

function stateProjection(uf, modelKey){
  const v = stateProjectionBase(uf, modelKey);
  return (scenario==='base' || !stateAvgBase(uf).has) ? v : clampPct(v + scenarioShift(uf));
}
/* Agrega as projeções de todos os 27 estados, ponderadas pelo peso
   eleitoral de 2022 de cada um — em vez de extrapolar a curva nacional
   "costurada" (que pulava conforme qual estado tinha pesquisa em cada
   data, e por isso podia dar números sem sentido). Cada estado contribui
   com o seu PRÓPRIO horizonte de projeção, o que é estatisticamente
   muito mais estável. */
function nationalProjection(modelKey){
  let sumW=0, sumL=0, coveredWeight=0, trendWeight=0;
  for(const uf in DATA){
    const w = DATA[uf].weight;
    sumW += w; sumL += stateProjection(uf, modelKey) * w;
    const n = statePollsSorted(uf).length;
    if(n>=1) coveredWeight += w;
    if(n>=2) trendWeight += w;
  }
  return {lula: sumW? sumL/sumW : 50, coveredWeight, trendWeight};
}

function computeProjections(){
  const totalPolls = Object.values(DATA).reduce((a,s)=>a+((s.polls||[]).length),0);
  if(totalPolls===0) return null;
  return { ols: nationalProjection('ols'), wls: nationalProjection('wls') };
}

/* ---------- Peso eleitoral coberto vs. total (métrica isolada) --------- */
function coverageWeight(){
  let covered=0, total=0;
  for(const uf in DATA){ const w=DATA[uf].weight; total+=w; if(((DATA[uf].polls||[]).length)>0) covered+=w; }
  return {covered, total, pct: total? covered/total*100 : 0};
}

/* ---------- Estados decisivos: margem Lula×Flávio abaixo do limiar ----- */
function decisiveStates(){
  const out=[];
  for(const uf in DATA){
    const avg = stateAvg(uf);
    if(!avg.has) continue;
    const margin = Math.abs(avg.lula-avg.opp);
    if(margin < DECISIVE_MARGIN) out.push({uf, avg, margin});
  }
  return out.sort((a,b)=>a.margin-b.margin);
}

/* ---------- Ranking / média / efeito de casa por instituto (group-by) -- */
function instituteStats(){
  const byInst = {};
  for(const uf in DATA){
    (DATA[uf].polls||[]).forEach(p=>{
      const s = byInst[p.inst] || (byInst[p.inst] = {inst:p.inst, count:0, states:new Set(), sumLula:0, sumCred:0});
      s.count++; s.states.add(uf); s.sumLula += p.lula; s.sumCred += p.cred;
    });
  }
  return Object.values(byInst).map(s=>({
    inst: s.inst, count: s.count, states: s.states.size,
    rawAvg: s.sumLula/s.count, avgCred: s.sumCred/s.count,
    houseEffect: HOUSE_EFFECTS[s.inst] !== undefined ? HOUSE_EFFECTS[s.inst] : null
  })).sort((a,b)=> b.count-a.count);
}

/* ---------- Última alternância de liderança nacional -------------------
   Percorre a série consolidada nacional (mesma lógica do gráfico de linha
   do tempo) e encontra a data mais recente em que o líder mudou (Lula
   passou a liderar, ou deixou de liderar, os 50%). */
function lastLeadershipChange(points){
  if(!points || points.length<2) return null;
  let lastChange=null, prevLeader = points[0].lula>=50 ? 'lula':'opp';
  for(let i=1;i<points.length;i++){
    const leader = points[i].lula>=50 ? 'lula':'opp';
    if(leader!==prevLeader){ lastChange = {date:points[i].date, newLeader:leader}; prevLeader=leader; }
  }
  return lastChange;
}

/* ---------- LOESS: regressão local ponderada (Cleveland) ---------------
   Para cada ponto x0 onde a curva é avaliada: pega os q = span·n pontos
   mais próximos, pondera-os com o núcleo tricúbico w=(1-|d/h|³)³ (h = distância
   ao q-ésimo vizinho), ajusta um polinômio de grau 1 ou 2 por mínimos
   quadrados ponderados e usa o valor ajustado em x0. As iterações robustas
   recalculam os pesos com a função bisquare dos resíduos, reduzindo a
   influência de pesquisas "fora da curva". Retorna uma função f(x). */
function solveLinear(A,b){
  const n=b.length; for(let i=0;i<n;i++){
    let m=i; for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[m][i])) m=r;
    if(Math.abs(A[m][i])<1e-12) return null;
    [A[i],A[m]]=[A[m],A[i]]; [b[i],b[m]]=[b[m],b[i]];
    for(let r=i+1;r<n;r++){ const f=A[r][i]/A[i][i]; for(let c=i;c<n;c++) A[r][c]-=f*A[i][c]; b[r]-=f*b[i]; }
  }
  const x=new Array(n); for(let i=n-1;i>=0;i--){ let t=b[i]; for(let c=i+1;c<n;c++) t-=A[i][c]*x[c]; x[i]=t/A[i][i]; } return x;
}
function loessSmooth(xs, ys, span, degree, iters){
  span=span||LOESS_SPAN; degree=degree||LOESS_DEGREE; iters=iters===undefined?LOESS_ROBUST_ITERS:iters;
  const n=xs.length; if(n<4) return null;
  const deg=Math.min(degree, n-2), q=Math.min(n, Math.max(deg+2, Math.ceil(span*n)));
  let rw=new Array(n).fill(1);
  const fitAt=(x0)=>{
    const d=xs.map(x=>Math.abs(x-x0)), h=Math.max([...d].sort((a,b)=>a-b)[q-1],1e-9);
    const w=d.map((di,i)=>{ const u=di/h; return (u<1?Math.pow(1-u*u*u,3):0)*rw[i]; });
    const m=deg+1, A=Array.from({length:m},()=>new Array(m).fill(0)), b=new Array(m).fill(0);
    for(let i=0;i<n;i++){ if(!w[i]) continue; const dx=xs[i]-x0, pw=[1]; for(let k=1;k<2*m;k++) pw[k]=pw[k-1]*dx;
      for(let r=0;r<m;r++){ b[r]+=w[i]*pw[r]*ys[i]; for(let c=0;c<m;c++) A[r][c]+=w[i]*pw[r+c]; } }
    const sol=solveLinear(A,b);
    if(sol) return sol[0];
    let sw=0,sy=0; for(let i=0;i<n;i++){ sw+=w[i]; sy+=w[i]*ys[i]; } return sw? sy/sw : ys[0];
  };
  for(let it=0; it<iters; it++){
    const res=xs.map((x,i)=>Math.abs(ys[i]-fitAt(x))), med=[...res].sort((a,b)=>a-b)[Math.floor(n/2)]||0;
    if(med<1e-9) break;
    rw=res.map(r=>{ const u=r/(6*med); return u<1?Math.pow(1-u*u,2):0; });
  }
  return fitAt;
}
function renderTimeline(){
  const svg=document.getElementById('timeSvg');
  const all=[];
  for(const uf in DATA){
    for(const p of (DATA[uf].polls||[])){ if(p.date) all.push({uf,date:p.date,lula:p.lula}); }
  }
  all.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const proj = computeProjections();
  if(all.length===0){
    svg.innerHTML = '<foreignObject x="0" y="0" width="800" height="320"><div xmlns="http://www.w3.org/1999/xhtml" class="chart-empty">Adicione pesquisas com data para ver a evolução no tempo.</div></foreignObject>';
    renderProjectionPanel(proj);
    renderLeadershipInfo(null);
    return;
  }

  // Recalcula a média nacional a cada evento, mas SÓ guarda um ponto por
  // data única (o estado consolidado ao fim daquele dia) — antes cada
  // pesquisa virava um ponto separado, mesmo quando duas pesquisas caíam
  // no mesmo dia, o que gerava pontos "empilhados" na mesma posição do
  // eixo X (o efeito de duplicação que ficava ilegível no gráfico).
  const latest={};
  const byDate = new Map(); // date -> {lula, opp}
  for(const item of all){
    latest[item.uf]=item;
    let sumL=0,sumW=0;
    for(const uf in latest){ sumL += latest[uf].lula * DATA[uf].weight; sumW += DATA[uf].weight; }
    const lula = sumW? sumL/sumW : 50;
    byDate.set(item.date, {date:item.date, lula, opp:100-lula});
  }
  const points = Array.from(byDate.values()); // já em ordem cronológica (Map preserva inserção, e "all" está ordenado)

  const W=800,H=340,padL=42,padR=20,padT=30,padB=38;
  const t0 = new Date(points[0].date+'T00:00:00').getTime();
  const lastDate = points[points.length-1].date;
  // o domínio do eixo X vai até a maior das duas datas: a última pesquisa
  // OU o dia da eleição (para caber a linha pontilhada de projeção)
  const showProj = !!proj;
  const t1raw = new Date(lastDate+'T00:00:00').getTime();
  const tElection = new Date(ELECTION_DAY+'T00:00:00').getTime();
  const t1 = showProj ? Math.max(t1raw, tElection) : t1raw;
  const span = Math.max(1, t1 - t0);
  const xOf=(dateISO)=> points.length===1 && !showProj
    ? (W-padL-padR)/2 + padL
    : padL + ((new Date(dateISO+'T00:00:00').getTime()-t0)/span)*(W-padL-padR);
  const xs=(p)=> xOf(p.date);
  const ys=(v)=> padT + (100-v)/100*(H-padT-padB);

  // pontos de tela (px) pra cada série, usados tanto pra desenhar quanto
  // pra alimentar a curva suavizada (smoothLinePath só recebe {x,y})
  const lulaPts = points.map(p=>({x:xs(p), y:ys(p.lula)}));
  const oppPts  = points.map(p=>({x:xs(p), y:ys(p.opp)}));
  // curva LOESS (suaviza a série nacional): avaliada em 81 pontos do primeiro ao último dia
  const day0 = new Date(points[0].date+'T00:00:00').getTime();
  const dayOf = p => (new Date(p.date+'T00:00:00').getTime()-day0)/86400000;
  const maxD = dayOf(points[points.length-1]);
  const smoothF = loessSmooth(points.map(dayOf), points.map(p=>p.lula));
  let lineL = lulaPts, lineO = oppPts, lastLine = points[points.length-1].lula;
  if(smoothF && maxD>0){
    lineL=[]; lineO=[];
    for(let k=0;k<=80;k++){ const d=maxD*k/80, v=clampPct(smoothF(d)), x=padL+(d*86400000/span)*(W-padL-padR);
      lineL.push({x, y:ys(v)}); lineO.push({x, y:ys(100-v)}); }
    lastLine = clampPct(smoothF(maxD));
  }

  let svgc='';
  // grade horizontal: linhas fortes em 0/25/50/75/100 + linhas finas
  // intermediárias a cada 10%, estilo painel de agregador profissional
  for(let v=0; v<=100; v+=10){
    const y = ys(v);
    const major = (v%25===0);
    svgc += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" class="gridline'+(major?'':' minor')+'"'+(v===50?' stroke-dasharray="3,4"':'')+'/>';
    if(major) svgc += '<text x="'+(padL-8)+'" y="'+(y+3.5).toFixed(1)+'" class="axislabel" text-anchor="end">'+v+'%</text>';
  }

  // grade vertical: até 6 marcas de data uniformemente espaçadas ao longo
  // do período coberto, formatadas curtas (dd/mm) — bem mais legível que
  // só 3 rótulos quando a série cobre muitos meses.
  const tickDates = [];
  {
    const nTicks = Math.min(6, Math.max(2, points.length));
    for(let i=0;i<nTicks;i++){
      const t = t0 + (span*i)/(nTicks-1);
      tickDates.push(new Date(t));
    }
  }
  tickDates.forEach((d,i)=>{
    const x = padL + ((d.getTime()-t0)/span)*(W-padL-padR);
    if(x < padL-1 || x > W-padR+1) return;
    svgc += '<line x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+(H-padB)+'" class="gridline vgrid"/>';
    const dd = String(d.getDate()).padStart(2,'0'), mm = String(d.getMonth()+1).padStart(2,'0');
    const anchor = i===0 ? 'start' : (i===tickDates.length-1 && !showProj ? 'end' : 'middle');
    svgc += '<text x="'+x.toFixed(1)+'" y="'+(H-12)+'" class="axislabel" text-anchor="'+anchor+'">'+dd+'/'+mm+'</text>';
  });

  // marcador vertical do dia da eleição
  if(showProj){
    const xe = xOf(ELECTION_DAY);
    svgc += '<line x1="'+xe.toFixed(1)+'" y1="'+padT+'" x2="'+xe.toFixed(1)+'" y2="'+(H-padB)+'" class="electionline"/>';
    svgc += '<text x="'+xe.toFixed(1)+'" y="'+(padT-10)+'" class="axislabel electionlabel" text-anchor="middle">25/10 · eleição</text>';
  }

  { const tn=new Date(todayISO()+'T00:00:00').getTime();
    if(tn>t0 && tn<t1){ const xt=(padL+((tn-t0)/span)*(W-padL-padR)).toFixed(1);
      svgc += '<line x1="'+xt+'" y1="'+padT+'" x2="'+xt+'" y2="'+(H-padB)+'" class="todayline"/><text x="'+xt+'" y="'+(H-padB-6)+'" class="axislabel todaylabel" text-anchor="middle">hoje</text>'; } }
  // legenda no topo, no estilo dos "chips" coloridos do Google Trends
  svgc += '<g class="chartlegend">'+
    '<circle cx="'+padL+'" cy="12" r="4.5" fill="var(--lula,#b3261e)"/><text x="'+(padL+11)+'" y="15.5" class="legendlabel">Lula</text>'+
    '<circle cx="'+(padL+58)+'" cy="12" r="4.5" fill="var(--opp,#0b57d0)"/><text x="'+(padL+69)+'" y="15.5" class="legendlabel">Flávio</text>'+
  '</g>';

  // área sob a linha do Lula, preenchida com a textura pontilhada
  // ("halftone") — a assinatura gráfica do site — agora seguindo a
  // mesma curva suave da linha, em vez de segmentos retos.
  svgc += '<path d="'+smoothAreaPath(lineL, H-padB)+'" class="timeline-area"/>';

  // linha Flávio (traço mais fino, por trás) + linha Lula (em destaque, por cima), ambas suavizadas
  svgc += '<path d="'+smoothLinePath(lineO)+'" class="timeline-line opp"/>';
  svgc += '<path d="'+smoothLinePath(lineL)+'" class="timeline-line lula"/>';

  points.forEach((p,i)=>{
    const x=xs(p).toFixed(1);
    svgc += '<circle cx="'+x+'" cy="'+ys(p.opp).toFixed(1)+'" r="3" class="timeline-dot opp" data-i="'+i+'"><title>'+fmtDate(p.date)+': Flávio '+p.opp.toFixed(1)+'%</title></circle>';
    svgc += '<circle cx="'+x+'" cy="'+ys(p.lula).toFixed(1)+'" r="3.6" class="timeline-dot lula" data-i="'+i+'"><title>'+fmtDate(p.date)+': Lula '+p.lula.toFixed(1)+'%</title></circle>';
  });

  // linhas pontilhadas de projeção — dos dois modelos — até o dia da eleição
  if(showProj){
    const last = points[points.length-1];
    const xe = xOf(ELECTION_DAY).toFixed(1);
    const x0 = xs(last).toFixed(1);
    svgc += '<path d="M'+x0+','+ys(lastLine).toFixed(1)+' L'+xe+','+ys(proj.ols.lula).toFixed(1)+'" class="proj-line ols"/>';
    svgc += '<path d="M'+x0+','+ys(lastLine).toFixed(1)+' L'+xe+','+ys(proj.wls.lula).toFixed(1)+'" class="proj-line wls"/>';
    svgc += '<circle cx="'+xe+'" cy="'+ys(proj.ols.lula).toFixed(1)+'" r="4" class="proj-dot ols"><title>Tendência linear simples em 25/10: Lula '+proj.ols.lula.toFixed(1)+'%</title></circle>';
    svgc += '<circle cx="'+xe+'" cy="'+ys(proj.wls.lula).toFixed(1)+'" r="4" class="proj-dot wls"><title>Tendência ponderada por recência em 25/10: Lula '+proj.wls.lula.toFixed(1)+'%</title></circle>';
  }

  // rótulos de valor direto no fim de cada linha (como Economist/FT fazem
  // em vez de depender só da legenda) — mostram o último valor conhecido.
  const lastP = points[points.length-1];
  const lx = xs(lastP);
  [['lula', lastP.lula, 8], ['opp', lastP.opp, -8]].forEach(([key,val,dy])=>{
    const ly = ys(val);
    const txt = val.toFixed(1)+'%';
    const bw = 15 + txt.length*6.4;
    svgc += '<rect x="'+(lx+7).toFixed(1)+'" y="'+(ly+dy-9).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="16" rx="8" class="endlabel-bg"/>';
    svgc += '<text x="'+(lx+7+bw/2).toFixed(1)+'" y="'+(ly+dy+2.5).toFixed(1)+'" class="endlabel '+key+'" text-anchor="middle">'+txt+'</text>';
  });

  svgc += '<line x1="'+padL+'" y1="'+(H-padB)+'" x2="'+(W-padR)+'" y2="'+(H-padB)+'" class="gridline strong"/>';

  // zona invisível que captura o mouse em toda a área do gráfico, usada
  // pelo listener de hover instalado logo abaixo (crosshair + tooltip).
  svgc += '<rect x="'+padL+'" y="'+padT+'" width="'+(W-padL-padR)+'" height="'+(H-padT-padB)+'" class="hoverzone" data-hover="1"/>';
  svgc += '<g id="timeHoverLayer" style="display:none;">'+
    '<line x1="0" y1="'+padT+'" x2="0" y2="'+(H-padB)+'" class="crosshair" id="timeCrosshair"/>'+
    '<circle r="5" class="hoverdot lula" id="timeHoverLula"/>'+
    '<circle r="4.5" class="hoverdot opp" id="timeHoverOpp"/>'+
  '</g>';

  svg.innerHTML = svgc;
  renderProjectionPanel(proj);
  renderLeadershipInfo(lastLeadershipChange(points));
  attachTimelineHover(svg, points, xs, ys, W, H);
}
/* ---------- Interatividade: crosshair + tooltip ao passar o mouse ------
   Reatribuído a cada renderTimeline() porque o SVG é reconstruído do
   zero (innerHTML) a cada atualização. Encontra o ponto de dado mais
   próximo do X do mouse e realça os dois valores daquela data. */
function attachTimelineHover(svg, points, xsFn, ysFn, W, H){
  const zone = svg.querySelector('[data-hover]');
  const layer = document.getElementById('timeHoverLayer');
  const crosshair = document.getElementById('timeCrosshair');
  const dotLula = document.getElementById('timeHoverLula');
  const dotOpp = document.getElementById('timeHoverOpp');
  const tooltip = document.getElementById('timeTooltip');
  const wrap = document.getElementById('timeSvgWrap');
  if(!zone || !layer || !tooltip || !wrap || !points.length) return;
  const xPositions = points.map(p=>xsFn(p));
  function nearestIndex(mx){
    let best=0, bestD=Infinity;
    xPositions.forEach((x,i)=>{ const d=Math.abs(x-mx); if(d<bestD){ bestD=d; best=i; } });
    return best;
  }
  function move(evt){
    const rect = svg.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const mxSvg = ((clientX - rect.left) / rect.width) * W;
    const i = nearestIndex(mxSvg);
    const p = points[i];
    const x = xsFn(p), yL = ysFn(p.lula), yO = ysFn(p.opp);
    layer.style.display = '';
    crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
    dotLula.setAttribute('cx', x); dotLula.setAttribute('cy', yL);
    dotOpp.setAttribute('cx', x); dotOpp.setAttribute('cy', yO);
    tooltip.hidden = false;
    tooltip.innerHTML = '<span class="tt-date">'+fmtDate(p.date)+'</span>'+
      '<span class="tt-lula">● Lula '+p.lula.toFixed(1)+'%</span><br>'+
      '<span class="tt-opp">● Flávio '+p.opp.toFixed(1)+'%</span>';
    const left = clientX - rect.left;
    const top = yL * (rect.height / H);
    tooltip.style.left = Math.min(Math.max(left,50), rect.width-50)+'px';
    tooltip.style.top = Math.max(top, 24)+'px';
  }
  function leave(){ layer.style.display='none'; tooltip.hidden = true; }
  zone.addEventListener('mousemove', move);
  zone.addEventListener('mouseleave', leave);
  zone.addEventListener('touchmove', move, {passive:true});
  zone.addEventListener('touchend', leave);
}
function renderLeadershipInfo(change){
  const el = document.getElementById('leadershipInfo');
  if(!el) return;
  if(!change){ el.innerHTML=''; return; }
  const who = change.newLeader==='lula' ? 'Lula assumiu a liderança' : 'Lula perdeu a liderança (Flávio passou à frente)';
  el.innerHTML = '<span class="leadchip">'+icon('repeat')+' Última alternância de liderança nacional: <b>'+fmtDate(change.date)+'</b> — '+who+'</span>';
}

function renderProjectionPanel(proj){
  const el = document.getElementById('timelineProjections');
  if(!el) return;
  if(!proj){
    el.innerHTML = '<p class="empty">Cadastre ao menos uma pesquisa para ver a projeção até a eleição.</p>';
    return;
  }
  const days = Math.max(0, Math.round(daysBetweenDates(todayISO(), ELECTION_DAY)));
  const card = (title, desc, lula, trendWeight, cls)=>{
    const opp = 100-lula;
    return '<div class="projcard '+cls+'">'+
      '<div class="projcard-head"><span class="projdot"></span><h4>'+title+'</h4></div>'+
      '<p class="projdesc">'+desc+'</p>'+
      '<div class="projresult"><b>Lula '+lula.toFixed(1)+'%</b><span class="muted">× Flávio '+opp.toFixed(1)+'%</span></div>'+
      '<div class="projmeta">'+(trendWeight*100).toFixed(0)+'% do peso eleitoral tem tendência própria calculada (2+ pesquisas no estado)</div>'+
    '</div>';
  };
  el.innerHTML =
    '<p class="section-sub">Projeção para <b>25/10/2026</b> ('+days+' dia(s) restantes). Cada estado é projetado com base na <b>sua própria</b> série de pesquisas (2+ pesquisas → tendência; 1 pesquisa → mantém o valor; 0 pesquisas → assume o resultado de 2022), e o resultado nacional é a soma ponderada pelo peso eleitoral de cada estado — <b>'+(proj.ols.coveredWeight*100).toFixed(0)+'% do peso nacional</b> já tem pesquisa cadastrada. São estimativas estatísticas simples, não previsões oficiais.</p>'+
    '<div class="projgrid">'+
      card('Tendência linear simples', 'Regressão linear (mínimos quadrados) sobre a série de cada estado, mesmo peso para toda pesquisa.', proj.ols.lula, proj.ols.trendWeight, 'ols')+
      card('Tendência ponderada por recência', 'Regressão linear ponderada por estado: pesquisas mais recentes pesam mais (meia-vida de '+RECENCY_HALF_LIFE_DAYS+' dias), capturando melhor o momentum atual.', proj.wls.lula, proj.wls.trendWeight, 'wls')+
    '</div>';
}
function renderStats(){
  let covered=0,total=0,lastDate=null;
  for(const uf in DATA){
    const polls=DATA[uf].polls||[];
    if(polls.length){ covered++; total+=polls.length; }
    for(const p of polls){ if(p.date && (!lastDate || p.date>lastDate)) lastDate=p.date; }
  }
  document.getElementById('statCoverage').textContent = covered+' / '+Object.keys(DATA).length;
  document.getElementById('statPolls').textContent = total;
  { const d=lastDate?daysBetween(lastDate,new Date()):null;
    document.getElementById('statLast').innerHTML = lastDate ? fmtDate(lastDate)+'<small class="substat">'+(d===0?'hoje':d===1?'ontem':'há '+d+' dias')+'</small>' : '—'; }

  const days = Math.max(0, Math.round(daysBetweenDates(todayISO(), ELECTION_DAY)));
  const statCountdown = document.getElementById('statCountdown');
  if(statCountdown) statCountdown.textContent = days+' dia'+(days===1?'':'s');

  const cw = coverageWeight();
  const statCoverW = document.getElementById('statCoverW');
  if(statCoverW) statCoverW.textContent = cw.pct.toFixed(1)+'%';
}

/* ---------- Aba Institutos: ranking de atividade + média por instituto
   + efeito de casa (house effect). Tudo group-by sobre os dados já
   existentes — nenhum campo novo precisou ser cadastrado. ---------- */
function renderInstitutes(){
  const wrap = document.getElementById('instituteList');
  if(!wrap) return;
  const stats = instituteStats();
  if(!stats.length){ wrap.innerHTML = '<p class="empty">Cadastre pesquisas para ver o ranking de institutos.</p>'; return; }
  const maxCount = Math.max(...stats.map(s=>s.count));
  const rows = stats.map(s=>{
    const heHtml = s.houseEffect===null
      ? '<span class="muted">— (só nele mesmo)</span>'
      : '<span class="ppbadge '+(s.houseEffect>0.3?'up':s.houseEffect<-0.3?'down':'flat')+'" title="Diferença média frente ao consenso de outros institutos no mesmo estado">'+(s.houseEffect>0?'+':'')+s.houseEffect.toFixed(1)+' p.p.</span>';
    return '<tr><td>'+s.inst+'</td><td class="num">'+s.count+'</td><td class="num">'+s.states+'</td><td class="num">'+s.rawAvg.toFixed(1)+'%</td><td class="num">'+s.avgCred.toFixed(1)+'</td><td class="num">'+heHtml+'</td></tr>';
  }).join('');
  const bars = stats.map(s=>
    '<div class="rowbar"><div class="uf instname" title="'+s.inst+'">'+s.inst+'</div><div class="track"><div class="fill" style="width:'+(s.count/maxCount*100)+'%;background:var(--brand)"></div></div><div class="pct">'+s.count+'</div></div>'
  ).join('');
  wrap.innerHTML =
    '<h3 class="subhead">Atividade por instituto</h3>'+
    '<div class="section-sub">Quantas pesquisas cada instituto tem cadastradas no total — mais pesquisas de um mesmo instituto não significam mais precisão, mas ajudam a estimar o efeito de casa dele com mais confiança.</div>'+
    bars+
    '<h3 class="subhead" style="margin-top:22px;">Média bruta e efeito de casa</h3>'+
    '<div class="section-sub">O <b>efeito de casa</b> é o viés médio de um instituto frente ao consenso de outros institutos no mesmo estado (mesma técnica usada por agregadores como FiveThirtyEight e Split Ticket). Valor positivo = tende a favorecer Lula frente ao consenso; negativo = tende a favorecer Flávio.</div>'+
    '<div class="table-scroll"><table><thead><tr><th>Instituto</th><th>Pesquisas</th><th>Estados</th><th>Média bruta (Lula)</th><th>Cred. média</th><th>Efeito de casa</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ---------- Insights regionais ---------- */
function renderRegions(){
  const wrap = document.getElementById('regionList');
  const cards = REGION_ORDER.map(region=>{
    const ufs = REGIONS[region];
    let curW=0, curL=0, baseW=0, baseL=0, covered=0, totalPolls=0;
    ufs.forEach(uf=>{
      const base = BASELINE_2022[uf];
      const w = base.weight;
      baseW += w; baseL += base.lula*w;
      const avg = stateAvg(uf);
      const polls = (DATA[uf] && DATA[uf].polls) || [];
      totalPolls += polls.length;
      if(avg.has){ covered++; curW += w; curL += avg.lula*w; }
    });
    const baseAvg = baseL/baseW;
    const hasCur = curW>0;
    const curAvg = hasCur ? curL/curW : null;
    const delta = hasCur ? curAvg - baseAvg : null;
    const nationalShare = baseW; // peso da região no total nacional (2022)
    return {region, ufs, baseAvg, curAvg, delta, covered, total:ufs.length, totalPolls, nationalShare};
  });

  wrap.innerHTML = cards.map(c=>{
    const barCur = c.curAvg===null ? null : c.curAvg;
    const deltaHtml = c.delta===null
      ? '<span class="ppbadge flat">sem pesquisas na região</span>'
      : '<span class="ppbadge '+ppClass(c.delta)+'">'+ppArrow(c.delta)+' '+fmtPP(c.delta)+' vs 2022</span>';
    return '<div class="regioncard">'+
      '<div class="regioncard-head">'+
        '<h3>'+c.region+'</h3>'+
        '<span class="regionshare">'+(c.nationalShare*100).toFixed(1)+'% do eleitorado nacional (2022)</span>'+
      '</div>'+
      '<div class="regioncard-body">'+
        '<div class="regionmetric">'+
          '<div class="rk">2022 (Lula × Bolsonaro)</div>'+
          '<div class="rv">'+c.baseAvg.toFixed(1)+'% <span class="muted">× '+(100-c.baseAvg).toFixed(1)+'%</span></div>'+
        '</div>'+
        '<div class="regionmetric">'+
          '<div class="rk">Média atual (Lula × Flávio)</div>'+
          '<div class="rv">'+(barCur===null? '— sem dados' : barCur.toFixed(1)+'% <span class="muted">× '+(100-barCur).toFixed(1)+'%</span>')+'</div>'+
        '</div>'+
        '<div class="regionmetric">'+
          '<div class="rk">Variação de Lula</div>'+
          '<div class="rv">'+deltaHtml+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="regioncard-foot">'+c.covered+' de '+c.total+' estados com pesquisa · '+c.totalPolls+' pesquisa(s) cadastrada(s)</div>'+
    '</div>';
  }).join('');

  const withDelta = Object.keys(BASELINE_2022).filter(uf=>stateDelta(uf)!==null)
    .map(uf=>({uf, delta:stateDelta(uf)}));
  const insightsEl = document.getElementById('regionInsights');
  if(withDelta.length===0){
    insightsEl.innerHTML = '<p class="empty">Cadastre pesquisas em ao menos um estado para ver os destaques de oscilação em relação a 2022.</p>';
  } else {
    const sorted = [...withDelta].sort((a,b)=>b.delta-a.delta);
    const best = sorted.slice(0,3);
    const worst = sorted.slice(-3).reverse();
    const li = (arr)=> arr.map(x=>'<li><b>'+NAMES[x.uf]+'</b> <span class="ppbadge '+ppClass(x.delta)+'">'+ppArrow(x.delta)+' '+fmtPP(x.delta)+'</span></li>').join('');
    insightsEl.innerHTML =
      '<div class="insightcol"><h4>Maior avanço de Lula vs 2022</h4><ul>'+li(best)+'</ul></div>'+
      '<div class="insightcol"><h4>Maior recuo de Lula vs 2022</h4><ul>'+li(worst)+'</ul></div>';
  }
}

/* ---------- Gráfico de correlação (Pearson): 2022 oficial × cenário atual
   Dispersão (scatter) estado a estado, eixo X = 2022, eixo Y = média
   atual, com a diagonal "sem mudança" e a reta de regressão (mínimos
   quadrados) para leitura visual imediata do quanto o padrão de 2022
   ainda explica o cenário de 2026 — a mesma leitura de "swing" que
   agregadores como o pdvoto mostram entre duas eleições. */
function renderCorrelation(){
  const svg = document.getElementById('corrSvg');
  const statsEl = document.getElementById('corrStats');
  if(!svg) return;
  const pts = correlationPoints();
  if(pts.length < 2){
    svg.innerHTML = '<foreignObject x="0" y="0" width="640" height="360"><div xmlns="http://www.w3.org/1999/xhtml" class="chart-empty">Cadastre pesquisas em pelo menos 2 estados para calcular a correlação com 2022.</div></foreignObject>';
    if(statsEl) statsEl.innerHTML = '';
    return;
  }
  const xsData = pts.map(p=>p.x), ysData = pts.map(p=>p.y);
  const r = pearsonCorrelation(xsData, ysData);
  const r2 = r*r;
  const fit = olsRegression(xsData, ysData);

  const allVals = xsData.concat(ysData);
  let dmin = Math.floor((Math.min(...allVals)-5)/10)*10;
  let dmax = Math.ceil((Math.max(...allVals)+5)/10)*10;
  dmin = Math.max(0, dmin); dmax = Math.min(100, dmax);
  if(dmax-dmin < 20){ dmin=Math.max(0,dmin-10); dmax=Math.min(100,dmax+10); }

  const W=640,H=640,padL=48,padR=22,padT=22,padB=48;
  const plotW = W-padL-padR, plotH = H-padT-padB;
  const xOf = v => padL + ((v-dmin)/(dmax-dmin))*plotW;
  const yOf = v => padT + (1-(v-dmin)/(dmax-dmin))*plotH;

  let svgc='';
  // grade quadrada — mesmas marcas nos dois eixos, pra deixar claro que é a mesma escala (0–100%)
  for(let v=Math.ceil(dmin/10)*10; v<=dmax; v+=10){
    const x=xOf(v), y=yOf(v);
    const major = v%20===0;
    svgc += '<line x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+(H-padB)+'" class="gridline'+(major?'':' minor')+'"/>';
    svgc += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" class="gridline'+(major?'':' minor')+'"/>';
    if(major){
      svgc += '<text x="'+x.toFixed(1)+'" y="'+(H-padB+16)+'" class="axislabel" text-anchor="middle">'+v+'%</text>';
      svgc += '<text x="'+(padL-8)+'" y="'+(y+3.5).toFixed(1)+'" class="axislabel" text-anchor="end">'+v+'%</text>';
    }
  }
  svgc += '<line x1="'+padL+'" y1="'+(H-padB)+'" x2="'+(W-padR)+'" y2="'+(H-padB)+'" class="gridline strong"/>';
  svgc += '<line x1="'+padL+'" y1="'+padT+'" x2="'+padL+'" y2="'+(H-padB)+'" class="gridline strong"/>';
  svgc += '<text x="'+((padL+W-padR)/2).toFixed(1)+'" y="'+(H-14)+'" class="axistitle" text-anchor="middle">% de Lula — resultado oficial 2022</text>';
  svgc += '<text x="16" y="'+((padT+H-padB)/2).toFixed(1)+'" class="axistitle" text-anchor="middle" transform="rotate(-90 16 '+((padT+H-padB)/2).toFixed(1)+')">% de Lula — média atual (2026)</text>';

  // diagonal "sem mudança" (y = x)
  svgc += '<path d="M'+xOf(dmin).toFixed(1)+','+yOf(dmin).toFixed(1)+' L'+xOf(dmax).toFixed(1)+','+yOf(dmax).toFixed(1)+'" class="diagline"/>';
  svgc += '<text x="'+(xOf(dmax)-6).toFixed(1)+'" y="'+(yOf(dmax)-8).toFixed(1)+'" class="diaglabel" text-anchor="end">sem mudança vs 2022</text>';

  // reta de regressão (mínimos quadrados) entre os pontos
  const fitY1 = fit.intercept + fit.slope*dmin, fitY2 = fit.intercept + fit.slope*dmax;
  svgc += '<path d="M'+xOf(dmin).toFixed(1)+','+yOf(fitY1).toFixed(1)+' L'+xOf(dmax).toFixed(1)+','+yOf(fitY2).toFixed(1)+'" class="fitline"/>';

  // legenda
  svgc += '<g class="chartlegend">'+
    '<circle cx="'+(padL+6)+'" cy="'+(padT+10)+'" r="4.5" fill="var(--up)"/><text x="'+(padL+16)+'" y="'+(padT+13.5)+'" class="corrlegend">Avançou vs 2022</text>'+
    '<circle cx="'+(padL+140)+'" cy="'+(padT+10)+'" r="4.5" fill="var(--down)"/><text x="'+(padL+150)+'" y="'+(padT+13.5)+'" class="corrlegend">Recuou vs 2022</text>'+
  '</g>';

  pts.forEach(p=>{
    const x=xOf(p.x), y=yOf(p.y);
    const cls = p.delta>0.5?'up':p.delta<-0.5?'down':'flat';
    svgc += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="6.5" class="corr-dot '+cls+'" data-uf="'+p.uf+'"><title>'+NAMES[p.uf]+' ('+p.uf+')\n2022: '+p.x.toFixed(1)+'% · agora: '+p.y.toFixed(1)+'% · variação: '+fmtPP(p.delta)+' · '+p.n+' pesquisa(s)</title></circle>';
    svgc += '<text x="'+(x+9).toFixed(1)+'" y="'+(y+3.2).toFixed(1)+'" class="corr-label">'+p.uf+'</text>';
  });

  svg.innerHTML = svgc;
  attachCorrHover(svg, pts, xOf, yOf);

  if(statsEl){
    const tier = r>=0.7 ? 'padrão de 2022 fortemente preservado'
      : r>=0.4 ? 'padrão de 2022 parcialmente preservado'
      : r>=0 ? 'padrão de 2022 fracamente relacionado'
      : 'padrão de 2022 invertido';
    statsEl.innerHTML =
      '<div class="corrstat"><div class="k">Correlação de Pearson (r)</div><div class="v">'+r.toFixed(3)+'</div></div>'+
      '<div class="corrstat"><div class="k">R² (variância explicada)</div><div class="v">'+(r2*100).toFixed(1)+'<span class="unit">%</span></div></div>'+
      '<div class="corrstat"><div class="k">Estados na amostra</div><div class="v">'+pts.length+'<span class="unit">/ 27</span></div></div>'+
      '<div class="corrstat"><div class="k">Leitura</div><div class="v" style="font-size:.92rem;line-height:1.3;">'+tier+'</div></div>';
  }
}
function attachCorrHover(svg, pts, xOf, yOf){
  const tooltip = document.getElementById('corrTooltip');
  const wrap = document.getElementById('corrSvgWrap');
  if(!tooltip || !wrap) return;
  svg.querySelectorAll('.corr-dot').forEach(dot=>{
    const uf = dot.getAttribute('data-uf');
    const p = pts.find(x=>x.uf===uf);
    if(!p) return;
    dot.addEventListener('mouseenter', ()=>{
      dot.classList.add('hi');
      const rect = svg.getBoundingClientRect();
      const x = xOf(p.x)*(rect.width/640), y = yOf(p.y)*(rect.width/640);
      tooltip.hidden=false;
      tooltip.innerHTML = '<span class="tt-date">'+NAMES[uf]+' ('+uf+')</span>'+
        '2022: <b>'+p.x.toFixed(1)+'%</b> · agora: <b>'+p.y.toFixed(1)+'%</b><br>'+
        'variação: <b>'+fmtPP(p.delta)+'</b> · '+p.n+' pesquisa'+(p.n===1?'':'s');
      tooltip.style.left = Math.min(Math.max(x,60), rect.width-60)+'px';
      tooltip.style.top = Math.max(y,24)+'px';
    });
    dot.addEventListener('mouseleave', ()=>{ dot.classList.remove('hi'); tooltip.hidden=true; });
  });
}

/* ---------- Probabilidade de vitória: simulação de Monte Carlo ----------
   Mesma família de modelos de FiveThirtyEight / The Economist / Split Ticket:
   o resultado de cada estado = média das pesquisas + choque NACIONAL (comum a
   todos) + choque REGIONAL (comum à região) + erro PRÓPRIO do estado. Os erros
   compartilhados criam correlação entre estados (se as pesquisas erram para um
   lado, erram juntas) — sem isso a probabilidade sairia absurdamente confiante.
   Cada simulação soma os 27 estados ponderados pelo peso eleitoral; a
   probabilidade de vitória é a fração das simulações com Lula > 50%.
   Gerador pseudoaleatório com semente fixa: o resultado é estável entre recarregamentos. */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function randn(r){ let u=0; while(!u) u=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*r()); }
function monteCarlo(){
  if(!Object.values(DATA).some(s=>(s.polls||[]).length)) return null;
  const rnd = mulberry32(20261025), days = Math.max(0, daysBetweenDates(todayISO(), ELECTION_DAY));
  const natSd = Math.sqrt(MC_NATIONAL_SD**2 + MC_DRIFT_PER_SQRT_DAY**2*days);
  const sts = Object.keys(DATA).map(uf=>{
    const a = stateAvgBase(uf), d = stateDispersion(uf), sem = d.moe!==null ? d.moe/Z95 : 0;
    return {uf, region:REGION_OF[uf], w:DATA[uf].weight, wins:0,
      center: a.has ? a.lula : BASELINE_2022[uf].lula,
      sd: a.has ? Math.sqrt(sem**2 + MC_STATE_SD**2) : MC_NOPOLL_SD};
  });
  const totW = sts.reduce((x,t)=>x+t.w,0), res = new Float64Array(MC_SIMS);
  for(let i=0;i<MC_SIMS;i++){
    const nat = randn(rnd)*natSd, reg = {}; let sum=0;
    sts.forEach(t=>{
      if(reg[t.region]===undefined) reg[t.region] = randn(rnd)*MC_REGION_SD;
      const l = clampPct(t.center + nat + reg[t.region] + randn(rnd)*t.sd);
      if(l>50) t.wins++; sum += l*t.w;
    });
    res[i] = sum/totW;
  }
  const sorted = Array.from(res).sort((a,b)=>a-b), pct = q => sorted[Math.min(MC_SIMS-1, Math.floor(q*MC_SIMS))];
  return {res, pWin: res.filter(v=>v>50).length/MC_SIMS, mean: res.reduce((x,v)=>x+v,0)/MC_SIMS,
          p5:pct(.05), p95:pct(.95), p01:pct(.001), p99:pct(.999), states: sts.map(t=>({uf:t.uf, p:t.wins/MC_SIMS}))};
}
function nationalScenario(sc){
  let sl=0, sw=0;
  for(const uf in DATA){ const a=stateAvgBase(uf); if(!a.has) continue; const w=DATA[uf].weight;
    sl += clampPct(a.lula + (sc==='base'?0:(sc==='lula'?1:-1)*scenarioMoe(uf))) * w; sw += w; }
  return sw ? sl/sw : null;
}
function renderProb(){
  const svg=document.getElementById('probSvg'), st=document.getElementById('probStats'), sc=document.getElementById('probScenarios'), ul=document.getElementById('probStates');
  if(!svg) return;
  const mc = monteCarlo(); const lp=document.getElementById('leadProb');
  if(lp) lp.innerHTML = mc ? '<span class="probchip lula">Lula '+(mc.pWin*100).toFixed(0)+'% de chance</span><span class="probchip opp">Flávio '+(100-mc.pWin*100).toFixed(0)+'% de chance</span>' : '';
  if(!mc){
    svg.innerHTML='<foreignObject x="0" y="0" width="800" height="320"><div xmlns="http://www.w3.org/1999/xhtml" class="chart-empty">Cadastre pesquisas para simular a probabilidade de vitória.</div></foreignObject>';
    st.innerHTML=''; sc.innerHTML=''; ul.innerHTML=''; return;
  }
  const W=800,H=320,padL=42,padR=20,padT=26,padB=42, bw=0.5;
  const lo=Math.floor(Math.min(mc.p01,48)-1), hi=Math.ceil(Math.max(mc.p99,52)+1), nb=Math.ceil((hi-lo)/bw), cnt=new Array(nb).fill(0);
  mc.res.forEach(v=>{ const k=Math.floor((v-lo)/bw); if(k>=0&&k<nb) cnt[k]++; });
  const mx=Math.max(...cnt), xOf=v=>padL+(v-lo)/(hi-lo)*(W-padL-padR), yOf=c=>H-padB-(c/mx)*(H-padT-padB-8);
  let g='';
  for(let v=Math.ceil(lo/2)*2; v<=hi; v+=2) g+='<line x1="'+xOf(v).toFixed(1)+'" y1="'+padT+'" x2="'+xOf(v).toFixed(1)+'" y2="'+(H-padB)+'" class="gridline vgrid"/><text x="'+xOf(v).toFixed(1)+'" y="'+(H-padB+16)+'" class="axislabel" text-anchor="middle">'+v+'%</text>';
  cnt.forEach((c,k)=>{ const x0=xOf(lo+k*bw), mid=lo+(k+.5)*bw;
    g+='<rect x="'+(x0+.6).toFixed(1)+'" y="'+yOf(c).toFixed(1)+'" width="'+(xOf(lo+bw)-xOf(lo)-1.2).toFixed(1)+'" height="'+(H-padB-yOf(c)).toFixed(1)+'" class="mc-bar '+(mid>50?'lula':'opp')+'"><title>'+(lo+k*bw).toFixed(1)+'–'+(lo+(k+1)*bw).toFixed(1)+'% de Lula: '+(c/MC_SIMS*100).toFixed(1)+'% das simulações</title></rect>'; });
  g+='<line x1="'+padL+'" y1="'+(H-padB)+'" x2="'+(W-padR)+'" y2="'+(H-padB)+'" class="gridline strong"/>';
  g+='<line x1="'+xOf(50).toFixed(1)+'" y1="'+padT+'" x2="'+xOf(50).toFixed(1)+'" y2="'+(H-padB)+'" class="electionline"/><text x="'+xOf(50).toFixed(1)+'" y="'+(padT-9)+'" class="axislabel electionlabel" text-anchor="middle">50% · maioria</text>';
  [['p5',mc.p5],['p95',mc.p95]].forEach(([k,v])=>{ g+='<line x1="'+xOf(v).toFixed(1)+'" y1="'+(H-padB)+'" x2="'+xOf(v).toFixed(1)+'" y2="'+(H-padB+6)+'" class="gridline strong"/>'; });
  g+='<text x="'+padL+'" y="'+(H-6)+'" class="axislabel">Intervalo de 90%: '+mc.p5.toFixed(1)+'% a '+mc.p95.toFixed(1)+'% de Lula · eixo X = % nacional de Lula · altura = frequência nas '+MC_SIMS.toLocaleString('pt-BR')+' simulações</text>';
  svg.innerHTML=g;
  const pl=(mc.pWin*100), pf=100-pl;
  st.innerHTML='<div class="corrstat"><div class="k">Chance de vitória — Lula</div><div class="v">'+pl.toFixed(1)+'<span class="unit">%</span></div></div>'+
    '<div class="corrstat"><div class="k">Chance de vitória — Flávio</div><div class="v">'+pf.toFixed(1)+'<span class="unit">%</span></div></div>'+
    '<div class="corrstat"><div class="k">Resultado esperado (Lula)</div><div class="v">'+mc.mean.toFixed(1)+'<span class="unit">%</span></div></div>'+
    '<div class="corrstat"><div class="k">Intervalo de 90%</div><div class="v" style="font-size:.95rem;">'+mc.p5.toFixed(1)+'% – '+mc.p95.toFixed(1)+'%</div></div>';
  const card=(t,d,k)=>{ const l=nationalScenario(k); if(l===null) return '';
    return '<div class="projcard '+(k==='lula'?'wls':'ols')+'"><div class="projcard-head"><span class="projdot"></span><h4>'+t+'</h4></div><p class="projdesc">'+d+'</p><div class="projresult"><b>Lula '+l.toFixed(1)+'%</b><span class="muted">× Flávio '+(100-l).toFixed(1)+'%</span></div><div class="projmeta">'+(l>50?'Lula vence':l<50?'Flávio vence':'Empate')+' por '+Math.abs(2*l-100).toFixed(1)+' p.p.</div></div>'; };
  sc.innerHTML = card('Média das pesquisas','Sem ajuste: média de cada estado como está.','base')+
    card('Margem de erro a favor de Lula','Soma a margem de erro prevista de cada estado (IC95% entre pesquisas; '+FALLBACK_MOE+' p.p. se só há 1 pesquisa) ao Lula.','lula')+
    card('Margem de erro a favor de Flávio','Subtrai de Lula a margem de erro prevista de cada estado, favorecendo Flávio.','flavio');
  ul.innerHTML = mc.states.filter(x=>stateAvgBase(x.uf).has).sort((a,b)=>Math.abs(a.p-.5)-Math.abs(b.p-.5)).slice(0,8).map(x=>
    '<div class="rowbar clickable" data-uf="'+x.uf+'" tabindex="0" role="button"><div class="uf">'+x.uf+'</div><div class="track"><div class="fill" style="width:'+(x.p*100)+'%;background:'+colorFor(50+(x.p-.5)*50)+'"></div></div><div class="pct">'+(x.p*100).toFixed(0)+'%</div></div>').join('');
}

function renderAll(){
  HOUSE_EFFECTS = houseEffects();
  renderMap(); renderBar(); renderRank(); renderTimeline(); renderStats(); renderRegions(); renderInstitutes(); renderCorrelation(); renderProb();
  if(selectedUF) renderPanel(selectedUF);
}

const isMobile=()=>window.matchMedia('(max-width:720px)').matches;
function buzz(ms){ try{ navigator.vibrate&&navigator.vibrate(ms); }catch(e){} }
function closeSheet(){ document.body.classList.remove('sheet-open'); const s=document.getElementById('side'); if(s) s.style.transform=''; }
function openPanel(uf){
  selectedUF=uf;
  editingIndex=null;
  renderPanel(uf);
  const _s=document.getElementById('ufSelect'); if(_s) _s.value=uf;
  if(isMobile()){ document.body.classList.add('sheet-open'); document.getElementById('side').scrollTop=0; buzz(8); }
  else if(window.matchMedia('(max-width:960px)').matches) document.getElementById('panel').scrollIntoView({behavior:'smooth',block:'start'});
}
const METHOD_LABEL = {ponderada:'ponderada por credibilidade e recência', simples:'simples', ajustada:'ponderada + efeito de casa corrigido'};
function renderPanel(uf){
  const avg=stateAvg(uf);
  const base=BASELINE_2022[uf];
  const delta=stateDelta(uf);
  const disp=stateDispersion(uf);
  const trend=stateTrendSimple(uf);
  const stale=stateStale(uf);
  const polls=(DATA[uf].polls||[]).map((p,i)=>({...p,_i:i})).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  const editing = editingIndex!==null ? (DATA[uf].polls||[])[editingIndex] : null;
  let rows = polls.map(p=>{
    const rw = p.date ? recencyWeight(p.date) : 1;
    return '<tr'+(p._i===editingIndex?' class="editing"':'')+'><td>'+p.inst+'</td><td class="num">'+fmtDate(p.date)+'</td><td class="num">'+p.lula.toFixed(1)+'%</td><td class="num">'+p.opp.toFixed(1)+'%</td><td class="num">'+p.cred+'</td><td class="num" title="Peso por recência (meia-vida de '+RECENCY_HALF_LIFE_DAYS+' dias)">'+Math.round(rw*100)+'%</td>'+
      '<td class="rowactions"><button class="ic ed" data-i="'+p._i+'" title="Editar pesquisa" aria-label="Editar pesquisa">'+icon('edit')+'</button><button class="ic rm" data-i="'+p._i+'" title="Remover pesquisa" aria-label="Remover pesquisa">'+icon('remove')+'</button></td></tr>';
  }).join('');
  const avgLine = avg.has
    ? 'Média atual ('+METHOD_LABEL[method]+'): <b>Lula '+avg.lula.toFixed(1)+'%</b>'+(disp.moe!==null?' <span class="moe">± '+disp.moe.toFixed(1)+' p.p.</span>':'')+' × <b>Flávio '+avg.opp.toFixed(1)+'%</b>'
    : 'Nenhuma pesquisa cadastrada ainda para este estado.';
  const badgeRow = avg.has ? (
    '<div class="statsrow">'+
      '<span class="tierbadge '+disp.tier+'" title="Baseada no número de pesquisas e na concordância entre elas">'+
        signalIcon(disp.tier)+' '+TIER_LABEL[disp.tier]+' · '+disp.n+' pesquisa'+(disp.n===1?'':'s')+
      '</span>'+
      (disp.divergence!==null && disp.n>1 ? '<span class="divbadge" title="Diferença entre a pesquisa mais alta e a mais baixa (Lula) no estado">'+icon('divergence')+' divergência '+disp.divergence.toFixed(1)+' p.p.</span>' : '')+
      (trend ? '<span class="ppbadge '+trend.dir+'">'+trendIcon(trend.dir)+' tendência '+(trend.delta>0?'+':'')+trend.delta.toFixed(1)+' p.p. desde '+fmtDate(trend.from.date)+'</span>' : '')+
      (stale.stale ? '<span class="stalebadge" title="Pesquisa mais recente cadastrada há '+stale.days+' dias">'+icon('clock')+' dado desatualizado ('+stale.days+' dias)</span>' : '')+
    '</div>'
  ) : '';
  const compareBlock = base ? (
    '<div class="compare2022">'+
      '<div class="c22-row"><span>2022 — Lula</span><b>'+base.lula.toFixed(2)+'%</b></div>'+
      '<div class="c22-row"><span>2022 — Bolsonaro (pai)</span><b>'+base.bolsonaro.toFixed(2)+'%</b></div>'+
      (avg.has ? '<div class="c22-row highlight"><span>Variação de Lula em relação a 2022</span><span class="ppbadge '+ppClass(delta)+'">'+ppArrow(delta)+' '+fmtPP(delta)+'</span></div>'
               : '<div class="c22-row muted"><span>Sem pesquisas para calcular a variação ainda</span></div>')+
    '</div>'
  ) : '';
  document.getElementById('panel').innerHTML =
    '<h2>'+NAMES[uf]+' <span class="sub" style="font-weight:400;">('+uf+')</span></h2>'+
    '<div class="sub">Peso no total nacional (2022): '+(DATA[uf].weight*100).toFixed(1)+'% · Região: '+REGION_OF[uf]+'</div>'+
    '<div class="avg">'+avgLine+'</div>'+
    badgeRow+
    compareBlock+
    (polls.length ? '<div class="table-scroll"><table><thead><tr><th>Instituto</th><th>Data</th><th>Lula</th><th>Flávio</th><th>Cred.</th><th>Peso</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>' : '')+
    '<button id="openAddBtn" type="button">'+icon('add')+' Adicionar pesquisa</button>';
  document.querySelectorAll('.ic.rm').forEach(b=>b.addEventListener('click', async e=>{
    const i=parseInt(e.target.closest('button').dataset.i);
    if(!(await ensureAuth())) return;
    if(!confirm('Remover esta pesquisa?')) return;
    const gone=(DATA[uf]&&DATA[uf].polls||[])[i];
    try{ await removePoll(uf, i); toastUndo('Pesquisa removida.', gone, uf); if(editingIndex===i) closePollModal(); await refresh(); }catch(err){ toast('Erro ao remover: '+err.message); }
  }));
  document.querySelectorAll('.ic.ed').forEach(b=>b.addEventListener('click', async e=>{
    const i=parseInt(e.target.closest('button').dataset.i);
    if(!(await ensureAuth())) return;
    openPollModal(uf, i);
  }));
  document.getElementById('openAddBtn').addEventListener('click', async ()=>{ if(await ensureAuth()) openPollModal(uf, null); });
}

/* ---------- Modal de adicionar/editar pesquisa --------------------------
   O formulário só existe dentro do modal agora — nunca mais empurra o
   mapa pra baixo. A mesma marcação de antes, só que gerada à parte e
   injetada em #modalBody quando o modal abre. */
function pollFormHTML(uf, editing){
  return (editing ? '<div class="full editnotice">'+icon('edit')+' Editando pesquisa de "'+editing.inst+'" — altere os campos e salve.</div>' : '')+
    '<div class="full"><label>Instituto de pesquisa</label><input id="f-inst" placeholder="Ex: Datafolha" value="'+(editing?editing.inst:'')+'"></div>'+
    '<div class="full"><label>Data da pesquisa</label><input id="f-date" type="date" value="'+(editing?editing.date:todayISO())+'"></div>'+
    '<div><label>Lula %</label><input id="f-lula" type="number" step="0.1" min="0" max="100" value="'+(editing?editing.lula:'')+'"></div>'+
    '<div><label>Flávio % (auto = 100-Lula)</label><input id="f-opp" type="number" step="0.1" min="0" max="100" placeholder="opcional" value="'+(editing?editing.opp:'')+'"></div>'+
    '<div class="full"><label>Credibilidade (1=baixa, 5=alta)</label><input id="f-cred" type="number" min="1" max="5" value="'+(editing?editing.cred:3)+'"></div>'+
    (editing
      ? '<button id="addbtn" class="full">'+icon('save')+' Salvar alterações</button><button id="cancelbtn" class="full ghost" type="button">Cancelar</button>'
      : '<button id="addbtn" class="full">'+icon('add')+' Adicionar pesquisa</button>');
}
function openPollModal(uf, editIndex){
  editingIndex = editIndex;
  const editing = editIndex!==null ? (DATA[uf].polls||[])[editIndex] : null;
  document.getElementById('modalTitle').textContent = editing ? 'Editar pesquisa · '+NAMES[uf] : 'Adicionar pesquisa · '+NAMES[uf];
  document.getElementById('modalBody').innerHTML = '<div id="addform">'+pollFormHTML(uf, editing)+'</div>';
  document.getElementById('pollModalOverlay').hidden = false;
  document.body.classList.add('modal-open');
  const cancelbtn = document.getElementById('cancelbtn');
  if(cancelbtn) cancelbtn.addEventListener('click', closePollModal);
  document.getElementById('addbtn').addEventListener('click', async ()=>{
    const inst=document.getElementById('f-inst').value.trim()||'Pesquisa sem nome';
    const date=document.getElementById('f-date').value || todayISO();
    let lula=parseFloat(document.getElementById('f-lula').value);
    if(isNaN(lula)){ toast('Informe o % de Lula.','err'); document.getElementById('f-lula').focus(); return; }
    let opp=parseFloat(document.getElementById('f-opp').value);
    let cred=parseInt(document.getElementById('f-cred').value)||3;
    const payload = {inst,date,lula,opp:isNaN(opp)?undefined:opp,cred};
    try{
      if(editingIndex!==null){ await editPoll(uf, editingIndex, payload); }
      else { await addPoll(uf, payload); }
      closePollModal();
      await refresh(); toast('Pesquisa salva.');
    }
    catch(err){ toast('Erro ao salvar: '+err.message); }
  });
  document.getElementById('f-inst').focus();
  document.getElementById('addform').addEventListener('keydown',e=>{ if(e.key==='Enter' && e.target.tagName==='INPUT'){ e.preventDefault(); document.getElementById('addbtn').click(); } });
}
function closePollModal(){
  document.getElementById('pollModalOverlay').hidden = true;
  document.body.classList.remove('modal-open');
  editingIndex = null;
}
document.getElementById('modalClose').addEventListener('click', closePollModal);
document.getElementById('pollModalOverlay').addEventListener('click', e=>{
  if(e.target.id==='pollModalOverlay') closePollModal();
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && !document.getElementById('pollModalOverlay').hidden) closePollModal();
});

const TAB_TITLE={map:'Mapa',region:'Regiões',rank:'Ranking',time:'Evolução',prob:'Chances',inst:'Institutos'};
function selectTab(name){
  document.body.dataset.tab=name; document.title=(TAB_TITLE[name]||'Mapa')+' · Mapa Eleitoral do Brasil'; buzz(5);
  closeSheet(); if(isMobile()) window.scrollTo({top:0});
  try{ history.replaceState(null,'','#'+name); }catch(e){}
  document.querySelectorAll('nav#tabs button').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===name));
  document.querySelectorAll('nav#tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(name+'view').classList.add('active');
}
document.querySelectorAll('nav#tabs button').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
document.querySelectorAll('input[name=method]').forEach(r=>r.addEventListener('change',e=>{ method=e.target.value; renderAll(); }));
document.querySelectorAll('input[name=scenario]').forEach(r=>r.addEventListener('change',e=>{ scenario=e.target.value; renderAll(); }));
document.querySelectorAll('input[name=mapmode]').forEach(r=>r.addEventListener('change',e=>{ mapMode=e.target.value; renderMap(); }));

/* ---------- Botões "Baixar PNG" (mapa e gráfico de correlação) --------- */
function mapLegendForExport(){
  return mapMode==='variacao'
    ? [{color:'#b26a00', label:'Recuo de Lula vs 2022'}, {color:'#eceff1', label:'Sem dados / estável'}, {color:'#146c2e', label:'Avanço de Lula vs 2022'}]
    : [{color:'#0b57d0', label:'Flávio à frente'}, {color:'#eceff1', label:'Sem dados / empate'}, {color:'#b3261e', label:'Lula à frente'}];
}
const dlMapBtn = document.getElementById('dlMap');
if(dlMapBtn) dlMapBtn.addEventListener('click', ()=>{
  const modeLabel = mapMode==='variacao' ? 'Variação vs 2022 (p.p.)' : 'Intenção de voto — média ponderada das pesquisas';
  exportChartPNG('brmap', 'mapa-eleitoral-brasil-'+mapMode+'-'+todayISO()+'.png', {
    button: dlMapBtn,
    title: 'Mapa Eleitoral do Brasil',
    subtitle: modeLabel+' · Lula × Flávio Bolsonaro',
    legend: mapLegendForExport(),
    bg: '#ffffff'
  });
});
const dlCorrBtn = document.getElementById('dlCorr');
if(dlCorrBtn) dlCorrBtn.addEventListener('click', ()=>{
  const pts = correlationPoints();
  const r = pts.length>=2 ? pearsonCorrelation(pts.map(p=>p.x), pts.map(p=>p.y)) : null;
  exportChartPNG('corrSvg', 'correlacao-2022-vs-2026-'+todayISO()+'.png', {
    button: dlCorrBtn,
    title: 'Correlação: resultado oficial de 2022 × cenário atual (2026)',
    subtitle: r===null ? 'Dados insuficientes para calcular a correlação.' : 'Correlação de Pearson r = '+r.toFixed(3)+' · '+pts.length+' estado(s) com pesquisa cadastrada',
    legend: [{color:'#146c2e', label:'Avançou vs 2022'}, {color:'#b26a00', label:'Recuou vs 2022'}],
    bg: '#ffffff'
  });
});
const dlTimeBtn = document.getElementById('dlTime');
if(dlTimeBtn) dlTimeBtn.addEventListener('click', ()=> exportChartPNG('timeSvg','evolucao-media-nacional-'+todayISO()+'.png',{button:dlTimeBtn, title:'Evolução da média nacional — Lula × Flávio', subtitle:'Regressão local (LOESS) sobre a série de pesquisas · linhas pontilhadas = projeção até 25/10', legend:[{color:'#b3261e',label:'Lula'},{color:'#0b57d0',label:'Flávio'}]}));
document.addEventListener('keydown',e=>{ if(e.target.closest('input,select,textarea')||e.ctrlKey||e.metaKey||e.altKey) return; const i='123456'.indexOf(e.key); if(i>=0){ const b=document.querySelectorAll('#tabs button')[i]; if(b) b.click(); } });
const dlProbBtn = document.getElementById('dlProb');
if(dlProbBtn) dlProbBtn.addEventListener('click', ()=> exportChartPNG('probSvg','probabilidade-vitoria-'+todayISO()+'.png',{button:dlProbBtn, title:'Probabilidade de vitória — simulação de Monte Carlo', subtitle:'Distribuição do % nacional de Lula em '+MC_SIMS.toLocaleString('pt-BR')+' simulações com erros nacional, regional e estadual', legend:[{color:'#b3261e',label:'Lula vence'},{color:'#0b57d0',label:'Flávio vence'}], bg:'#ffffff'}));
document.getElementById('reset').addEventListener('click', async ()=>{
  if(!(await ensureAuth())) return;
  if(confirm('Remover todas as pesquisas cadastradas de todos os estados? Essa ação não pode ser desfeita.')){
    try{ await resetAll(); selectedUF=null; document.getElementById('panel').innerHTML='<p class="empty">Clique em um estado no mapa para ver e adicionar pesquisas.</p>'; await refresh(); }
    catch(err){ toast('Erro ao limpar: '+err.message); }
  }
});

async function refresh(){
  DATA = await fetchStates();
  renderAll();
  document.body.classList.remove('loading'); setSync('on');
}

async function init(){
  await loadGeoMap();
  buildSVG();
  buildWatermark();
  try{
    await refresh();
    setSync('on');
  }catch(err){
    setSync('err', 'Sem conexão com o servidor/MongoDB'); document.body.classList.remove('loading');
    console.error(err);
  }
}
/* Preferências lembradas (média, cenário, mapa), aba na URL (#rank), clique em linhas, botão "topo" */
function savePrefs(){ try{ localStorage.setItem('mapaPrefs', JSON.stringify({method, scenario, mapmode:mapMode})); }catch(e){} }
document.querySelectorAll('#controls input').forEach(r=>r.addEventListener('change',savePrefs));
(function restore(){
  try{ const s=JSON.parse(localStorage.getItem('mapaPrefs')||'{}');
    [['method',s.method],['scenario',s.scenario],['mapmode',s.mapmode]].forEach(([n,v])=>{ const r=v&&document.querySelector('input[name='+n+'][value="'+v+'"]');
      if(r){ r.checked=true; if(n==='method') method=v; else if(n==='scenario') scenario=v; else mapMode=v; } });
  }catch(e){}
  const h=location.hash.slice(1); if(h && document.getElementById(h+'view')) selectTab(h); else document.body.dataset.tab='map';
})();
function openFromRow(el){ const r=el.closest('.clickable[data-uf]'); if(r){ selectTab('map'); openPanel(r.dataset.uf); } }
document.addEventListener('click',e=>openFromRow(e.target));
document.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ') && e.target.matches && e.target.matches('.clickable[data-uf]')){ e.preventDefault(); openFromRow(e.target); } });
const toTop=document.getElementById('toTop');
if(toTop){ window.addEventListener('scroll',()=>{ toTop.hidden = window.scrollY<500; },{passive:true}); toTop.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'})); }
init();


/* ---------- Extras: sair, auto-atualização, CSV, resumo, atalho "/" ---------- */
document.getElementById('lockBtn').addEventListener('click', async ()=>{
  try{ await fetch('/api/auth/logout',{method:'POST',headers:{'Authorization':'Bearer '+authToken}}); }catch(e){}
  authToken=null; setAuthUI(); toast('Sessão de edição encerrada.');
});
setInterval(async ()=>{
  if(document.hidden || document.body.classList.contains('modal-open') || document.querySelector('.modal-overlay:not([hidden])')) return;
  try{ await refresh(); }catch(e){ setSync('err','Sem conexão — tentando de novo'); }
}, 60000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) refresh().catch(()=>{}); });
document.addEventListener('keydown', e=>{ if(e.key==='/' && !e.target.closest('input,select,textarea') && !e.ctrlKey && !e.metaKey){ const s=document.getElementById('ufSelect'); if(s){ e.preventDefault(); s.focus(); } } });

document.getElementById('exportCsv').addEventListener('click', ()=>{
  const q=v=>'"'+String(v).replace(/"/g,'""')+'"', rows=[['UF','Estado','Instituto','Data','Lula','Flavio','Credibilidade']];
  Object.keys(DATA).sort().forEach(uf=>(DATA[uf].polls||[]).forEach(p=>rows.push([uf,NAMES[uf]||uf,p.inst,p.date,p.lula,p.opp,p.cred])));
  if(rows.length===1){ toast('Não há pesquisas para exportar.'); return; }
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(q).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='pesquisas-'+todayISO()+'.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000); toast('CSV salvo: '+(rows.length-1)+' pesquisas.');
});
document.getElementById('copySum').addEventListener('click', async ()=>{
  let wl=0,wo=0,w=0,L=[],F=[],T=[],n=0;
  Object.keys(DATA).forEach(uf=>{ const a=stateAvg(uf); if(!a.has) return; n++; const wt=DATA[uf].weight||0; wl+=a.lula*wt; wo+=a.opp*wt; w+=wt;
    (Math.abs(a.lula-a.opp)<1?T:(a.lula>a.opp?L:F)).push(uf); });
  if(!n){ toast('Cadastre pesquisas antes de copiar o resumo.'); return; }
  const f1=v=>v.toFixed(1).replace('.',',');
  const txt='Mapa Eleitoral — '+fmtDate(todayISO())+'\nMédia ponderada nos estados com pesquisa ('+n+'/27):\nLula '+f1(wl/w)+'% × Flávio '+f1(wo/w)+'%\n\nLula à frente em '+L.length+': '+(L.join(', ')||'—')+'\nFlávio à frente em '+F.length+': '+(F.join(', ')||'—')+(T.length?'\nEmpate técnico: '+T.join(', '):'')+'\n\nPainel independente, não oficial.';
  try{ await navigator.clipboard.writeText(txt); toast('Resumo copiado.'); }catch(e){ window.prompt('Copie o resumo:',txt); }
});


/* ---------- Modo app: gaveta, arrastar para fechar, puxar para atualizar, PWA ---------- */
(function(){
  const side=document.getElementById('side'), handle=document.getElementById('sheetHandle');
  document.getElementById('sheetBackdrop').addEventListener('click',closeSheet);
  document.getElementById('sheetClose').addEventListener('click',closeSheet);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && document.body.classList.contains('sheet-open') && !document.querySelector('.modal-overlay:not([hidden])')) closeSheet(); });
  let y0=null, dy=0;
  handle.addEventListener('touchstart',e=>{ y0=e.touches[0].clientY; dy=0; side.style.transition='none'; },{passive:true});
  handle.addEventListener('touchmove',e=>{ if(y0===null) return; dy=Math.max(0,e.touches[0].clientY-y0); side.style.transform='translateY('+dy+'px)'; },{passive:true});
  handle.addEventListener('touchend',()=>{ if(y0===null) return; side.style.transition=''; if(dy>side.offsetHeight*0.25) closeSheet(); else side.style.transform=''; y0=null; });
  // também fecha arrastando para baixo quando o conteúdo está no topo
  let sy=null;
  side.addEventListener('touchstart',e=>{ sy = side.scrollTop<=0 ? e.touches[0].clientY : null; },{passive:true});
  side.addEventListener('touchend',e=>{ if(sy!==null && e.changedTouches[0].clientY-sy>110) closeSheet(); sy=null; });

  // puxar para atualizar (só no topo da página, sem gaveta/modal)
  const ptr=document.getElementById('ptr'); let p0=null, pd=0, busy=false;
  document.addEventListener('touchstart',e=>{ p0 = (isMobile() && window.scrollY<=0 && !busy && !document.body.classList.contains('sheet-open') && !document.body.classList.contains('modal-open') && !e.target.closest('.table-scroll,#stats,svg.chart,.chart-svg-wrap')) ? e.touches[0].clientY : null; },{passive:true});
  document.addEventListener('touchmove',e=>{ if(p0===null) return; pd=e.touches[0].clientY-p0; if(pd>0 && window.scrollY<=0){ const k=Math.min(pd,110); ptr.style.opacity=Math.min(1,k/70); ptr.style.transform='translateY('+(k-50)+'px) rotate('+(k*3)+'deg)'; } },{passive:true});
  document.addEventListener('touchend',async()=>{
    if(p0===null) return; const go=pd>85; p0=null; pd=0;
    if(!go){ ptr.style.opacity=0; ptr.style.transform=''; return; }
    busy=true; ptr.classList.add('spin'); ptr.style.transform='translateY(20px)'; buzz(10);
    try{ await refresh(); toast('Atualizado.'); }catch(e){ toast('Sem conexão.','err'); }
    ptr.classList.remove('spin'); ptr.style.opacity=0; ptr.style.transform=''; busy=false;
  });

  // tema da barra do sistema acompanha claro/escuro
  const tc=document.querySelector('meta[name=theme-color]');
  const mq=window.matchMedia('(prefers-color-scheme: dark)');
  const upd=()=>{ if(tc) tc.content = getComputedStyle(document.body).backgroundColor || '#ffffff'; };
  mq.addEventListener&&mq.addEventListener('change',upd); upd();

  if('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname!=='127.0.0.1'){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
})();


/* ---------- Detalhes finos (rodada 5) ---------- */
// 1) Copiar link do estado (#UF) e abrir estado direto pela URL
(function(){
  document.addEventListener('click',e=>{
    const t=e.target.closest('#panel h3, #panel h2'); if(!t || !selectedUF) return;
    const url=location.origin+location.pathname+'?uf='+selectedUF;
    (navigator.share && isMobile() ? navigator.share({title:'Mapa Eleitoral — '+NAMES[selectedUF],url}).catch(()=>{}) : navigator.clipboard.writeText(url).then(()=>toast('Link de '+NAMES[selectedUF]+' copiado.')).catch(()=>{}));
  });
  const q=new URLSearchParams(location.search).get('uf'); if(q) window.addEventListener('load',()=>setTimeout(()=>{ const u=q.toUpperCase(); if(NAMES[u]){ selectTab('map'); openPanel(u); } },900));
})();
// 2) Navegação por teclado entre estados no painel: ← → (ordem alfabética)
document.addEventListener('keydown',e=>{
  if(!selectedUF || e.target.closest('input,select,textarea') || e.ctrlKey||e.metaKey||e.altKey || document.querySelector('.modal-overlay:not([hidden])')) return;
  if(e.key!=='ArrowLeft' && e.key!=='ArrowRight') return;
  const ks=Object.keys(NAMES).sort((x,y)=>NAMES[x].localeCompare(NAMES[y],'pt-BR')), i=ks.indexOf(selectedUF);
  openPanel(ks[(i+(e.key==='ArrowRight'?1:-1)+ks.length)%ks.length]);
});
// 3) Aviso de offline / voltou a conexão
window.addEventListener('offline',()=>{ setSync('err','Offline — mostrando último dado'); toast('Você está offline.','err'); });
window.addEventListener('online',()=>{ toast('Conexão restaurada.'); refresh().catch(()=>{}); });
// 4) Contraste: destacar o estado selecionado no mapa trazendo-o para frente
const _rm=renderMap; renderMap=function(){ _rm.apply(this,arguments); const el=selectedUF&&document.getElementById('st-'+selectedUF); if(el&&el.parentNode) el.parentNode.insertBefore(el, el.parentNode.querySelector('.maplabel')||null); };
