// Interface das novas páginas: Histórico, comparação de Institutos, Simulador e Cenários.
// Depende de app.js (polls, cfg, $, ic, esc, f1, fd, today), stats.js e analytics.js.
(function () {
  const A = Analytics, p1 = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',')), pp = (v) => (v == null ? '—' : (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + ' pp');
  const pct = (v) => (v == null ? '—' : (v * 100 < 0.1 && v > 0 ? '<0,1' : (v * 100).toFixed(v > 0.99 || v < 0.01 ? 1 : 0).replace('.', ',')) + '%');
  const C = { L: 'var(--rd)', F: 'var(--bl)', D: '#6b5bd6', G: '#8a93a6' };
  const PAL = ['#d6334a', '#1f5fd6', '#11793f', '#c77700', '#7b3fb8', '#0e8a9c', '#a33c6b', '#5f6b7a'];
  const ref = () => cfg.ref || today();
  const hopts = () => ({ halfLife: +cfg.half || 14, scope: cfg.scope, tau: +cfg.tau || 1.5, houseEffect: cfg.house !== '0' });
  const mcBase = () => ({ sysErr: +cfg.sys, walk: +cfg.walk, intensity: +cfg.int, freq: +cfg.freq, sims: 20000, fan: false });
  const real = () => polls; // dados cadastrados (DEMO, se carregada, já é identificada na tabela)
  const minDate = () => real().map(A.avail).sort()[0] || ref();
  const shiftDate = (d, n) => S.toDate(S.toTime(d) + n * S.DAY);
  const xtip = '<div class="xtip" hidden></div>';
  const legend = (items) => `<div class="legend">${items.map((i) => `<span><i style="background:${i.c}"></i>${esc(i.n)}</span>`).join('')}</div>`;

  // ---------- gráfico de linhas genérico (SVG próprio, com cursor e dica) ----------
  function lineChart(box, o) {
    const W = Math.max(320, box.clientWidth || 900), H = W < 560 ? 260 : 340, m = { l: 46, r: 14, t: 14, b: 30 }, all = [];
    o.series.forEach((s) => s.pts.forEach((q) => { all.push(q); }));
    if (!all.length) { box.innerHTML = '<div class="empty">Sem dados suficientes para este período.</div>'; return; }
    let x0 = Math.min(...all.map((q) => q.t)), x1 = Math.max(...all.map((q) => q.t)); if (x0 === x1) { x0 -= S.DAY; x1 += S.DAY; }
    const ys = []; all.forEach((q) => { ys.push(q.y); if (o.band && q.lo != null) ys.push(q.lo, q.hi); }); if (o.ref != null) ys.push(o.ref);
    let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = Math.max(0.5, (y1 - y0) * 0.1); y0 -= padY; y1 += padY;
    const raw = (y1 - y0) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map((k) => k * mag).find((k) => k >= raw);
    y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
    const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r), Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.b - m.t);
    let g = ''; for (let v = y0; v <= y1 + 1e-9; v += step) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--bd)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(step < 1 ? 1 : 0).replace('.', ',')}${o.unit || ''}</text>`;
    for (let i = 0; i <= 4; i++) { const t = x0 + ((x1 - x0) * i) / 4; g += `<text x="${X(t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${S.toDate(t).slice(5).split('-').reverse().join('/')}</text>`; }
    if (o.ref != null) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" stroke="var(--tx)" stroke-dasharray="4 4" opacity=".6"/>`;
    let body = '';
    o.series.forEach((s) => {
      const pts = s.pts.slice().sort((a, b) => a.t - b.t);
      if (o.band && s.band) body += `<path d="M${pts.map((q) => X(q.t).toFixed(1) + ' ' + Y(q.hi).toFixed(1)).join('L')}L${pts.slice().reverse().map((q) => X(q.t).toFixed(1) + ' ' + Y(q.lo).toFixed(1)).join('L')}Z" fill="${s.color}" opacity=".13"/>`;
      if (!s.dots && pts.length > 1) body += `<path d="M${pts.map((q) => X(q.t).toFixed(1) + ' ' + Y(q.y).toFixed(1)).join('L')}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2.6}" ${s.dash ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round" class="draw"/>`;
      if (s.dots || pts.length === 1 || s.marks) body += pts.map((q) => `<circle cx="${X(q.t)}" cy="${Y(q.y)}" r="${s.dots ? 4.5 : 3}" fill="${s.dots ? '#fff' : s.color}" stroke="${s.color}" stroke-width="2"/>`).join('');
    });
    box.style.position = 'relative';
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="lc" role="img" aria-label="${esc(o.label || 'Gráfico')}">${g}${body}<line class="cur" y1="${m.t}" y2="${H - m.b}" stroke="var(--gr)" hidden/></svg>${xtip}`;
    const svg = box.querySelector('svg'), cur = svg.querySelector('.cur'), tip = box.querySelector('.xtip');
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, t = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0), rows = [];
      let tt = null;
      o.series.forEach((s) => { let b = null; s.pts.forEach((q) => { if (!b || Math.abs(q.t - t) < Math.abs(b.t - t)) b = q; }); if (b && Math.abs(b.t - t) <= Math.max(S.DAY * 2, (x1 - x0) / 25)) { rows.push(`<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${o.fmt ? o.fmt(b.y) : p1(b.y) + (o.unit || '')}</b>${o.band && b.lo != null && s.band ? ` <small>(${p1(b.lo)}–${p1(b.hi)})</small>` : ''}</div>`); tt = b.t; } });
      if (!rows.length) { tip.hidden = true; cur.setAttribute('hidden', ''); return; }
      cur.removeAttribute('hidden'); cur.setAttribute('x1', X(tt)); cur.setAttribute('x2', X(tt));
      tip.innerHTML = `<b>${fd(S.toDate(tt))}</b>${rows.join('')}`; tip.hidden = false;
      const left = (X(tt) / W) * r.width; tip.style.left = Math.min(Math.max(0, left + 12), r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '8px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; cur.setAttribute('hidden', ''); });
  }

  // ---------- esqueleto das páginas ----------
  const sec = (id, icon, title, sub, inner) => `<section data-page="${id}" hidden><h2>${ic(icon)}${title}</h2><p class="muted">${sub}</p>${inner}</section>`;
  const num = (id, lbl, v, min, max, step, hint) => `<label class="fld"><span>${lbl}</span><input id="${id}" type="number" value="${v}" min="${min}" max="${max}" step="${step}"><small>${hint}</small></label>`;
    function build() {
    const main = document.querySelector('main');
    const before = main.querySelector('[data-page="pesquisas"]');
    const html =
      sec('historico', 'chart', 'Histórico das pesquisas', 'Evolução diária da média de Lula e Flávio (votos válidos), recalculada dia a dia usando só pesquisas já divulgadas naquela data.',
        `<div class="card"><div class="tools"><div class="seg" id="hPre">${[[7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [0, 'Tudo']].map(([d, t]) => `<button class="btn" data-d="${d}">${t}</button>`).join('')}</div>
<label>De <input type="date" id="hFrom"></label><label>Até <input type="date" id="hTo"></label>
<label>Exibir <select id="hShow"><option value="both">Lula e Flávio</option><option value="lula">Só Lula</option><option value="flavio">Só Flávio</option><option value="diff">Diferença (Lula − Flávio)</option></select></label>
<label>Comparar com <select id="hCmp"><option value="">Nada</option><option value="simple">Média simples (sem pesos)</option><option value="polls">Pesquisas individuais (pontos)</option></select></label>
<label class="chk"><input type="checkbox" id="hBand" checked> Faixa de erro (95%)</label></div>
<div id="hChart"></div><div id="hLeg"></div><p class="muted small">Linha = média ponderada recalculada a cada dia (mesmo modelo da página Presidente). Faixa = ±1,96 × erro-padrão da média (<b>só erro amostral combinado</b>; não inclui viés sistemático das pesquisas). A média só muda quando entra uma pesquisa nova ou quando a recência pesa mais as antigas.</p></div>
<div class="card"><h3>${ic('arrows')}Comparação de tendências no período</h3><div class="scroll"><table id="hTrend"></table></div><p class="muted small" id="hTrendNote"></p></div>`) +
      sec('simulador', 'dice', 'Simulador eleitoral', 'Monte Carlo com até 1 bilhão de cenários: probabilidade de cada candidato superar o limiar de votos válidos, com debates, atos, apoios, escândalos, economia, mídia e hecatombes como choques de campanha.',
        `<div class="card"><h3>${ic('sliders')}Parâmetros</h3><div class="fgrid sim">
${`<label class="fld"><span>Data da eleição</span><input id="sElec" type="date"><small>Horizonte máximo: 120 dias.</small></label>`}
${num('sThr', 'Limiar de vitória (% válidos de Lula)', 50, 40, 60, 0.1, 'Padrão 50%: maioria dos votos válidos.')}
${num('sShift', 'Ajuste manual do nível de Lula (pp)', 0, -10, 10, 0.1, 'Hipótese: desloca a média atual. 0 = dados reais.')}
${num('sSys', 'Erro sistemático das pesquisas (σ, pp)', 2, 0, 8, 0.1, 'Viés comum a todos os institutos (cauda pesada, t de 5 gl).')}
${num('sWalk', 'Volatilidade diária residual (pp/dia)', 0.08, 0, 1, 0.01, 'Ruído de fundo; o resto da volatilidade vem dos choques.')}
${num('sTrend', 'Multiplicador da tendência', 1, 0, 2, 0.1, '0 = ignora tendência; 1 = estimada; 2 = dobra.')}
${num('sDamp', 'Persistência da tendência (0–1)', 0.95, 0.5, 1, 0.01, 'Quanto da tendência continua a cada dia.')}
<label class="fld"><span>Nº de simulações</span><select id="sSims"><option value="100000">100 mil</option><option value="250000">250 mil</option><option value="500000">500 mil</option><option value="1000000">1 milhão</option><option value="10000000">10 milhões</option><option value="100000000">100 milhões (minutos)</option><option value="1000000000">1 bilhão (vários minutos)</option></select><small>1 milhão: erro de sorteio da probabilidade ≈ ±0,1 pp.</small></label>
<label class="fld"><span>Perfil da campanha</span><select id="sPerfil"><option value="calma">Calma</option><option value="padrao" selected>Padrão</option><option value="turbulenta">Turbulenta</option><option value="caotica">Caótica</option><option value="custom">Personalizado</option></select><small>Define frequência e intensidade dos choques.</small></label>
${num('sFreq', 'Frequência dos choques', 1, 0, 3, 0.1, '1 = padrão; 2 = o dobro de acontecimentos.')}
${num('sInt', 'Intensidade dos choques', 1, 0, 3, 0.1, '1 = padrão; multiplica o tamanho de cada impacto.')}
<label class="fld"><span>Debates (dias antes da eleição)</span><input id="sDeb" type="text" value="12, 7, 2" inputmode="numeric"><small>Separe por vírgula. Vazio = sem debates.</small></label>
${num('sExpL', 'Exposição a choques: Lula', 1, 0, 2, 0.1, 'Multiplica a frequência dos acontecimentos de Lula.')}
${num('sExpF', 'Exposição a choques: Flávio', 1, 0, 2, 0.1, 'Multiplica a frequência dos acontecimentos de Flávio.')}
</div><h4>Tipos de acontecimentos incluídos</h4><div class="grpbox" id="sGrp">${MC.GROUPS.map((g) => `<label class="chk"><input type="checkbox" data-g="${g.id}" checked> ${g.name}</label>`).join('')}</div>
<div class="row"><label class="chk"><input type="checkbox" id="sShock" checked> Choques de campanha ligados</label><label class="chk"><input type="checkbox" id="sReg" checked> Regimes de campanha (calma / normal / turbulenta)</label><button class="btn" id="sReset">${ic('reset')}Restaurar padrões</button></div></div><div id="sOut"></div>`) +
      sec('cenarios', 'flask', 'Comparação de cenários', 'Simule novas pesquisas hipotéticas e veja o efeito na média nacional. <b>Cenários ficam só neste navegador e nunca alteram os dados reais.</b>',
        `<div class="banner">${ic('flask')}<span>Tudo nesta página é <b>hipotético</b>. Pesquisas simuladas não são salvas na base, não aparecem nas demais páginas e não representam resultados reais.</span></div>
<div class="card"><div class="tools"><button class="btn primary" id="scNew">${ic('plus')}Novo cenário</button><button class="btn" id="scExp">${ic('download')}Exportar cenários</button><label class="btn">${ic('upload')}Importar cenários<input type="file" id="scImp" accept=".json" hidden></label></div><div id="scList"></div></div>
<div id="scEdit"></div><div id="scOut"></div>`);
    before.insertAdjacentHTML('beforebegin', html);
    $('[data-page="institutos"]').insertAdjacentHTML('beforeend', `<div id="instX"></div>`);
    const nav = $('#nav'), mk = (h, i, t) => `<a href="#${h}">${ic(i)}${t}</a>`;
    nav.innerHTML = mk('presidente', 'chart', 'Presidente') + mk('historico', 'clock', 'Histórico') + mk('institutos', 'building', 'Institutos') + mk('simulador', 'dice', 'Simulador') + mk('cenarios', 'flask', 'Cenários') + mk('pesquisas', 'list', 'Pesquisas') + mk('metodologia', 'book', 'Metodologia') + mk('config', 'sliders', 'Configurações');
  }

  // ---------- Histórico ----------
  const H = { from: '', to: '', set: false };
  function histInit() {
    const sync = () => { $('#hFrom').value = H.from; $('#hTo').value = H.to; };
    $('#hPre').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const d = +b.dataset.d; H.to = ref(); H.from = d ? shiftDate(H.to, -d) : minDate(); sync(); hist(); });
    ['hFrom', 'hTo'].forEach((id) => $('#' + id).addEventListener('change', () => { H.from = $('#hFrom').value; H.to = $('#hTo').value; hist(); }));
    ['hShow', 'hCmp', 'hBand'].forEach((id) => $('#' + id).addEventListener('change', hist));
  }
  function hist() {
    if (!polls.length) { $('#hChart').innerHTML = '<div class="empty">Nenhuma pesquisa cadastrada.</div>'; $('#hLeg').innerHTML = ''; $('#hTrend').innerHTML = ''; return; }
    if (!H.set) { H.to = ref(); H.from = minDate(); H.set = true; }
    $('#hFrom').value = H.from; $('#hTo').value = H.to;
    if (H.from > H.to) { $('#hChart').innerHTML = '<div class="empty">A data inicial é posterior à final.</div>'; return; }
    const ser = A.dailySeries(real(), H.from, H.to, hopts());
    const show = $('#hShow').value, cmp = $('#hCmp').value, band = $('#hBand').checked, S_ = [], L = [];
    const pts = (k, lo, hi) => ser.map((s) => ({ t: s.t, y: s[k], lo: lo && s[lo], hi: hi && s[hi] }));
    if (show === 'diff') { S_.push({ name: 'Lula − Flávio (pp)', color: C.D, pts: ser.map((s) => ({ t: s.t, y: s.diff, lo: 2 * (s.lo - s.l) + s.diff, hi: 2 * (s.hi - s.l) + s.diff })), band: true }); L.push({ n: 'Lula − Flávio (pp)', c: C.D }); }
    if (show === 'both' || show === 'lula') { S_.push({ name: 'Lula (média)', color: C.L, pts: pts('l', 'lo', 'hi'), band: true }); L.push({ n: 'Lula', c: C.L }); }
    if (show === 'both' || show === 'flavio') { S_.push({ name: 'Flávio (média)', color: C.F, pts: ser.map((s) => ({ t: s.t, y: s.f, lo: 100 - s.hi, hi: 100 - s.lo })), band: true }); L.push({ n: 'Flávio', c: C.F }); }
    if (cmp === 'simple' && show !== 'diff') {
      if (show !== 'flavio') { S_.push({ name: 'Lula (média simples)', color: C.L, dash: true, w: 1.8, pts: pts('simpleL') }); }
      if (show !== 'lula') { S_.push({ name: 'Flávio (média simples)', color: C.F, dash: true, w: 1.8, pts: ser.map((s) => ({ t: s.t, y: 100 - s.simpleL })) }); }
      L.push({ n: 'Tracejado = média simples', c: C.G });
    }
    if (cmp === 'polls' && show !== 'diff') {
      const ps = real().filter((p) => p.fieldEnd >= H.from && p.fieldEnd <= H.to && S.validShares(p));
      if (show !== 'flavio') S_.push({ name: 'Lula (pesquisa)', color: C.L, dots: true, pts: ps.map((p) => ({ t: S.toTime(p.fieldEnd), y: S.validShares(p).l })) });
      if (show !== 'lula') S_.push({ name: 'Flávio (pesquisa)', color: C.F, dots: true, pts: ps.map((p) => ({ t: S.toTime(p.fieldEnd), y: S.validShares(p).f })) });
      L.push({ n: 'Círculos = pesquisas (fim do campo)', c: C.G });
    }
    lineChart($('#hChart'), { series: S_, band, unit: show === 'diff' ? '' : '%', ref: show === 'diff' ? 0 : 50, label: 'Evolução da média de Lula e Flávio', fmt: show === 'diff' ? (v) => pp(v) : null });
    $('#hLeg').innerHTML = legend(L);
    const rows = [['Lula', 'l', C.L], ['Flávio', 'f', C.F], ['Diferença (Lula − Flávio)', 'diff', C.D]].map(([n, k, c]) => ({ n, c, t: A.trend(ser, k) }));
    $('#hTrend').innerHTML = `<tr><th>Série</th><th>Início</th><th>Fim</th><th>Variação</th><th>Inclinação (pp/dia)</th></tr>` + rows.map((r) => r.t ? `<tr><td><i class="dot" style="background:${r.c}"></i>${r.n}</td><td>${p1(r.t.first)}${k_(r.n)}</td><td>${p1(r.t.last)}${k_(r.n)}</td><td><b>${pp(r.t.change)}</b></td><td>${r.t.slopeSe != null ? (r.t.slope >= 0 ? '+' : '−') + Math.abs(r.t.slope).toFixed(3).replace('.', ',') + ' ± ' + (1.96 * r.t.slopeSe).toFixed(3).replace('.', ',') : '—'}</td></tr>` : `<tr><td>${r.n}</td><td colspan="4" class="muted">Pontos insuficientes no período.</td></tr>`).join('');
    $('#hTrendNote').textContent = ser.length < 2 ? 'É preciso ao menos 2 dias com média calculada para medir tendência.' : `Base: ${ser.length} dias com média no período. Inclinação por regressão linear simples (± = intervalo de 95%, ignora autocorrelação dos dias, que são calculados com pesquisas em comum: trate como indicativo, não como teste de significância).`;
  }
  const k_ = (n) => (n.startsWith('Dif') ? ' pp' : '%');

  // ---------- Institutos ----------
  const IX = { sel: null };
  function instX() {
    const el = $('#instX'); if (!el) return;
    if (!polls.length) { el.innerHTML = ''; return; }
    const rep = A.instituteReport(real(), ref(), hopts()); if (!IX.sel) IX.sel = new Set(rep.map((r) => r.institute));
    const colorOf = (n) => PAL[rep.findIndex((r) => r.institute === n) % PAL.length];
    const maxDev = Math.max(1, ...rep.map((r) => Math.abs(r.meanDev || 0)));
    const sel = rep.filter((r) => IX.sel.has(r.institute));
    el.innerHTML = `<div class="card"><h3>${ic('scale')}Comparação entre institutos</h3><p class="muted small">Todos os valores vêm dos cadastros. “—” = dado não informado ou sem base de comparação (nada é estimado para preencher lacunas).</p><div class="scroll"><table class="cmp"><tr><th>Instituto</th><th>Pesquisas</th><th>Período de campo</th><th>Método(s)</th><th>Amostra média</th><th>n efetivo médio</th><th>MoE média</th><th>Última (L–F, válidos)</th><th>Peso na média</th><th>Desvio vs. outros (pp)</th><th>Efeito de instituto (modelo)</th></tr>
${rep.map((r) => `<tr><td><label class="chk"><input type="checkbox" data-i="${esc(r.institute)}" ${IX.sel.has(r.institute) ? 'checked' : ''}><i class="dot" style="background:${colorOf(r.institute)}"></i><b>${esc(r.institute)}</b></label></td><td>${r.count}</td><td>${fd(r.first)} → ${fd(r.last)}</td><td>${r.methods.map(esc).join(', ') || '—'}</td><td>${r.meanSample ? Math.round(r.meanSample).toLocaleString('pt-BR') : '—'}</td><td>${r.meanNeff ? Math.round(r.meanNeff).toLocaleString('pt-BR') : '—'}</td><td>${r.meanMoe ? '±' + p1(r.meanMoe) + ' pp' : '—'}</td><td>${r.lastL != null ? p1(r.lastL) + ' – ' + p1(r.lastF) : '—'}</td><td>${r.lastWeightShare != null ? pct(r.lastWeightShare) : '—'}</td><td>${r.meanDev != null ? `<b>${pp(r.meanDev)}</b>${r.sdDev != null ? ` <small>dp ${p1(r.sdDev)}</small>` : ''} <small>(n=${r.nDev})</small>` : '—'}</td><td>${r.modelHouse != null ? pp(r.modelHouse) : '<span class="muted" title="Exige ≥2 pesquisas do instituto">n/d</span>'}</td></tr>`).join('')}</table></div>
<p class="muted small"><b>Desvio vs. outros</b>: média de (voto válido de Lula na pesquisa − média dos <i>demais</i> institutos já divulgados no fim do campo). Positivo = mais favorável a Lula que os outros. <b>Efeito de instituto</b>: correção aplicada pelo modelo (só com ≥2 pesquisas; encolhida para 0). Isto mede <i>diferença em relação à média</i>, <b>não acerto</b>: o 2º turno ainda não ocorreu, então não há resultado oficial para medir acurácia. Com poucas pesquisas, diferenças podem ser ruído.</p></div>
<div class="card"><h3>${ic('range')}Desvio de cada instituto vs. os demais, ao longo do tempo</h3><div id="ixDev"></div><div id="ixLeg"></div></div>
<div class="card"><h3>${ic('chart')}Pesquisas dos institutos selecionados vs. média</h3><div id="ixAvg"></div><div id="ixLeg2"></div><p class="muted small">Círculos = voto válido de Lula em cada pesquisa (fim do campo). Linha cinza = média ponderada diária.</p></div>`;
    el.querySelectorAll('input[data-i]').forEach((c) => c.addEventListener('change', () => { c.checked ? IX.sel.add(c.dataset.i) : IX.sel.delete(c.dataset.i); instX(); }));
    lineChart($('#ixDev'), { series: sel.map((r) => ({ name: r.institute, color: colorOf(r.institute), marks: true, pts: r.hist.filter((h) => h.dev != null).map((h) => ({ t: S.toTime(h.fieldEnd), y: h.dev })) })), ref: 0, unit: '', fmt: pp, label: 'Desvio por instituto' });
    $('#ixLeg').innerHTML = legend(sel.map((r) => ({ n: r.institute, c: colorOf(r.institute) }))) + '<p class="muted small">Linha tracejada = 0 (igual aos demais). Pontos ausentes = não havia outros institutos divulgados na data.</p>';
    const ser = A.dailySeries(real(), minDate(), ref(), hopts());
    lineChart($('#ixAvg'), { series: [{ name: 'Média (Lula)', color: C.G, pts: ser.map((s) => ({ t: s.t, y: s.l })) }].concat(sel.map((r) => ({ name: r.institute, color: colorOf(r.institute), dots: true, pts: r.hist.map((h) => ({ t: S.toTime(h.fieldEnd), y: h.l })) }))), unit: '%', label: 'Pesquisas por instituto e média' });
    $('#ixLeg2').innerHTML = legend([{ n: 'Média', c: C.G }].concat(sel.map((r) => ({ n: r.institute, c: colorOf(r.institute) }))));
  }

  // ---------- Simulador (Monte Carlo v2) ----------
  const PERFIS = { calma: [0.6, 0.8], padrao: [1, 1], turbulenta: [1.5, 1.2], caotica: [2.2, 1.5] };
  const SIDS = ['sElec', 'sThr', 'sShift', 'sSys', 'sWalk', 'sTrend', 'sDamp', 'sSims', 'sFreq', 'sInt', 'sDeb', 'sExpL', 'sExpF', 'sShock', 'sReg'];
  const SF = { g: '', t: '', n: 20 }; // filtros da tabela de choques
  let simTok = 0, lastSim = null;
  function simInit() {
    const set = () => { $('#sElec').value = cfg.elec || ''; $('#sSys').value = cfg.sys; $('#sWalk').value = cfg.walk; $('#sSims').value = String(cfg.sims); $('#sFreq').value = cfg.freq; $('#sInt').value = cfg.int; };
    set();
    let t; const go = () => { clearTimeout(t); t = setTimeout(sim, 350); };
    SIDS.forEach((id) => { $('#' + id).addEventListener('input', go); $('#' + id).addEventListener('change', go); });
    $('#sGrp').addEventListener('change', go);
    $('#sPerfil').addEventListener('change', () => { const p = PERFIS[$('#sPerfil').value]; if (p) { $('#sFreq').value = p[0]; $('#sInt').value = p[1]; } go(); });
    ['sFreq', 'sInt'].forEach((id) => $('#' + id).addEventListener('input', () => { $('#sPerfil').value = 'custom'; }));
    $('#sReset').addEventListener('click', () => { set(); $('#sThr').value = 50; $('#sShift').value = 0; $('#sSys').value = 2; $('#sWalk').value = 0.08; $('#sTrend').value = 1; $('#sDamp').value = 0.95; $('#sSims').value = '1000000'; $('#sFreq').value = 1; $('#sInt').value = 1; $('#sPerfil').value = 'padrao'; $('#sDeb').value = '12, 7, 2'; $('#sExpL').value = 1; $('#sExpF').value = 1; $('#sShock').checked = true; $('#sReg').checked = true; $('#sGrp').querySelectorAll('input').forEach((i) => (i.checked = true)); sim(); });
    $('#sOut').addEventListener('change', (e) => { if (e.target.dataset.f && lastSim) { SF[e.target.dataset.f] = e.target.value; shockTable(); } });
    $('#sOut').addEventListener('click', (e) => { const b = e.target.closest('[data-more]'); if (b && lastSim) { SF.n = SF.n > 20 ? 20 : 1000; shockTable(); } });
  }
  const val = (id, d, lo, hi) => { const v = parseFloat($('#' + id).value); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  function simOpts() {
    const deb = $('#sDeb').value.split(/[,;\s]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
    return { threshold: val('sThr', 50, 40, 60), shift: val('sShift', 0, -10, 10), sysErr: val('sSys', 2, 0, 8), walk: val('sWalk', 0.08, 0, 1), trendMult: val('sTrend', 1, 0, 2), damp: val('sDamp', 0.95, 0.5, 1),
      sims: Math.round(val('sSims', 1000000, 1000, 1000000000)), freq: val('sFreq', 1, 0, 3), intensity: val('sInt', 1, 0, 3), expL: val('sExpL', 1, 0, 2), expF: val('sExpF', 1, 0, 2), debates: deb,
      shocks: $('#sShock').checked, regimes: $('#sReg').checked, groups: [...$('#sGrp').querySelectorAll('input:checked')].map((i) => i.dataset.g), fan: false, matrix: true };
  }
  function sim() {
    const out = $('#sOut'); if (!polls.length) { out.innerHTML = '<div class="card empty">Nenhuma pesquisa cadastrada.</div>'; return; }
    const ag = S.aggregate(real(), ref(), hopts()); if (!ag.model) { out.innerHTML = '<div class="card empty">Nenhuma pesquisa entra na média.</div>'; return; }
    const elec = $('#sElec').value || cfg.elec || ref(), o = simOpts(), full = MC.cached(ag.model, ref(), elec, o), tok = ++simTok;
    if (full) { simView(full, ag, elec, o, false); return; }
    simView(MC.run(ag.model, ref(), elec, Object.assign({}, o, { sims: Math.min(20000, o.sims), matrix: false })), ag, elec, o, true);
    MC.runAsync(ag.model, ref(), elec, o, (f) => { const b = $('#sProg i'); if (b && tok === simTok) { b.style.width = (f * 100).toFixed(0) + '%'; $('#sProgT').textContent = 'Calculando ' + Math.round(f * o.sims).toLocaleString('pt-BR') + ' de ' + o.sims.toLocaleString('pt-BR') + ' cenários…'; } },
      (r) => { if (tok === simTok && r && page() === 'simulador') simView(r, ag, elec, o, true); })
      .then((r) => { if (tok === simTok && r && page() === 'simulador') simView(r, ag, elec, o, false); }).catch(() => {});
  }
  const sgn = (v, d) => (v > 0.0005 ? '+' : v < -0.0005 ? '−' : '') + Math.abs(v * 100).toFixed(d == null ? 1 : d).replace('.', ',') + ' pp';
  function matrixCard(mc) {
    const m = mc.matrix; if (!m) return `<div class="card"><h3>${ic('users')}Matriz de debates</h3><p class="muted small">Calculando as 25 combinações de desempenho no debate final…</p></div>`;
    const cell = (l, f) => { const c = m.cells.find((x) => x.L === l && x.F === f), a = Math.min(0.55, Math.abs(c.p - 0.5) * 0.9); return `<td class="heat ${c.p >= 0.5 ? 'hl' : 'hf'}" style="--a:${a.toFixed(2)}"><b>${Math.round(c.p * 100)}%</b></td>`; };
    return `<div class="card"><h3>${ic('users')}Matriz de debates: e se o último debate for…</h3><p class="muted small" style="margin:0 0 10px">Probabilidade de Lula superar ${p1(mc.threshold)}% se, no <b>último debate</b>, cada um tiver o desempenho indicado (todo o resto segue sorteado; ${m.cells[0].n.toLocaleString('pt-BR')} cenários por célula). Desempenho ruim pesa mais que o bom equivalente (assimetria de negatividade).</p>
<div class="scroll"><table class="mx"><tr><th rowspan="2">Lula ↓</th><th colspan="5" style="text-align:center">Flávio →</th></tr><tr>${m.cats.map((c) => `<th>${c}</th>`).join('')}</tr>${m.cats.map((c, l) => `<tr><th>${c}</th>${m.cats.map((_, f) => cell(l, f)).join('')}</tr>`).join('')}</table></div>
<div class="legend"><span><i style="background:var(--rd)"></i>Lula favorito (≥ 50%)</span><span><i style="background:var(--bl)"></i>Flávio favorito</span></div></div>`;
  }
  function shockTable() {
    const mc = lastSim, box = $('#sShockTbl'); if (!mc || !box) return;
    let rows = mc.rows.filter((r) => (!SF.g || r.grp === SF.g) && (!SF.t || (SF.t === 'g' ? (r.actor === 'L') === (r.tone === 'g') && r.tone : SF.t === 'b' ? (r.actor === 'L') === (r.tone === 'b') && r.tone : SF.t === 'L' ? r.actor === 'L' : r.actor === 'F')));
    rows.sort((a, b) => Math.abs(b.d || 0) - Math.abs(a.d || 0) || b.pOcc - a.pOcc); const total = rows.length; rows = rows.slice(0, SF.n);
    const gname = (id) => (MC.GROUPS.find((g) => g.id === id) || {}).name || id, dot = (r) => (r.tone ? `<i class="dot" style="background:${r.med > 0 ? 'var(--rd)' : 'var(--bl)'}"></i>` : '');
    box.innerHTML = `<div class="scroll"><table class="cmp"><tr><th>Choque</th><th>Grupo</th><th>Prob. até a eleição</th><th>Efeito típico em Lula</th><th>Meia-vida</th><th>P(Lula vence | ocorre)</th><th>Δ vs. não ocorre</th></tr>${rows.map((r) => `<tr><td style="white-space:normal;min-width:260px">${dot(r)}${esc(r.name)}</td><td>${esc(gname(r.grp))}</td><td>${pct(r.pOcc)}</td><td>${r.med != null ? pp(r.med) : '<small>agregado</small>'}${r.pseudo ? '' : ''}</td><td>${p1(r.hl)} d</td><td>${r.pWinOcc == null ? '—' : pct(r.pWinOcc)}</td><td><b>${r.d == null ? '—' : sgn(r.d)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhum choque com esses filtros.</td></tr>'}</table></div><p class="muted small">Mostrando ${rows.length} de ${total}. ${total > 20 ? `<button class="btn" data-more="1">${SF.n > 20 ? 'Mostrar menos' : 'Mostrar todos'}</button>` : ''}</p>`;
  }
  function simView(mc, ag, elec, o, preview) {
    const out = $('#sOut'); lastSim = mc;
    const q = mc.q, pL = mc.pLula, pF = 1 - pL, ci = mc.pCI;
    const W = Math.max(320, out.clientWidth - 44 || 900), Hh = 230, m = { l: 12, r: 12, t: 12, b: 28 }, xa = Math.floor(q.p1 - 1), xb = Math.ceil(q.p99 + 1), X = (v) => m.l + ((v - xa) / (xb - xa)) * (W - m.l - m.r), base = Hh - m.b, mx = Math.max(...mc.hist), bw = (X(xa + mc.bw) - X(xa));
    let bars = '', ticks = ''; mc.hist.forEach((h, i) => { const v = mc.histLo + i * mc.bw; if (v < xa || v > xb) return; const y = (h / mx) * (base - m.t); bars += `<rect x="${X(v)}" y="${base - y}" width="${Math.max(1, bw - 0.5)}" height="${y}" fill="${v + mc.bw / 2 > mc.threshold ? C.L : C.F}" opacity=".85"/>`; });
    for (let v = Math.ceil(xa / 2) * 2; v <= xb; v += 2) ticks += `<text x="${X(v)}" y="${Hh - 8}" text-anchor="middle">${v}%</text>`;
    const xt = X(mc.threshold), shockOn = mc.params.ev.length > 0 || mc.params.deb.on, dP = pL - mc.pNoShock;
    const bar = (a, b, c, h) => `<rect x="${X(Math.max(a, xa))}" y="${Hh - 6}" width="${Math.max(2, X(Math.min(b, xb)) - X(Math.max(a, xa)))}" height="${h}" rx="${h / 2}" fill="${c}"/>`;
    const comp = mc.comp.map((c) => `<tr><td>${esc(c.name)}</td><td>${p1(c.sd)} pp</td><td><span class="vbar"><i style="width:${(c.share * 100).toFixed(1)}%"></i></span> ${Math.round(c.share * 100)}%</td></tr>`).join('');
    const grp = mc.groups.filter((g) => g.pOcc > 0).map((g) => `<tr><td>${esc(g.name)}</td><td>${pct(g.pOcc)}</td><td>${g.mean > 0 ? '+' : g.mean < 0 ? '−' : ''}${Math.abs(g.mean).toFixed(2).replace('.', ',')} pp</td><td>${pct(g.pWinOcc)}</td><td><b>${g.d == null ? '—' : sgn(g.d)}</b></td></tr>`).join('');
    const gopt = (id, v, t) => `<option value="${id}"${SF.g === id ? ' selected' : ''}>${t}</option>`;
    out.innerHTML = `<div class="card"><h3>${ic('target')}Probabilidade de superar ${p1(mc.threshold)}% dos votos válidos</h3>
${preview ? `<div class="mcprog" id="sProg" role="progressbar" aria-label="Progresso da simulação"><i></i></div><p class="muted small" id="sProgT" style="margin:4px 0 10px">Prévia com ${mc.N.toLocaleString('pt-BR')} cenários. Calculando ${o.sims.toLocaleString('pt-BR')}…</p>` : ''}
<div class="prob"><div class="pc rd"><small>Lula</small><b>${pct(pL)}</b><span>IC 95% do sorteio: ${pct(ci[0])}–${pct(ci[1])}</span></div><div class="pc bl"><small>Flávio</small><b>${pct(pF)}</b><span>IC 95% do sorteio: ${pct(1 - ci[1])}–${pct(1 - ci[0])}</span></div></div>
<div class="pbar"><span class="rd" style="width:${Math.max(pL * 100, 9)}%">Lula ${pct(pL)}</span><span class="bl" style="width:${Math.max(pF * 100, 9)}%">Flávio ${pct(pF)}</span></div>
<svg viewBox="0 0 ${W} ${Hh}" class="dens" role="img" aria-label="Distribuição simulada do voto válido de Lula">${bars}<line x1="${m.l}" x2="${W - m.r}" y1="${base}" y2="${base}" stroke="var(--gr)"/><line x1="${xt}" x2="${xt}" y1="${m.t}" y2="${base}" stroke="var(--tx)" stroke-dasharray="4 4"/>${ticks}${bar(q.p5, q.p95, '#d9d4fb', 6)}${bar(q.p25, q.p75, 'var(--ac)', 6)}</svg>
${legend([{ n: 'Lula acima do limiar', c: C.L }, { n: 'Flávio vence', c: C.F }, { n: 'Faixa 50%', c: 'var(--ac)' }, { n: 'Faixa 90%', c: '#d9d4fb' }])}
<div class="mcstats"><div><small>Mediana de Lula</small><b>${p1(q.p50)}%</b></div><div><small>Intervalo 50%</small><b>${p1(q.p25)}–${p1(q.p75)}%</b></div><div><small>Intervalo 90%</small><b>${p1(q.p5)}–${p1(q.p95)}%</b></div><div><small>Intervalo 99,8%</small><b>${p1(q.p01)}–${p1(q.p999)}%</b></div><div><small>Horizonte</small><b>${mc.h} dia(s)</b></div><div><small>Choques por cenário</small><b>${mc.evPerSim.toFixed(1).replace('.', ',')}</b></div><div><small>Assimetria · curtose</small><b>${mc.skew.toFixed(2).replace('.', ',')} · ${mc.kurt.toFixed(1).replace('.', ',')}</b></div><div><small>Sem choques de campanha</small><b>${pct(mc.pNoShock)}</b></div></div>
${shockOn ? `<p class="muted small" style="margin:12px 0 0">Efeito dos choques sobre a probabilidade de Lula: <b>${sgn(dP)}</b> (mesmos sorteios de base com e sem choques; os choques aumentam a incerteza e, quando há favorito, puxam a probabilidade em direção a 50%). Em ${pct(mc.flipsLoss)} dos cenários os choques tiram a vitória de Lula e em ${pct(mc.flipsGain)} a dão.</p>` : '<p class="muted small" style="margin:12px 0 0">Choques de campanha desligados: só erro das pesquisas, ruído diário e tendência.</p>'}</div>
<div class="card"><h3>${ic('range')}De onde vem a incerteza</h3><div class="scroll"><table><tr><th>Componente</th><th>Desvio-padrão</th><th>Parcela da variância</th></tr>${comp}</table></div><p class="muted small">Componentes independentes por construção; as parcelas somam 100%. Os choques têm cauda pesada: seu desvio-padrão subestima o peso dos extremos (veja a curtose acima).</p></div>
${shockOn ? `<div class="card"><h3>${ic('flag')}Hecatombes e caudas</h3><div class="mcstats"><div><small>Hecatombe contra Lula (choque líquido ≤ −${mc.hecThreshold} pp)</small><b>${pct(mc.pHecL)}</b></div><div><small>Hecatombe a favor de Lula (≥ +${mc.hecThreshold} pp)</small><b>${pct(mc.pHecF)}</b></div><div><small>Ao menos 1 choque individual ≥ 3 pp</small><b>${pct(mc.pBig)}</b></div><div><small>Lula abaixo de 45% dos válidos</small><b>${pct(mc.tails.lt45)}</b></div><div><small>Lula abaixo de 40%</small><b>${pct(mc.tails.lt40)}</b></div><div><small>Lula acima de 55%</small><b>${pct(mc.tails.gt55)}</b></div><div><small>Lula acima de 60%</small><b>${pct(mc.tails.gt60)}</b></div><div><small>Regime: calma · normal · turbulenta</small><b>${mc.regimes.map((x) => Math.round(x * 100)).join(' · ')}%</b></div></div><p class="muted small" style="margin:10px 0 0">Hecatombe = soma líquida dos choques, já dissipados até a eleição, igual ou superior a ${mc.hecThreshold} pp contra um dos lados. Inclui colapsos de imagem, ondas de apoio, atentados, crises exógenas e cascatas de escândalos.</p></div>
${matrixCard(mc)}
<div class="card"><h3>${ic('bars')}Resumo por grupo de acontecimentos</h3><div class="scroll"><table class="cmp"><tr><th>Grupo</th><th>Prob. de ≥ 1 ocorrência</th><th>Efeito médio em Lula (quando ocorre)</th><th>P(Lula vence | ocorre)</th><th>Δ vs. não ocorre</th></tr>${grp}</table></div></div>
<div class="card"><h3>${ic('list')}Catálogo de choques: probabilidade e impacto (${mc.rows.length} tipos)</h3><div class="tools"><label>Grupo <select data-f="g"><option value="">Todos</option>${MC.GROUPS.map((g) => gopt(g.id, g.id, g.name)).join('')}</select></label><label>Quem / tipo <select data-f="t"><option value="">Todos</option><option value="g"${SF.t === 'g' ? ' selected' : ''}>Bons para o ator</option><option value="b"${SF.t === 'b' ? ' selected' : ''}>Ruins para o ator</option><option value="L"${SF.t === 'L' ? ' selected' : ''}>Só acontecimentos de Lula</option><option value="F"${SF.t === 'F' ? ' selected' : ''}>Só acontecimentos de Flávio</option></select></label></div><div id="sShockTbl"></div><p class="muted small">Ordenado pelo efeito sobre a probabilidade de vitória (Δ). “Efeito típico” é a mediana do tamanho (pp do voto válido de Lula, já com sinal), antes do decaimento; o ponto vermelho marca efeito a favor de Lula e o azul, a favor de Flávio. Os desempenhos em debate (péssimo, ruim, bom, muito bom) aparecem como linhas agregadas.</p></div>` : ''}
<div class="card" id="sSens"><h3>${ic('range')}Sensibilidade às premissas</h3>${skLines}</div>
<div class="card prose"><h3>${ic('info')}Como ler os resultados</h3>
<p><b>Intervalos 50% e 90%</b>: faixa do voto válido de Lula que contém 50% (ou 90%) dos ${mc.N.toLocaleString('pt-BR')} resultados simulados. Descrevem o <i>modelo</i> (erro da média de ±${p1(1.96 * ag.model.se)} pp, erro sistemático, oscilação, tendência e choques), não são intervalos de confiança clássicos.</p>
<p><b>IC 95% do sorteio</b>: incerteza <i>numérica</i> da probabilidade por usar ${mc.N.toLocaleString('pt-BR')} sorteios (Wilson). <b>Não</b> inclui a incerteza sobre as premissas, que a sensibilidade e os parâmetros acima permitem explorar.</p>
<p><b>Frequências e tamanhos dos choques são premissas informadas, não estatísticas observadas</b>: foram calibradas para que a variação total de uma campanha de duas semanas fique na ordem de grandeza da literatura (poucos pontos percentuais; efeitos de debate geralmente abaixo de 2 pp e que se dissipam em dias ou semanas). Detalhes e referências na aba Metodologia. Votos válidos = Lula + Flávio. Ajuste manual diferente de 0 transforma o resultado em hipótese.</p></div>`;
    if (shockOn) shockTable();
    if (!preview) fillSens(ag.model, elec, o, mc.threshold);
  }

  let sensTok = 0;
  function fillSens(model, elec, o, thr) {
    const tok = ++sensTok;
    setTimeout(() => {
      if (tok !== sensTok || !$('#sSens')) return;
      const sens = A.sensitivity(model, ref(), elec, Object.assign({}, o, { sims: Math.min(o.sims, 40000), fan: false, matrix: false }));
      if (tok !== sensTok || !$('#sSens')) return;
      $('#sSens').innerHTML = `<h3>${ic('range')}Sensibilidade às premissas</h3><p class="muted small">Mesmos dados, premissas alteradas (40.000 sorteios por linha). Se a probabilidade muda muito, a conclusão depende do que se assume sobre o erro das pesquisas.</p><div class="scroll"><table><tr><th>Premissa</th><th>σ sistemático</th><th>Tendência</th><th>P(Lula &gt; ${p1(thr)}%)</th></tr>${sens.map((s) => `<tr><td>${s.label}</td><td>${p1(s.sysErr)} pp</td><td>${s.trendMult}×</td><td><b>${pct(s.p)}</b></td></tr>`).join('')}</table></div>`;
    }, 30);
  }
  // ---------- Cenários (localStorage; separados da base real) ----------
  const KEY = 'obs-scenarios-v1';
  let SC = [], editing = null;
  const load = () => { try { SC = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { SC = []; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(SC)); } catch (e) { /* armazenamento indisponível */ } };
  const uid = () => 's' + Math.random().toString(36).slice(2, 8);
  function scList() {
    $('#scList').innerHTML = SC.length ? `<div class="sclist">${SC.map((s) => `<div class="sc"><b>${esc(s.name)}</b><small>${(s.adds || []).length} pesquisa(s) simulada(s) · ${Object.keys(s.overrides || {}).length} alterada(s) · ${(s.exclude || []).length} excluída(s)</small><span><button class="btn" data-a="edit" data-i="${s.id}">${ic('edit')}Editar</button><button class="btn" data-a="dup" data-i="${s.id}">${ic('copy')}Duplicar</button><button class="btn danger" data-a="del" data-i="${s.id}">${ic('trash')}</button></span></div>`).join('')}</div>` : '<div class="empty">Nenhum cenário. Crie um para testar “e se uma nova pesquisa mostrasse…?”.</div>';
  }
  function scEditor() {
    const el = $('#scEdit'); if (!editing) { el.innerHTML = ''; return; }
    const e = editing, r = real().filter((p) => !p.duplicateOf).sort((a, b) => (a.fieldEnd < b.fieldEnd ? 1 : -1));
    const cur = S.aggregate(real(), ref(), hopts()).weighted;
    el.innerHTML = `<div class="card"><h3>${ic('edit')}Editar cenário</h3><label class="fld"><span>Nome</span><input id="eName" value="${esc(e.name)}" maxlength="80"></label>
<h4>Pesquisas hipotéticas</h4><div class="scroll"><table class="ed"><tr><th>Instituto</th><th>Início</th><th>Fim</th><th>Tipo</th><th>Lula</th><th>Flávio</th><th>Amostra</th><th>Método</th><th></th></tr>
${(e.adds || []).map((a, i) => `<tr><td><input data-k="institute" data-i="${i}" value="${esc(a.institute)}"></td><td><input type="date" data-k="fieldStart" data-i="${i}" value="${esc(a.fieldStart)}"></td><td><input type="date" data-k="fieldEnd" data-i="${i}" value="${esc(a.fieldEnd)}"></td><td><select data-k="resultType" data-i="${i}"><option value="total" ${a.resultType === 'total' ? 'selected' : ''}>Totais</option><option value="valid" ${a.resultType === 'valid' ? 'selected' : ''}>Válidos</option></select></td><td><input type="number" step="0.1" data-k="lula" data-i="${i}" value="${a.lula ?? ''}"></td><td><input type="number" step="0.1" data-k="flavio" data-i="${i}" value="${a.flavio ?? ''}"></td><td><input type="number" data-k="sample" data-i="${i}" value="${a.sample ?? ''}" placeholder="opcional"></td><td><select data-k="method" data-i="${i}">${['', 'presencial', 'telefone', 'internet'].map((m) => `<option value="${m}" ${a.method === m ? 'selected' : ''}>${m || '—'}</option>`).join('')}</select></td><td><button class="btn danger" data-rm="${i}">${ic('x')}</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nenhuma pesquisa hipotética.</td></tr>'}</table></div>
<div class="row"><button class="btn" id="eAdd">${ic('plus')}Adicionar pesquisa hipotética</button><button class="btn" id="eAddAvg" ${cur ? '' : 'disabled'}>${ic('target')}Partir da média atual (${cur ? p1(cur.l) + '–' + p1(cur.f) : '—'})</button></div>
<h4>Alterar ou excluir pesquisas reais (só neste cenário)</h4><div class="scroll"><table class="ed"><tr><th>Excluir</th><th>Instituto</th><th>Fim do campo</th><th>Real (L–F)</th><th>Lula (hipot.)</th><th>Flávio (hipot.)</th></tr>
${r.map((p) => { const o = (e.overrides || {})[p.id]; return `<tr><td><input type="checkbox" data-ex="${p.id}" ${(e.exclude || []).includes(p.id) ? 'checked' : ''}></td><td>${esc(p.institute)}</td><td>${fd(p.fieldEnd)}</td><td>${p1(p.lula)} – ${p1(p.flavio)}</td><td><input type="number" step="0.1" data-ov="${p.id}" data-w="lula" value="${o ? o.lula : ''}" placeholder="—"></td><td><input type="number" step="0.1" data-ov="${p.id}" data-w="flavio" value="${o ? o.flavio : ''}" placeholder="—"></td></tr>`; }).join('')}</table></div>
<div id="eErr" class="err" role="alert"></div><div class="row"><button class="btn" id="eCancel">${ic('x')}Cancelar</button><button class="btn primary" id="eSave">${ic('check')}Salvar e comparar</button></div></div>`;
    const sync = () => { e.name = $('#eName').value; el.querySelectorAll('[data-k]').forEach((i) => { const a = e.adds[+i.dataset.i], k = i.dataset.k; a[k] = ['lula', 'flavio', 'sample'].includes(k) ? (i.value === '' ? '' : +i.value) : i.value; });
      e.exclude = [...el.querySelectorAll('[data-ex]:checked')].map((i) => i.dataset.ex); e.overrides = {};
      r.forEach((p) => { const l = el.querySelector(`[data-ov="${p.id}"][data-w="lula"]`).value, f = el.querySelector(`[data-ov="${p.id}"][data-w="flavio"]`).value; if (l !== '' && f !== '') e.overrides[p.id] = { lula: +l, flavio: +f }; }); };
    const blank = (extra) => Object.assign({ institute: 'Hipotético', fieldStart: ref(), fieldEnd: ref(), resultType: 'total', lula: '', flavio: '', sample: '', method: '' }, extra);
    $('#eAdd').onclick = () => { sync(); e.adds.push(blank()); scEditor(); };
    $('#eAddAvg').onclick = () => { sync(); e.adds.push(blank({ lula: +cur.l.toFixed(1), flavio: +cur.f.toFixed(1), resultType: 'valid' })); scEditor(); };
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { sync(); e.adds.splice(+b.dataset.rm, 1); scEditor(); }));
    $('#eCancel').onclick = () => { editing = null; scEditor(); };
    $('#eSave').onclick = () => { sync(); const errs = A.validateScenario(e); if (!e.name.trim()) errs.unshift('Dê um nome ao cenário.'); if (errs.length) { $('#eErr').innerHTML = errs.map(esc).join('<br>'); return; }
      const i = SC.findIndex((s) => s.id === e.id); i >= 0 ? (SC[i] = e) : SC.push(e); save(); editing = null; scEditor(); scList(); scOut(); };
  }
  function scOut() {
    const el = $('#scOut'); if (!SC.length || !polls.length) { el.innerHTML = ''; return; }
    const cmp = A.compareScenarios(real(), SC, ref(), cfg.elec || ref(), hopts(), mcBase()), rows = [cmp.base].concat(cmp.rows), mxd = Math.max(1, ...cmp.rows.map((r) => Math.abs(r.dL || 0)));
    el.innerHTML = `<div class="card"><h3>${ic('arrows')}Efeito na média nacional e na probabilidade</h3><div class="scroll"><table><tr><th>Cenário</th><th>Pesquisas na média</th><th>Lula</th><th>Flávio</th><th>Δ Lula vs. real</th><th>P(Lula &gt; 50%)</th><th>Δ prob.</th></tr>
${rows.map((r, i) => `<tr class="${i ? '' : 'base'}"><td><b>${esc(r.name)}</b>${i ? ' <span class="tag">hipotético</span>' : ' <span class="tag real">real</span>'}</td><td>${r.count}</td><td>${p1(r.l)}%</td><td>${p1(r.f)}%</td><td>${i ? `<span class="dbar"><i style="width:${(Math.abs(r.dL || 0) / mxd) * 50}%;${r.dL >= 0 ? 'left:50%;background:var(--rd)' : 'right:50%;background:var(--bl)'}"></i></span> ${pp(r.dL)}` : '—'}</td><td><b>${pct(r.pLula)}</b> <small>(${pct(r.pCI[0])}–${pct(r.pCI[1])})</small></td><td>${i ? pp(r.dP == null ? null : r.dP * 100).replace('pp', 'p.p.') : '—'}</td></tr>`).join('')}</table></div>
<p class="muted small">Cada cenário usa as mesmas regras de ponderação, o mesmo horizonte (${fd(cfg.elec || ref())}) e as mesmas premissas de Configurações. Parênteses = IC 95% apenas do sorteio. Δ prob. em pontos percentuais. Cenários sem alterações reproduzem exatamente a base real.</p></div>
<div class="card"><h3>${ic('chart')}Média diária: base real vs. cenários</h3><div id="scChart"></div><div id="scLeg"></div></div>`;
    const lastAdd = SC.flatMap((s) => (s.adds || []).map((a) => A.avail(a))).sort().pop(), to = lastAdd && lastAdd > ref() ? lastAdd : ref(), from = shiftDate(to, -30) > minDate() ? shiftDate(to, -30) : minDate();
    const mk = (polls_) => A.dailySeries(polls_, from, to, hopts()).map((s) => ({ t: s.t, y: s.l })), series = [{ name: 'Real (base)', color: C.G, w: 3.2, pts: mk(real()) }].concat(SC.map((s, i) => ({ name: s.name, color: PAL[i % PAL.length], dash: true, pts: mk(A.applyScenario(real(), s)) })));
    lineChart($('#scChart'), { series, unit: '%', ref: 50, label: 'Média de Lula por cenário' });
    $('#scLeg').innerHTML = legend(series.map((s) => ({ n: s.name, c: s.color }))) + '<p class="muted small">Eixo: voto válido de Lula (%). Últimos 30 dias até a data da última pesquisa hipotética.</p>';
  }
  function scInit() {
    load(); scList();
    $('#scNew').onclick = () => { editing = { id: uid(), name: 'Cenário ' + (SC.length + 1), adds: [], overrides: {}, exclude: [] }; scEditor(); };
    $('#scList').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; const s = SC.find((x) => x.id === b.dataset.i);
      if (b.dataset.a === 'edit') editing = JSON.parse(JSON.stringify(s)); if (b.dataset.a === 'dup') { SC.push(Object.assign(JSON.parse(JSON.stringify(s)), { id: uid(), name: s.name + ' (cópia)' })); save(); }
      if (b.dataset.a === 'del' && confirm('Excluir este cenário? A base real não é afetada.')) { SC = SC.filter((x) => x.id !== s.id); save(); } scList(); scEditor(); scOut(); });
    $('#scExp').onclick = () => dl('cenarios-observatorio.json', JSON.stringify({ tipo: 'cenarios-hipoteticos', cenarios: SC }, null, 1), 'application/json');
    $('#scImp').onchange = async (ev) => { try { const j = JSON.parse(await ev.target.files[0].text()); const ok = (j.cenarios || []).filter((s) => s && s.name && Array.isArray(s.adds || [])); ok.forEach((s) => SC.push(Object.assign({ overrides: {}, exclude: [] }, s, { id: uid() }))); save(); scList(); scOut(); alert(ok.length + ' cenário(s) importado(s).'); } catch (e) { alert('Arquivo inválido.'); } ev.target.value = ''; };
  }

  // ---------- skeleton screens (somem sozinhos quando o conteúdo real é renderizado) ----------
  const skCard = '<div class="sk-wrap" aria-hidden="true"><span class="sk sk-title"></span><div class="sk-row"><span class="sk sk-box"></span><span class="sk sk-box"></span><span class="sk sk-box"></span></div><span class="sk sk-bar"></span><span class="sk sk-line m"></span></div>';
  const skChart = '<div class="sk-wrap" aria-hidden="true"><span class="sk sk-chart"></span><span class="sk sk-line s"></span></div>';
  const skLines = '<div class="sk-wrap" aria-hidden="true"><span class="sk sk-title"></span><span class="sk sk-line"></span><span class="sk sk-line m"></span><span class="sk sk-line s"></span></div>';
  function skeletons() {
    const put = (sel, html) => { const el = $(sel); if (el && !el.innerHTML.trim()) { el.innerHTML = html; el.setAttribute('aria-busy', 'true'); } };
    put('#hero', skCard); put('#mc', skChart); put('#metrics', skLines); put('#hChart', skChart); put('#sOut', '<div class="card">' + skChart + '</div>'); put('#instX', '<div class="card">' + skLines + '</div>');
    const box = $('#chartBox'); if (box && !$('#skChart')) { const d = document.createElement('div'); d.id = 'skChart'; d.innerHTML = skChart; box.prepend(d); }
  }
  const doneSk = () => { const d = $('#skChart'); if (d) d.remove(); document.querySelectorAll('[aria-busy]').forEach((e) => e.removeAttribute('aria-busy')); };

  // ---------- integração ----------
  const page = () => location.hash.slice(1) || 'presidente';
  function renderExtra() { const p = page(); if (p === 'historico') hist(); else if (p === 'institutos') instX(); else if (p === 'simulador') sim(); else if (p === 'cenarios') { scList(); scOut(); } }
  build(); histInit(); simInit(); scInit(); route(); if (!polls.length) { skeletons(); setTimeout(doneSk, 8000); }
  const baseRender = render; render = function () { baseRender(); doneSk(); try { renderExtra(); } catch (e) { console.error(e); } };
  const TITLES = { presidente: 'Presidente', historico: 'Histórico', institutos: 'Institutos', simulador: 'Simulador', cenarios: 'Cenários', pesquisas: 'Pesquisas', metodologia: 'Metodologia', config: 'Configurações' };
  const setTitle = () => { const n = ($('#siteName') && $('#siteName').textContent) || 'Observatório das Pesquisas'; document.title = (TITLES[page()] ? TITLES[page()] + ' · ' : '') + n; };
  addEventListener('hashchange', () => { setTitle(); scrollTo(0, 0); setTimeout(renderExtra, 0); }); setTitle();
  addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('#search').focus(); } });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderExtra, 150); });
  if (polls.length) render();
})();
