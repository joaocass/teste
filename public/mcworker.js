// Worker do Monte Carlo: recebe o contexto uma vez e executa blocos de simulação sob demanda.
importScripts('stats.js?v=7', 'mc.js?v=7');
let ctx = null;
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') ctx = m.ctx;
  else if (m.type === 'run') postMessage({ type: 'done', task: m.task, out: MC.runTask(ctx, m.task) });
};
