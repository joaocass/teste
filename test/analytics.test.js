const test = require('node:test'), assert = require('node:assert');
const S = require('../public/stats'), A = require('../public/analytics');
const P = (o) => Object.assign({ id: Math.random().toString(36).slice(2), scope: 'nacional', resultType: 'total', method: 'internet', sample: 2000, confidence: 95, duplicateOf: '', released: '' }, o);
const base = [
  P({ institute: 'A', lula: 46, flavio: 48, fieldStart: '2026-10-01', fieldEnd: '2026-10-02' }),
  P({ institute: 'B', lula: 47, flavio: 47, fieldStart: '2026-10-01', fieldEnd: '2026-10-03' }),
  P({ institute: 'A', lula: 45, flavio: 49, fieldStart: '2026-10-05', fieldEnd: '2026-10-06' }),
  P({ institute: 'C', lula: 44, flavio: 50, fieldStart: '2026-10-05', fieldEnd: '2026-10-07', released: '2026-10-09' }),
];
test('série diária não usa pesquisas ainda não divulgadas (sem look-ahead)', () => {
  const s = A.dailySeries(base, '2026-10-02', '2026-10-09', {});
  const d8 = s.find((x) => x.date === '2026-10-08'), d9 = s.find((x) => x.date === '2026-10-09');
  assert.strictEqual(d8.n, 3); assert.strictEqual(d9.n, 4);
  assert.ok(s.every((x) => Math.abs(x.l + x.f - 100) < 1e-9));
  assert.strictEqual(s[0].date, '2026-10-02');
});
test('série diária coincide com agregação direta na data', () => {
  const s = A.dailySeries(base, '2026-10-09', '2026-10-09', {}), ag = S.aggregate(base, '2026-10-09', {});
  assert.ok(Math.abs(s[0].l - ag.weighted.l) < 1e-9);
});
test('tendência: série linear tem inclinação exata', () => {
  const ser = [0, 1, 2, 3].map((i) => ({ t: S.toTime('2026-10-01') + i * S.DAY, l: 50 - 0.5 * i }));
  const t = A.trend(ser, 'l'); assert.ok(Math.abs(t.slope + 0.5) < 1e-9); assert.ok(Math.abs(t.change + 1.5) < 1e-9);
  assert.strictEqual(A.trend([ser[0]], 'l'), null);
});
test('relatório de institutos: contagens, métodos e desvio leave-one-out', () => {
  const r = A.instituteReport(base, '2026-10-09', {}), a = r.find((x) => x.institute === 'A');
  assert.strictEqual(a.count, 2); assert.deepStrictEqual(a.methods, ['internet']);
  assert.strictEqual(a.hist.length, 2); assert.ok(a.hist.every((h) => h.dev == null || Math.abs(h.dev - (h.l - h.ref)) < 1e-9));
  assert.strictEqual(r.find((x) => x.institute === 'B').meanDev, r.find((x) => x.institute === 'B').hist[0].dev);
  // Instituto sem outros disponíveis na data não tem desvio inventado
  const solo = A.instituteReport([base[0]], '2026-10-09', {})[0]; assert.strictEqual(solo.meanDev, null);
});
test('cenário não altera dados reais e marca pesquisas hipotéticas', () => {
  const copy = JSON.stringify(base), sc = { id: 's1', name: 'X', adds: [{ institute: 'Hip', lula: 60, flavio: 40, fieldStart: '2026-10-08', fieldEnd: '2026-10-09' }] };
  const out = A.applyScenario(base, sc);
  assert.strictEqual(JSON.stringify(base), copy); assert.strictEqual(out.length, 5);
  assert.ok(out[4].hypothetical && out[4].id.startsWith('sim-')); assert.ok(!out[0].hypothetical);
});
test('cenário com pesquisa favorável a Lula aumenta a média e a probabilidade; overrides e exclusões funcionam', () => {
  const cmp = A.compareScenarios(base, [
    { id: 'up', name: 'Alta', adds: [{ institute: 'H', lula: 60, flavio: 40, fieldStart: '2026-10-08', fieldEnd: '2026-10-09', sample: 3000, method: 'internet' }] },
    { id: 'ov', name: 'Override', overrides: { [base[0].id]: { lula: 55, flavio: 45 } } },
    { id: 'ex', name: 'Excluir', exclude: [base[3].id] }], '2026-10-10', '2026-10-25', {}, { sims: 2000 });
  const up = cmp.rows[0], ov = cmp.rows[1], ex = cmp.rows[2];
  assert.ok(up.dL > 0 && up.dP >= 0); assert.ok(ov.dL > 0); assert.strictEqual(ex.count, 3); assert.ok(ex.dL > 0);
  assert.strictEqual(cmp.base.count, 4); assert.ok(Math.abs(cmp.base.l + cmp.base.f - 100) < 1e-9);
});
test('cenário sem alterações reproduz a base exatamente', () => {
  const c = A.compareScenarios(base, [{ id: 'n', name: 'Nulo' }], '2026-10-10', '2026-10-25', {}, { sims: 2000 });
  assert.strictEqual(c.rows[0].l, c.base.l); assert.strictEqual(c.rows[0].pLula, c.base.pLula);
});
test('validação de cenário rejeita pesquisa hipotética inválida', () => {
  assert.ok(A.validateScenario({ adds: [{ institute: '', lula: 150, flavio: 10, fieldEnd: 'x' }] }).length >= 2);
  assert.strictEqual(A.validateScenario({ adds: [{ institute: 'H', lula: 50, flavio: 50, fieldEnd: '2026-10-09' }] }).length, 0);
});
test('Monte Carlo: parâmetros novos (threshold, shift, trendMult, seed) e IC de Wilson', () => {
  const ag = S.aggregate(base, '2026-10-10', {}), m = ag.model, d = S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000 });
  const same = S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000 }); assert.strictEqual(d.pLula, same.pLula);
  assert.ok(S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000, shift: 3 }).pLula > d.pLula);
  assert.ok(S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000, threshold: 45 }).pLula > d.pLula);
  assert.ok(d.pCI[0] <= d.pLula && d.pLula <= d.pCI[1]);
  const ci = S.probCI(500, 1000); assert.ok(Math.abs((ci[0] + ci[1]) / 2 - 0.5) < 1e-3 && ci[1] - ci[0] < 0.07);
  const hi = S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000, sysErr: 6 }); assert.ok(Math.abs(hi.pLula - 0.5) < Math.abs(d.pLula - 0.5) + 0.02);
  // modo leve (fan:false) dá exatamente a mesma probabilidade, sem guardar caminhos diários
  const light = S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000, fan: false }); assert.strictEqual(light.pLula, d.pLula); assert.strictEqual(light.days.length, 0); assert.ok(d.days.length > 1);
  assert.strictEqual(S.simulate(m, '2026-10-10', '2026-10-25', { sims: 4000 }), d); // memoizado
  const raw = S.simulateRaw(m, '2026-10-10', '2026-10-25', { sims: 4000 }); assert.strictEqual(raw.pLula, d.pLula);
  const sens = A.sensitivity(m, '2026-10-10', '2026-10-25', { sims: 2000 }); assert.strictEqual(sens.length, 4);
});
