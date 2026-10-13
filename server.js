const http = require('http'), zlib = require('zlib'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const cfg = require('./config'), store = require('./lib/store'), Stats = require('./public/stats');
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.json': 'application/json' };
const NUM = ['lula', 'flavio', 'blankNull', 'undecided', 'others', 'sample', 'moe', 'confidence'];
const STR = ['institute', 'surveyId', 'scope', 'state', 'fieldStart', 'fieldEnd', 'released', 'tseDate', 'resultType', 'method', 'population', 'sponsor', 'tseNumber', 'source', 'notes', 'duplicateOf'];
function clean(b) {
  const p = {};
  NUM.forEach((k) => (p[k] = b[k] === '' || b[k] == null ? null : Number(b[k])));
  STR.forEach((k) => (p[k] = b[k] == null ? '' : String(b[k]).trim().slice(0, 500)));
  p.scope = p.scope || 'nacional'; p.demo = !!b.demo;
  return p;
}
const dupKey = (p) => [p.institute.toLowerCase(), p.surveyId, p.scope, p.state, p.fieldStart, p.fieldEnd].join('|');
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((ok, no) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } }); });

async function api(req, res, url) {
  const m = url.pathname.match(/^\/api\/polls(?:\/([\w-]+))?$/);
  if (url.pathname === '/api/config') return send(res, 200, { siteName: cfg.siteName, storage: store.mode() });
  if (url.pathname === '/api/polls/import' && req.method === 'POST') {
    const items = (await body(req)).polls || [], ok = [], errors = [], all = await store.list(), keys = new Set(all.map(dupKey));
    for (let i = 0; i < items.length; i++) {
      const p = clean(items[i]), v = Stats.validatePoll(p);
      if (v.errors.length) { errors.push({ linha: i + 1, erros: v.errors }); continue; }
      if (keys.has(dupKey(p))) { errors.push({ linha: i + 1, erros: ['Duplicada (já cadastrada).'] }); continue; }
      p.id = crypto.randomUUID(); keys.add(dupKey(p)); await store.put(p); ok.push(p.id);
    }
    return send(res, 200, { imported: ok.length, errors });
  }
  if (!m) return send(res, 404, { error: 'Rota inexistente' });
  const id = m[1];
  if (req.method === 'GET' && !id) return send(res, 200, await store.list());
  if (req.method === 'DELETE') { id ? await store.remove(id) : await store.clear(); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' || req.method === 'PUT') {
    const raw = await body(req), p = clean(raw), v = Stats.validatePoll(p);
    if (v.errors.length) return send(res, 400, v);
    const all = await store.list();
    p.id = id || crypto.randomUUID();
    if (!raw.confirmSimilar && all.some((x) => x.id !== p.id && dupKey(x) === dupKey(p)))
      return send(res, 409, { errors: [], warnings: v.warnings, duplicate: true, message: 'Levantamento semelhante já cadastrado. Confirme se é uma pesquisa diferente.' });
    await store.put(p);
    return send(res, 200, { poll: p, warnings: v.warnings });
  }
  send(res, 405, { error: 'Método não permitido' });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Não encontrado'); }
    const st = fs.statSync(f), et = `W/"${st.size}-${Math.round(st.mtimeMs)}"`, type = MIME[path.extname(f)] || 'application/octet-stream';
    if (req.headers['if-none-match'] === et) { res.writeHead(304, { ETag: et }); return res.end(); }
    const hd = { 'Content-Type': type, ETag: et, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && /^(text\/|image\/svg|application\/(json|manifest))/.test(type)) { hd['Content-Encoding'] = 'gzip'; res.writeHead(200, hd); fs.createReadStream(f).pipe(zlib.createGzip()).pipe(res); }
    else { res.writeHead(200, hd); fs.createReadStream(f).pipe(res); }
  } catch (e) { send(res, 500, { error: 'Erro interno: ' + e.message }); }
});
module.exports = server;
if (require.main === module) store.init().then((m) => server.listen(cfg.port, () => console.log(`${cfg.siteName} em http://localhost:${cfg.port} (armazenamento: ${m})`))).catch((e) => { console.error('Falha ao conectar no MongoDB:', e.message); process.exit(1); });
