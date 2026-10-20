// Núcleo estatístico (navegador + Node). Sem dependências.
// Pipeline: votos válidos -> erro amostral (n efetivo) -> pesos (recência × 1/variância total) ->
// efeito de instituto (com encolhimento) -> média + erro-padrão -> tendência encolhida -> Monte Carlo.
(function (root) {
  const DAY = 86400000;
  const toTime = (s) => new Date(s + 'T12:00:00Z').getTime();
  const toDate = (t) => new Date(t).toISOString().slice(0, 10);
  const DEF = { halfLife: 14, tau: 1.5, sysErr: 2.0, walk: 0.12, driftSd: 0.08, damp: 0.95, sims: 10000, houseEffect: true };
  const DEFF = { presencial: 1.3, telefone: 1.6, internet: 1.8 }; // efeito de desenho por método (n efetivo = n / deff)
  const Z = { 90: 1.645, 95: 1.96, 99: 2.576 };

  function validShares(p) {
    if (p.resultType === 'valid') return { l: p.lula, f: p.flavio };
    const s = p.lula + p.flavio;
    if (!(s > 0)) return null;
    return { l: (p.lula / s) * 100, f: (p.flavio / s) * 100 };
  }
  function validatePoll(p) {
    const err = [], warn = [];
    const num = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
    if (!p.institute || !String(p.institute).trim()) err.push('Informe o instituto.');
    ['lula', 'flavio'].forEach((k) => {
      if (!num(p[k])) err.push(`Informe o percentual de ${k === 'lula' ? 'Lula' : 'Flávio'}.`);
      else if (p[k] < 0 || p[k] > 100) err.push('Percentuais devem estar entre 0 e 100.');
    });
    ['blankNull', 'undecided', 'others'].forEach((k) => {
      if (num(p[k]) && (p[k] < 0 || p[k] > 100)) err.push('Percentuais devem estar entre 0 e 100.');
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fieldEnd || '') || isNaN(toTime(p.fieldEnd))) err.push('Data final do campo inválida.');
    if (p.fieldStart && p.fieldEnd && p.fieldStart > p.fieldEnd) err.push('A data final do campo é anterior à inicial.');
    if (!['valid', 'total'].includes(p.resultType)) err.push('Indique se os resultados são votos totais ou válidos.');
    if (p.sample !== null && p.sample !== undefined && p.sample !== '' && !(Number(p.sample) > 0)) err.push('Amostra deve ser positiva.');
    if (err.length === 0) {
      const sum = ['lula', 'flavio', 'blankNull', 'undecided', 'others'].reduce((a, k) => a + (num(p[k]) ? Number(p[k]) : 0), 0);
      if (p.resultType === 'valid' && Math.abs(Number(p.lula) + Number(p.flavio) - 100) > 1.5) warn.push('Em votos válidos, Lula + Flávio deveria somar ~100%.');
      if (p.resultType === 'total' && sum > 101.5) warn.push('A soma dos percentuais passa de 100%.');
      if (!num(p.sample) && !num(p.moe)) warn.push('Sem amostra nem margem de erro: a pesquisa terá peso mínimo de precisão.');
    }
    return { errors: err, warnings: warn };
  }

  // Amostra em nº de entrevistas. Valores < 100 são lidos como "milhares" (ex.: 2,52 = 2.520; 5,026 = 5.026).
  function sampleN(p) { const s = Number(p.sample); return s > 0 ? (s < 100 ? Math.round(s * 1000) : s) : null; }
  // n efetivo: n/deff; se também há MoE, vale o MENOR entre n/deff e o n implícito na MoE (MoE otimista demais é ignorada).
  function effectiveN(p) {
    const n = sampleN(p), z = Z[Number(p.confidence)] || 1.96;
    const byN = n ? n / (DEFF[p.method] || 1.5) : null;
    const byM = Number(p.moe) > 0 ? (z * z * 0.25) / Math.pow(Number(p.moe) / 100, 2) : null;
    return byN && byM ? Math.min(byN, byM) : byN || byM;
  }
  // Erro-padrão amostral (pp) da parcela de Lula entre votos válidos (base = só quem escolheu um dos dois).
  function sampleSE(p) {
    const n = effectiveN(p), s = validShares(p);
    if (!n || !s) return 3.5; // sem n/MoE: erro assumido grande (não inventa precisão)
    const base = p.resultType === 'valid' ? 1 : (p.lula + p.flavio) / 100, nv = Math.max(30, n * base), q = s.l / (s.l + s.f);
    return Math.sqrt((q * (1 - q)) / nv) * 100;
  }

  // Peso = recência × 1/(erro amostral² + τ²). τ = erro não amostral (viés, ponderação, método): impede que n gigante domine.
  function weigh(p, refDate, opt) {
    opt = Object.assign({}, DEF, opt);
    const age = Math.max(0, (toTime(refDate) - toTime(p.fieldEnd)) / DAY), f = [];
    if (p.duplicateOf) return { w: 0, included: false, reason: 'Duplicata de outro levantamento', age, factors: f };
    if (!validShares(p)) return { w: 0, included: false, reason: 'Resultados inválidos', age, factors: f };
    if (opt.windowDays && age > opt.windowDays) return { w: 0, included: false, reason: 'Fora do período', age, factors: f };
    if (opt.scope && opt.scope !== 'all' && p.scope !== opt.scope) return { w: 0, included: false, reason: 'Abrangência diferente', age, factors: f };
    const rec = Math.pow(0.5, age / opt.halfLife), se = sampleSE(p), v = se * se + opt.tau * opt.tau, n = effectiveN(p);
    f.push(`recência ${rec.toFixed(2)}`, n ? `n efetivo ≈ ${Math.round(n)}` : 'sem n/MoE', `erro amostral ±${(1.96 * se).toFixed(1)} pp`, `erro total ±${(1.96 * Math.sqrt(v)).toFixed(1)} pp`);
    return { w: rec / v, included: true, reason: '', age, factors: f, se, v };
  }

  function aggregate(polls, refDate, opt) {
    opt = Object.assign({}, DEF, opt);
    const info = {}, E = [];
    polls.forEach((p) => {
      const r = weigh(p, refDate, opt); info[p.id] = r;
      if (r.included) { const s = validShares(p), t = s.l + s.f; E.push({ p, r, L: (s.l / t) * 100, ul: s.l, uf: s.f, inst: p.institute, w: r.w }); }
    });
    if (!E.length) return { info, count: 0, weighted: null, simple: null, model: null };
    // Cada instituto pesa ~√k (k pesquisas), evitando que quem publica toda semana domine.
    const k = {}; E.forEach((e) => (k[e.inst] = (k[e.inst] || 0) + 1)); E.forEach((e) => (e.w /= Math.sqrt(k[e.inst])));
    // Efeito de instituto: desvio médio vs consenso dos OUTROS, encolhido por k/(k+3). Só com ≥2 pesquisas do instituto.
    const house = {};
    if (opt.houseEffect) Object.keys(k).forEach((i) => {
      if (k[i] < 2) return;
      const mine = E.filter((e) => e.inst === i), others = E.filter((e) => e.inst !== i), sw = others.reduce((a, e) => a + e.w, 0);
      if (!sw) return;
      const cons = others.reduce((a, e) => a + e.w * e.L, 0) / sw;
      house[i] = (mine.reduce((a, e) => a + e.L - cons, 0) / mine.length) * (k[i] / (k[i] + 3));
    });
    E.forEach((e) => (e.A = e.L - (house[e.inst] || 0)));
    const sw = E.reduce((a, e) => a + e.w, 0), sw2 = E.reduce((a, e) => a + e.w * e.w, 0), m = E.reduce((a, e) => a + e.w * e.A, 0) / sw;
    E.forEach((e) => (e.r.share = e.w / sw));
    const se = Math.sqrt(E.reduce((a, e) => a + e.w * e.w * e.r.v, 0)) / sw, neff = (sw * sw) / sw2;
    // Tendência: regressão ponderada no tempo (x = −idade), encolhida p/ 0 (prior N(0, driftSd²)): poucos pontos => tendência ~0.
    let slope = 0, slopeSd = opt.driftSd, xbar = 0;
    const ages = new Set(E.map((e) => Math.round(e.r.age)));
    xbar = -E.reduce((a, e) => a + e.w * e.r.age, 0) / sw;
    if (E.length >= 3 && ages.size >= 3) {
      const sxx = E.reduce((a, e) => a + e.w * Math.pow(-e.r.age - xbar, 2), 0), pxx = E.reduce((a, e) => a + Math.pow(-e.r.age - xbar, 2) / e.r.v, 0);
      if (sxx > 0 && pxx > 0) {
        const b = E.reduce((a, e) => a + e.w * (-e.r.age - xbar) * (e.A - m), 0) / sxx, vb = 1 / pxx, s0 = opt.driftSd * opt.driftSd;
        slope = (b * s0) / (s0 + vb); slopeSd = Math.sqrt((s0 * vb) / (s0 + vb));
      }
    }
    const nowL = m + slope * (0 - xbar), nowSe = Math.sqrt(se * se + Math.pow(slopeSd * xbar, 2));
    const n = E.length, ul = E.reduce((a, e) => a + e.ul, 0) / n, uf = E.reduce((a, e) => a + e.uf, 0) / n;
    return { info, count: n, weighted: { l: m, f: 100 - m }, simple: { l: ul, f: uf },
      model: { mean: m, se, neff, slope, slopeSd, nowL, nowSe, house, ref: refDate } };
  }

  // --- Monte Carlo ---------------------------------------------------------------------------
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function normal(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
  const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  // Cada simulação: nível atual ~ N(nowL, nowSe) + erro sistemático das pesquisas (t de Student, 5 gl, caudas pesadas, comum a todas)
  // + passeio aleatório diário da opinião + deriva amortecida com inclinação incerta. Vence quem passar de 50% dos válidos.
  function simulate(model, refDate, elecDate, o) {
    o = Object.assign({}, DEF, o);
    if (!model) return null;
    const h = Math.max(0, Math.min(120, Math.round((toTime(elecDate || refDate) - toTime(refDate)) / DAY))), N = Math.max(1000, Math.min(50000, +o.sims || 10000));
    const thr = Number.isFinite(+o.threshold) ? +o.threshold : 50, shift = +o.shift || 0, tm = Number.isFinite(+o.trendMult) ? +o.trendMult : 1;
    const r = rng(o.seed != null ? +o.seed : 7919 + Math.round(model.nowL * 100) * 31 + h), fan = o.fan !== false, paths = fan ? Array.from({ length: h + 1 }, () => new Float64Array(N)) : null, fin = new Float64Array(N), sc = Math.sqrt(3 / 5);
    for (let i = 0; i < N; i++) {
      let chi = 0; for (let j = 0; j < 5; j++) { const z = normal(r); chi += z * z; }
      const e = (o.sysErr * sc * normal(r)) / Math.sqrt(chi / 5), b = tm * model.slope + model.slopeSd * normal(r);
      let L = model.nowL + shift + model.nowSe * normal(r) + e; if (fan) paths[0][i] = L;
      for (let d = 1; d <= h; d++) { L += o.walk * normal(r) + b * Math.pow(o.damp, d); if (fan) paths[d][i] = L; }
      fin[i] = L;
    }
    const t0 = toTime(refDate), days = (fan ? paths : []).map((col, d) => { const s = Float64Array.from(col).sort(); return { date: toDate(t0 + d * DAY), t: t0 + d * DAY, p5: quant(s, 0.05), p25: quant(s, 0.25), p50: quant(s, 0.5), p75: quant(s, 0.75), p95: quant(s, 0.95) }; });
    const sorted = Float64Array.from(fin).sort(); let win = 0; for (let i = 0; i < N; i++) if (fin[i] > thr) win++;
    const lo = 30, bw = 0.25, nb = 160, hist = new Array(nb).fill(0); for (let i = 0; i < N; i++) hist[Math.max(0, Math.min(nb - 1, Math.floor((fin[i] - lo) / bw)))]++;
    return { N, h, days, hist: hist.map((c) => c / N), histLo: lo, bw, pLula: win / N, pFlavio: 1 - win / N, pCI: probCI(win, N), threshold: thr,
      q: { p1: quant(sorted, 0.01), p99: quant(sorted, 0.99), p5: quant(sorted, 0.05), p25: quant(sorted, 0.25), p50: quant(sorted, 0.5), p75: quant(sorted, 0.75), p95: quant(sorted, 0.95) }, params: o };
  }

  // Memoização: a simulação é determinística (semente fixa), então mesmos dados + mesmos parâmetros = mesmo resultado.
  // Evita recalcular 10 mil simulações a cada tecla na busca, redimensionamento da janela ou troca de aba.
  const memo = new Map(), simulateRaw = simulate;
  function simulateCached(model, refDate, elecDate, o) {
    if (!model) return null;
    const key = [model.nowL, model.nowSe, model.slope, model.slopeSd, refDate, elecDate, JSON.stringify(o || {})].join('|');
    if (memo.has(key)) return memo.get(key);
    const v = simulateRaw(model, refDate, elecDate, o); memo.set(key, v);
    if (memo.size > 40) memo.delete(memo.keys().next().value);
    return v;
  }
  // Intervalo de 95% (Wilson) para a probabilidade estimada: mede só o ERRO DE SIMULAÇÃO (nº de sorteios),
  // não a incerteza das premissas do modelo (essa é mostrada pela análise de sensibilidade).
  function probCI(k, n) { const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, w = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d; return [Math.max(0, c - w), Math.min(1, c + w)]; }

  // LOESS (grau 1 ou 2, tricúbico). `prior` = pesos opcionais por observação (ex.: precisão). Null se dados insuficientes.
  function loess(xs, ys, span, degree, prior) {
    degree = degree || 1;
    const n = xs.length;
    if (n < 4 || new Set(xs).size < 3) return null;
    const q = Math.min(n, Math.max(degree + 2, Math.ceil(span * n)));
    return function (x0) {
      const d = xs.map((x) => Math.abs(x - x0)), sorted = d.slice().sort((a, b) => a - b);
      let h = sorted[q - 1];
      if (h <= 0) h = 1;
      const w = d.map((di, i) => (di < h ? Math.pow(1 - Math.pow(di / h, 3), 3) * (prior ? prior[i] : 1) : 0));
      const t = xs.map((x) => (x - x0) / DAY);
      const m = degree + 1, A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
      for (let i = 0; i < n; i++) {
        if (!w[i]) continue;
        for (let r = 0; r < m; r++) {
          for (let c = 0; c < m; c++) A[r][c] += w[i] * Math.pow(t[i], r + c);
          A[r][m] += w[i] * Math.pow(t[i], r) * ys[i];
        }
      }
      for (let r = 1; r < m; r++) A[r][r] += 1e-9 * (A[r][r] || 1);
      for (let i = 0; i < m; i++) {
        let p = i;
        for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
        [A[i], A[p]] = [A[p], A[i]];
        if (Math.abs(A[i][i]) < 1e-12) return A[0][0] > 0 ? A[0][m] / A[0][0] : null;
        for (let r = i + 1; r < m; r++) { const k = A[r][i] / A[i][i]; for (let c = i; c <= m; c++) A[r][c] -= k * A[i][c]; }
      }
      const b = new Array(m).fill(0);
      for (let i = m - 1; i >= 0; i--) { let s = A[i][m]; for (let c = i + 1; c < m; c++) s -= A[i][c] * b[c]; b[i] = s / A[i][i]; }
      return b[0];
    };
  }
  root.Stats = { toTime, toDate, validShares, validatePoll, sampleN, effectiveN, sampleSE, weigh, aggregate, simulate: simulateCached, simulateRaw, probCI, loess, DAY, DEF };
  if (typeof module !== 'undefined') module.exports = root.Stats;
})(typeof window !== 'undefined' ? window : globalThis);
