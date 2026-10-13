# Estudo: Monte Carlo v2 com choques de campanha

## 1. O problema
O modelo anterior somava ao nível atual de Lula (% dos válidos) quatro ruídos suaves: erro da média, erro sistemático das pesquisas, passeio aleatório diário e tendência. Isso produz uma distribuição quase gaussiana e **subestima eventos discretos**: um debate desastroso, um escândalo, um atentado, uma crise. Esses acontecimentos são raros ou pontuais, têm efeitos assimétricos e de cauda pesada, e se dissipam com o tempo. O v2 os modela explicitamente.

## 2. Arquitetura matemática
Nível final: `L = nível atual + ε_média + ε_sist + W + D + Σ choques`.

| Componente | Lei | Observação |
|---|---|---|
| ε_média | N(0, se²) | erro da média ponderada |
| ε_sist | t₅ escalada (σ = 2 pp) | erro comum a todos os institutos; erro médio absoluto de pesquisas ≈ 2 pp (351 eleições, 45 países; Jennings & Wlezien, 2018) |
| W | N(0, walk²·V·h), V = volatilidade estocástica lognormal | soma de h passos gaussianos em forma fechada (exata); V gera caudas mais pesadas |
| D | (tend. × inclinação) · Σ dampᵈ | tendência incerta e amortecida, forma fechada |
| Σ choques | processo de Poisson composto (Cox) | ver abaixo |

**Regimes de campanha (processo de Cox / mistura de Markov, cf. Hamilton 1989).** Cada cenário sorteia um regime: calma (25%), normal (55%) ou turbulenta (20%), que multiplica a frequência (×0,5/×1/×1,8, normalizada para média 1) e o tamanho (×0,85/×1/×1,2) dos choques. A contagem de eventos fica superdispersa (como uma binomial negativa), e não Poisson pura: campanhas movimentadas têm vários acontecimentos juntos.

**Choques (Merton 1976, processo de saltos).** O catálogo tem ~100 tipos (ver `public/mc.js`, constante `TPL`), em 11 grupos: debates, atos, apoios, escândalos, gafes/viralização/entrevistas, economia/governo, justiça, mídia/desinformação, segurança/imprevistos, mobilização/abstenção e hecatombes. Cada tipo existe nas versões Lula e Flávio, com variantes **boas e ruins**; alguns são específicos de quem é governo (economia, desastres). Parâmetros por tipo:

* **frequência**: probabilidade de ≥ 1 ocorrência em 14 dias (taxa λ = −ln(1−p)/14), por debate ou no dia da eleição;
* **tempo**: uniforme, "tardio" (exponencial truncada, concentrada na reta final, para boatos, atos de véspera e surpresas) ou preso às datas de debate;
* **tamanho**: mediana lognormal (pp do voto válido) + **cauda GPD** com probabilidade `pt` (Pareto generalizada; teorema de Pickands–Balkema–de Haan: excedências acima de um limiar alto convergem para a GPD), truncado em 12 pp;
* **dissipação**: `efeito(g) = φ + (1−φ)·2^(−g/T½)`, g = dias até a eleição. Eventos próximos da eleição quase não decaem (não há tempo); eventos antigos revertem, como se observa em "bounces" de debates e convenções;
* **cascata de Hawkes (1971)**: escândalos, vazamentos, operações e hecatombes geram "filhos" (razão de ramificação η < 1, atraso exponencial, até 3 gerações), o que cria agrupamentos de más (ou boas) notícias;
* **efeito bumerangue** (`flip`): boatos e deepfakes podem se voltar contra quem os espalha; crises exógenas e institucionais podem ajudar ou prejudicar o governo.

**Debates (modelo próprio).** Para cada debate agendado (padrão: 12, 7 e 2 dias antes da eleição, editável; ocorre com 90%), cada candidato tem desempenho **péssimo (6%) / ruim (19%) / regular (50%) / bom (19%) / muito bom (6%)**, com efeito próprio de −0,9 / −0,35 / 0 / +0,3 / +0,6 pp, assimétrico (perda pesa mais que ganho; viés de negatividade, Lau 1985; Soroka 2006). Efeito líquido em Lula = efeito de Lula − efeito de Flávio, com ruído, fator de alcance lognormal e peso crescente (0,7 → 1,1) para debates mais próximos da eleição. Meia-vida de 6 dias e 25% permanente. Além disso há momentos virais, cadeira vazia, ataques eficazes e respostas travadas. A **matriz de debates** do Simulador condiciona o último debate nas 25 combinações de desempenho.

## 3. Engenharia dos 1.000.000 de sorteios
* **Forma fechada** para a parte gaussiana (passeio aleatório e tendência): não é preciso simular dia a dia para o resultado final; só o leque diário usa 20 mil trajetórias.
* **Choques por superposição**: o total de eventos é Poisson(Σλ) e o tipo é escolhido por busca binária na distribuição acumulada.
* **PRNG sfc32** (estado de 128 bits) e normais por Box–Muller com reaproveitamento.
* **Blocos de 25 mil sorteios com semente própria** → o resultado é idêntico com 1 ou N workers (testado) e a interface não trava. Vários Web Workers em paralelo; sem Workers, roda em blocos devolvendo o controle ao navegador.
* **Números aleatórios comuns**: fluxos separados para a base e para os choques, então "P com choques − P sem choques" é efeito puro, sem ruído de sorteio.
* Quantis e histograma vêm de um histograma fino (0,05 pp), com interpolação; IC de Wilson para a probabilidade (com 1 milhão, ≈ ±0,1 pp).
* Tempo medido neste ambiente, 1 núcleo, sem workers: ~6 s para 1 milhão + leque + matriz de debates; com workers, uma fração disso.

## 4. Calibração (e o que ela NÃO é)
Não existe base de dados que dê "a probabilidade de um escândalo em 14 dias". As frequências e tamanhos do catálogo são **premissas informadas**, ajustadas por uma restrição agregada:

* o desvio-padrão da soma dos choques em 14 dias fica em ~1,6 pp (fator de calibração `CAL = 0,9`), o que mantém a variação total de uma campanha de duas semanas na ordem de poucos pontos percentuais. Referências: efeitos de debate em geral abaixo de ~2 pp, com reversão em dias ou semanas (análises de FiveThirtyEight e Princeton Election Consortium); "bounces" de convenção de 4–6 pp revertendo em semanas; no 2º turno de 2022 as últimas pesquisas (Datafolha 52–53, Ipec 54% dos válidos para Lula) ficaram 1–3 pp acima do resultado (50,9%), compatível com σ sistemático de 2 pp;
* o crescimento do desvio dos choques com o horizonte é sub-√h (≈1,4 / 1,8 / 2,2 / 2,6 pp para 7 / 14 / 30 / 60 dias) por causa da dissipação;
* a média líquida dos choques é ~0 (nenhum viés político embutido); ambos os lados têm catálogos simétricos, exceto os efeitos de governo, que vão para quem é governo. As "exposições" por candidato e a intensidade são ajustáveis;
* hecatombes (choque líquido ≥ 4 pp) ocorrem em ~1,4% dos cenários contra cada lado em 14 dias. Mudar isso é questão de julgamento: use o perfil "Caótica" ou a intensidade para testar.

Consequência prática: quando há um favorito, os choques **reduzem** a probabilidade dele (mais incerteza), e a probabilidade deve ser lida como cenário condicional, não como previsão.

## 5. Limitações
Parâmetros são premissas, não estimativas estatísticas; efeitos reais são correlacionados entre tipos e podem ser maiores que os modelados; o modelo trabalha em pontos do voto válido nacional (sem estados, abstenção explícita ou terceiros); as pesquisas podem errar em conjunto de forma assimétrica (use "Ajuste manual"); os dados de demonstração são fictícios.

## 6. Referências
Merton (1976) *Option pricing when underlying stock returns are discontinuous*, J. Financial Economics · Hawkes (1971) *Spectra of some self-exciting and mutually exciting point processes*, Biometrika · Balkema & de Haan (1974) e Pickands (1975), teoria de valores extremos (GPD) · Hamilton (1989) *A new approach to the economic analysis of nonstationary time series and the business cycle*, Econometrica · Gelman & King (1993) *Why are American presidential election campaign polls so variable when votes are so predictable?*, British J. Political Science · Lau (1985) *Two explanations for negativity effects in political behavior*, AJPS · Soroka (2006) *Good news and bad news: asymmetric responses to economic information*, J. of Politics · Jennings & Wlezien (2018) *Election polling errors across time and space*, Nature Human Behaviour.
