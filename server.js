require('dotenv').config();
const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const ORIGINAL = require('./seedData');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'mapa_eleitoral';

if (!MONGODB_URI) {
  console.error('Defina MONGODB_URI no arquivo .env antes de iniciar o servidor.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => { if (/sw\.js$/.test(p)) res.set('Cache-Control', 'no-cache'); if (/manifest\.webmanifest$/.test(p)) res.set('Content-Type', 'application/manifest+json'); } }));

// ---- Malha oficial do IBGE (UFs), baixada uma vez e guardada em disco ----
const GEO_FILE = path.join(__dirname, 'data', 'geo-br-uf.json');
let geoCache = null;
async function loadGeo() {
  if (geoCache) return geoCache;
  try { geoCache = fs.readFileSync(GEO_FILE, 'utf8'); return geoCache; } catch (e) {}
  const base = 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&intrarregiao=UF';
  for (const q of ['&qualidade=intermediaria', '&qualidade=minima', '']) {
    try {
      const r = await fetch(base + q, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const txt = await r.text();
      if (JSON.parse(txt).features.length < 27) continue;
      fs.mkdirSync(path.dirname(GEO_FILE), { recursive: true });
      fs.writeFileSync(GEO_FILE, txt);
      geoCache = txt; return txt;
    } catch (e) {}
  }
  return null;
}
app.get('/api/geo', async (req, res) => {
  const g = await loadGeo();
  if (!g) return res.status(503).json({ error: 'Malha indisponível.' });
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=604800' }).send(g);
});

// ---- Autenticação (necessária só para alterar dados) ----
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
if (!auth.configured) console.warn('ATENÇÃO: admin.hash/ADMIN_PASSWORD_HASH ausente — nenhuma alteração será permitida.');

let statesCol, auditCol;
function audit(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 400 && auditCol) auditCol.insertOne({ at: new Date(), action: req.method + ' ' + req.path, ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 160) }).catch(() => {});
  });
  next();
}

async function seedIfEmpty() {
  const count = await statesCol.countDocuments();
  if (count === 0) {
    const docs = Object.entries(ORIGINAL).map(([uf, s]) => ({ _id: uf, weight: s.w, polls: [] }));
    await statesCol.insertMany(docs);
    console.log('Seed inicial criado para ' + docs.length + ' estados (sem pesquisas).');
  }
}

function sanitizePoll(body) {
  const lula = Number(body.lula);
  if (Number.isNaN(lula)) return null;
  const oppRaw = Number(body.opp);
  return {
    inst: (body.inst || 'Pesquisa sem nome').toString().slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10),
    lula: Math.max(0, Math.min(100, lula)),
    opp: Number.isNaN(oppRaw) ? Math.max(0, Math.min(100, 100 - lula)) : Math.max(0, Math.min(100, oppRaw)),
    cred: Math.max(1, Math.min(5, parseInt(body.cred, 10) || 3))
  };
}

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  statesCol = db.collection('states');
  auditCol = db.collection('audit');
  auditCol.createIndex({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }).catch(() => {});
  app.get('/api/audit', auth.requireAuth, async (req, res) => {
    try { res.json(await auditCol.find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(100).toArray()); }
    catch (e) { res.status(500).json({ error: 'Falha ao ler histórico.' }); }
  });
  await seedIfEmpty();
  console.log('Conectado ao MongoDB (' + DB_NAME + ').');

  // Lista todos os estados com peso e pesquisas
  app.get('/api/states', async (req, res) => {
    try {
      const docs = await statesCol.find({}).toArray();
      const out = {};
      docs.forEach(d => { out[d._id] = { weight: d.weight, polls: d.polls || [] }; });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: 'Falha ao ler dados.' });
    }
  });

  // Adiciona uma pesquisa a um estado
  app.post('/api/states/:uf/polls', auth.requireAuth, audit, async (req, res) => {
    try {
      const uf = req.params.uf.toUpperCase();
      const poll = sanitizePoll(req.body || {});
      if (!/^[A-Z]{2}$/.test(uf)) return res.status(400).json({ error: 'UF inválida.' });
      if (!poll) return res.status(400).json({ error: 'Campo "lula" inválido.' });
      // Nota: no driver oficial do MongoDB (mongodb ^6.x), findOneAndUpdate()
      // retorna o próprio documento atualizado (ou null), e não mais um
      // objeto { value }. Usar "result.value" aqui SEMPRE dava undefined,
      // então o front-end recebia um HTTP 404 e mostrava "Erro ao salvar"
      // mesmo com o $push já persistido no banco — a pesquisa era salva,
      // mas o aviso de erro aparecia do mesmo jeito. Corrigido abaixo.
      const result = await statesCol.findOneAndUpdate(
        { _id: uf },
        { $push: { polls: poll } },
        { returnDocument: 'after' }
      );
      if (!result) return res.status(404).json({ error: 'Estado não encontrado.' });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Falha ao salvar pesquisa.' });
    }
  });

  // Edita uma pesquisa existente pelo índice
  app.put('/api/states/:uf/polls/:index', auth.requireAuth, audit, async (req, res) => {
    try {
      const uf = req.params.uf.toUpperCase();
      const idx = parseInt(req.params.index, 10);
      const poll = sanitizePoll(req.body || {});
      if (!/^[A-Z]{2}$/.test(uf)) return res.status(400).json({ error: 'UF inválida.' });
      if (!poll) return res.status(400).json({ error: 'Campo "lula" inválido.' });
      const doc = await statesCol.findOne({ _id: uf });
      if (!doc) return res.status(404).json({ error: 'Estado não encontrado.' });
      const polls = doc.polls || [];
      if (idx < 0 || idx >= polls.length) return res.status(400).json({ error: 'Índice inválido.' });
      polls[idx] = poll;
      await statesCol.updateOne({ _id: uf }, { $set: { polls } });
      res.json({ _id: uf, weight: doc.weight, polls });
    } catch (e) {
      res.status(500).json({ error: 'Falha ao editar pesquisa.' });
    }
  });

  // Remove uma pesquisa pelo índice
  app.delete('/api/states/:uf/polls/:index', auth.requireAuth, audit, async (req, res) => {
    try {
      const uf = req.params.uf.toUpperCase();
      const idx = parseInt(req.params.index, 10);
      const doc = await statesCol.findOne({ _id: uf });
      if (!doc) return res.status(404).json({ error: 'Estado não encontrado.' });
      const polls = doc.polls || [];
      if (idx < 0 || idx >= polls.length) return res.status(400).json({ error: 'Índice inválido.' });
      polls.splice(idx, 1);
      await statesCol.updateOne({ _id: uf }, { $set: { polls } });
      res.json({ _id: uf, weight: doc.weight, polls });
    } catch (e) {
      res.status(500).json({ error: 'Falha ao remover pesquisa.' });
    }
  });

  // Limpa todas as pesquisas de todos os estados
  app.post('/api/reset', auth.requireAuth, audit, async (req, res) => {
    try {
      await statesCol.updateMany({}, { $set: { polls: [] } });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Falha ao limpar dados.' });
    }
  });

  app.listen(PORT, () => console.log('Servidor rodando em http://localhost:' + PORT));
}

start().catch(err => {
  console.error('Erro ao iniciar o servidor:', err.message);
  process.exit(1);
});
