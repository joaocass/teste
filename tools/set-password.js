// Uso: node tools/set-password.js "nova senha"  → grava admin.hash (scrypt)
const fs = require('fs'), path = require('path');
const { hashPassword } = require('../auth');
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error('Informe uma senha com 12+ caracteres.'); process.exit(1); }
hashPassword(pw).then(h => { fs.writeFileSync(path.join(__dirname, '..', 'admin.hash'), h + '\n', { mode: 0o600 }); console.log('admin.hash atualizado.'); });
