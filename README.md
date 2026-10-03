# Mapa Eleitoral do Brasil — Node.js + MongoDB

Aplicação Node.js/Express que serve um mapa eleitoral interativo (Lula x Flávio)
e guarda as pesquisas de cada estado no MongoDB.

## ⚠️ Importante sobre a senha do MongoDB (troque-a!)

A connection string usada aqui foi compartilhada em texto aberto em algum
momento. **Recomendo fortemente trocar a senha do usuário no MongoDB Atlas**
(Database Access → Edit user → Edit password) antes de usar isso em produção
ou de subir este projeto para qualquer lugar público (GitHub, etc).
O arquivo `.env` já está no `.gitignore` para não ser commitado por engano.

## Estrutura

```
mapa-eleitoral-brasil/
├── server.js         # servidor Express + rotas da API + conexão MongoDB
├── seedData.js        # pesos populacionais usados para popular o banco na 1ª vez
├── package.json
├── .env                # variáveis de ambiente (string de conexão) — NÃO versionar
├── .env.example
└── public/
    ├── index.html        # página
    ├── style.css         # estilo (visual institucional)
    ├── app.js            # lógica do front-end (fala com a API)
    ├── mapPaths.js       # geometria SVG dos estados (contornos do mapa)
    └── baseline2022.js   # resultado oficial de 2022 por estado + regiões (referência para os p.p.)
```

## Como rodar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Confira o arquivo `.env` (já vem preenchido com a string de conexão que
   você passou). Se quiser usar outro banco/cluster, edite `MONGODB_URI`.
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Abra `http://localhost:3000` no navegador.

Na primeira execução, o servidor cria a coleção `states` no banco
`mapa_eleitoral` e semeia os 27 estados (com os pesos populacionais) sem
nenhuma pesquisa cadastrada — é aí que você começa a adicionar os dados reais.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/states` | Retorna todos os estados com peso e lista de pesquisas |
| POST | `/api/states/:uf/polls` | Adiciona uma pesquisa `{inst, date, lula, opp, cred}` ao estado `:uf` |
| DELETE | `/api/states/:uf/polls/:index` | Remove a pesquisa no índice `:index` do estado `:uf` |
| POST | `/api/reset` | Zera as pesquisas de todos os estados |

## Funcionalidades

- Visual em Material Design 3 (tema claro/escuro automático, navigation bar no celular).
- Mapa do Brasil com dois modos, alternáveis nos controles do topo:
  - **Intenção de voto**: colore cada estado pela média atual de Lula.
  - **Variação vs 2022**: colore cada estado pela variação em pontos percentuais (p.p.) de Lula frente ao resultado oficial de 2022 (verde = avanço, laranja/marrom = recuo).
- **Comparação com 2022 em cada estado**: o painel lateral mostra o resultado oficial de 2022 (Lula × Bolsonaro pai, votos válidos) lado a lado com a média atual (Lula × Flávio), e a variação em p.p. Os dados de referência de 2022 estão em `public/baseline2022.js`.
- **Peso por recência das pesquisas**: quanto mais antiga a pesquisa, menor o peso dela na média "ponderada" — o peso cai pela metade a cada 120 dias (meia-vida), com um piso mínimo para não zerar pesquisas antigas por completo. Esse percentual de peso aparece na tabela de pesquisas de cada estado (coluna "Peso rec."). É possível alternar para "Média simples" (sem decaimento) nos controles.
- Aba **Regiões**: cartões com a média ponderada de cada região (Norte, Nordeste, Centro-Oeste, Sudeste, Sul), comparando o resultado de 2022 com a média atual e a variação em p.p., além de um ranking dos estados com maior avanço/recuo de Lula.
- Aba **Ranking dos estados**: barras comparando todos os estados, com selo de variação vs 2022 ao lado de cada um.
- Aba **Linha do tempo**: evolução da média nacional consolidada por data.
- Dados persistidos no MongoDB — qualquer pessoa acessando o mesmo servidor vê os mesmos dados em tempo real (a cada ação, a página relê a API). Isso não muda: `baseline2022.js` é só referência estática do front-end, nada foi alterado no schema do Mongo, então as 71 pesquisas que você já tem cadastradas continuam funcionando normalmente.

### Sobre a meia-vida de 120 dias

O valor está no topo de `public/app.js`:

```js
const RECENCY_HALF_LIFE_DAYS = 120;
const RECENCY_FLOOR = 0.12;
```

Diminua `RECENCY_HALF_LIFE_DAYS` para pesquisas antigas perderem peso mais rápido, ou aumente para elas durarem mais. `RECENCY_FLOOR` é o peso mínimo que uma pesquisa muito antiga ainda mantém (12% por padrão).

## Precisão estatística — como funciona o agregador (atualização)

O painel usa as mesmas técnicas de agregadores de pesquisa profissionais
(FiveThirtyEight, RealClearPolitics, Split Ticket), adaptadas aos dados que
já existem — nenhum campo novo precisou ser cadastrado:

- **Efeito de casa (house effects)**: para cada pesquisa de um instituto num
  estado, compara-se o resultado dela com a média ponderada das pesquisas de
  TODOS OS OUTROS institutos no mesmo estado. A diferença média (ponderada
  por credibilidade × recência) é o viés sistemático do instituto — quanto
  ele tende a ficar acima/abaixo do consenso. Só é calculável quando 2+
  institutos pesquisam o mesmo estado. Veja a aba **Institutos**. A opção de
  cálculo "**+ efeito de casa**" (nos controles do topo) usa essa correção
  para dar uma média nacional mais precisa, removendo o viés conhecido de
  cada instituto antes de fazer a média.
- **Intervalo de confiança / "confiança da amostra"**: como o painel não tem
  o tamanho amostral de cada pesquisa, a forma estatisticamente honesta de
  medir incerteza é tratar as pesquisas de um estado como pontos de uma
  meta-amostra (mesma lógica de meta-análise de efeitos aleatórios):
  calcula-se o desvio-padrão ponderado das pesquisas em torno da média do
  estado, e o erro-padrão da média é esse desvio dividido pela raiz do
  número de pesquisas (`SE = σ / √n`). O IC95% exibido é `± 1,96 × SE`. Com
  1 pesquisa não há como estimar dispersão, então o selo mostra "dado
  preliminar" em vez de um número inventado.
- **Divergência entre institutos**: diferença simples entre a pesquisa mais
  alta e a mais baixa de Lula no estado (`max − min`).
- **Tendência simples**: seta ▲▼● comparando a primeira e a última pesquisa
  cadastrada do estado (independe da regressão usada na projeção nacional).
- **Selo de dado desatualizado**: quando a pesquisa mais recente do estado
  tem mais de `STALE_DAYS_THRESHOLD` dias (45 por padrão).
- **Estados decisivos**: estados com `|Lula − Flávio| < DECISIVE_MARGIN`
  p.p. (5 por padrão), na aba Ranking.
- **Métricas fixas no topo**: contagem regressiva até 25/10 e % do peso
  eleitoral nacional já coberto por pesquisa.
- **Última alternância de liderança nacional**: data em que a série
  consolidada nacional cruzou os 50% pela última vez, na aba Linha do tempo.

Todos os limiares (`STALE_DAYS_THRESHOLD`, `DECISIVE_MARGIN`, `Z95`) estão
no topo de `public/app.js` e podem ser ajustados livremente.

## Atualização: LOESS, cenários de margem de erro e Monte Carlo

- **Linha do tempo com LOESS** (regressão local, tricúbico + iterações robustas). Parâmetros no topo de `public/app.js`: `LOESS_SPAN`, `LOESS_DEGREE`, `LOESS_ROBUST_ITERS`. Os pontos continuam sendo os valores reais.
- **Cenário de margem de erro** (controle no topo): soma (ou subtrai) de Lula a margem de erro prevista de CADA estado (IC95% entre pesquisas; `FALLBACK_MOE` = 3 p.p. nos estados com 1 pesquisa). Afeta mapa, barra, ranking, regiões, projeções e correlação.
- **Aba Probabilidades**: simulação de Monte Carlo (10.000 rodadas) com erro nacional, regional e estadual; mostra chance de vitória, intervalo de 90%, histograma e os estados mais incertos. Parâmetros `MC_*` no topo do `app.js`.

## Detalhes finos (última rodada)

Vírgula decimal pt-BR em todo o texto; siglas das UFs no mapa; clique nas linhas do ranking/estados decisivos abre o estado; chance de vitória (Monte Carlo) no resumo; linha "hoje" na evolução; "há N dias" na última atualização; preferências (média/cenário/mapa) e aba na URL lembradas; esqueleto de carregamento; botão "voltar ao topo"; Enter envia o formulário e valida o campo de Lula.

## Segurança (senha de edição)

- Ler o painel é público; **adicionar, editar, remover pesquisas e limpar tudo exigem senha**. A senha é pedida na primeira ação; o token fica só em memória — F5, nova aba ou outro dispositivo pedem de novo.
- Só o **hash scrypt** (N=2^16, sal de 32 bytes) está no servidor (`admin.hash`, ou a variável `ADMIN_PASSWORD_HASH`). A senha não está no código nem no front-end.
- Comparação em tempo constante, sessão com token aleatório de 256 bits (no servidor só o SHA-256), expira em 2h sem uso / 12h no máximo, amarrada ao navegador.
- Anti força bruta: após 5 erros o IP é bloqueado (1, 2, 4… min, até 24h) + limite global de 60 tentativas/hora.
- Cabeçalhos de segurança (CSP, nosniff, DENY frame, HSTS em HTTPS) e corpo de requisição limitado a 4 KB.
- **Use HTTPS em produção** (a senha trafega na requisição de login). Atrás de proxy (Render, Railway…), defina `TRUST_PROXY=true`.
- Trocar a senha: `node tools/set-password.js "nova senha"`. Se hospedar via git, `admin.hash` está no `.gitignore`: copie o conteúdo para a variável `ADMIN_PASSWORD_HASH` no host.

## Mapa

A malha vem do IBGE (`/api/geo`, baixada uma vez pelo servidor e guardada em `data/geo-br-uf.json`). Se não carregar, usa os contornos antigos de `mapPaths.js`. Os rótulos ficam no centro do maior círculo inscrito de cada estado; RN, PB, PE, AL, SE, ES e RJ, quando pequenos, ganham rótulo externo com linha-guia.

## Extras (rodada 3)

- **Sair** (cabeçalho, aparece após o login): encerra a sessão de edição na hora.
- **Auto-atualização** a cada 60 s e ao voltar para a aba (pausa com modal aberto), para vários aparelhos verem o mesmo dado.
- **Exportar CSV** de todas as pesquisas (Excel pt-BR, `;` e UTF-8) e **Copiar resumo** pronto para WhatsApp.
- **Desfazer** ao remover uma pesquisa (8 s).
- Atalho **/** foca a seleção de estado.
- **Histórico de alterações** no servidor (coleção `audit`, guarda 90 dias): `GET /api/audit` com sessão de edição ativa.

## Modo app no celular

- Barra inferior com as 6 abas (safe-area de iPhone/Android), mapa na primeira tela, resumo em chips com rolagem lateral.
- Toque num estado → painel sobe como **gaveta** (arraste para baixo, toque fora ou no X para fechar).
- **Puxar para atualizar** no topo, vibração leve ao selecionar, campos 16 px (sem zoom no iOS), alvos de toque ≥ 44 px.
- **Instalável** (PWA): no Chrome/Android "Instalar app"; no iOS Safari "Compartilhar → Adicionar à Tela de Início". Abre em tela cheia, com cache da interface (`sw.js`). Precisa de HTTPS.

## Rodada 5 — correções e detalhes

- Celular: o resumo grande só aparece na aba Mapa (nas outras sobra espaço para o conteúdo); gráficos de evolução, probabilidade e correlação mantêm tamanho legível e rolam na horizontal.
- Título da aba do navegador muda conforme a seção; toque em "Paraíba" (nome no painel) compartilha/copia o link `?uf=PB`, que já abre o estado.
- Teclado: ← → navega entre estados com o painel aberto; foco visível em tudo; números tabulares nas tabelas.
- Aviso de offline/online, estado selecionado destacado no mapa, vibração leve ao trocar de aba.
