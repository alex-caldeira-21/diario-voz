# diario-voz

Diário por voz e "segunda memória" pessoal. Falo (ou digito) fatos do dia,
ideias, decisões e lembretes pelo celular ou pelo PC; cada entrada é
classificada por IA, gravada numa Google Sheet e levada para o vault do
Obsidian como nota diária. Também dá para perguntar ao diário em linguagem
natural.

Especificação completa: [SPEC.md](SPEC.md). Roteiro de teste manual:
[TESTES.md](TESTES.md).

- App: https://alex-caldeira-21.github.io/diario-voz/
- Repositório: https://github.com/alex-caldeira-21/diario-voz

## Como funciona

```
docs/ (PWA no GitHub Pages)  ──POST text/plain──►  Apps Script (web app)
  ditado Web Speech API                              ├─ API Anthropic (classificar / perguntar)
  fila IndexedDB + Background Sync                   └─ Google Sheet "diario" (fila)
                                                              ▲
sync/sheet_to_obsidian.py  ──POST (pendentes/marcar)──────────┘
  tarefa agendada → escreve .md no vault → chama obsidian-sync.ps1 (git do vault)
```

Nenhuma entrada se perde:
- **Sem sinal:** a entrada fica no IndexedDB do aparelho e é enviada quando a
  rede volta, mesmo com o app fechado (Background Sync).
- **Falha da IA:** a entrada é gravada como `registro` com
  `classificado=FALSE`, e um gatilho a cada 6 h reclassifica.
- **Reenvio:** o `id` (UUID gerado no aparelho) torna o registro idempotente,
  na planilha e no vault.

## Estrutura

| Pasta | O quê |
|---|---|
| `apps-script/` | Backend: `doPost`, planilha, chamadas ao Claude, `setup()`, testes manuais |
| `docs/` | PWA servido pelo GitHub Pages (HTML, CSS e JS puros, sem build) |
| `sync/` | Script Python que leva as entradas para o Obsidian e a tarefa agendada |
| `.githooks/` | `pre-commit` que bloqueia chaves e tokens |

## Identificadores

| Item | Valor |
|---|---|
| Projeto Apps Script | `diario-voz`, scriptId em [.clasp.json](.clasp.json) |
| **deploymentId** | `AKfycbwc9HYvopw6fVH0EK8MbPD7d7QFj15rZU5stIMdRDRb3uPfaTL90NV2QUtiXnmq8ls` |
| URL do web app | `https://script.google.com/macros/s/AKfycbwc9HYvopw6fVH0EK8MbPD7d7QFj15rZU5stIMdRDRb3uPfaTL90NV2QUtiXnmq8ls/exec` |
| Planilha | `diario-voz`, aba `diario` (o link aparece no log do `setup()`) |

O `deploymentId` nunca muda: o app no celular guarda a URL.

---

## Setup do zero

Pré-requisitos no PC (Windows 11): Git, Node.js LTS (para o clasp) e Python 3.11+.

### 1. Apps Script

1. Ative a Apps Script API em https://script.google.com/home/usersettings.
2. Instale e autentique o clasp (as credenciais ficam em
   `%USERPROFILE%\.clasprc.json`, nunca no repositório):
   ```bash
   npm install -g @google/clasp
   clasp login
   ```
3. Envie o código. Para um projeto novo, apague o `.clasp.json` e rode
   `clasp create-script --type standalone --title diario-voz --rootDir apps-script`
   (guarde uma cópia de `apps-script/appsscript.json`, porque o create a sobrescreve).
   ```bash
   clasp push --force
   ```
4. Crie a chave em https://console.anthropic.com/settings/keys (com faturamento ativo).
5. No editor (`clasp open-script` ou o link do projeto): **Configurações do
   projeto** (engrenagem) → **Propriedades do script** → **Adicionar
   propriedade do script**, com `ANTHROPIC_KEY` = a chave. **Nunca** cole a
   chave no código.
6. No editor, abra `Setup.gs`, escolha `setup` e clique em **Executar**.
   Autorize (Avançado → Acessar diario-voz). O registro de execução mostra o
   link da planilha, o `APP_TOKEN` e `Falta: nada`.
7. Primeiro deployment (só uma vez):
   ```bash
   clasp create-deployment --description "diario-voz web app"
   ```
8. Rode as funções de `Testes.gs` no editor (veja [TESTES.md](TESTES.md)).

### 2. PWA

1. GitHub → **Settings** → **Pages** → **Deploy from a branch** → `main` / `/docs`.
2. No Android (Chrome), abra a URL do Pages → **⋮** → **Instalar app**.
3. No app, em **Ajustes**: cole a URL `/exec` e o token → **Testar conexão**.

### 3. Sync com o Obsidian

```bash
cd sync
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

Preencha o `sync/.env` (ignorado pelo git):

| Variável | Valor |
|---|---|
| `APPS_SCRIPT_URL` | URL `/exec` |
| `APP_TOKEN` | token de 64 caracteres |
| `VAULT_PATH` | raiz do vault, hoje `E:\05-Notas\Obsidian\Ideias` |
| `PASTA_DIARIO` | `60-Pessoal/diario` |
| `SYNC_SCRIPT` | `E:\05-Notas\obsidian-sync.ps1` (vazio para não acionar o git do vault) |
| `TAREFAS_FORMATO` | `tasks` (Obsidian Tasks, `📅 AAAA-MM-DD`) ou `simples` (`(até DD/MM)`) |

Rode uma vez, confira a nota e instale as tarefas agendadas:

```bash
.venv\Scripts\python sheet_to_obsidian.py
powershell -ExecutionPolicy Bypass -File instalar_tarefa.ps1
```

São registradas `DiarioVozSync` (no logon, com 2 min de atraso) e
`DiarioVozSync2h` (a cada 2 h). As notas ficam em
`{VAULT}/{PASTA_DIARIO}/{AAAA}/{AAAA-MM-DD}.md`.

### 4. Hook de segurança

Depois de clonar o repositório:

```bash
git config core.hooksPath .githooks
```

O hook procura, nos arquivos staged, chaves da Anthropic e um `APP_TOKEN`
preenchido (o padrão exato está em [.githooks/pre-commit](.githooks/pre-commit))
e bloqueia o commit se encontrar algo. O `SPEC.md` e o próprio hook ficam de
fora porque citam o padrão; não escreva o padrão literal em outros arquivos.

---

## Manutenção

### Atualizar o app (PWA)

O service worker serve tudo do cache (cache-first). Para o celular receber
uma versão nova:

1. Edite os arquivos em `docs/`.
2. **Aumente `VERSAO` em [docs/sw.js](docs/sw.js)** (por exemplo, `'1'` → `'2'`).
   Sem isso, o celular continua com os arquivos antigos.
3. Se criar um arquivo novo em `docs/`, inclua-o na lista `SHELL` do `sw.js`.
4. Commit e push. O GitHub Pages publica em 1–2 min.
5. No celular, feche e abra o app: o service worker novo instala, apaga o
   cache antigo e assume. A versão aparece no rodapé de **Ajustes**.

### Atualizar o Apps Script sem mudar a URL

```bash
clasp push
clasp create-deployment --deploymentId AKfycbwc9HYvopw6fVH0EK8MbPD7d7QFj15rZU5stIMdRDRb3uPfaTL90NV2QUtiXnmq8ls --description "o que mudou"
```

Nunca rode `create-deployment` sem `--deploymentId`: isso cria uma URL nova.

### Trocar o token

1. No editor do Apps Script: **Propriedades do script** → apague `APP_TOKEN`.
2. Rode `setup()`. Ele gera um token novo e mostra no registro de execução.
3. Atualize o token no app (**Ajustes** → **Testar conexão**) e no `sync/.env`.

As entradas que estiverem na fila do celular continuam lá e são enviadas
assim que o token novo for salvo.

### Trocar a chave da Anthropic ou o modelo

- Chave: edite `ANTHROPIC_KEY` nas Propriedades do script. Não precisa de
  novo deployment.
- Modelo: edite `MODELO` (padrão `claude-haiku-4-5`).

### Reclassificar entradas

Entradas gravadas quando a IA falhou ficam com `classificado=FALSE`. O
gatilho `gatilhoReclassificar` roda a cada 6 h (até 50 por vez). Para rodar
na hora, execute `gatilhoReclassificar` no editor.

A reclassificação corrige só a planilha: se o sync já tiver levado a entrada
para o vault, a nota mantém `(registro)` e sem tags.

### Logs

| Onde | O quê |
|---|---|
| `sync/logs/AAAA-MM.log` | cada execução do sync (nunca contém o token) |
| Apps Script → **Execuções** | chamadas ao web app, erros e o gatilho de 6 h |
| Agendador de Tarefas → `DiarioVozSync*` | último resultado (0 = ok) |

---

## Solução de problemas

| Sintoma | Causa e solução |
|---|---|
| "Token incorreto" em Testar conexão | Token diferente do `APP_TOKEN`. Copie de novo do log do `setup()`. |
| "A URL não respondeu como o web app" | URL errada ou sem `/exec`, ou deployment com acesso restrito. |
| "Sem conexão para o ditado" | O ditado do Chrome precisa de internet. Use o microfone do teclado; a entrada vai para a fila. |
| Microfone bloqueado | Chrome → ⋮ → Configurações → Configurações do site → Microfone → permitir. |
| App não atualiza no celular | Faltou aumentar `VERSAO` no `sw.js`. |
| Entrada "recusada pelo servidor" em Recentes | O servidor rejeitou a entrada (por exemplo, texto acima de 10.000 caracteres). Ela fica na fila para você ver. |
| `fatal: detected dubious ownership` | A pasta pertence a outro usuário do Windows (instalação antiga). `git config --global --add safe.directory <pasta>` ou `takeown` como administrador. |
| Tarefa agendada não roda | Confira o último resultado no Agendador e o `sync/logs/`. O caminho do Python é o `sync\.venv\Scripts\pythonw.exe`. |

---

## Diferenças em relação ao SPEC

Decisões tomadas durante a implementação, com o motivo:

- **Escopo `script.scriptapp`** no `appsscript.json`: necessário para o
  `setup()` criar o gatilho de 6 h.
- **Ação `ping`** no Apps Script: confere token e chave sem tocar na planilha
  (usada por "Testar conexão").
- **Dia da semana na mensagem de classificar** e definição explícita de
  `trabalho` e `registro` no prompt: fatos técnicos sem ação pendente eram
  classificados como `registro`.
- **Texto gravado como texto puro** na planilha (formato `@` e apóstrofo de
  prefixo para `=` e `+`), para o Sheets não converter datas nem criar fórmulas.
- **Paleta do tema claro escurecida**: as cores originais do espectro não
  passavam no contraste WCAG sobre o fundo claro (ciano 1,9:1, amarelo 1,3:1).
  O anel do microfone usa as cores vivas nos dois temas.
- **Alvo de compartilhamento**: o Android substitui a query da URL, então o
  app reconhece o compartilhamento pela presença de `titulo`, `texto` ou `url`
  (o `?origem=compartilhar` continua aceito).
- **Service worker como módulo** (Chrome/Edge 91+), para reaproveitar
  `fila.js` e `api.js` no Background Sync.
- **Toast no topo** e **"Desfazer" no Limpar**.
- **Navegação com ícone e nome**: no celular, barra fixa embaixo (zona do
  polegar); no PC (≥ 768 px), barra de pílulas no topo. As abas de texto no
  topo do SPEC ficavam escondidas.
- **Python do venv** (`sync/.venv`) em vez do lançador `py`, que não existe
  nesta máquina; tarefas criadas com `Register-ScheduledTask` porque o espaço
  em "Segunda Memoria" quebra as aspas do `schtasks /tr` no PowerShell 5.1.
- **Lembretes no Obsidian com o texto literal** do ditado (o exemplo do SPEC
  mostrava um texto resumido, o que contrariaria a regra de nunca reescrever).
- **`tzdata`** no `requirements.txt`: no Windows o `zoneinfo` não tem os fusos.
- **Lighthouse 12+ não tem mais a categoria PWA**: a instalabilidade é
  verificada instalando o app (veja [TESTES.md](TESTES.md)).
