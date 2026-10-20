const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
process.env.PORT = '0';
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), 'polls-test-' + process.pid + '.json'); // nunca tocar nos dados reais
const store = require('../lib/store'), server = require('../server');
const F = process.env.DATA_FILE;
test('fluxo cadastrar → listar → editar → duplicada → excluir', async () => {
  if (fs.existsSync(F)) fs.unlinkSync(F);
  await store.init(); await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const j = (u, m, b) => fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }).then(async (r) => ({ s: r.status, d: await r.json() }));
  const p = { institute: 'Teste', surveyId: '1', fieldStart: '2026-10-01', fieldEnd: '2026-10-03', lula: 51, flavio: 49, resultType: 'valid', sample: 1000 };
  assert.deepStrictEqual((await j('/api/polls', 'GET')).d, []);
  const bad = await j('/api/polls', 'POST', { ...p, lula: 150 }); assert.strictEqual(bad.s, 400);
  const ok = await j('/api/polls', 'POST', p); assert.strictEqual(ok.s, 200);
  assert.strictEqual((await j('/api/polls', 'POST', p)).s, 409);
  assert.strictEqual((await j('/api/polls', 'POST', { ...p, confirmSimilar: true })).s, 200);
  const id = ok.d.poll.id; await j('/api/polls/' + id, 'PUT', { ...p, lula: 52, flavio: 48, confirmSimilar: true });
  assert.strictEqual((await j('/api/polls', 'GET')).d.find((x) => x.id === id).lula, 52);
  await j('/api/polls/' + id, 'DELETE'); assert.strictEqual((await j('/api/polls', 'GET')).d.length, 1);
  const imp = await j('/api/polls/import', 'POST', { polls: [{ ...p, surveyId: '9', fieldEnd: '2026-10-05' }, { institute: '' }] });
  assert.strictEqual(imp.d.imported, 1); assert.strictEqual(imp.d.errors.length, 1);
  const html = await fetch(base + '/').then((r) => r.text()); assert.ok(html.includes('Observatório'));
  for (const f of ['analytics.js', 'extra.js', 'theme.css', 'stats.js']) assert.strictEqual((await fetch(base + '/' + f)).status, 200, f);
  const idx = await fetch(base + '/').then((r) => r.text()); for (const s of ['analytics.js', 'extra.js', 'theme.css']) assert.ok(idx.includes(s), s);
  const fv = await fetch(base + '/favicon.svg'); assert.strictEqual(fv.status, 200); assert.ok(fv.headers.get('content-type').includes('svg'));
  const et = fv.headers.get('etag'); assert.ok(et); assert.strictEqual((await fetch(base + '/favicon.svg', { headers: { 'If-None-Match': et } })).status, 304);
  assert.strictEqual((await fetch(base + '/manifest.webmanifest')).status, 200);
  server.closeAllConnections(); server.close(); fs.unlinkSync(F);
});
