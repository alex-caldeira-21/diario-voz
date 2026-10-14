# diario-voz: especificação para o Claude Code

> Como usar este arquivo: salve-o na raiz do repositório como `SPEC.md` e
> inicie o Claude Code com: "Leia o SPEC.md inteiro e execute a Fase 1.
> Pare em cada CHECKPOINT."

---

## 0. Regras de trabalho (leia antes de tudo)

1. Trabalhe **por fases** (seção 11). Ao fim de cada fase, mostre o que foi
   feito, rode os testes da fase e **pare**.
2. Em todo ponto marcado como **CHECKPOINT (usuário)**, pare e diga
   exatamente o que eu preciso clicar ou digitar, com a URL e o nome do
   menu. Não tente contornar login, consentimento OAuth ou telas web.
3. **Nunca** escreva chaves, tokens ou senhas em arquivo versionado, log,
   commit ou saída de terminal. Segredos vivem só em Script Properties
   (Apps Script) e no `.env` local (ignorado pelo git).
4. **Nunca** apague linhas da planilha nem arquivos do vault. Operações
   permitidas: criar, acrescentar e marcar status.
5. **Nunca** reescreva, resuma ou "melhore" o texto que eu ditei. O texto
   é gravado como recebido (apenas `trim()`).
6. Ambiente: **Windows 11** no PC (PowerShell) e **Android + Chrome** no
   celular. Não há suporte a iOS. Use o `py` como lançador do Python.
7. Sem frameworks nem etapa de build no front-end: HTML, CSS e JS puros
   (ES2022, módulos nativos). Motivo: o GitHub Pages serve arquivos
   estáticos, o app precisa funcionar offline e sem build não há
   dependências para manter.
8. Antes de usar comandos do clasp, rode `clasp --version` e use a sintaxe
   da versão instalada (os comandos mudaram entre a 2.x e a 3.x).

---

## 1. Objetivo

Um diário por voz e "segunda memória" pessoal. Eu falo (ou digito) fatos
do dia, ideias, decisões e lembretes pelo celular ou pelo PC. Cada entrada
é classificada por IA e gravada numa Google Sheet, que funciona como fila.
Quando o PC liga, um script leva as entradas para o meu vault do Obsidian
como notas diárias em Markdown. Também posso perguntar ao diário em
linguagem natural ("o que aconteceu no POP de Pederneiras semana
passada?").

Requisito crítico: **nenhuma entrada pode ser perdida**. Isso vale para
falta de sinal (uso em campo, em POPs no interior), para falha da API do
Claude e para reenvio duplicado.

---

## 2. Arquitetura

```
docs/ (PWA no GitHub Pages)  ──POST text/plain──►  Apps Script (web app)
  ditado Web Speech API                              ├─ API Anthropic (classificar / perguntar)
  fila IndexedDB + Background Sync                   └─ Google Sheet "diario" (fila)
                                                              ▲
sync/sheet_to_obsidian.py  ──POST (pendentes/marcar)──────────┘
  roda no logon do Windows → escreve .md no vault → chama obsidian-sync.ps1
```

Decisões fixas:
- **O PWA fica em `docs/`**, porque o GitHub Pages só publica a raiz ou a
  pasta `/docs`, sem Actions. O repositório precisa ser **público** (Pages
  em repo privado exige plano pago). Portanto o repo não pode conter
  nenhum segredo. A URL do web app e o token são digitados no app no
  primeiro uso.
- **Um único tipo de credencial** no sistema: o `APP_TOKEN`. O script
  Python também fala só com o Apps Script, sem service account e sem
  Google Cloud Console.
- **`Content-Type: text/plain`** em todas as chamadas ao Apps Script. Com
  `application/json`, o navegador dispara um preflight CORS (`OPTIONS`)
  que o Apps Script não responde.

---

## 3. Estrutura do repositório

```
diario-voz/
├─ SPEC.md
├─ README.md
├─ .gitignore              # .env, .clasprc.json, __pycache__/, *.log, sync/state/
├─ docs/                   # PWA (GitHub Pages)
│  ├─ index.html
│  ├─ app.js               # UI, roteamento por abas, estado
│  ├─ voz.js               # wrapper da Web Speech API
│  ├─ fila.js              # IndexedDB: entradas pendentes + config (token, url)
│  ├─ api.js               # chamadas ao Apps Script, timeout, retry
│  ├─ estilo.css
│  ├─ sw.js                # service worker: cache offline + Background Sync
│  ├─ manifest.json
│  ├─ fontes/              # woff2 self-hosted (necessário offline)
│  └─ icones/              # 192, 512, maskable-512, ícones dos atalhos
├─ apps-script/
│  ├─ appsscript.json
│  ├─ Code.gs              # doPost, roteamento, utilitários
│  ├─ Diario.gs            # registrar, recentes, pendentes, marcar
│  ├─ Claude.gs            # classificar, perguntar
│  ├─ Setup.gs             # setup() idempotente
│  └─ Testes.gs            # funções de teste manuais rodáveis no editor
└─ sync/
   ├─ sheet_to_obsidian.py
   ├─ nota.py              # formatação Markdown (pura, testável)
   ├─ test_nota.py         # pytest
   ├─ requirements.txt     # requests, python-dotenv, pytest
   ├─ .env.example
   └─ instalar_tarefa.ps1  # registra a tarefa agendada
```

---

## 4. Planilha (aba `diario`)

| Col | Campo | Tipo | Observação |
|---|---|---|---|
| A | id | UUID v4 | Gerado **no cliente**; garante idempotência |
| B | criado_em | ISO 8601 com offset (`2026-10-14T08:32:10-03:00`) | Momento em que eu falei, não o momento do upload |
| C | recebido_em | ISO 8601 | Quando chegou no Apps Script |
| D | tipo | enum | registro, trabalho, lembrete, ideia, decisao, pessoal |
| E | tags | texto | separadas por `, `, kebab-case, até 3 |
| F | texto | texto | literal, até 10.000 caracteres |
| G | lembrete_data | `AAAA-MM-DD` ou vazio | só para tipo=lembrete com data |
| H | origem | enum | android, windows, compartilhar |
| I | status | enum | inbox → processado |
| J | classificado | TRUE/FALSE | FALSE quando a IA falhou (reprocessável) |

Motivo de `criado_em` vir do cliente: uma entrada gravada offline às 10h
e enviada às 15h tem que aparecer às 10h no diário.

Datas são gravadas **como texto ISO**, não como objeto `Date`. Isso evita
que o Sheets converta fuso ou formato e garante que o Python leia sem
ambiguidade.

---

## 5. Apps Script

### 5.1 `appsscript.json`

```json
{
  "timeZone": "America/Sao_Paulo",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ],
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

### 5.2 Script Properties

| Chave | Quem define |
|---|---|
| `SHEET_ID` | `setup()` |
| `APP_TOKEN` | `setup()` (`Utilities.getUuid()` + `Utilities.getUuid()` concatenados, sem hífens) |
| `ANTHROPIC_KEY` | **eu, manualmente** (Configurações do projeto → Propriedades do script) |
| `MODELO` | `setup()`, padrão `claude-haiku-4-5` |

### 5.3 `setup()` (idempotente)
- Cria a planilha `diario-voz` com a aba `diario`, o cabeçalho da seção 4,
  a linha 1 congelada e a coluna F com quebra de texto, **somente se**
  `SHEET_ID` não existir.
- Cria `APP_TOKEN` e `MODELO` somente se não existirem.
- Loga a URL da planilha, o token e uma lista do que falta (por exemplo,
  `ANTHROPIC_KEY`).
- Pode ser rodada várias vezes sem efeito colateral.

### 5.4 `doPost(e)`: contrato

Requisição (corpo JSON enviado como text/plain):
```json
{ "acao": "registrar", "token": "...", ...campos }
```

Resposta, sempre HTTP 200 com JSON:
```json
{ "ok": true, ...dados }
{ "ok": false, "erro": "codigo_curto", "msg": "texto para humano" }
```

Validações de entrada (falha → `ok:false`):
- corpo com mais de 20 KB → `payload_grande`
- token ausente ou diferente → `nao_autorizado`. Comparar em tempo
  constante (percorrer todos os caracteres) para não vazar informação
  pelo tempo de resposta.
- `acao` desconhecida → `acao_invalida`

### 5.5 Ações

**`registrar`**: `{ id, criado_em, texto, origem }`
1. `LockService.getScriptLock().waitLock(10000)`.
2. Se o `id` já existe na coluna A → `{ ok:true, duplicado:true }`.
3. Chama `classificar(texto)` com tratamento de erro. **Se a API falhar,
   grava assim mesmo** com `tipo=registro`, `tags=""`,
   `classificado=FALSE`. A entrada nunca é perdida por falha da IA.
4. `appendRow` e retorna `{ ok:true, tipo, tags, lembrete_data }`.

**`recentes`**: `{ limite = 20 }` → últimas N linhas, da mais nova para a
mais antiga (id, criado_em, tipo, tags, texto, lembrete_data, status).

**`perguntar`**: `{ pergunta, dias = 30 }`
1. Lê as linhas com `criado_em` dentro da janela.
2. Se a pergunta contiver termos com 4 letras ou mais, prioriza as linhas
   que os contenham (sem acento, sem diferenciar maiúsculas). Completa com
   as mais recentes até o teto.
3. Teto de **400 entradas**. Cálculo: 400 × ~60 tokens = ~24 mil tokens de
   entrada. Custo por pergunta no Haiku 4.5: 24.000 × US$ 1/M = US$ 0,024,
   mais ~500 tokens de saída × US$ 5/M = US$ 0,0025, total ≈ **US$ 0,027**.
4. Chama `perguntar()` no Claude e retorna `{ ok:true, resposta,
   usadas: n }`.

**`pendentes`**: `{}` → todas as linhas com `status=inbox`.

**`marcar`**: `{ ids: [...] }` → muda o status para `processado`. Ids que
não existem são ignorados. Retorna `{ ok:true, marcados: n }`.

**`reclassificar`**: `{}` → reprocessa até 50 linhas com
`classificado=FALSE`. Também pode ser disparada por um gatilho de tempo a
cada 6 horas, criado pelo `setup()` se ainda não existir.

### 5.6 Chamada ao Claude (`Claude.gs`)

```javascript
UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
  method: 'post',
  contentType: 'application/json',
  muteHttpExceptions: true,
  headers: {
    'x-api-key': PROPS.getProperty('ANTHROPIC_KEY'),
    'anthropic-version': '2023-06-01'
  },
  payload: JSON.stringify({ model, max_tokens, system, messages })
});
```
- HTTP diferente de 200 → lança um erro com o status e as primeiras 200
  letras do corpo, **sem a chave**.
- Faz o parse do JSON removendo cercas de código ``` antes.

**System prompt de `classificar`** (com `max_tokens: 150`):
```
Você classifica entradas de um diário pessoal de um técnico de
infraestrutura de telecom (POPs, datacenters, nobreaks, fibra óptica) que
também estuda, empreende e tem vida pessoal.
Responda SOMENTE com JSON válido, sem texto extra:
{"tipo": "...", "tags": ["..."], "lembrete_data": "AAAA-MM-DD" | null}
- tipo: um de registro, trabalho, lembrete, ideia, decisao, pessoal.
  "lembrete" = algo que a pessoa precisa fazer ou lembrar no futuro.
- tags: 1 a 3, kebab-case, minúsculas, sem acento; prefira nomes próprios
  citados (cidade/POP, equipamento, projeto).
- lembrete_data: só se houver prazo; resolva datas relativas ("sexta",
  "amanhã") usando a data de referência fornecida.
```
Mensagem do usuário: `Data de referência: {criado_em}\nEntrada: {texto}`.

**System prompt de `perguntar`** (com `max_tokens: 800`):
```
Você responde perguntas sobre o diário pessoal do usuário usando SOMENTE
as entradas fornecidas. Cite a data (DD/MM) de cada fato usado. Se a
resposta não estiver nas entradas, diga que não encontrou registro sobre
isso no período. Nunca invente. Português do Brasil, direto, sem
introdução.
```
As entradas vão no formato `[AAAA-MM-DD HH:mm] (tipo; tags) texto`, uma
por linha.

### 5.7 Deploy
- Crie **um** deployment de web app e, a partir daí, **sempre atualize
  esse mesmo ID**. A URL não pode mudar, porque o app no celular a guarda.
- Registre o `deploymentId` no README.
- `.clasp.json` (que contém o scriptId) pode ser versionado.
  `.clasprc.json` **nunca** (contém tokens OAuth e fica no `%USERPROFILE%`).

---

## 6. PWA (`docs/`)

### 6.1 Telas (abas no topo)

1. **Registrar** (padrão): data de hoje, contador de pendentes, área de
   texto grande com a transcrição ao vivo e o botão de microfone na zona
   do polegar (parte inferior central). Botões "Salvar" e "Limpar".
2. **Perguntar**: campo de pergunta (também com microfone), seletor de
   período (7 / 30 / 90 dias) e resposta renderizada.
3. **Recentes**: linha do tempo das últimas 20 entradas, agrupadas por
   dia, mais as pendentes locais marcadas como "na fila".
4. **Ajustes** (ícone de engrenagem): URL do web app, token (campo de
   senha, com botão para mostrar), "Testar conexão", "Enviar fila agora" e
   versão do app.

Primeiro uso: se não houver URL e token, abrir direto em Ajustes com uma
explicação curta de onde pegar cada um.

### 6.2 Voz (`voz.js`)

```javascript
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
rec.lang = 'pt-BR';
rec.continuous = false;      // continuous=true repete resultados no Chrome Android
rec.interimResults = true;
// enquanto o estado for "gravando", reiniciar em onend
```
- Toque no microfone alterna gravar/parar. Ao parar, o texto fica
  editável. **Nunca salvar automaticamente.**
- Erro `network` → aviso: "Sem conexão para o ditado. Use o microfone do
  teclado; a entrada vai para a fila." O campo continua utilizável.
- Erro `not-allowed` → instrução para liberar o microfone nas
  configurações do site no Chrome.
- **Não** usar `getUserMedia`/`AnalyserNode` para animar o nível de áudio.
  No Android, abrir o microfone duas vezes ao mesmo tempo pode derrubar o
  reconhecimento. A animação reage aos eventos `onresult`.
- Se não houver suporte a SpeechRecognition, esconder o botão e mostrar
  só o campo de texto.

### 6.3 Fila (`fila.js` + `sw.js`)
- IndexedDB `diario-voz`, com as stores `pendentes` (keyPath `id`) e
  `config` (url, token). O token fica no IndexedDB, **não no
  localStorage**, porque o service worker não acessa o localStorage e
  precisa do token para o Background Sync.
- Ao salvar: gerar `id = crypto.randomUUID()` e `criado_em` com offset
  local, gravar em `pendentes`, tentar enviar na hora e, se falhar,
  registrar `sync.register('enviar-fila')`.
- Reenviar também nos eventos `online`, `visibilitychange` (visible) e ao
  abrir o app.
- Remover da fila **somente** após `ok:true` (incluindo `duplicado:true`).
- `api.js`: timeout de 20 s com `AbortController`, backoff 2 s → 8 s →
  30 s.
- Service worker: cache do app shell (HTML, CSS, JS, fontes, ícones) com
  estratégia cache-first e versionamento por constante `VERSAO`. Chamadas
  ao Apps Script **nunca** passam pelo cache.

### 6.4 Integração com o Android (`manifest.json`)
- `display: standalone`, `start_url: "./"`, `scope: "./"`, `lang: "pt-BR"`,
  `theme_color` e `background_color` iguais à cor `tinta` (seção 7).
- Ícones 192, 512 e `maskable` 512.
- `share_target` (GET; params `title→titulo`, `text→texto`, `url→url`). Ao
  abrir com `?origem=compartilhar`, preencher o campo com o conteúdo e
  `origem=compartilhar`, sem salvar automaticamente.
- `shortcuts`: "Nova entrada por voz" (`./?modo=voz`), "Perguntar ao
  diário" (`./?modo=perguntar`).
- Feedback tátil: `navigator.vibrate(15)` ao começar a gravar e
  `navigator.vibrate([10, 40, 10])` ao salvar.
- `origem`: `android` se o userAgent contiver Android, senão `windows`.

---

## 7. Direção visual: "Espectro"

**Conceito.** O app é de um técnico de fibra óptica. Cada tipo de entrada
recebe uma cor do espectro, como os canais de um DWDM. O diário vira um
espectro do dia: dias de muito trabalho ficam ciano, dias de ideias ficam
violeta. A cor tem significado, não é decoração.

**O elemento memorável é o botão de microfone.** Um anel em
`conic-gradient` com todas as cores do espectro. Parado, gira lentamente
(1 volta a cada 20 s). Gravando, acelera e a cada `onresult` dá um pulso
de escala (1 → 1,06 → 1) em 180 ms. Ao salvar, o anel inteiro assume
por 400 ms a cor do tipo classificado. Esse é o **único** movimento não
disparado por ação do usuário. Todo o resto da interface fica quieta e
disciplinada.

### 7.1 Paleta (tokens em `:root`)

| Token | Escuro (padrão) | Claro |
|---|---|---|
| `--tinta` (fundo) | `#16133D` (índigo profundo) | `#F6F5FF` |
| `--superficie` | `#221E55` | `#FFFFFF` |
| `--linha` | `#3A3580` | `#DDDAF5` |
| `--texto` | `#F4F2FF` | `#1C1846` |
| `--texto-2` | `#B9B4E8` | `#5B5690` |

Espectro (o mesmo nos dois temas, ajustando a luminosidade só se o
contraste falhar):

| Tipo | Token | Hex |
|---|---|---|
| trabalho | `--c-trabalho` | `#2EC4F1` ciano |
| lembrete | `--c-lembrete` | `#FFD23F` amarelo |
| ideia | `--c-ideia` | `#8B5CF6` violeta |
| decisao | `--c-decisao` | `#3DDC97` verde |
| pessoal | `--c-pessoal` | `#FF3D9A` magenta |
| registro | `--c-registro` | `#FF8A3D` laranja |

- Tema: `prefers-color-scheme` + seletor manual em Ajustes
  (`:root[data-theme]`), salvo no IndexedDB.
- Contraste: o texto sobre as cores do espectro precisa atingir WCAG AA.
  Os chips de tipo usam fundo da cor com 18% de opacidade, borda sólida da
  cor e texto em `--texto`.

### 7.2 Tipografia (self-hosted em `docs/fontes/`, woff2, para funcionar offline)
- **Bricolage Grotesque** (variável): títulos e a data do dia. A data é o
  título da tela Registrar, grande (clamp 2.2rem–3.2rem), peso 700, eixo
  de largura condensado. Por exemplo: "Terça, 14 de outubro".
- **Atkinson Hyperlegible**: todo o resto. Escolhida pela legibilidade
  sob sol forte, em campo.
- Escala: 0.875 / 1 / 1.25 / 1.6 / 2.2 rem. Corpo com 1rem e
  line-height 1.55. Linhas com no máximo ~70 caracteres.
- Transcrição ao vivo em 1.25rem. O texto parcial (ainda não finalizado)
  aparece em `--texto-2` e o final em `--texto`.

### 7.3 Layout
```
┌────────────────────────────┐
│ Registrar  Perguntar  Rec. ⚙│  abas (indicador = barra do espectro)
│                            │
│ Terça,                     │  data em Bricolage, alinhada à esquerda
│ 14 de outubro              │
│ 2 na fila                  │  só aparece se > 0, cor --c-lembrete
│ ┌────────────────────────┐ │
│ │ transcrição ao vivo…   │ │  área de texto, cresce até 40vh
│ └────────────────────────┘ │
│                            │
│          ( ◉ )             │  anel do espectro, 88px, zona do polegar
│   Limpar        Salvar     │
└────────────────────────────┘
```
- Alinhamento à esquerda em tudo, exceto o microfone, que fica centrado.
- **Recentes**: linha do tempo com uma faixa vertical de 4px na cor do
  tipo à esquerda de cada entrada, hora em `--texto-2` e chips de tags.
  Sem cartões idênticos com sombra. A separação entre entradas é feita
  por espaço, não por caixas.
- Cabeçalho por dia: o nome do dia e, ao lado, uma **barra de espectro do
  dia** de 6px de altura, proporcional à quantidade de cada tipo. Esse é
  o "espectro do dia".
- Raio de borda com hierarquia: 999px (microfone e chips), 16px (área de
  texto), 0 (faixas da linha do tempo).
- Respeitar as áreas seguras do Android (`env(safe-area-inset-*)`) e
  `viewport-fit=cover`.

### 7.4 Texto da interface (português, sentence case, voz ativa)
- Botões: "Salvar" → toast "Salvo como trabalho". "Testar conexão" →
  "Conexão ok" ou o erro específico.
- Offline: "Sem conexão. A entrada ficou na fila e será enviada quando a
  rede voltar."
- Vazio em Recentes: "Nada registrado ainda. Toque no microfone e conte
  como foi o dia."
- Evitar: rótulos em CAIXA ALTA, setas "→" em botões, fonte monoespaçada
  decorativa, metadados separados por "·", emojis na interface.

### 7.5 Qualidade mínima
- Foco de teclado visível (anel de 2px em `--c-trabalho`).
- `prefers-reduced-motion`: o anel para de girar e os pulsos viram uma
  troca de opacidade.
- Alvos de toque com no mínimo 48×48 px.
- Lighthouse PWA instalável e Acessibilidade ≥ 95.

---

## 8. Sincronização com o Obsidian (`sync/`)

### 8.1 `.env.example`
```
APPS_SCRIPT_URL=
APP_TOKEN=
VAULT_PATH=C:\caminho\do\vault
PASTA_DIARIO=60-Pessoal/diario
SYNC_SCRIPT=C:\caminho\obsidian-sync.ps1
TAREFAS_FORMATO=tasks
```

### 8.2 Fluxo de `sheet_to_obsidian.py`
1. `POST {acao: "pendentes"}`. Se a lista vier vazia, sai com código 0.
2. Agrupa por data de `criado_em` (fuso `America/Sao_Paulo`).
3. Para cada dia, abre ou cria
   `{VAULT}/{PASTA_DIARIO}/{AAAA}/{AAAA-MM-DD}.md`.
4. **Idempotência:** cada entrada é escrita com o marcador
   `<!-- id:UUID -->`. Antes de escrever, verifica se o id já está no
   arquivo. Se estiver, pula. Isso garante que rodar duas vezes não
   duplica nada.
5. Insere as entradas em ordem cronológica na seção `## Entradas`.
   Lembretes com data também entram na seção `## Lembretes` como tarefa.
6. Escreve num arquivo temporário e depois faz `os.replace`, uma escrita
   atômica para não corromper a nota se o processo cair no meio.
7. Só depois de **todos** os arquivos gravados: `POST {acao: "marcar",
   ids}`.
8. Se `SYNC_SCRIPT` estiver definido, executa
   `powershell -NoProfile -ExecutionPolicy Bypass -File "<SYNC_SCRIPT>"`.
9. Log em `sync/logs/AAAA-MM.log` (rotação mensal). Nunca logar o token.

Ordem importante: escrever primeiro e marcar depois. Se cair entre os
dois passos, na próxima execução a entrada volta como pendente, e o
marcador de id evita a duplicata. O inverso perderia dados.

### 8.3 Formato da nota diária (`nota.py`, funções puras)
```markdown
---
tipo: diario
data: 2026-10-14
tags: [diario, pop-pederneiras, nobreak]
---

# Terça, 14 de outubro de 2026

## Entradas

### 08:32 (trabalho)
<!-- id:3f6c... -->
Nobreak do POP Pederneiras com alarme de bateria, agendar troca.
#pop-pederneiras #nobreak

## Lembretes

- [ ] Agendar troca de bateria do nobreak Pederneiras 📅 2026-10-17
```
- As `tags` do frontmatter são a união das tags do dia, sem repetição,
  com `diario` sempre presente. Atualizar a cada execução.
- Lembretes: com `TAREFAS_FORMATO=tasks`, usar `📅 AAAA-MM-DD` (formato do
  plugin Obsidian Tasks). Com `simples`, usar `(até DD/MM)`.
- Se a nota do dia já existir com conteúdo manual, **preservar tudo** e
  apenas inserir nas seções. Se uma seção não existir, criá-la no final.

### 8.4 `instalar_tarefa.ps1`
```powershell
schtasks /create /tn "DiarioVozSync" /sc onlogon /delay 0002:00 /rl LIMITED /f `
  /tr "py `"$PSScriptRoot\sheet_to_obsidian.py`""
```
O atraso de 2 minutos existe porque o Wi-Fi ainda pode não estar
conectado logo após o logon. Adicione também uma segunda tarefa a cada
2 horas (`/sc hourly /mo 2`), para o PC que fica ligado o dia inteiro.

---

## 9. Segurança

- `APP_TOKEN` com 64 caracteres hexadecimais. Para trocar, apague a
  propriedade, rode `setup()` de novo e atualize o app e o `.env`.
- A `ANTHROPIC_KEY` nunca sai do Apps Script e nunca aparece em
  respostas ou logs.
- Repositório público: rodar `git grep -nE "sk-ant|APP_TOKEN=.+"` antes de
  cada commit (adicione como hook `pre-commit` simples).
- CSP no `index.html`: `default-src 'self'; connect-src
  https://script.google.com https://script.googleusercontent.com;
  font-src 'self'; img-src 'self' data:`. O `script.googleusercontent.com`
  é necessário porque o Apps Script responde com um redirect para esse
  domínio.
- Limite de tamanho do texto: 10.000 caracteres no cliente e no
  servidor.

---

## 10. Testes

- **Apps Script (`Testes.gs`):** `testeRegistrar()` (inclui reenvio do
  mesmo id), `testeClassificar()` com 5 frases reais (abaixo),
  `testePerguntar()`, `testeTokenInvalido()`.
- **Python:** pytest em `nota.py` cobrindo nota nova, nota existente com
  conteúdo manual, id repetido, lembrete com e sem data e ordem
  cronológica com entrada offline (criado_em antigo chegando depois).
- **PWA (roteiro manual que você me entrega no fim):** instalar no
  Android; ditar com 4G; modo avião → ditar pelo Gboard → salvar → fechar
  o app → desligar o modo avião → confirmar o envio pelo Background Sync;
  compartilhar uma mensagem do WhatsApp para o app; usar os atalhos do
  ícone; testar no Windows (Chrome e Edge) e com Win+H.

Frases para `testeClassificar()`:
1. "Nobreak do POP Pederneiras alarmando bateria baixa, preciso agendar troca até sexta"
2. "Ideia: cardápio digital com QR code para os restaurantes da consultoria"
3. "Decidi migrar o formulário de preventiva do PowerApps para Excel"
4. "Levei a Athena no veterinário, tudo certo"
5. "Atenuação no enlace Bauru–Jaú subiu 3 dB desde ontem"

---

## 11. Fases e checkpoints

**Fase 1: Apps Script**
1. Criar `apps-script/` completo.
2. **CHECKPOINT (usuário):** ativar a Apps Script API em
   https://script.google.com/home/usersettings.
3. `clasp login`. **CHECKPOINT (usuário):** autorizar no navegador.
4. Criar o projeto e fazer `push`.
5. **CHECKPOINT (usuário):** criar a chave em console.anthropic.com
   (com faturamento ativo), abrir o editor, adicionar `ANTHROPIC_KEY` nas
   Propriedades do script, rodar `setup()`, aceitar a tela "app não
   verificado" (Avançado → Acessar), copiar o token do log.
6. Criar o deployment e me passar a URL `/exec`.
7. Rodar as funções de `Testes.gs` (eu rodo no editor, você me diz quais).

**Fase 2: PWA**
1. Implementar `docs/` seguindo as seções 6 e 7. Antes de escrever o CSS,
   me mostre os tokens finais e um wireframe ASCII revisado.
2. Servir localmente (`py -m http.server 8080 -d docs`) e testar no
   desktop via `http://localhost:8080`.
3. **CHECKPOINT (usuário):** criar o repositório público no GitHub e
   ativar o Pages em Settings → Pages → Branch `main` / pasta `/docs`.
4. Push e testar no Android pela URL do Pages (HTTPS é obrigatório para o
   microfone e o service worker).

**Fase 3: Sync**
1. Implementar `sync/` com os testes pytest passando.
2. **CHECKPOINT (usuário):** preencher o `.env`.
3. Rodar manualmente uma vez, conferir a nota gerada no vault e então
   rodar `instalar_tarefa.ps1`.

**Fase 4: Fechamento**
- README com setup completo, `deploymentId`, como trocar o token e como
  atualizar o app (aumentar `VERSAO` no sw.js).
- Roteiro de teste manual da seção 10.

---

## 12. Critérios de aceite

- [ ] Uma entrada ditada offline aparece na planilha com o `criado_em`
      original, depois que a rede volta e sem eu reabrir o app.
- [ ] Reenviar o mesmo id não gera uma segunda linha.
- [ ] Com a `ANTHROPIC_KEY` inválida, a entrada é salva com
      `classificado=FALSE` e é reclassificada depois.
- [ ] Rodar o sync duas vezes seguidas não duplica nada no vault.
- [ ] Nenhum segredo no repositório (`git grep` limpo).
- [ ] O app é instalável no Android, com atalhos e alvo de
      compartilhamento funcionando.
- [ ] Tema claro e escuro, movimento reduzido respeitado, Lighthouse
      Acessibilidade ≥ 95.
