/* Autenticação do painel — somente o servidor conhece o hash; a senha nunca é
   guardada em texto, nunca vai para o front-end e não é logada.
   - Hash: scrypt (N=2^16, r=8, p=1 → ~64 MB por tentativa, caro p/ força bruta), sal aleatório de 32 bytes
   - Comparação em tempo constante (timingSafeEqual)
   - Sessão: token aleatório de 256 bits; no servidor só fica o SHA-256 dele
   - Anti força bruta: bloqueio progressivo por IP + limite global por hora */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;   // expira após 2h sem uso
const SESSION_MAX_MS  = 12 * 60 * 60 * 1000;  // e no máximo 12h de vida
const MAX_SESSIONS = 20;
const GLOBAL_MAX_PER_HOUR = 60;

function scryptAsync(pw, salt, p) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, p.len, { N: p.N, r: p.r, p: p.p, maxmem: 256 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));
}
async function hashPassword(password) {
  const p = { N: 65536, r: 8, p: 1, len: 64 };
  const salt = crypto.randomBytes(32);
  const key = await scryptAsync(password.normalize('NFKC'), salt, p);
  return ['scrypt', p.N, p.r, p.p, salt.toString('base64'), key.toString('base64')].join('$');
}
function loadStoredHash() {
  if (process.env.ADMIN_PASSWORD_HASH) return process.env.ADMIN_PASSWORD_HASH.trim();
  try { return fs.readFileSync(path.join(__dirname, 'admin.hash'), 'utf8').trim(); } catch (e) { return null; }
}
const STORED = loadStoredHash();
// hash "isca" para gastar o mesmo tempo quando não há hash configurado / usuário bloqueado
const DUMMY = ['scrypt', 65536, 8, 1, crypto.randomBytes(32).toString('base64'), crypto.randomBytes(64).toString('base64')].join('$');

async function verifyPassword(password) {
  const parts = (STORED || DUMMY).split('$');
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const got = await scryptAsync(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), { N: +N, r: +r, p: +p, len: expected.length });
  return !!STORED && crypto.timingSafeEqual(got, expected);
}

const sessions = new Map();   // sha256(token) -> { born, last, ua }
const fails = new Map();      // ip -> { n, until, last }
let globalWindow = { start: Date.now(), n: 0 };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const uaOf = (req) => sha(String(req.headers['user-agent'] || ''));

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.last > SESSION_IDLE_MS || now - s.born > SESSION_MAX_MS) sessions.delete(k);
  for (const [ip, f] of fails) if (now - f.last > 24 * 3600 * 1000) fails.delete(ip);
}, 60 * 1000).unref();

async function login(req, res) {
  const ip = req.ip || 'x', now = Date.now();
  if (now - globalWindow.start > 3600 * 1000) globalWindow = { start: now, n: 0 };
  const f = fails.get(ip) || { n: 0, until: 0, last: now };
  if (f.until > now) return res.status(429).json({ error: 'Muitas tentativas. Aguarde ' + Math.ceil((f.until - now) / 60000) + ' min.' });
  if (++globalWindow.n > GLOBAL_MAX_PER_HOUR) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });
  const pw = req.body && req.body.password;
  if (typeof pw !== 'string' || pw.length < 1 || pw.length > 200) return res.status(400).json({ error: 'Senha inválida.' });
  let ok = false;
  try { ok = await verifyPassword(pw); } catch (e) { return res.status(500).json({ error: 'Falha na verificação.' }); }
  if (!ok) {
    f.n++; f.last = now;
    if (f.n >= 5) f.until = now + Math.min(24 * 3600 * 1000, 60 * 1000 * Math.pow(2, f.n - 5)); // 1, 2, 4, 8… min
    fails.set(ip, f);
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  fails.delete(ip);
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(sha(token), { born: now, last: now, ua: uaOf(req) });
  res.json({ token, expiresInMs: SESSION_IDLE_MS });
}
function logout(req, res) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (t) sessions.delete(sha(t));
  res.json({ ok: true });
}
function requireAuth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const k = t && sha(t), s = k && sessions.get(k), now = Date.now();
  if (!s || now - s.last > SESSION_IDLE_MS || now - s.born > SESSION_MAX_MS || s.ua !== uaOf(req)) {
    if (k) sessions.delete(k);
    return res.status(401).json({ error: 'Autenticação necessária.', auth: true });
  }
  s.last = now;
  next();
}
module.exports = { login, logout, requireAuth, hashPassword, configured: !!STORED };
