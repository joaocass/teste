const fs = require('fs'), path = require('path'), cfg = require('../config');
const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'polls.json');
let col = null, mode = 'file';
async function init() {
  const hasUri = !!process.env.MONGODB_URI;
  try {
    const { MongoClient } = require('mongodb');
    const c = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 8000 });
    await c.connect();
    col = c.db(cfg.mongoDb).collection('polls');
    await col.createIndex({ id: 1 }, { unique: true });
    mode = 'mongodb';
  } catch (e) {
    console.error('ERRO MONGODB COMPLETO:\n', e.stack || e);
    // Se você definiu MONGODB_URI, não grava em arquivo escondido: para e mostra o erro.
    if (hasUri || !cfg.allowFileFallback) process.exit(1);
    console.warn('[aviso] Usando data/polls.json (somente desenvolvimento).');
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
  }
  return mode;
}
const rf = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []);
const wf = (a) => fs.writeFileSync(FILE, JSON.stringify(a, null, 1));
module.exports = {
  init, mode: () => mode,
  async list() { return mode === 'mongodb' ? col.find({}, { projection: { _id: 0 } }).toArray() : rf(); },
  async put(p) {
    if (mode === 'mongodb') { await col.replaceOne({ id: p.id }, p, { upsert: true }); return; }
    const a = rf(), i = a.findIndex((x) => x.id === p.id); i >= 0 ? (a[i] = p) : a.push(p); wf(a);
  },
  async remove(id) { if (mode === 'mongodb') await col.deleteOne({ id }); else wf(rf().filter((x) => x.id !== id)); },
  async clear() { if (mode === 'mongodb') await col.deleteMany({}); else wf([]); }
};
