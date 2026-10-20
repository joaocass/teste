// Análises derivadas (navegador + Node). Sem dependências além de stats.js. Funções puras, sem estado global.
// Nada aqui inventa dados: tudo é calculado a partir das pesquisas cadastradas (ou de cenários hipotéticos,
// sempre marcados e mantidos fora da base real).
(function (root) {
  const S = root.Stats || (typeof require !== 'undefined' ? require('./stats') : null);
  const M = () => root.MC || (typeof require !== 'undefined' ? require('./mc.js') : null); // Monte Carlo v2 (carregado depois deste arquivo no navegador)
  const DAY = S.DAY;
  // Data a partir da qual a pesquisa era pública (divulgação; se ausente, fim do campo). Evita "olhar o futuro".
  const avail = (p) => (p.released && p.released > p.fieldEnd ? p.released : p.fieldEnd);
  const isReal = (p) => !p.hypothetical;

  // Série diária da média: para cada dia d, agrega SOMENTE pesquisas já divulgadas até d, com as mesmas
  // regras do modelo (recência, precisão, instituto). Dias sem pesquisa elegível são omitidos.
  function dailySeries(polls, from, to, opt) {
    const out = [];
    for (let t = S.toTime(from); t <= S.toTime(to); t += DAY) {
      const d = S.toDate(t), sub = polls.filter((p) => avail(p) <= d), ag = S.aggregate(sub, d, opt);
      if (!ag.weighted) continue;
      const h = 1.96 * ag.model.se;
      out.push({ date: d, t, l: ag.weighted.l, f: ag.weighted.f, diff: ag.weighted.l - ag.weighted.f, lo: ag.weighted.l - h, hi: ag.weighted.l + h, simpleL: ag.simple.l, n: ag.count });
    }
    return out;
  }
  // Variação ao longo de um trecho: diferença entre extremos e inclinação (MQO, pp/dia) com erro-padrão.
  function trend(series, key) {
    const n = series.length; if (n < 2) return null;
    const xs = series.map((s) => (s.t - series[0].t) / DAY), ys = series.map((s) => s[key]), mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0); if (!sxx) return null;
    const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
    const res = ys.reduce((a, y, i) => a + (y - my - b * (xs[i] - mx)) ** 2, 0), se = n > 2 ? Math.sqrt(res / (n - 2) / sxx) : null;
    return { change: ys[n - 1] - ys[0], slope: b, slopeSe: se, days: xs[n - 1], first: ys[0], last: ys[n - 1] };
  }

  // Relatório por instituto. Desvio de cada pesquisa = voto válido de Lula − média das pesquisas dos OUTROS
  // institutos já divulgadas na data de término do campo (leave-one-institute-out). Null se não há comparação.
  function instituteReport(polls, refDate, opt) {
    const ag = S.aggregate(polls, refDate, opt), by = {};
    polls.filter(isReal).forEach((p) => (by[p.institute] = by[p.institute] || []).push(p));
    return Object.keys(by).sort().map((name) => {
      const ps = by[name].slice().sort((a, b) => (a.fieldEnd < b.fieldEnd ? -1 : 1)), hist = [];
      ps.forEach((p) => {
        const sh = S.validShares(p); if (!sh) return;
        const others = polls.filter((q) => q.institute !== name && avail(q) <= p.fieldEnd), a = S.aggregate(others, p.fieldEnd, Object.assign({}, opt, { houseEffect: false }));
        hist.push({ id: p.id, fieldEnd: p.fieldEnd, l: sh.l, f: sh.f, ref: a.weighted ? a.weighted.l : null, dev: a.weighted ? sh.l - a.weighted.l : null });
      });
      const devs = hist.filter((h) => h.dev != null).map((h) => h.dev), mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const sd = devs.length > 1 ? Math.sqrt(devs.reduce((a, d) => a + (d - mean(devs)) ** 2, 0) / (devs.length - 1)) : null;
      const samples = ps.map(S.sampleN).filter(Boolean), neffs = ps.map(S.effectiveN).filter(Boolean), moes = ps.map((p) => p.moe).filter((v) => v > 0);
      const last = ps[ps.length - 1], ls = S.validShares(last), inclAg = ag.info[last.id];
      return { institute: name, count: ps.length, first: ps[0].fieldEnd, last: last.fieldEnd, methods: [...new Set(ps.map((p) => p.method).filter(Boolean))], sponsors: [...new Set(ps.map((p) => p.sponsor).filter(Boolean))],
        meanSample: mean(samples), meanNeff: mean(neffs), meanMoe: mean(moes), lastL: ls ? ls.l : null, lastF: ls ? ls.f : null, lastWeightShare: inclAg && inclAg.share != null ? inclAg.share : null,
        meanDev: mean(devs), sdDev: sd, nDev: devs.length, modelHouse: ag.model && ag.model.house[name] != null ? ag.model.house[name] : null, hist };
    });
  }

  // --- Cenários hipotéticos (nunca gravados na base real) ---------------------------------------
  // cenário = { id, name, adds:[pesquisa hipotética], overrides:{[idReal]:{lula,flavio}}, exclude:[idReal] }
  function applyScenario(real, sc) {
    const ex = new Set(sc.exclude || []), ov = sc.overrides || {};
    const base = real.filter((p) => !ex.has(p.id)).map((p) => (ov[p.id] ? Object.assign({}, p, { lula: +ov[p.id].lula, flavio: +ov[p.id].flavio, hypothetical: true, modified: true }) : p));
    const adds = (sc.adds || []).map((a, i) => Object.assign({ scope: 'nacional', resultType: 'total', method: '', confidence: 95 }, a, { id: 'sim-' + (sc.id || 'x') + '-' + i, hypothetical: true, duplicateOf: '' }));
    return base.concat(adds);
  }
  function validateScenario(sc) {
    const errors = [];
    (sc.adds || []).forEach((a, i) => { const v = S.validatePoll(Object.assign({ resultType: 'total' }, a, { lula: a.lula === '' ? null : a.lula, flavio: a.flavio === '' ? null : a.flavio })); v.errors.forEach((e) => errors.push(`Pesquisa hipotética ${i + 1}: ${e}`)); });
    return errors;
  }
  // Compara cenários com a base real (cenário nulo). Retorna média, deltas e Monte Carlo de cada um.
  function compareScenarios(real, scenarios, refDate, elecDate, aggOpt, mcOpt) {
    const run = (name, polls, id) => {
      const ag = S.aggregate(polls, refDate, aggOpt), mc = ag.model ? M().run(ag.model, refDate, elecDate, Object.assign({ sims: 20000, fan: false }, mcOpt)) : null;
      return { id, name, count: ag.count, l: ag.weighted ? ag.weighted.l : null, f: ag.weighted ? ag.weighted.f : null, se: ag.model ? ag.model.se : null, nowL: ag.model ? ag.model.nowL : null, pLula: mc ? mc.pLula : null, pCI: mc ? mc.pCI : null, q: mc ? mc.q : null };
    };
    const base = run('Dados reais (base)', real.filter(isReal), 'base');
    const rows = scenarios.map((sc) => { const r = run(sc.name, applyScenario(real.filter(isReal), sc), sc.id); r.dL = r.l != null && base.l != null ? r.l - base.l : null; r.dP = r.pLula != null && base.pLula != null ? r.pLula - base.pLula : null; return r; });
    return { base, rows };
  }
  // Sensibilidade: probabilidade de Lula passar de `threshold` variando o erro sistemático (0,5× / 1× / 1,5×) e a tendência (0 / 1×).
  function sensitivity(model, refDate, elecDate, mcOpt) {
    const out = [], o = mcOpt || {}, sys = o.sysErr != null ? +o.sysErr : S.DEF.sysErr;
    [[0.5, 1], [1, 1], [1.5, 1], [1, 0]].forEach(([k, tm]) => { const m = M().run(model, refDate, elecDate, Object.assign({ sims: 20000 }, o, { sysErr: sys * k, trendMult: tm, fan: false })); out.push({ label: tm === 0 ? 'Sem tendência' : `Erro sistemático ${k}×`, sysErr: sys * k, trendMult: tm, p: m.pLula }); });
    return out;
  }
  root.Analytics = { avail, dailySeries, trend, instituteReport, applyScenario, validateScenario, compareScenarios, sensitivity };
  if (typeof module !== 'undefined') module.exports = root.Analytics;
})(typeof window !== 'undefined' ? window : globalThis);
