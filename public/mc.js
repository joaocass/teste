// Monte Carlo v2 — "choques de campanha" (navegador + Node + Web Worker). Sem dependências além de stats.js.
// Nível final de Lula (% dos válidos) = base + Σ choques, onde
//   base  = nível atual + erro da média + erro sistemático (t de Student, 5 gl) + passeio aleatório com volatilidade estocástica
//           + tendência incerta e amortecida;                                  [forma fechada, exata para a soma gaussiana]
//   choques = processo de Poisson composto (Cox: a intensidade depende do REGIME da campanha) sobre um catálogo de ~100 tipos de
//           acontecimentos (debates, atos, apoios, escândalos, gafes, economia, justiça, mídia, segurança, mobilização, hecatombes),
//           com tamanho lognormal + cauda GPD (Pareto generalizada), cascatas de Hawkes (auto-excitação) e decaimento exponencial
//           até a eleição (meia-vida própria + fração permanente).
// Cada bloco de 25 mil sorteios tem semente própria => o resultado é idêntico com 1 ou N workers (reprodutível).
// Fluxos aleatórios separados (base × choques) => "números aleatórios comuns": P(com choques) − P(sem choques) é efeito puro.
(function (root) {
  const S = root.Stats || (typeof require !== 'undefined' ? require('./stats.js') : null);
  const CHUNK = 25000, MAXN = 1000000000, SYNC_MAX = 2000000, BINS = 2000, BW = 100 / BINS, MATRIX_N = 12000, FAN_N = 20000, CAP = 12, HEC = 4;
  // Fator de calibração do tamanho dos choques (ver docs/ESTUDO_MONTE_CARLO.md, seção "Calibração").
  const CAL = 0.9;
  const GROUPS = [
    { id: 'debates', name: 'Debates' }, { id: 'atos', name: 'Atos e comícios' }, { id: 'apoios', name: 'Apoios e articulação' },
    { id: 'escandalos', name: 'Escândalos e denúncias' }, { id: 'gafes', name: 'Gafes, viralização e entrevistas' }, { id: 'economia', name: 'Economia e governo' },
    { id: 'justica', name: 'Justiça e instituições' }, { id: 'midia', name: 'Mídia e desinformação' }, { id: 'seguranca', name: 'Segurança e imprevistos' },
    { id: 'mobilizacao', name: 'Mobilização e abstenção' }, { id: 'hecatombes', name: 'Hecatombes e viradas' }];
  const CATS = ['péssimo', 'ruim', 'regular', 'bom', 'muito bom'];
  const DEB = { E: [-0.9, -0.35, 0, 0.3, 0.6], cum: [0.06, 0.25, 0.75, 0.94, 1], noise: 0.25, reach: 0.3, hl: 6, phi: 0.25, pOcc: 0.9, off: [12, 7, 2], wMin: 0.7, wMax: 1.1 };
  const REG = { p: [0.25, 0.55, 0.2], lam: [0.5, 1, 1.8], imp: [0.85, 1, 1.2] };

  // Modelos de catálogo. T(chave, grupo, rótulo, tom g|b, p, mediana pp, σlog, meia-vida d, fração permanente, tempo u|l|d|e, extras)
  // p = prob. de ≥1 ocorrência em 14 dias (tempo u/l), por debate (d) ou no dia da eleição (e). tom g = bom para o ator, b = ruim.
  // extras: pt/tsc/xi = cauda GPD (prob., escala, forma); eta/th = Hawkes (razão de ramificação, atraso médio d); flip = chance de efeito
  // invertido (efeito bumerangue); tl = escala do "tempo tardio"; only = só para L ou F (efeito de governo).
  const T = (k, g, n, tone, p, med, sl, hl, phi, tim, x) => Object.assign({ k, g, n, tone, p, med, sl, hl, phi, tim }, x || {});
  const TPL = [
    T('ato_massa', 'atos', 'Ato de massa bem-sucedido', 'g', 0.288, 0.18, 0.5, 4, 0.1, 'u'),
    T('ato_vespera', 'atos', 'Grande ato na reta final', 'g', 0.168, 0.27, 0.5, 8, 0.15, 'l', { tl: 3 }),
    T('ato_vazio', 'atos', 'Ato esvaziado ou com baixa adesão', 'b', 0.1056, 0.18, 0.5, 4, 0.05, 'u'),
    T('ato_incidente', 'atos', 'Incidente ou confronto durante ato', 'b', 0.048, 0.3, 0.7, 6, 0.1, 'u', { pt: 0.15, tsc: 0.8, xi: 0.3 }),
    T('ato_uniao', 'atos', 'Ato de união com aliados e ex-adversários', 'g', 0.096, 0.21, 0.5, 6, 0.2, 'u'),
    T('apoio_lider', 'apoios', 'Apoio público de liderança relevante', 'g', 0.216, 0.23, 0.5, 8, 0.3, 'u'),
    T('apoio_peso', 'apoios', 'Apoio de peso: partido, bloco ou ex-candidato', 'g', 0.0864, 0.52, 0.55, 14, 0.45, 'u', { pt: 0.08, tsc: 1, xi: 0.25 }),
    T('apoio_perda', 'apoios', 'Rompimento ou retirada pública de apoio', 'b', 0.0864, 0.39, 0.6, 12, 0.35, 'u', { pt: 0.06, tsc: 0.8, xi: 0.25 }),
    T('apoio_racha', 'apoios', 'Racha ou desgaste na coalizão', 'b', 0.096, 0.23, 0.5, 8, 0.2, 'u'),
    T('apoio_morno', 'apoios', 'Aliado declara neutralidade ou apoio morno', 'b', 0.12, 0.13, 0.5, 6, 0.15, 'u'),
    T('esc_denuncia', 'escandalos', 'Nova denúncia ou investigação', 'b', 0.1277, 0.2, 0.7, 10, 0.3, 'u', { pt: 0.1, tsc: 1.2, xi: 0.3, eta: 0.35, th: 3 }),
    T('esc_vazamento', 'escandalos', 'Vazamento de áudio, mensagens ou documentos', 'b', 0.0403, 0.29, 0.7, 9, 0.25, 'u', { pt: 0.12, tsc: 1.5, xi: 0.3, eta: 0.45, th: 3 }),
    T('esc_operacao', 'escandalos', 'Operação policial ou judicial atinge aliados', 'b', 0.047, 0.25, 0.6, 10, 0.3, 'u', { pt: 0.08, tsc: 1.2, xi: 0.3, eta: 0.3, th: 4 }),
    T('esc_familia', 'escandalos', 'Problema envolvendo familiares ou auxiliares', 'b', 0.0672, 0.14, 0.6, 7, 0.2, 'u', { eta: 0.2, th: 3 }),
    T('esc_desmonte', 'escandalos', 'Acusação desmontada ou contra-ataque eficaz', 'g', 0.0739, 0.14, 0.5, 7, 0.2, 'u'),
    T('esc_fato', 'escandalos', 'Fato novo favorável vem à tona', 'g', 0.047, 0.19, 0.5, 8, 0.25, 'u'),
    T('gafe_viral', 'gafes', 'Gafe ou declaração infeliz viraliza', 'b', 0.24, 0.18, 0.6, 4, 0.05, 'u', { pt: 0.06, tsc: 0.6, xi: 0.3 }),
    T('gafe_imprensa', 'gafes', 'Atrito público com imprensa ou instituição', 'b', 0.12, 0.17, 0.5, 5, 0.1, 'u'),
    T('gafe_frase', 'gafes', 'Frase ou vídeo de impacto viraliza a favor', 'g', 0.18, 0.18, 0.6, 4, 0.1, 'u'),
    T('gafe_entrev_boa', 'gafes', 'Entrevista ou sabatina muito bem recebida', 'g', 0.12, 0.18, 0.5, 5, 0.15, 'u'),
    T('gafe_entrev_ruim', 'gafes', 'Entrevista ou sabatina mal avaliada', 'b', 0.12, 0.18, 0.5, 5, 0.15, 'u'),
    T('eco_inflacao', 'economia', 'Alta de preços e de alimentos pesa no governo', 'b', 0.144, 0.27, 0.5, 12, 0.35, 'u', { only: 'L' }),
    T('eco_emprego', 'economia', 'Indicador econômico positivo: emprego, renda, PIB', 'g', 0.144, 0.24, 0.5, 12, 0.35, 'u', { only: 'L' }),
    T('eco_cambio', 'economia', 'Choque de câmbio, juros ou mercado', 'b', 0.0576, 0.36, 0.6, 10, 0.3, 'u', { only: 'L', pt: 0.1, tsc: 1, xi: 0.3 }),
    T('eco_beneficio', 'economia', 'Anúncio ou pagamento de benefício ou reajuste', 'g', 0.144, 0.3, 0.5, 10, 0.3, 'u', { only: 'L' }),
    T('eco_servico', 'economia', 'Greve ou crise em serviço essencial', 'b', 0.0576, 0.3, 0.6, 7, 0.2, 'u', { only: 'L' }),
    T('eco_alivio', 'economia', 'Queda de preços ou alívio no custo de vida', 'g', 0.096, 0.24, 0.5, 10, 0.3, 'u', { only: 'L' }),
    T('eco_plano_bom', 'economia', 'Plano econômico bem recebido por analistas', 'g', 0.1056, 0.21, 0.5, 8, 0.25, 'u', { only: 'F' }),
    T('eco_plano_mal', 'economia', 'Proposta econômica criticada ou impopular', 'b', 0.12, 0.24, 0.5, 8, 0.25, 'u', { only: 'F' }),
    T('jus_desfav', 'justica', 'Decisão judicial ou do TSE desfavorável', 'b', 0.096, 0.27, 0.6, 9, 0.25, 'u', { pt: 0.1, tsc: 1, xi: 0.3 }),
    T('jus_fav', 'justica', 'Decisão judicial ou do TSE favorável', 'g', 0.096, 0.21, 0.5, 8, 0.2, 'u'),
    T('jus_resposta', 'justica', 'Direito de resposta ou remoção de conteúdo concedido', 'g', 0.12, 0.12, 0.5, 5, 0.1, 'u'),
    T('jus_sancao', 'justica', 'Sanção ou multa por propaganda irregular', 'b', 0.072, 0.15, 0.5, 5, 0.1, 'u'),
    T('mid_boato', 'midia', 'Boato ou desinformação viral de última hora', 'b', 0.1152, 0.26, 0.7, 6, 0.1, 'l', { tl: 3, flip: 0.2, pt: 0.1, tsc: 1, xi: 0.3 }),
    T('mid_deepfake', 'midia', 'Deepfake ou montagem convincente', 'b', 0.0307, 0.41, 0.7, 5, 0.1, 'l', { tl: 3, flip: 0.15, pt: 0.2, tsc: 1.5, xi: 0.3 }),
    T('mid_cob_neg', 'midia', 'Cobertura negativa intensa', 'b', 0.1344, 0.15, 0.5, 6, 0.15, 'u'),
    T('mid_cob_pos', 'midia', 'Cobertura positiva ou reportagem favorável', 'g', 0.1152, 0.14, 0.5, 6, 0.15, 'u'),
    T('mid_desmentido', 'midia', 'Desmentido eficaz de boato', 'g', 0.0768, 0.13, 0.5, 5, 0.1, 'u'),
    T('seg_saude_sol', 'seguranca', 'Problema de saúde gera onda de solidariedade', 'g', 0.009, 0.5, 0.6, 8, 0.2, 'u', { pt: 0.2, tsc: 1, xi: 0.3 }),
    T('seg_saude_duv', 'seguranca', 'Problema de saúde gera dúvida sobre as condições', 'b', 0.0134, 0.5, 0.6, 8, 0.2, 'u', { pt: 0.2, tsc: 1, xi: 0.3 }),
    T('seg_atentado', 'seguranca', 'Agressão ou atentado contra o candidato (solidariedade)', 'g', 0.0038, 1.12, 0.6, 14, 0.4, 'u', { pt: 0.3, tsc: 2.5, xi: 0.3 }),
    T('seg_violencia', 'seguranca', 'Violência política atribuída a apoiadores', 'b', 0.0448, 0.28, 0.7, 7, 0.2, 'u', { pt: 0.15, tsc: 1, xi: 0.3 }),
    T('seg_crise_bem', 'seguranca', 'Tragédia ou desastre: resposta do governo bem avaliada', 'g', 0.0358, 0.22, 0.5, 8, 0.25, 'u', { only: 'L' }),
    T('seg_crise_mal', 'seguranca', 'Tragédia ou desastre: resposta do governo mal avaliada', 'b', 0.0358, 0.28, 0.5, 8, 0.25, 'u', { only: 'L' }),
    T('seg_geopolitica', 'seguranca', 'Crise internacional entra na campanha', 'b', 0.0448, 0.22, 0.6, 10, 0.25, 'u', { only: 'L', flip: 0.35 }),
    T('mob_abstencao', 'mobilizacao', 'Abstenção por clima ou transporte afeta a base', 'b', 0.072, 0.21, 0.5, 1, 1, 'e'),
    T('mob_reta', 'mobilizacao', 'Mobilização e voto útil na reta final', 'g', 0.144, 0.27, 0.5, 10, 0.3, 'l', { tl: 4 }),
    T('mob_desanimo', 'mobilizacao', 'Desânimo ou desmobilização da base', 'b', 0.0864, 0.24, 0.5, 8, 0.2, 'u'),
    T('mob_indecisos', 'mobilizacao', 'Indecisos migram para o candidato', 'g', 0.12, 0.24, 0.5, 8, 0.25, 'l', { tl: 4 }),
    T('mob_terceira', 'mobilizacao', 'Eleitor de terceira via fecha com o candidato', 'g', 0.12, 0.24, 0.5, 8, 0.25, 'u'),
    T('hec_neg', 'hecatombes', 'HECATOMBE: colapso de imagem do candidato', 'b', 0.0037, 1.81, 0.45, 18, 0.55, 'u', { pt: 0.35, tsc: 2, xi: 0.3, eta: 0.5, th: 2.5 }),
    T('hec_pos', 'hecatombes', 'HECATOMBE POSITIVA: onda decisiva de apoio', 'g', 0.0037, 1.81, 0.45, 18, 0.55, 'u', { pt: 0.35, tsc: 2, xi: 0.3, eta: 0.5, th: 2.5 }),
    T('hec_momentum', 'hecatombes', 'Cascata de momentum (efeito manada)', 'g', 0.0252, 0.73, 0.5, 10, 0.35, 'l', { tl: 5, pt: 0.1, tsc: 1.2, xi: 0.3, eta: 0.5, th: 2 }),
    T('hec_surpresa', 'hecatombes', 'Surpresa de última hora (“October surprise”)', 'b', 0.0158, 0.87, 0.6, 6, 0.5, 'l', { tl: 2, pt: 0.15, tsc: 1.5, xi: 0.3, flip: 0.15 }),
    T('hec_exogeno', 'hecatombes', 'Choque exógeno grave: crise global, pandemia, guerra', 'b', 0.0021, 1.45, 0.5, 20, 0.5, 'u', { only: 'L', pt: 0.4, tsc: 2.4, xi: 0.35, flip: 0.35 }),
    T('hec_institucional', 'hecatombes', 'Crise institucional grave', 'b', 0.001, 1.81, 0.5, 20, 0.5, 'u', { only: 'L', pt: 0.4, tsc: 2.4, xi: 0.35, flip: 0.5 }),
    T('deb_viral_bom', 'debates', 'Momento viral positivo no debate', 'g', 0.0672, 0.42, 0.6, 5, 0.25, 'd', { pt: 0.12, tsc: 1, xi: 0.3 }),
    T('deb_viral_ruim', 'debates', 'Momento viral negativo no debate', 'b', 0.084, 0.47, 0.6, 5, 0.25, 'd', { pt: 0.15, tsc: 1.2, xi: 0.3 }),
    T('deb_ausencia', 'debates', 'Ausência ou “cadeira vazia” em debate', 'b', 0.0101, 0.52, 0.5, 6, 0.3, 'd'),
    T('deb_ataque', 'debates', 'Ataque eficaz ao adversário em debate', 'g', 0.084, 0.23, 0.5, 5, 0.2, 'd'),
    T('deb_travada', 'debates', 'Resposta fraca ou travada em pergunta-chave', 'b', 0.084, 0.23, 0.5, 5, 0.2, 'd')
  ];

  // ---------- aleatoriedade ----------
  function sfc32(a, b, c, d) { return function () { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return (t >>> 0) / 4294967296; }; }
  function mk(seed, stream) {
    let s = ((seed >>> 0) ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0;
    const sm = () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
    const r = sfc32(sm(), sm(), sm(), sm()); for (let i = 0; i < 12; i++) r(); return r;
  }
  function normalGen(r) { let sp = NaN; return function () { if (sp === sp) { const v = sp; sp = NaN; return v; } const u = Math.sqrt(-2 * Math.log(1 - r())), a = 6.283185307179586 * r(); sp = u * Math.sin(a); return u * Math.cos(a); }; }
  function poisson(r, lam) { let n = 0; while (lam > 10) { n += poissonK(r, 10); lam -= 10; } return n + poissonK(r, lam); }
  function poissonK(r, lam) { if (lam <= 0) return 0; const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
  const chunkSeed = (seed, chunk) => (Math.imul((seed ^ 0xa5a5a5a5) >>> 0, 0x85ebca6b) + Math.imul(chunk + 1, 0xc2b2ae35)) >>> 0;

  // ---------- preparação do contexto (serializável) ----------
  function prepare(model, refDate, elecDate, o) {
    o = o || {};
    const D = S.DEF, num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null && v !== undefined ? +v : d);
    const h = Math.max(0, Math.min(120, Math.round((S.toTime(elecDate || refDate) - S.toTime(refDate)) / S.DAY)));
    const names = Object.assign({ L: 'Lula', F: 'Flávio' }, o.names), on = o.groups ? new Set(o.groups) : null;
    const freq = Math.max(0, num(o.freq, 1)), expo = { L: Math.max(0, num(o.expL, 1)), F: Math.max(0, num(o.expF, 1)) };
    const off = (Array.isArray(o.debates) ? o.debates : DEB.off).map(Number).filter((v) => v > 0 && v < h).sort((a, b) => b - a);
    const nd = off.length, w = off.map((_, k) => (nd > 1 ? DEB.wMin + ((DEB.wMax - DEB.wMin) * k) / (nd - 1) : 1));
    const debOn = !on || on.has('debates');
    const ev = [];
    TPL.forEach((t) => ['L', 'F'].forEach((a) => {
      if (t.only && t.only !== a) return;
      if (on && !on.has(t.g)) return;
      let mu = 0;
      if (t.tim === 'd') mu = debOn ? -Math.log(1 - t.p) * nd : 0; else if (t.tim === 'e') mu = h > 0 ? -Math.log(1 - t.p) : 0; else mu = (-Math.log(1 - t.p) / 14) * h;
      mu *= freq * expo[a];
      ev.push({ id: t.k + '_' + a, grp: t.g, name: `${t.n} (${names[a]})`, actor: a, tone: t.tone, dir: (a === 'L') === (t.tone === 'g') ? 1 : -1, mu, med: t.med, sl: t.sl, hl: t.hl, phi: t.phi, tim: t.tim, tl: t.tl || 3, pt: t.pt || 0, tsc: t.tsc || 1, xi: t.xi || 0, eta: t.eta || 0, th: t.th || 3, flip: t.flip || 0, p: t.p });
    }));
    const rm = REG.p.reduce((s, p, i) => s + p * REG.lam[i], 0);
    const regOn = o.regimes !== false;
    return {
      v: 2, ref: refDate, h, N: Math.max(1000, Math.min(MAXN, Math.round(num(o.sims, 1000000)))), seed: Number.isFinite(+o.seed) && o.seed !== null && o.seed !== undefined ? +o.seed >>> 0 : (7919 + Math.round(model.nowL * 100) * 31 + h) >>> 0,
      nowL: model.nowL, nowSe: model.nowSe, slope: model.slope, slopeSd: model.slopeSd, shift: num(o.shift, 0), thr: num(o.threshold, 50),
      sysErr: Math.max(0, num(o.sysErr, D.sysErr)), walk: Math.max(0, num(o.walk, 0.08)), tm: num(o.trendMult, 1), damp: Math.min(1, Math.max(0, num(o.damp, D.damp))), svol: Math.max(0, num(o.svol, 0.3)),
      int: Math.max(0, num(o.intensity, 1)), shocks: o.shocks !== false, regP: REG.p, regL: regOn ? REG.lam.map((x) => x / rm) : [1, 1, 1], regI: regOn ? REG.imp : [1, 1, 1],
      deb: { t: off.map((d) => h - d), off, w, on: debOn && o.shocks !== false, E: DEB.E, cum: DEB.cum, noise: DEB.noise, reach: DEB.reach, hl: DEB.hl, phi: DEB.phi, pOcc: Math.min(1, Math.max(0, num(o.pDebate, DEB.pOcc))) },
      ev: o.shocks === false ? [] : ev, names, fan: o.fan !== false, matrix: o.matrix === true
    };
  }

  // ---------- gerador de choques de uma simulação ----------
  function makeSim(c) {
    const K = c.ev.length, NE = K + 9, jDeb = K, h = c.h, E = c.ev, d = c.deb;
    const A = (f) => Float64Array.from(E.map(f).concat(new Array(9).fill(0)));
    const dir = A((e) => e.dir), med = A((e) => e.med), sl = A((e) => e.sl), pt = A((e) => e.pt), tsc = A((e) => e.tsc), xi = A((e) => e.xi), hl = A((e) => e.hl), phi = A((e) => e.phi), flip = A((e) => e.flip), eta = A((e) => e.eta), th = A((e) => e.th), tl = A((e) => e.tl);
    hl[jDeb] = d.hl; phi[jDeb] = d.phi;
    const tim = Int8Array.from(E.map((e) => ({ u: 0, l: 1, d: 2, e: 3 })[e.tim]).concat(new Array(9).fill(0)));
    const cum = new Float64Array(K); let acc = 0; E.forEach((e, i) => { acc += e.mu; cum[i] = acc; }); const muTot = acc; for (let i = 0; i < K; i++) cum[i] /= muTot || 1;
    const MAXE = 4096, evT = new Float64Array(MAXE), evI = new Float64Array(MAXE), evJ = new Int32Array(MAXE), psJ = new Int32Array(64), psI = new Float64Array(64), qT = new Float64Array(64), qI = new Float64Array(64), qD = new Int8Array(64);
    const ln2 = Math.LN2, nDeb = d.t.length, catMap = [0, 1, -1, 2, 3];
    const st = { m: 0, pm: 0, reg: 1 };
    const res = (j, t) => phi[j] + (1 - phi[j]) * Math.exp((-ln2 * (h - t)) / hl[j]);
    const cat = (u) => (u < d.cum[0] ? 0 : u < d.cum[1] ? 1 : u < d.cum[2] ? 2 : u < d.cum[3] ? 3 : 4);
    function push(j, t, I) { if (st.m < MAXE) { evT[st.m] = t; evI[st.m] = I; evJ[st.m] = j; st.m++; } }
    function draw(rE, nE, force) {
      st.m = 0; st.pm = 0;
      const u0 = rE(), reg = u0 < c.regP[0] ? 0 : u0 < c.regP[0] + c.regP[1] ? 1 : 2, rm = c.regL[reg], im = c.regI[reg] * c.int * CAL; st.reg = reg;
      if (d.on) for (let k = 0; k < nDeb; k++) {
        const last = force && k === nDeb - 1;
        if (!last && rE() >= d.pOcc) continue;
        const cL = last ? force.L : cat(rE()), cF = last ? force.F : cat(rE()), reach = Math.exp(d.reach * nE() - 0.5 * d.reach * d.reach), sc = d.w[k] * im * reach, t = d.t[k];
        push(jDeb, t, sc * (d.E[cL] - d.E[cF]) + d.w[k] * im * d.noise * nE());
        const r = res(jDeb, t);
        if (cL !== 2 && st.pm < 62) { psJ[st.pm] = K + 1 + catMap[cL]; psI[st.pm++] = sc * d.E[cL] * r; }
        if (cF !== 2 && st.pm < 62) { psJ[st.pm] = K + 5 + catMap[cF]; psI[st.pm++] = -sc * d.E[cF] * r; }
      }
      if (muTot > 0) {
        const n = poisson(rE, muTot * rm);
        for (let a = 0; a < n; a++) {
          const u = rE(); let lo = 0, hi = K - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; } const j = lo;
          let t; const tm = tim[j];
          if (tm === 0) t = h * (0.0001 + 0.9999 * rE()); else if (tm === 1) t = h + tl[j] * Math.log(1 - rE() * (1 - Math.exp(-h / tl[j]))); else if (tm === 2) t = d.t[Math.min(nDeb - 1, Math.floor(rE() * nDeb))]; else t = h;
          let M = med[j] * Math.exp(sl[j] * nE());
          if (pt[j] > 0 && rE() < pt[j]) { const x = xi[j], uu = rE(); M += x > 1e-9 ? (tsc[j] / x) * (Math.pow(1 - uu, -x) - 1) : -tsc[j] * Math.log(1 - uu); }
          if (M > CAP) M = CAP;
          const sg = flip[j] > 0 && rE() < flip[j] ? -dir[j] : dir[j], I = sg * M * im;
          push(j, t, I);
          if (eta[j] > 0) { // cascata de Hawkes: cada evento gera filhos (ramificação eta<1), atraso exponencial, até 3 gerações
            let qn = 1; qT[0] = t; qI[0] = I; qD[0] = 0;
            while (qn > 0) {
              qn--; const pT = qT[qn], pI = qI[qn], g = qD[qn]; if (g >= 3) continue;
              const nc = poissonK(rE, eta[j]);
              for (let b = 0; b < nc; b++) { const tc = pT - th[j] * Math.log(1 - rE()); if (tc > h) continue; const Ic = pI * (0.3 + 0.5 * rE()); push(j, tc, Ic); if (qn < 62) { qT[qn] = tc; qI[qn] = Ic; qD[qn] = g + 1; qn++; } }
            }
          }
        }
      }
      return st;
    }
    return { draw, st, evT, evI, evJ, psJ, psI, res, NE, jDeb };
  }

  const newAcc = (c) => { const NE = c.ev.length + 9; return { n: 0, hist: new Uint32Array(BINS), win: 0, win0: 0, lose2: 0, gain2: 0, mom: new Float64Array(4), comp: new Float64Array(10), hecL: 0, hecF: 0, big: 0, nEv: 0, reg: new Float64Array(3), occ: new Float64Array(NE), wOcc: new Float64Array(NE), imp: new Float64Array(NE), gOcc: new Float64Array(GROUPS.length), gWin: new Float64Array(GROUPS.length), gImp: new Float64Array(GROUPS.length) }; };
  const grpIdx = (c) => { const idx = c.ev.map((e) => GROUPS.findIndex((g) => g.id === e.grp)); for (let i = 0; i < 9; i++) idx.push(0); return idx; };

  // ---------- bloco de simulações (nº fixo, semente própria) ----------
  function core(c, chunk, n, force) {
    const seed = chunkSeed(c.seed, chunk), rB = mk(seed, 1), rE = mk(seed, 2), nB = normalGen(rB), nE = normalGen(rE), sim = makeSim(c), a = newAcc(c), gi = grpIdx(c), NE = sim.NE, st = sim.st;
    const h = c.h, sc = Math.sqrt(3 / 5), sqh = Math.sqrt(h), Dsum = c.damp >= 1 ? h : (c.damp * (1 - Math.pow(c.damp, h))) / (1 - c.damp), base0 = c.nowL + c.shift, thr = c.thr;
    const stamp = new Int32Array(NE), impJ = new Float64Array(NE), gStamp = new Int32Array(GROUPS.length), gImpJ = new Float64Array(GROUPS.length), seen = new Int32Array(NE), gSeen = new Int32Array(GROUPS.length);
    for (let i = 1; i <= n; i++) {
      let chi = 0; for (let j = 0; j < 5; j++) { const z = nB(); chi += z * z; }
      const eSys = (c.sysErr * sc * nB()) / Math.sqrt(chi / 5), cMean = c.nowSe * nB(), zv = nB(), vm = c.svol > 0 ? Math.exp(c.svol * zv - 0.5 * c.svol * c.svol) : 1;
      const cWalk = c.walk * vm * sqh * nB(), cDrift = (c.tm * c.slope + c.slopeSd * nB()) * Dsum, L0 = base0 + cMean + eSys + cWalk + cDrift;
      sim.draw(rE, nE, force);
      let evt = 0, big = 0, ns = 0, gs = 0;
      for (let k = 0; k < st.m; k++) {
        const j = sim.evJ[k], v = sim.evI[k] * sim.res(j, sim.evT[k]); evt += v; if (Math.abs(v) > big) big = Math.abs(v);
        if (stamp[j] !== i) { stamp[j] = i; seen[ns++] = j; impJ[j] = 0; } impJ[j] += v;
        const g = gi[j]; if (gStamp[g] !== i) { gStamp[g] = i; gSeen[gs++] = g; gImpJ[g] = 0; } gImpJ[g] += v;
      }
      for (let k = 0; k < st.pm; k++) { const j = sim.psJ[k]; if (stamp[j] !== i) { stamp[j] = i; seen[ns++] = j; impJ[j] = 0; } impJ[j] += sim.psI[k]; }
      let L = L0 + evt; L = L < 0.01 ? 0.01 : L > 99.99 ? 99.99 : L;
      const win = L > thr, win0 = L0 > thr;
      a.n++; a.hist[Math.min(BINS - 1, Math.floor(L / BW))]++; if (win) a.win++; if (win0) a.win0++; if (win0 && !win) a.lose2++; if (!win0 && win) a.gain2++;
      a.mom[0] += L; a.mom[1] += L * L; a.mom[2] += L * L * L; a.mom[3] += L * L * L * L;
      const cp = a.comp; cp[0] += cMean; cp[1] += cMean * cMean; cp[2] += eSys; cp[3] += eSys * eSys; cp[4] += cWalk; cp[5] += cWalk * cWalk; cp[6] += cDrift; cp[7] += cDrift * cDrift; cp[8] += evt; cp[9] += evt * evt;
      if (evt <= -HEC) a.hecL++; if (evt >= HEC) a.hecF++; if (big >= 3) a.big++; a.nEv += st.m; a.reg[st.reg]++;
      for (let k = 0; k < ns; k++) { const j = seen[k]; a.occ[j]++; if (win) a.wOcc[j]++; a.imp[j] += impJ[j]; }
      for (let k = 0; k < gs; k++) { const g = gSeen[k]; a.gOcc[g]++; if (win) a.gWin[g]++; a.gImp[g] += gImpJ[g]; }
    }
    return a;
  }
  function addAcc(x, y) {
    x.n += y.n; x.win += y.win; x.win0 += y.win0; x.lose2 += y.lose2; x.gain2 += y.gain2; x.hecL += y.hecL; x.hecF += y.hecF; x.big += y.big; x.nEv += y.nEv;
    ['hist', 'mom', 'comp', 'reg', 'occ', 'wOcc', 'imp', 'gOcc', 'gWin', 'gImp'].forEach((k) => { const a = x[k], b = y[k]; for (let i = 0; i < a.length; i++) a[i] += b[i]; });
    return x;
  }

  // ---------- leque de trajetórias diárias (para o gráfico de projeção) ----------
  function fanPaths(c, nP) {
    const seed = chunkSeed(c.seed, 987654), rB = mk(seed, 1), rE = mk(seed, 2), nB = normalGen(rB), nE = normalGen(rE), sim = makeSim(c), st = sim.st, h = c.h, sc = Math.sqrt(3 / 5);
    const cols = Array.from({ length: h + 1 }, () => new Float32Array(nP)), dp = [];
    for (let d = 0; d <= h; d++) dp.push(Math.pow(c.damp, d));
    for (let p = 0; p < nP; p++) {
      let chi = 0; for (let j = 0; j < 5; j++) { const z = nB(); chi += z * z; }
      const eSys = (c.sysErr * sc * nB()) / Math.sqrt(chi / 5), cMean = c.nowSe * nB(), vm = c.svol > 0 ? Math.exp(c.svol * nB() - 0.5 * c.svol * c.svol) : 1, b = c.tm * c.slope + c.slopeSd * nB();
      sim.draw(rE, nE, null); let walk = 0, drift = 0; const L0 = c.nowL + c.shift + cMean + eSys; cols[0][p] = L0;
      for (let d = 1; d <= h; d++) {
        walk += c.walk * vm * nB(); drift += b * dp[d]; let evt = 0;
        for (let k = 0; k < st.m; k++) { const t = sim.evT[k]; if (t <= d) { const j = sim.evJ[k], ph = jPhi(c, j); evt += sim.evI[k] * (ph + (1 - ph) * Math.exp((-Math.LN2 * (d - t)) / jHl(c, j))); } }
        cols[d][p] = Math.min(99.99, Math.max(0.01, L0 + walk + drift + evt));
      }
    }
    const t0 = S.toTime(c.ref), q = (s, x) => s[Math.min(s.length - 1, Math.max(0, Math.round(x * (s.length - 1))))];
    return cols.map((col, d) => { const s = Float32Array.from(col).sort(); return { date: S.toDate(t0 + d * S.DAY), t: t0 + d * S.DAY, p5: q(s, 0.05), p25: q(s, 0.25), p50: q(s, 0.5), p75: q(s, 0.75), p95: q(s, 0.95) }; });
  }
  const jPhi = (c, j) => (j === c.ev.length ? c.deb.phi : c.ev[j].phi), jHl = (c, j) => (j === c.ev.length ? c.deb.hl : c.ev[j].hl);

  // ---------- consolidação ----------
  function qh(hist, n, q) { const target = q * n; let cumv = 0; for (let i = 0; i < hist.length; i++) { const nx = cumv + hist[i]; if (nx >= target && hist[i] > 0) return (i + (target - cumv) / hist[i]) * BW; cumv = nx; } return 100; }
  const pBelow = (hist, n, x) => { let s = 0; const k = Math.floor(x / BW); for (let i = 0; i < k && i < hist.length; i++) s += hist[i]; return s / n; };
  function pseudoNames(c) { const L = c.names.L, F = c.names.F, o = ['péssimo', 'ruim', 'bom', 'muito bom']; return ['Debates: efeito líquido (todos os debates)'].concat(o.map((x) => `${L} tem desempenho ${x.toUpperCase()} em ao menos um debate`), o.map((x) => `${F} tem desempenho ${x.toUpperCase()} em ao menos um debate`)); }
  function finalize(a, c, extra) {
    const n = a.n, K = c.ev.length, pL = a.win / n, mean = a.mom[0] / n, v2 = a.mom[1] / n - mean * mean, sd = Math.sqrt(Math.max(0, v2));
    const m3 = a.mom[2] / n - 3 * mean * (a.mom[1] / n) + 2 * mean ** 3, m4 = a.mom[3] / n - 4 * mean * (a.mom[2] / n) + 6 * mean * mean * (a.mom[1] / n) - 3 * mean ** 4;
    const q = {}; [['p01', 0.001], ['p1', 0.01], ['p5', 0.05], ['p25', 0.25], ['p50', 0.5], ['p75', 0.75], ['p95', 0.95], ['p99', 0.99], ['p999', 0.999]].forEach(([k, x]) => (q[k] = qh(a.hist, n, x)));
    const nb = 160, lo = 30, hist = new Array(nb).fill(0); for (let i = 0; i < BINS; i++) { const b = Math.floor((i * BW - lo) / 0.25); hist[Math.max(0, Math.min(nb - 1, b))] += a.hist[i] / n; }
    const compNames = ['Erro da média das pesquisas', 'Erro sistemático (viés comum)', 'Oscilação diária da opinião', 'Tendência incerta', 'Choques de campanha'], cv = [];
    for (let i = 0; i < 5; i++) { const m = a.comp[2 * i] / n; cv.push(Math.max(0, a.comp[2 * i + 1] / n - m * m)); }
    const tv = cv.reduce((s, x) => s + x, 0) || 1, comp = compNames.map((nm, i) => ({ name: nm, sd: Math.sqrt(cv[i]), share: cv[i] / tv }));
    const names = c.ev.map((e) => e.name).concat(pseudoNames(c));
    const rows = [];
    for (let j = 0; j < K + 9; j++) {
      const e = j < K ? c.ev[j] : null, occ = a.occ[j]; if (!e && j > K && occ === 0 && c.deb.t.length === 0) continue;
      const nots = n - occ, pw = occ ? a.wOcc[j] / occ : null, pn = nots ? (a.win - a.wOcc[j]) / nots : null;
      rows.push({ id: e ? e.id : j === K ? 'deb_liquido' : 'deb_cat_' + j, name: names[j], grp: e ? e.grp : 'debates', actor: e ? e.actor : j > K + 4 ? 'F' : j === K ? '' : 'L', tone: e ? e.tone : '', pOcc: occ / n, pAnalytic: e ? 1 - Math.exp(-e.mu) : null, mean: occ ? a.imp[j] / occ : 0, pWinOcc: pw, d: pw != null && pn != null ? pw - pn : null, med: e ? e.dir * e.med * CAL * c.int : null, hl: e ? e.hl : c.deb.hl, pseudo: !e });
    }
    const groups = GROUPS.map((g, i) => ({ id: g.id, name: g.name, pOcc: a.gOcc[i] / n, mean: a.gOcc[i] ? a.gImp[i] / a.gOcc[i] : 0, pWinOcc: a.gOcc[i] ? a.gWin[i] / a.gOcc[i] : null, d: a.gOcc[i] && n > a.gOcc[i] ? a.gWin[i] / a.gOcc[i] - (a.win - a.gWin[i]) / (n - a.gOcc[i]) : null }));
    return { N: n, h: c.h, days: [], hist, histLo: lo, bw: 0.25, pLula: pL, pFlavio: 1 - pL, pCI: S.probCI(a.win, n), threshold: c.thr, q, mean, sd, skew: sd > 0 ? m3 / sd ** 3 : 0, kurt: sd > 0 ? m4 / sd ** 4 - 3 : 0,
      pNoShock: a.win0 / n, flipsLoss: a.lose2 / n, flipsGain: a.gain2 / n, comp, rows, groups, pHecL: a.hecL / n, pHecF: a.hecF / n, pBig: a.big / n, evPerSim: a.nEv / n, regimes: Array.from(a.reg).map((x) => x / n),
      tails: { lt40: pBelow(a.hist, n, 40), lt45: pBelow(a.hist, n, 45), gt55: 1 - pBelow(a.hist, n, 55), gt60: 1 - pBelow(a.hist, n, 60) }, hecThreshold: HEC,
      matrix: (extra && extra.matrix) || null, params: c, ctx: c };
  }

  // ---------- tarefas e execução (síncrona e assíncrona) ----------
  function tasksFor(c) {
    const t = []; if (c.fan && c.h > 0) t.push({ job: 'fan', n: 0 }); // o leque vai primeiro: assim as prévias já o incluem
    for (let k = 0, left = c.N; left > 0; k++) { const n = Math.min(CHUNK, left); t.push({ job: 'main', chunk: k, n }); left -= n; }
    if (c.matrix) for (let l = 0; l < 5; l++) for (let f = 0; f < 5; f++) t.push({ job: 'mx', chunk: 100000 + l * 5 + f, n: MATRIX_N, force: { L: l, F: f } });
    return t;
  }
  const runTask = (c, t) => (t.job === 'fan' ? { fan: fanPaths(c, Math.min(FAN_N, Math.max(2000, c.N))) } : { acc: core(c, t.chunk, t.n, t.force || null) });

  // Consolidador em fluxo: cada bloco é somado ao total assim que chega e descartado (memória constante, mesmo com 1 bilhão de sorteios).
  // Os blocos principais são somados SEMPRE na ordem do índice (buffer de reordenação) => resultado idêntico com 1 ou N workers, bit a bit.
  function newMerger(c) {
    const m = { main: newAcc(c), next: 0, pend: new Map(), mx: [], fan: [] };
    m.add = (task, out) => {
      if (task.job === 'main') { m.pend.set(task.chunk, out.acc); while (m.pend.has(m.next)) { addAcc(m.main, m.pend.get(m.next)); m.pend.delete(m.next); m.next++; } }
      else if (task.job === 'mx') m.mx.push({ L: task.force.L, F: task.force.F, p: out.acc.win / out.acc.n, n: out.acc.n });
      else if (task.job === 'fan') m.fan = out.fan;
    };
    m.snapshot = () => {
      const cells = m.mx.slice().sort((x, y) => x.L - y.L || x.F - y.F), res = finalize(m.main, c, { matrix: cells.length ? { cats: CATS, cells } : null }); res.days = m.fan; return res;
    };
    return m;
  }
  function assemble(c, results) { const m = newMerger(c); results.forEach((r) => m.add(r.task, r.out)); return m.snapshot(); } // results: [{task, out}] em qualquer ordem
  const cache = new Map();
  const keyOf = (c) => JSON.stringify(c);
  function remember(k, v) { cache.set(k, v); if (cache.size > 12) cache.delete(cache.keys().next().value); return v; }
  // run() é síncrono: limitado a SYNC_MAX para nunca congelar a página. Para mais sorteios use runAsync (workers).
  function run(model, refDate, elecDate, o) {
    if (!model) return null; const c = prepare(model, refDate, elecDate, o); if (c.N > SYNC_MAX) c.N = SYNC_MAX; const k = keyOf(c); if (cache.has(k)) return cache.get(k);
    return remember(k, assemble(c, tasksFor(c).map((t) => ({ task: t, out: runTask(c, t) }))));
  }
  function cached(model, refDate, elecDate, o) { return model ? cache.get(keyOf(prepare(model, refDate, elecDate, o))) || null : null; }

  let live = null; // execução assíncrona corrente: pedidos iguais compartilham o mesmo cálculo; um pedido diferente cancela o anterior
  function cancel() { if (live) { const l = live; live = null; l.stop(); } }
  const PROG_MS = 120, PART_MS = 3000, PART_MIN = 100000; // progresso a cada 120 ms; prévia parcial a cada 3 s (após 100 mil sorteios)
  // onProgress(fração, feitos, total); onPartial(resultado parcial com N = sorteios já somados, res.partial = true). O resultado final só vem pela Promise.
  function runAsync(model, refDate, elecDate, o, onProgress, onPartial) {
    if (!model) return Promise.resolve(null);
    const c = prepare(model, refDate, elecDate, o), k = keyOf(c); if (cache.has(k)) return Promise.resolve(cache.get(k));
    if (live && live.key === k) { if (onProgress) live.ls.push(onProgress); if (onPartial) live.ps.push(onPartial); return live.promise; }
    cancel();
    const me = { key: k, ls: onProgress ? [onProgress] : [], ps: onPartial ? [onPartial] : [], stop: null, promise: null };
    me.promise = new Promise((resolve, reject) => {
      const tasks = tasksFor(c), total = tasks.reduce((s, t) => s + (t.n || 0), 0), mg = newMerger(c); let done = 0, idx = 0, stopped = false, workers = [], lastP = 0, lastQ = Date.now();
      const kill = () => { workers.forEach((w) => w.terminate()); workers = []; };
      const finish = () => { if (stopped) return; kill(); if (live === me) live = null; me.ls.forEach((f) => f(1, total, total)); resolve(remember(k, mg.snapshot())); };
      const tick = (t) => {
        done += t.n || 0; const now = Date.now();
        if (now - lastP >= PROG_MS) { lastP = now; me.ls.forEach((f) => f(Math.min(1, done / total), done, total)); }
        if (me.ps.length && now - lastQ >= PART_MS && mg.main.n >= PART_MIN && mg.main.n < c.N) { lastQ = now; const r = mg.snapshot(); r.partial = true; me.ps.forEach((f) => f(r)); }
      };
      const got = (t, out) => { mg.add(t, out); tick(t); };
      me.stop = () => { stopped = true; kill(); reject(new Error('cancelado')); };
      const serial = () => { // sem Workers: um bloco por vez, devolvendo o controle à interface entre eles
        mg.main = newAcc(c); mg.next = 0; mg.pend.clear(); mg.mx = []; mg.fan = []; done = 0; idx = 0;
        const step = () => { if (stopped) return; if (idx >= tasks.length) return finish(); const t = tasks[idx++]; got(t, runTask(c, t)); setTimeout(step, 0); }; step();
      };
      if (typeof Worker === 'undefined' || typeof document === 'undefined') return serial();
      try {
        const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4, nW = Math.max(1, Math.min(16, hw - 1, tasks.length)); let alive = nW, failed = false;
        const feed = (w) => { if (stopped || failed) return; if (idx >= tasks.length) { w.terminate(); if (--alive === 0) finish(); return; } w.postMessage({ type: 'run', task: tasks[idx++] }); };
        for (let i = 0; i < nW; i++) {
          const w = new Worker('mcworker.js?v=7'); workers.push(w);
          w.onmessage = (e) => { const m = e.data; if (m.type === 'done' && !stopped) { got(m.task, m.out); feed(w); } };
          w.onerror = () => { if (stopped || failed) return; failed = true; kill(); serial(); };
          w.postMessage({ type: 'init', ctx: c }); feed(w);
        }
      } catch (err) { serial(); }
    });
    live = me; return me.promise;
  }

  root.MC = { prepare, run, runAsync, cached, cancel, core, addAcc, finalize, makeSim, tasksFor, runTask, assemble, newMerger, MAXN, SYNC_MAX, GROUPS, CATS, TPL, DEB, REG, CHUNK, CAL, HEC };
  if (typeof module !== 'undefined') module.exports = root.MC;
})(typeof window !== 'undefined' ? window : globalThis);
