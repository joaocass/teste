const test = require('node:test'), assert = require('node:assert');
const S = require('../public/stats.js'), MC = require('../public/mc.js');
const model = { nowL: 51.5, nowSe: 0.7, slope: 0, slopeSd: 0.05 }, REF = '2026-10-11', ELEC = '2026-10-25';
const run = (o) => MC.run(model, REF, ELEC, Object.assign({ sims: 50000, fan: false }, o));

test('MC v2: reprodutível e memoizado', () => { const a = run({}), b = run({}); assert.strictEqual(a, b); const c = MC.prepare(model, REF, ELEC, { sims: 50000 }); assert.strictEqual(MC.assemble(c, MC.tasksFor(c).map((t) => ({ task: t, out: MC.runTask(c, t) }))).pLula, a.pLula); });
test('MC v2: resultado não depende da ordem/divisão dos blocos (workers)', () => {
  const c = MC.prepare(model, REF, ELEC, { sims: 100000, fan: false }), T = MC.tasksFor(c), rev = T.slice().reverse().map((t) => ({ task: t, out: MC.runTask(c, t) }));
  assert.strictEqual(MC.assemble(c, rev).pLula, MC.assemble(c, T.map((t) => ({ task: t, out: MC.runTask(c, t) }))).pLula);
});
test('MC v2: sem choques ≈ modelo antigo (mesma lei) e choques aumentam a dispersão e puxam P para 50%', () => {
  const off = run({ shocks: false, walk: 0.12, sims: 200000 }), old = S.simulateRaw(model, REF, ELEC, { sims: 50000, fan: false });
  assert.ok(Math.abs(off.pLula - old.pLula) < 0.012, `${off.pLula} vs ${old.pLula}`);
  const on = run({ sims: 200000 }), base = run({ shocks: false, sims: 200000 });
  assert.ok(on.sd > base.sd + 0.3); assert.ok(on.kurt > base.kurt); assert.ok(Math.abs(on.pLula - 0.5) < Math.abs(on.pNoShock - 0.5));
  assert.ok(Math.abs(on.pNoShock - base.pLula) < 0.01); // números aleatórios comuns
});
test('MC v2: ocorrência simulada ≈ analítica; calibração do desvio dos choques em ~1,5 pp (14 dias)', () => {
  const r = run({ sims: 200000 }); const e = r.rows.find((x) => x.id === 'ato_massa_L'); assert.ok(e.pOcc <= e.pAnalytic + 0.01 && e.pOcc > e.pAnalytic - 0.04);
  assert.ok(r.comp[4].sd > 1.2 && r.comp[4].sd < 2.0, r.comp[4].sd);
});
test('MC v2: parâmetros — limiar, ajuste, grupos, exposição e intensidade', () => {
  assert.ok(run({ shift: 3 }).pLula > run({}).pLula); assert.ok(run({ threshold: 45 }).pLula > run({}).pLula);
  const only = run({ groups: ['hecatombes'], sims: 100000 }); assert.ok(only.rows.every((x) => x.grp === 'hecatombes' || x.pseudo) && only.comp[4].sd < run({}).comp[4].sd);
  assert.ok(run({ intensity: 0 }).comp[4].sd < 1e-9); assert.ok(run({ intensity: 2 }).comp[4].sd > run({}).comp[4].sd * 1.7);
  const noF = run({ expF: 0, sims: 100000 }); assert.ok(noF.rows.filter((x) => x.actor === 'F' && !x.pseudo).every((x) => x.pOcc === 0));
});
test('MC v2: debates — matriz monotônica e sem debates sem categorias', () => {
  const r = MC.run(model, REF, ELEC, { sims: 20000, fan: false, matrix: true }), P = (l, f) => r.matrix.cells.find((c) => c.L === l && c.F === f).p;
  for (let f = 0; f < 5; f++) for (let l = 0; l < 4; l++) assert.ok(P(l + 1, f) >= P(l, f) - 0.02);
  for (let l = 0; l < 5; l++) for (let f = 0; f < 4; f++) assert.ok(P(l, f + 1) <= P(l, f) + 0.02);
  assert.ok(P(0, 4) < P(4, 0) - 0.1); assert.ok(r.rows.some((x) => /PÉSSIMO/.test(x.name) && x.pOcc > 0));
  assert.ok(run({ debates: [] }).rows.filter((x) => x.pseudo && x.pOcc > 0).length === 0);
});
test('MC v2: leque diário, hecatombes e catálogo amplo', () => {
  const r = MC.run(model, REF, ELEC, { sims: 20000, fan: true }); assert.strictEqual(r.days.length, 15); assert.ok(r.days[14].p95 - r.days[14].p5 > r.days[1].p95 - r.days[1].p5);
  assert.ok(r.rows.filter((x) => !x.pseudo).length >= 100 && r.pHecL > 0 && r.pHecF > 0); assert.ok(MC.TPL.some((t) => t.g === 'hecatombes' && t.tone === 'g') && MC.TPL.some((t) => t.g === 'hecatombes' && t.tone === 'b'));
  const z = MC.run(model, REF, REF, { sims: 5000, fan: false }); assert.ok(Math.abs(z.sd - Math.sqrt(0.49 + 4)) < 0.2);
});

test('MC v3: aceita até 1 bilhão de sorteios (limite do contexto) e run() síncrono nunca passa de SYNC_MAX', () => {
  assert.strictEqual(MC.prepare(model, REF, ELEC, { sims: 5e9 }).N, 1e9); assert.strictEqual(MC.prepare(model, REF, ELEC, { sims: 1e9 }).N, 1e9); assert.strictEqual(MC.MAXN, 1e9);
  const c = MC.prepare(model, REF, ELEC, { sims: 1e9, fan: false }), T = MC.tasksFor(c); assert.strictEqual(T.length, 1e9 / MC.CHUNK); // 40 mil blocos, gerados sem custo
  assert.strictEqual(T.reduce((s, t) => s + t.n, 0), 1e9); assert.ok(MC.SYNC_MAX >= 1e6 && MC.SYNC_MAX < 1e7);
});
test('MC v3: consolidação em fluxo = soma ordenada, em qualquer ordem de chegada (idêntico bit a bit)', () => {
  const c = MC.prepare(model, REF, ELEC, { sims: 120000, matrix: true }), T = MC.tasksFor(c), R = T.map((t) => ({ task: t, out: MC.runTask(c, t) }));
  const a = MC.assemble(c, R), b = MC.assemble(c, R.slice().reverse()), sh = R.slice().sort((x, y) => ((x.task.chunk * 7919) % 13) - ((y.task.chunk * 7919) % 13));
  [b, MC.assemble(c, sh)].forEach((x) => { assert.deepStrictEqual([x.pLula, x.mean, x.sd, x.q, x.rows, x.matrix, x.days], [a.pLula, a.mean, a.sd, a.q, a.rows, a.matrix, a.days]); });
});
test('MC v3: runAsync (sem Workers) devolve o mesmo resultado de run() e chama o progresso até 100%', async () => {
  let last = 0; const o = { sims: 150000, fan: true, matrix: true }, r = await MC.runAsync(model, REF, ELEC, Object.assign({}, o, { seed: 5 }), (f) => (last = f));
  assert.strictEqual(last, 1); const s = MC.run(model, REF, ELEC, Object.assign({}, o, { seed: 5 })); assert.strictEqual(r, s); // mesma entrada de cache
});
