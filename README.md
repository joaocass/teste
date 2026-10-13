# Observatório das Pesquisas (2º turno 2026)

Agregador independente de pesquisas. Node.js (sem Express) + MongoDB + HTML/CSS/JS puro. Gráfico SVG próprio com LOESS real (`public/stats.js`).

## Executar
1. Tenha Node 18+ e um MongoDB rodando (ex.: `docker run -d -p 27017:27017 mongo:7`).
2. `npm install`
3. `npm start` → http://localhost:3000
Variáveis: `MONGODB_URI`, `MONGODB_DB`, `PORT`, `SITE_NAME` (nome do site), `NO_FILE_FALLBACK=1` (falha se o Mongo estiver fora; sem isso, cai em `data/polls.json` só para desenvolvimento).
Testes: `npm test` (cálculos, LOESS, API, análises, cenários, Monte Carlo).

## Modelo estatístico (resumo; detalhes na aba Metodologia)
Votos válidos → n efetivo (n/deff por método, amostra <100 lida como milhares) → peso = recência × 1/(erro amostral² + τ²) × 1/√k por instituto → efeito de instituto com encolhimento → média + erro-padrão + índice de Kish → tendência encolhida → **Monte Carlo v2** (1 milhão de simulações: erro da média + erro sistemático t₅ + volatilidade estocástica + deriva amortecida + **choques de campanha**) até a data da eleição (padrão 25/10/2026, em Configurações). No gráfico: seletor **Projeção** (mediana tracejada + faixas 50%/90%).
Testes usam arquivo temporário (`DATA_FILE`) e não tocam em `data/polls.json`.

## Novas funcionalidades (v1.1)
- **Histórico** (`#historico`): média diária de Lula e Flávio recalculada dia a dia **só com pesquisas já divulgadas** na data (usa `released`, ou `fieldEnd` se vazio; sem “olhar o futuro”). Filtros de período (7/15/30 dias, tudo, datas livres), exibição Lula/Flávio/diferença, faixa de erro de 95%, comparação com média simples ou pesquisas individuais e tabela de tendências (variação e inclinação em pp/dia ± IC).
- **Institutos** (`#institutos`): além da tabela original, comparação com nº de pesquisas, período, métodos, amostra, n efetivo, margem, última pesquisa, peso na média, **desvio vs. demais institutos** (leave-one-institute-out, na data de cada pesquisa) e efeito de instituto estimado pelo modelo. Gráficos de desvio ao longo do tempo e pesquisas vs. média. Não há “taxa de acerto”: o 2º turno ainda não ocorreu. Campos não cadastrados aparecem como “—”.
- **Simulador** (`#simulador`): Monte Carlo com parâmetros editáveis (data, limiar, ajuste manual, erro sistemático, volatilidade, multiplicador/persistência da tendência, nº de simulações), probabilidade de cada candidato superar o limiar de votos válidos, histograma, intervalos 50%/90% dos cenários, **IC 95% de Wilson do sorteio** e tabela de **sensibilidade** às premissas.
- **Cenários** (`#cenarios`): pesquisas hipotéticas, alteração de resultados e exclusão de pesquisas reais, comparados à base real (média, Δ, probabilidade). **Ficam apenas no `localStorage` do navegador** (exportáveis em JSON); nunca vão ao MongoDB nem aparecem nas outras páginas; pesquisas simuladas recebem `hypothetical: true` e id `sim-…`.
- **Visual** (`public/theme.css`): design flat e sério (abas com sublinhado, cartões com borda fina, sem sombras nem degradês; referências gerais de portais de notícias e dashboards), roxo sobre branco. **Skeleton screens** enquanto os dados carregam e **layout mobile** com barra de navegação inferior, botão flutuante “Adicionar”, chips roláveis e diálogos em folha inferior. Respeita `prefers-reduced-motion`. Ao editar o CSS, aumente o `?v=` em `index.html` para invalidar o cache.
- `public/stats.js` ganhou, de forma retrocompatível, as opções `threshold`, `shift`, `trendMult` e `seed` em `simulate` e a função `probCI`. Sem opções, os resultados são idênticos aos da versão anterior.

## Desempenho e detalhes (v1.5)
- `Stats.simulate` agora é **memoizado** (resultado determinístico por dados + parâmetros) e aceita `fan:false` (só o resultado final, sem guardar caminhos diários). O simulador, a sensibilidade (5.000 sorteios por linha, calculada depois da primeira pintura) e os cenários usam o modo leve; resultados idênticos aos do modo completo (testado).
- Servidor: ETag/304 e gzip nos arquivos estáticos. Favicon SVG, manifesto (instalável como app), meta tags, link “Ir para o conteúdo”, título por página, rolagem ao topo ao trocar de aba e atalho `/` para buscar.

## Estrutura
- `public/analytics.js` série diária, tendência, relatório de institutos, cenários, sensibilidade (puro, testado) · `public/extra.js` interface das novas páginas · `public/theme.css` tema visual
- `public/stats.js` votos válidos, validação, ponderação, agregação, LOESS (isolado/testado)
- `lib/store.js` persistência MongoDB (com fallback em arquivo) · `server.js` API REST + estáticos
- `public/index.html|style.css|app.js` interface · `test/` testes

## Limitações conhecidas
- As novas telas **não foram testadas em navegador real** neste ambiente (só a lógica, por testes automatizados e verificação de sintaxe); revise visualmente.
- Cenários são por navegador (não sincronizam entre dispositivos).
- A faixa do histórico mostra só o erro amostral combinado; o intervalo de IC 95% do Monte Carlo cobre só o ruído do sorteio, e a incerteza das premissas aparece na sensibilidade.
- O driver MongoDB **não foi testado contra um Mongo real** (ambiente sem rede); a API foi testada no modo arquivo.
- Não implementados: exportação PNG, média móvel, desfazer, paginação da tabela, IndexedDB, filtros avançados (margem, amostra, estado, data de divulgação), skeletons, prévia detalhada de importação (há confirmação simples + relatório de erros), testes de interface.
- Suavização LOESS: grau 1, span fixo por nível (30/55/85%). O intervalo de incerteza aparece na projeção Monte Carlo, não na curva LOESS.
- Sem autenticação: qualquer um com acesso ao servidor edita os dados.
- Os dados de demonstração são fictícios e marcados "DEMO".

## Monte Carlo v2 (até 1 bilhão de cenários e choques de campanha)
- `public/mc.js` (motor, também roda em Node) e `public/mcworker.js` (Web Workers em paralelo; sem Workers cai para blocos cooperativos). Resultado idêntico com qualquer nº de workers. A página principal mostra uma prévia de 20 mil cenários na hora e refina até o total configurado (100 mil a **1 bilhão**) em segundo plano, com barra de progresso e **prévias parciais ao vivo** a cada ~3 s.
- **Escala (v1.7)**: os blocos de 25 mil sorteios são somados em fluxo, na ordem do índice, e descartados (memória constante: ~5 MB de heap em 3 mi de sorteios; 1 bi = 40 mil blocos). Usa `núcleos − 1` workers (até 16; antes, no máximo 4). Resultado **idêntico bit a bit** ao da v1.6 para a mesma semente, com 1 ou N workers. `MC.run()` (síncrono) é limitado a 2 mi para nunca congelar a página; acima disso, use `MC.runAsync()`.
- **Tempo de referência** (~7 µs por sorteio por núcleo): 1 mi ≈ 7 s em 1 núcleo; 100 mi ≈ 12 min em 1 núcleo, ≈ 2 min com 7 workers; 1 bi ≈ 20 min com 7 workers, ≈ 8 min com 15. O erro-padrão da probabilidade cai com √N: ±0,044 pp (1 mi), ±0,014 pp (10 mi), ±0,0044 pp (100 mi), ±0,0014 pp (1 bi).
- **Choques**: ~100 tipos de acontecimentos (debates péssimo/ruim/bom/muito bom, atos, apoios, escândalos, gafes, economia, justiça, mídia, segurança, mobilização, hecatombes) bons e ruins para os dois lados, com cauda GPD, cascatas de Hawkes, regimes de campanha e dissipação por meia-vida.
- **Simulador**: perfis (calma/padrão/turbulenta/caótica), frequência, intensidade, exposição por candidato, datas de debates, grupos ligáveis, decomposição da incerteza, hecatombes e caudas, **matriz de debates 5×5**, catálogo filtrável com o efeito de cada choque na probabilidade e sensibilidade.
- Configurações: nº de simulações (100 mil a 1 milhão), frequência e intensidade dos choques. O padrão da volatilidade diária caiu de 0,12 para 0,08 pp/dia (parte dela agora vem dos choques); configurações antigas salvas no navegador são migradas.
- Estudo completo, calibração e referências: `docs/ESTUDO_MONTE_CARLO.md`. As frequências e tamanhos são premissas informadas, não estatísticas observadas.
- Limitação: as telas novas não foram testadas em navegador real aqui (só a lógica, por testes e verificação de sintaxe); revise visualmente. `Stats.simulate` (v1) continua disponível, mas a interface usa `MC`.
