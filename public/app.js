const $ = (s) => document.querySelector(s), S = Stats;
const ic = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const chip = (i, t, k = '') => `<span class="chip ${k}">${ic(i)}${t}</span>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + '%');
const fd = (s) => (s ? s.split('-').reverse().join('/') : '—');
const today = () => new Date().toISOString().slice(0, 10);
let polls = [], sort = { k: 'fieldEnd', d: -1 }, view = null;
const cfg = Object.assign({ half: 14, scope: 'nacional', mark: '', ref: '', elec: '2026-10-25', sys: 2, walk: 0.08, tau: 1.5, sims: 1000000, int: 1, freq: 1, house: '1' }, (() => { const o = JSON.parse(localStorage.getItem('cfg') || '{}'); if (o.v !== 2) { delete o.sims; delete o.walk; } return o; })()); cfg.v = 2; // v2: Monte Carlo com choques (1 milhão de sorteios)
if (!cfg.elec) cfg.elec = '2026-10-25';
let lastMc = null, lastAg = null, mcW = 0;
const projEnd = () => ($('#fProj').value === 'on' && lastMc && lastMc.h > 0 ? lastMc.days[lastMc.h].t - S.DAY : 0);
const api = async (u, o) => { const r = await fetch(u, o && { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) }); const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 409) throw Object.assign(new Error('api'), { data: j }); j._status = r.status; return j; };
async function load() { polls = await api('/api/polls'); render(); }

const FIELDS = [['institute', 'Instituto *', 'text'], ['surveyId', 'Identificador da pesquisa', 'text'], ['scope', 'Abrangência', 'select:nacional,estadual'], ['state', 'Estado (se estadual)', 'text'],
['fieldStart', 'Campo — início', 'date'], ['fieldEnd', 'Campo — fim *', 'date'], ['released', 'Divulgação', 'date'], ['tseDate', 'Registro TSE (data)', 'date'],
['lula', 'Lula (%) *', 'number'], ['flavio', 'Flávio Bolsonaro (%) *', 'number'], ['blankNull', 'Branco/nulo (%)', 'number'], ['undecided', 'Indecisos (%)', 'number'], ['others', 'Outros (%)', 'number'],
['resultType', 'Os resultados são *', 'select:valid|Votos válidos,total|Votos totais'], ['sample', 'Amostra (entrevistas; <100 = milhares)', 'number'], ['moe', 'Margem de erro (pp)', 'number'], ['confidence', 'Nível de confiança (%)', 'number'],
['method', 'Método', 'select:|—,presencial|Presencial,telefone|Telefone,internet|Internet,outro|Outro'], ['population', 'População pesquisada', 'text'], ['sponsor', 'Contratante', 'text'], ['tseNumber', 'Nº registro TSE', 'text'], ['source', 'Link da fonte', 'url'], ['duplicateOf', 'Duplicata de (ID da pesquisa original)', 'text'], ['notes', 'Observações', 'text']];
function openForm(p, mode) {
  p = p || { scope: 'nacional', resultType: 'valid' };
  $('#dlgTitle').textContent = mode === 'edit' ? 'Editar pesquisa' : 'Adicionar pesquisa';
  $('#formErr').textContent = ''; $('#form').dataset.id = mode === 'edit' ? p.id : ''; $('#form').dataset.confirm = '';
  $('#fields').innerHTML = FIELDS.map(([k, l, t]) => {
    const v = p[k] ?? '';
    if (t.startsWith('select:')) return `<label>${l}<select name="${k}">${t.slice(7).split(',').map((o) => { const [a, b] = o.split('|'); return `<option value="${a}" ${a === v ? 'selected' : ''}>${b || a}</option>`; }).join('')}</select></label>`;
    return `<label>${l}<input name="${k}" type="${t}" ${t === 'number' ? 'step="any"' : ''} value="${esc(v)}"></label>`;
  }).join('');
  $('#dlg').showModal();
}
$('#form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData($('#form'))); body.confirmSimilar = $('#form').dataset.confirm === '1';
  const id = $('#form').dataset.id, el = $('#formErr'); el.className = 'err';
  const v = S.validatePoll({ ...body, lula: body.lula === '' ? null : +body.lula, flavio: body.flavio === '' ? null : +body.flavio });
  if (v.errors.length) { el.innerHTML = v.errors.map(esc).join('<br>'); return; }
  try {
    const r = await api(id ? '/api/polls/' + id : '/api/polls', { method: id ? 'PUT' : 'POST', body });
    if (r.duplicate) { $('#form').dataset.confirm = '1'; el.innerHTML = esc(r.message) + '<br><b>Clique em Salvar novamente para confirmar.</b>'; return; }
    $('#dlg').close(); await load();
    if (r.warnings?.length) alert('Salvo, com avisos:\n- ' + r.warnings.join('\n- '));
  } catch (x) { el.innerHTML = (x.data?.errors || ['Falha ao salvar.']).map(esc).join('<br>'); }
});
$('#cancel').onclick = () => $('#dlg').close(); $('#detClose').onclick = () => $('#det').close();
$('#addBtn').onclick = () => openForm();

function opts() { return { halfLife: +cfg.half || 14, scope: cfg.scope, windowDays: +$('#fPeriod').value || 0, tau: +cfg.tau || 1.5, houseEffect: cfg.house !== '0' }; }
function filtered() {
  const inst = $('#fInst').value, q = $('#search').value.toLowerCase();
  return polls.filter((p) => (!inst || p.institute === inst) && (!q || p.institute.toLowerCase().includes(q)));
}
function render() {
  const insts = [...new Set(polls.map((p) => p.institute))].sort(), cur = $('#fInst').value;
  $('#fInst').innerHTML = '<option value="">Todos</option>' + insts.map((i) => `<option ${i === cur ? 'selected' : ''}>${esc(i)}</option>`).join('');
  const ref = cfg.ref || today(), list = filtered(), ag = S.aggregate(list, ref, opts());
  const latest = list.map((p) => p.fieldEnd).sort().pop();
  $('#meta').innerHTML = chip('clock', 'Atualizado ' + new Date().toLocaleString('pt-BR')) + chip('list', polls.length + ' pesquisas') + chip('building', insts.length + ' institutos') + chip('check', ag.count + ' na média') + chip('calendar', 'Período: ' + $('#fPeriod').selectedOptions[0].text) + chip('calendar', 'Ref. ' + fd(ref)) + (cfg.elec ? chip('flag', 'Eleição ' + fd(cfg.elec), 'ac') : '');
  const mc = ag.model ? mcNow(ag.model, ref) : null; lastMc = mc;
  hero(ag, list, ref, latest, mc); chart(list, ag, mc); mcPanel(mc, ag); metrics(list, ag); table(list, ag); institutes();
  if (mc && mc.N < mcTarget()) mcRefine(ag, list, ref, latest);
}
// Monte Carlo v2: mostra já uma prévia (20 mil sorteios, instantânea) e refina para o total configurado (até 1 bilhão) em segundo plano, com prévias parciais ao vivo.
const mcTarget = () => Math.max(1000, Math.min(1000000000, +cfg.sims || 1000000));
const mcOpts = (sims) => ({ sysErr: +cfg.sys, walk: +cfg.walk, intensity: +cfg.int, freq: +cfg.freq, sims });
const mcNow = (model, ref) => MC.cached(model, ref, cfg.elec, mcOpts(mcTarget())) || MC.run(model, ref, cfg.elec, mcOpts(Math.min(20000, mcTarget())));
let mcTok = 0;
function mcRefine(ag, list, ref, latest) {
  const tok = ++mcTok;
  MC.runAsync(ag.model, ref, cfg.elec, mcOpts(mcTarget()), (f) => { const b = $('#mcProg i'); if (b && tok === mcTok) { b.style.width = (f * 100).toFixed(0) + '%'; $('#mcProgT').textContent = Math.round(f * mcTarget()).toLocaleString('pt-BR') + ' de ' + mcTarget().toLocaleString('pt-BR') + ' cenários'; } },
    (r) => { if (tok === mcTok && r) { lastMc = r; hero(ag, list, ref, latest, r); chart(list, ag, r); mcPanel(r, ag); } })
    .then((r) => { if (tok === mcTok && r) { lastMc = r; hero(ag, list, ref, latest, r); chart(list, ag, r); mcPanel(r, ag); } }).catch(() => {});
}
function hero(ag, list, ref, latest, mc) {
  if (!polls.length) { $('#hero').innerHTML = '<div class="empty"><b>Nenhuma pesquisa cadastrada.</b><br>Clique em “Adicionar” para inserir os dados manualmente.</div>'; return; }
  if (!ag.weighted) { $('#hero').innerHTML = '<div class="empty">Nenhuma pesquisa entra na média com os filtros atuais.</div>'; return; }
  const { l, f } = ag.weighted, d = l - f, w = opts(), p1 = (v) => v.toFixed(1).replace('.', ',');
  const prevRef = new Date(S.toTime(ref) - (w.windowDays || 30) * S.DAY).toISOString().slice(0, 10);
  const prev = S.aggregate(list, prevRef, w).weighted, ch = prev ? (l - f) - (prev.l - prev.f) : null;
  const lead = Math.abs(d) < 0.05 ? 'Empate numérico' : d > 0 ? 'Lula numericamente à frente' : 'Flávio numericamente à frente', tone = Math.abs(d) < 0.05 ? '' : d > 0 ? 'rd' : 'bl';
  $('#hero').innerHTML = `<div class="title">${ic('chart')}Presidente · 2º turno · Média das pesquisas · Votos válidos</div>
<div class="nums pulse"><div class="big rd"><small><i class="av">L</i><span>Lula</span></small>${f1(l)}</div><div class="big bl"><small><i class="av">F</i><span>Flávio Bolsonaro</span></small>${f1(f)}</div><div class="big"><small><span>Diferença</span></small>${p1(Math.abs(d))} pp</div></div>
<div class="split" role="img" aria-label="Divisão entre Lula e Flávio"><span class="sl" style="width:${l}%"></span><span class="sf" style="width:${f}%"></span><i></i></div>
<div class="chips">${chip('flag', lead, tone)}${chip('chart', 'Variação da diferença: ' + (ch == null ? 'sem base comparável' : (ch > -0.05 ? '+' : '') + p1(Math.abs(ch) < 0.05 ? 0 : ch) + ' pp'))}${chip('list', ag.count + ' pesquisa(s) · mais recente ' + fd(latest))}${ag.model ? chip('target', 'Incerteza da média (95%): ±' + p1(1.96 * ag.model.se) + ' pp') : ''}${mc && mc.h > 0 ? chip('dice', `Monte Carlo ${fd(cfg.elec).slice(0, 5)}: Lula ${Math.round(mc.pLula * 100)}% · Flávio ${Math.round(mc.pFlavio * 100)}%`, 'ac') : ''}</div>
<p class="muted small" style="margin:10px 0 0">Média ponderada de pesquisas; não implica vitória nem é previsão.</p>`;
}
function projSvg(k, mc, X, Y, c, m, H) {
  const tr = (v) => (k === 'l' ? v : k === 'f' ? 100 - v : 2 * v - 100), cl = (y) => Math.max(m.t, Math.min(H - m.b, y));
  const band = (a, b, op) => { const hi = mc.days.map((d) => [d.t, Math.max(tr(d[a]), tr(d[b]))]), lo = mc.days.map((d) => [d.t, Math.min(tr(d[a]), tr(d[b]))]).reverse();
    return `<path d="${hi.concat(lo).map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + cl(Y(q[1])).toFixed(1)).join('')}Z" fill="${c}" fill-opacity="${op}" stroke="none"/>`; };
  const med = mc.days.map((d, i) => (i ? 'L' : 'M') + X(d.t).toFixed(1) + ' ' + cl(Y(tr(d.p50))).toFixed(1)).join(''), e = mc.days[mc.h];
  return band('p5', 'p95', 0.1) + band('p25', 'p75', 0.2) + `<path d="${med}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="7 5"/><text x="${X(e.t) + 8}" y="${cl(Y(tr(e.p50))) + 4}" style="fill:${c};font-weight:700;font-size:12px">${tr(e.p50).toFixed(1).replace('.', ',')}</text>`;
}
function chart(list, ag, mc) {
  const svg = $('#chart'), W = 900, H = 420, m = { l: 48, r: 70, t: 14, b: 34 }, mode = $('#fMode').value;
  const pts = list.map((p) => ({ p, t: S.toTime(p.fieldEnd), s: S.validShares(p) })).filter((x) => x.s).sort((a, b) => a.t - b.t);
  if (!pts.length) { svg.setAttribute('viewBox', `0 0 ${W} 120`); svg.innerHTML = `<text x="${W / 2}" y="60" text-anchor="middle">Sem dados para exibir</text>`; return; }
  const proj = $('#fProj').value === 'on' && mc && mc.h > 0, full = [pts[0].t - 3 * S.DAY, Math.max(pts[pts.length - 1].t + 3 * S.DAY, proj ? mc.days[mc.h].t + 2 * S.DAY : 0)], [t0, t1] = view || full;
  const diff = mode === 'diff', lo = diff ? -20 : $('#fScale').value === '0' ? 0 : 40, hi = diff ? 20 : $('#fScale').value === '0' ? 100 : 60;
  const X = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r), Y = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  let o = `<rect x="0" y="0" width="${W}" height="${H}" fill="none"/>`;
  const step = diff ? 10 : hi - lo > 50 ? 20 : 5;
  for (let v = lo; v <= hi; v += step) o += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--bd)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}${diff ? '' : '%'}</text>`;
  const nt = 6; for (let i = 0; i <= nt; i++) { const t = t0 + ((t1 - t0) * i) / nt; o += `<text x="${X(t)}" y="${H - 10}" text-anchor="middle">${new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</text>`; }
  if (cfg.mark) o += `<line x1="${X(S.toTime(cfg.mark))}" x2="${X(S.toTime(cfg.mark))}" y1="${m.t}" y2="${H - m.b}" stroke="var(--gr)" stroke-dasharray="4 4"/>`;
  if (proj) o += `<line x1="${X(mc.days[mc.h].t)}" x2="${X(mc.days[mc.h].t)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--tx)" stroke-opacity=".35" stroke-dasharray="2 3"/><text x="${X(mc.days[mc.h].t) - 4}" y="${m.t + 12}" text-anchor="end" style="font-size:11px">Eleição ${fd(cfg.elec).slice(0, 5)}</text>`;
  const series = diff ? [{ k: 'd', c: 'var(--gr)', n: 'Lula − Flávio', get: (s) => s.l - s.f }] : [{ k: 'f', c: 'var(--bl)', n: 'Flávio', get: (s) => s.f }, { k: 'l', c: 'var(--rd)', n: 'Lula', get: (s) => s.l }];
  const xs = pts.map((x) => x.t);
  let loessOK = true, notes = '';
  series.forEach((se) => {
    const ys = pts.map((x) => se.get(x.s));
    if (proj) o += projSvg(se.k, mc, X, Y, se.c, m, H);
    let line = null;
    if (mode === 'raw') line = pts.map((x, i) => [x.t, ys[i]]);
    else {
      const fn = S.loess(xs, ys, +$('#fSmooth').value, 1);
      if (!fn) loessOK = false;
      else { line = []; const a = xs[0], b = xs[xs.length - 1]; for (let i = 0; i <= 80; i++) { const t = a + ((b - a) * i) / 80, v = fn(t); if (v != null) line.push([t, v]); } } // sem extrapolação
    }
    if (line && line.length) {
      o += `<path d="${line.map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join('')}" fill="none" stroke="${se.c}" stroke-width="2.5" stroke-linejoin="round"/>`;
      const last = line[line.length - 1]; o += `<text x="${X(last[0]) + 8}" y="${Y(last[1]) + 4}" style="fill:${se.c};font-weight:700;font-size:13px">${last[1].toFixed(1).replace('.', ',')}${diff ? ' pp' : '%'}</text>`;
    }
    pts.forEach((x, i) => { const cx = X(x.t), cy = Y(ys[i]); if (cx < m.l - 1 || cx > W - m.r + 1) return;
      o += `<circle class="pt" tabindex="0" data-id="${x.p.id}" cx="${cx}" cy="${cy}" r="4" fill="${se.c}" fill-opacity=".45" stroke="${se.c}" role="button" aria-label="${esc(x.p.institute)} ${fd(x.p.fieldEnd)}"/>`; });
  });
  if (!loessOK && mode !== 'raw') notes = `<text x="${m.l}" y="${m.t + 14}">Dados insuficientes para LOESS (mín. 4 pesquisas, 3 datas distintas) — exibindo só os pontos.</text>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = o + notes +
    `<g transform="translate(${m.l + 6},${H - m.b - 8})"><text>● Lula</text></g>`.replace('<text>', '<text style="fill:var(--rd)">') + `<g transform="translate(${m.l + 66},${H - m.b - 8})"><text style="fill:var(--bl)">● Flávio</text></g>`;
  svg.querySelectorAll('.pt').forEach((c) => { const show = (ev) => tip(c, ag); c.onmouseenter = show; c.onclick = show; c.onfocus = show; c.onmouseleave = () => ($('#tip').hidden = true); });
}
function tip(c, ag) {
  const p = polls.find((x) => x.id === c.dataset.id), t = $('#tip'), box = $('#chartBox').getBoundingClientRect(), r = c.getBoundingClientRect(), i = ag.info[p.id];
  t.innerHTML = `<b>${esc(p.institute)}</b><br>Campo: ${fd(p.fieldStart)} a ${fd(p.fieldEnd)} · Divulg.: ${fd(p.released)}<br>Lula ${p.lula}% · Flávio ${p.flavio}% (${p.resultType === 'valid' ? 'válidos' : 'totais'})<br>Margem: ${p.moe ?? '—'} · Amostra: ${S.sampleN(p)?.toLocaleString('pt-BR') ?? '—'}<br>${esc(p.method || '—')} · ${esc(p.scope)}${p.state ? '/' + esc(p.state) : ''}<br>${p.source ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">Fonte</a> · ` : ''}<a href="#" id="tipDet">Detalhes</a>`;
  t.hidden = false; t.style.left = Math.min(r.left - box.left + 12, box.width - 300) + 'px'; t.style.top = r.top - box.top + 14 + 'px';
  $('#tipDet').onclick = (e) => { e.preventDefault(); detail(p.id); };
}
function metrics(list, ag) {
  const v = list.map((p) => S.validShares(p)).filter(Boolean), mm = (a) => (a.length ? [Math.min(...a), Math.max(...a)] : [null, null]);
  const [lmin, lmax] = mm(v.map((s) => s.l)), [fmin, fmax] = mm(v.map((s) => s.f)), methods = {};
  list.forEach((p) => (methods[p.method || 'n/i'] = (methods[p.method || 'n/i'] || 0) + 1));
  const IC = { 'Média ponderada': 'scale', 'Média simples': 'bars', 'Diferença': 'arrows', 'Lula': 'range', 'Flávio': 'range', 'Erro': 'target', 'Pesquisas efetivas': 'users', 'Tendência': 'chart', 'Por método': 'flask' }, c = (k, val, sub) => `<div class="card"><div class="ico ${k.startsWith('Lula') ? 'rd' : k.startsWith('Flávio') ? 'bl' : ''}">${ic(IC[Object.keys(IC).find((x) => k.startsWith(x))] || 'bars')}</div><div class="k">${k}</div><div class="v">${val}</div><div class="k">${sub || ''}</div></div>`;
  const d = (x) => (x ? Math.abs(x.l - x.f).toFixed(1).replace('.', ',') + ' pp' : '—');
  const M = ag.model, cx = M ? c('Erro da média (95%)', '±' + (1.96 * M.se).toFixed(1).replace('.', ',') + ' pp', 'amostral + não amostral (τ)') + c('Pesquisas efetivas', M.neff.toFixed(1).replace('.', ','), 'índice de Kish (peso diluído)') + c('Tendência (encolhida)', (M.slope >= 0 ? '+' : '') + (M.slope * 7).toFixed(2).replace('.', ',') + ' pp/sem', 'Lula nos válidos; ~0 com poucos dados') : '';
  $('#metrics').innerHTML = c('Média ponderada (L / F)', ag.weighted ? f1(ag.weighted.l) + ' / ' + f1(ag.weighted.f) : '—', `${ag.count} obs.`) + c('Média simples (L / F)', ag.simple ? f1(ag.simple.l) + ' / ' + f1(ag.simple.f) : '—', `${ag.count} obs.`) +
    c('Diferença (ponderada)', d(ag.weighted), 'média simples: ' + d(ag.simple)) + c('Lula mín–máx', f1(lmin) + '–' + f1(lmax), v.length + ' obs.') + c('Flávio mín–máx', f1(fmin) + '–' + f1(fmax), v.length + ' obs.') +
    cx + c('Por método', Object.entries(methods).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ') || '—', 'pesquisas filtradas: ' + list.length);
}
function table(list, ag) {
  const rows = list.slice().sort((a, b) => ((a[sort.k] ?? '') > (b[sort.k] ?? '') ? 1 : -1) * sort.d);
  const H = [['institute', 'Instituto'], ['fieldEnd', 'Campo até'], ['released', 'Divulgação'], ['lula', 'Lula', 1], ['flavio', 'Flávio', 1], ['moe', 'Margem', 1], ['sample', 'Amostra', 1], ['method', 'Método'], ['scope', 'Abrangência'], [null, 'Na média'], [null, '']];
  const miss = (v, fmt) => (v == null || v === '' ? '<span class="miss">—</span>' : fmt ? fmt(v) : esc(v));
  $('#tbl').innerHTML = `<thead><tr>${H.map(([k, l, n]) => `<th class="${n ? 'n' : ''}" ${k ? `data-k="${k}"` : ''}>${l}${sort.k === k ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((p) => { const i = ag.info[p.id];
    return `<tr><td>${esc(p.institute)}${p.demo ? '<span class="demo">DEMO</span>' : ''}${p.resultType === 'total' ? ' <span class="badge" title="Votos totais; convertidos para válidos no cálculo">totais</span>' : ''}</td><td>${fd(p.fieldEnd)}</td><td>${miss(p.released, fd)}</td><td class="n">${p.lula}%</td><td class="n">${p.flavio}%</td><td class="n">${miss(p.moe, (v) => '±' + v)}</td><td class="n">${miss(S.sampleN(p), (v) => v.toLocaleString('pt-BR'))}</td><td>${miss(p.method)}</td><td>${esc(p.scope)}${p.state ? '/' + esc(p.state) : ''}</td>
<td><span class="badge ${i.included ? 'in' : ''}" title="${esc(i.included ? i.factors.join('; ') : i.reason)}">${i.included ? 'sim · peso ' + Math.round((i.share || 0) * 100) + '%' : 'não'}</span></td><td><button class="btn" data-a="det" data-id="${p.id}">${ic('eye')}Ver</button> <button class="btn" data-a="edit" data-id="${p.id}">${ic('edit')}Editar</button> <button class="btn" data-a="dup" data-id="${p.id}">${ic('copy')}Duplicar</button> <button class="btn danger" data-a="del" data-id="${p.id}">${ic('trash')}Excluir</button></td></tr>`; }).join('') : `<tr><td colspan="11" class="empty">Nenhuma pesquisa.</td></tr>`}</tbody>`;
}
$('#tbl').onclick = async (e) => {
  const th = e.target.closest('th[data-k]'); if (th) { sort = { k: th.dataset.k, d: sort.k === th.dataset.k ? -sort.d : 1 }; return render(); }
  const b = e.target.closest('button[data-a]'); if (!b) return; const p = polls.find((x) => x.id === b.dataset.id);
  if (b.dataset.a === 'det') detail(p.id); if (b.dataset.a === 'edit') openForm(p, 'edit');
  if (b.dataset.a === 'dup') { const c = { ...p }; delete c.id; openForm(c); }
  if (b.dataset.a === 'del' && confirm(`Excluir a pesquisa do ${p.institute} (${fd(p.fieldEnd)})?`)) { await api('/api/polls/' + p.id, { method: 'DELETE' }); load(); }
};
function detail(id) {
  const p = polls.find((x) => x.id === id), i = S.aggregate(polls, cfg.ref || today(), opts()).info[id];
  $('#detBody').innerHTML = `<h3>${esc(p.institute)} · ${fd(p.fieldEnd)}</h3><p>ID interno: <code>${p.id}</code></p><div class="scroll"><table>${FIELDS.map(([k, l]) => `<tr><th>${l}</th><td>${p[k] == null || p[k] === '' ? '<span class="miss">não informado</span>' : esc(p[k])}</td></tr>`).join('')}</table></div>
<p><b>Na média:</b> ${i.included ? 'sim, peso ' + i.w.toFixed(3) + ' (' + i.factors.join('; ') + ')' : 'não — ' + esc(i.reason)}. Dias desde o fim do campo: ${Math.round(i.age)}.</p>`;
  $('#tip').hidden = true; $('#det').showModal();
}
function institutes() {
  const g = {}; polls.forEach((p) => (g[p.institute] ||= []).push(p));
  const u = (a) => [...new Set(a.filter(Boolean))].map(esc).join(', ') || '—';
  $('#instTbl').innerHTML = `<thead><tr><th>Instituto</th><th class="n">Pesquisas</th><th>Mais recente</th><th>Abrangências</th><th>Métodos</th><th>Margens de erro</th><th></th></tr></thead><tbody>${Object.entries(g).sort().map(([n, a]) => `<tr><td>${esc(n)}</td><td class="n">${a.length}</td><td>${fd(a.map((p) => p.fieldEnd).sort().pop())}</td><td>${u(a.map((p) => p.scope))}</td><td>${u(a.map((p) => p.method))}</td><td>${u(a.map((p) => p.moe != null ? '±' + p.moe : ''))}</td><td><button class="btn" data-inst="${esc(n)}">Ver pesquisas</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sem institutos.</td></tr>'}</tbody>`;
}
$('#instTbl').onclick = (e) => { const n = e.target.dataset.inst; if (n) { $('#fInst').value = n; location.hash = 'pesquisas'; render(); } };

// Exportação / importação
const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
const KEYS = FIELDS.map((f) => f[0]);
$('#expJson').onclick = () => dl('pesquisas.json', JSON.stringify({ polls }, null, 1), 'application/json');
$('#expCsv').onclick = () => dl('pesquisas.csv', [KEYS.join(',')].concat(polls.map((p) => KEYS.map((k) => `"${String(p[k] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n'), 'text/csv');
function parseCsv(t) { const rows = []; let r = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; if (r.length > 1 || r[0]) rows.push(r); r = []; } else c += ch; } if (c || r.length) { r.push(c); rows.push(r); } const h = rows.shift() || []; return rows.map((x) => Object.fromEntries(h.map((k, i) => [k.trim(), x[i]]))); }
$('#impFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return; const t = await f.text();
  try { const items = f.name.endsWith('.csv') ? parseCsv(t) : (JSON.parse(t).polls || JSON.parse(t));
    if (!confirm(`Prévia: ${items.length} registro(s) encontrados em ${f.name}. Primeiro: ${items[0]?.institute || '?'} (${items[0]?.fieldEnd || '?'}). Importar? Registros inválidos ou duplicados serão ignorados e listados.`)) return;
    const r = await api('/api/polls/import', { method: 'POST', body: { polls: items } });
    alert(`Importados: ${r.imported}\nRejeitados: ${r.errors.length}` + r.errors.slice(0, 15).map((x) => `\nRegistro ${x.linha}: ${x.erros.join(' ')}`).join('')); load();
  } catch (x) { alert('Arquivo inválido: ' + x.message); } e.target.value = '';
};

// Configurações, demonstração, navegação
const saveCfg = () => { localStorage.setItem('cfg', JSON.stringify(cfg)); render(); };
[['cSys', 'sys'], ['cWalk', 'walk'], ['cTau', 'tau'], ['cSims', 'sims'], ['cInt', 'int'], ['cFreq', 'freq'], ['cHouse', 'house']].forEach(([id, k]) => ($('#' + id).value = cfg[k]));
$('#cHalf').value = cfg.half; $('#cScope').value = cfg.scope; $('#cMark').value = cfg.mark; $('#cRef').value = cfg.ref; $('#cElec').value = cfg.elec;
[['cHalf', 'half'], ['cScope', 'scope'], ['cMark', 'mark'], ['cRef', 'ref'], ['cElec', 'elec'], ['cSys', 'sys'], ['cWalk', 'walk'], ['cTau', 'tau'], ['cSims', 'sims'], ['cInt', 'int'], ['cFreq', 'freq'], ['cHouse', 'house']].forEach(([id, k]) => ($('#' + id).onchange = (e) => { cfg[k] = e.target.value; saveCfg(); }));
$('#demoBtn').onclick = async () => { // dados FICTÍCIOS, marcados como demo
  const items = []; for (let i = 0; i < 24; i++) { const d = new Date(Date.now() - (24 - i) * 2 * S.DAY).toISOString().slice(0, 10), n = ['Instituto Demo A', 'Instituto Demo B', 'Instituto Demo C'][i % 3], x = Math.sin(i * 1.7) * 1.5;
    items.push({ institute: n, surveyId: 'DEMO-' + i, scope: 'nacional', fieldStart: d, fieldEnd: d, released: d, lula: +(51 + i * 0.05 + x).toFixed(1), flavio: +(49 - i * 0.05 - x).toFixed(1), resultType: 'valid', sample: 1500 + (i % 3) * 500, moe: 2, method: ['telefone', 'internet', 'presencial'][i % 3], demo: true, notes: 'DADO FICTÍCIO DE DEMONSTRAÇÃO' }); }
  const r = await api('/api/polls/import', { method: 'POST', body: { polls: items } }); load();
};
$('#rmDemo').onclick = async () => { for (const p of polls.filter((x) => x.demo)) await api('/api/polls/' + p.id, { method: 'DELETE' }); load(); };
$('#clearAll').onclick = async () => { if (confirm('Apagar TODAS as pesquisas? Não há como desfazer.')) { await api('/api/polls', { method: 'DELETE' }); load(); } };
['fPeriod', 'fMode', 'fSmooth', 'fScale', 'fInst', 'fProj'].forEach((id) => ($('#' + id).onchange = render)); $('#search').oninput = render;
$('#resetBtn').onclick = () => { view = null; $('#fPeriod').value = '0'; $('#fInst').value = ''; $('#search').value = ''; $('#fMode').value = 'loess'; render(); };
$('#chart').addEventListener('wheel', (e) => { e.preventDefault(); const pts = polls.map((p) => S.toTime(p.fieldEnd)); if (!pts.length) return; const full = [Math.min(...pts) - 3 * S.DAY, Math.max(...pts, projEnd()) + 3 * S.DAY], [a, b] = view || full, k = e.deltaY > 0 ? 1.2 : 0.8, c = (a + b) / 2, h = ((b - a) / 2) * k; view = h * 2 >= full[1] - full[0] ? null : [c - h, c + h]; render(); }, { passive: false });
$('#burger').onclick = () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); };
function route() { const h = location.hash.slice(1) || 'presidente'; document.querySelectorAll('[data-page]').forEach((s) => (s.hidden = s.dataset.page !== h)); document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.hash === '#' + h)); $('#nav').classList.remove('open'); }
addEventListener('hashchange', () => { route(); if ((location.hash || '#presidente') === '#presidente' && lastMc && lastMc.N < mcTarget()) render(); }); route();
api('/api/config').then((c) => { $('#siteName').textContent = c.siteName; document.title = c.siteName; $('#storageInfo').textContent = c.storage === 'mongodb' ? 'Armazenamento: MongoDB do servidor.' : 'Armazenamento: arquivo local data/polls.json (MongoDB indisponível — somente desenvolvimento).'; });
load().catch(() => ($('#hero').innerHTML = '<div class="empty">Não foi possível carregar os dados do servidor.</div>'));

function mcPanel(mc, ag) {
  const el = $('#mc'); lastAg = ag;
  if (!mc) { el.innerHTML = `<h3>${ic('dice')}Simulação Monte Carlo</h3><p class="muted">Sem pesquisas suficientes na média para simular.</p>`; return; }
  const pc = (v) => v.toFixed(1).replace('.', ','), L = Math.round(mc.pLula * 100), F = 100 - L, q = mc.q;
  mcW = el.clientWidth; const W = Math.max(320, (mcW || 1000) - 44), H = W < 560 ? 250 : 320, m = { l: 12, r: 12, t: 36, b: 62 };
  const xa = Math.floor(q.p1 - 1), xb = Math.ceil(q.p99 + 1), X = (v) => m.l + ((v - xa) / (xb - xa)) * (W - m.l - m.r), base = H - m.b;
  const sm = (x) => { const c = (x - mc.histLo) / mc.bw - 0.5; let s = 0, ws = 0; for (let i = Math.floor(c) - 8; i <= Math.ceil(c) + 8; i++) { if (i < 0 || i >= mc.hist.length) continue; const w = Math.exp(-((i - c) ** 2) / 18); s += w * mc.hist[i]; ws += w; } return ws ? s / ws / mc.bw : 0; };
  const pts = []; let mx = 1e-9; for (let x = xa; x <= xb + 1e-9; x += 0.25) { const y = sm(x); pts.push([x, y]); if (y > mx) mx = y; }
  const Y = (v) => base - (v / mx) * (base - m.t - 12), line = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(''), area = `M${X(xa)} ${base}` + line.replace('M', 'L') + `L${X(xb)} ${base}Z`;
  const x50 = Math.max(m.l, Math.min(W - m.r, X(50))), step = xb - xa > 14 ? 2 : 1; let grid = '';
  for (let v = Math.ceil(xa / step) * step; v <= xb; v += step) grid += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${base}" stroke="var(--bd)"/><text x="${X(v)}" y="${base + 20}" text-anchor="middle">${v}%</text>`;
  const med = [X(q.p50), Y(sm(q.p50))], bar = (a, b, c, h) => `<rect x="${X(a)}" y="${H - 22}" width="${Math.max(2, X(b) - X(a))}" height="${h}" rx="${h / 2}" fill="${c}"/>`;
  el.innerHTML = `<h3>${ic('dice')}Simulação Monte Carlo · ${mc.h > 0 ? 'eleição em ' + fd(cfg.elec) + ' (' + mc.h + ' dias)' : 'estado atual'}</h3>
<p class="muted small" style="margin:0 0 10px">Distribuição do voto válido de Lula no dia da eleição, em ${mc.N.toLocaleString('pt-BR')} cenários simulados${mc.N < mcTarget() ? ' (prévia)' : ''}, incluindo choques de campanha: debates, atos, apoios, escândalos, economia, mídia e hecatombes.</p>
${mc.N < mcTarget() ? `<div class="mcprog" id="mcProg" role="progressbar" aria-label="Progresso da simulação"><i></i></div><p class="muted small" id="mcProgT" style="margin:4px 0 10px">Calculando…</p>` : ''}
<div class="pbar"><span class="rd" style="width:${Math.max(L, 9)}%">Lula ${L}%</span><span class="bl" style="width:${Math.max(F, 9)}%">Flávio ${F}%</span></div>
<svg viewBox="0 0 ${W} ${H}" class="dens" role="img" aria-label="Distribuição simulada do voto válido de Lula"><defs><clipPath id="mcL"><rect x="0" y="0" width="${x50}" height="${H}"/></clipPath><clipPath id="mcR"><rect x="${x50}" y="0" width="${W - x50}" height="${H}"/></clipPath></defs>${grid}
<path d="${area}" clip-path="url(#mcL)" fill="var(--bl)" fill-opacity=".8"/><path d="${area}" clip-path="url(#mcR)" fill="var(--rd)" fill-opacity=".8"/>
<line x1="${m.l}" x2="${W - m.r}" y1="${base}" y2="${base}" stroke="var(--gr)"/><line x1="${x50}" x2="${x50}" y1="${m.t - 6}" y2="${base}" stroke="var(--tx)" stroke-dasharray="4 4"/><text x="${x50}" y="14" text-anchor="middle" style="fill:var(--tx);font-weight:700;font-size:12px">${W < 560 ? '50%' : '50% = maioria'}</text>
<circle cx="${med[0]}" cy="${med[1]}" r="5.5" fill="#fff" stroke="var(--tx)" stroke-width="2"/><text x="${Math.min(med[0], x50 - 34)}" y="${med[1] - 12}" text-anchor="middle" style="fill:var(--tx);font-weight:700;font-size:12px">mediana ${pc(q.p50)}%</text>
${bar(q.p5, q.p95, '#d9d4fb', 8)}${bar(q.p25, q.p75, 'var(--ac)', 8)}</svg>
<div class="legend"><span><i style="background:var(--ac)"></i>50% dos cenários</span><span><i style="background:#d9d4fb"></i>90% dos cenários</span><span><i style="background:var(--bl)"></i>Flávio vence</span><span><i style="background:var(--rd)"></i>Lula vence</span></div>
<div class="mcstats"><div><small>Mediana de Lula</small><b>${pc(q.p50)}%</b></div><div><small>50% dos cenários</small><b>${pc(q.p25)}–${pc(q.p75)}%</b></div><div><small>90% dos cenários</small><b>${pc(q.p5)}–${pc(q.p95)}%</b></div><div><small>Erro da média (95%)</small><b>±${pc(1.96 * ag.model.se)} pp</b></div></div>
<div class="mcstats" style="margin-top:12px"><div><small>Lula sem choques de campanha</small><b>${Math.round(mc.pNoShock * 100)}%</b></div><div><small>Efeito dos choques na probabilidade</small><b>${(mc.pLula - mc.pNoShock) * 100 > 0.05 ? '+' : (mc.pLula - mc.pNoShock) * 100 < -0.05 ? '−' : ''}${Math.abs((mc.pLula - mc.pNoShock) * 100).toFixed(1).replace('.', ',')} pp</b></div><div><small>Hecatombe contra Lula (choque ≥ ${mc.hecThreshold} pp)</small><b>${pc(mc.pHecL * 100)}%</b></div><div><small>Hecatombe a favor de Lula (≥ ${mc.hecThreshold} pp)</small><b>${pc(mc.pHecF * 100)}%</b></div></div>
<p class="muted small" style="margin:12px 0 0">Cada cenário sorteia o nível atual, um erro sistemático comum às pesquisas (σ=${pc(mc.params.sysErr)} pp, cauda pesada), a oscilação diária da opinião, uma tendência incerta e um conjunto de <b>choques de campanha</b> (processo de saltos com ~100 tipos de acontecimentos, bons e ruins para os dois lados, que se dissipam até a eleição). Vence quem passa de 50% dos válidos. É uma probabilidade condicional a essas premissas, não uma previsão. <a href="#simulador">Ver catálogo de choques, matriz de debates e parâmetros →</a></p>`;
}
new ResizeObserver(() => { const el = $('#mc'); if (lastAg && el.clientWidth && Math.abs(el.clientWidth - mcW) > 4) mcPanel(lastMc, lastAg); }).observe($('#mc'));
