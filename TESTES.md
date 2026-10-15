# Roteiro de teste manual

Tudo o que for salvo durante os testes vai para a planilha e, depois, para o
vault. Linhas da planilha nunca são apagadas, então use frases que você não se
importe de guardar (por exemplo, começando com `[teste]`).

## Critérios de aceite (SPEC seção 12)

| # | Critério | Status | Como foi verificado |
|---|---|---|---|
| 1 | Entrada ditada offline aparece na planilha com o `criado_em` original, depois que a rede volta, sem reabrir o app | ok (14/10/2026) | Teste D3 no Android |
| 2 | Reenviar o mesmo id não gera uma segunda linha | ok (14/10/2026) | `testeRegistrar()` |
| 3 | Com a `ANTHROPIC_KEY` inválida, a entrada é salva com `classificado=FALSE` e reclassificada depois | **pendente** | Teste B |
| 4 | Rodar o sync duas vezes seguidas não duplica nada no vault | ok (14/10/2026) | pytest + execução real + simulação de queda antes do `marcar` |
| 5 | Nenhum segredo no repositório | ok (14/10/2026) | `git grep` limpo + hook `pre-commit` testado com chave falsa |
| 6 | App instalável no Android, com atalhos e alvo de compartilhamento | ok (14/10/2026) | Testes D1, D4, D5 |
| 7 | Tema claro e escuro, movimento reduzido respeitado, Lighthouse Acessibilidade ≥ 95 | temas e Lighthouse ok; **movimento reduzido pendente** | Teste F (Lighthouse: 100) e teste E3 |

---

## A. Apps Script (`Testes.gs`)

No editor do Apps Script, abra `Testes.gs`, escolha a função e clique em
**Executar**. Cada verificação aparece no registro como `OK` ou `FALHOU`.

| Função | O que confere | Esperado |
|---|---|---|
| `testeTokenInvalido` | token errado, sem token, ação inválida, corpo > 20 KB, ping | 5 × OK |
| `testeRegistrar` | gravação, reenvio do mesmo id, texto só com `trim()`, data ISO preservada, textos começando com `=`, `+`, `-`, `0012` | 11 × OK (as linhas de teste são marcadas como `processado`) |
| `testeClassificar` | as 5 frases do SPEC | 5 × OK; um `aviso` de tipo diferente do esperado não é falha |
| `testePerguntar` | perguntar, recentes, pendentes | 3 × OK |

Resultado em 14/10/2026: todos OK. Depois do ajuste do prompt, a frase 5
(atenuação no enlace) passou a vir como `trabalho`.

## B. Reclassificação quando a IA falha (critério 3)

A forma mais segura de simular a falha é trocar o **modelo** por um nome
inexistente: a API responde com erro igual ao de uma chave inválida, e você não
precisa mexer na chave.

1. Editor do Apps Script → **Configurações do projeto** → **Propriedades do
   script** → **Editar propriedades do script**.
2. Mude `MODELO` para `modelo-inexistente` e salve.
3. No app, salve a entrada `[teste] reclassificação com IA fora do ar`.
   - Esperado: toast "Salvo como registro".
4. Na planilha, na linha nova:
   - Esperado: `tipo=registro`, `tags` vazio, `classificado=FALSE`.
5. Volte `MODELO` para `claude-haiku-4-5` e salve.
6. No editor, abra `Diario.gs`, escolha `gatilhoReclassificar` e clique em **Executar**.
   - Esperado no registro: `reclassificar: {"ok":true,"reclassificados":1,...}`.
7. Na planilha, a mesma linha:
   - Esperado: `classificado=TRUE`, com `tipo` e `tags` preenchidos pela IA.

Para testar com a chave em vez do modelo: troque `ANTHROPIC_KEY` por
`chave-invalida`, repita os passos 3 e 4, volte a chave verdadeira e siga do
passo 6. Guarde a chave verdadeira antes.

Limitação conhecida: se o sync levar a entrada para o vault antes da
reclassificação (ele roda a cada 2 h), a nota mantém `(registro)` e sem tags.
A reclassificação corrige só a planilha.

## C. Python (`sync/`)

```bash
cd sync
.venv\Scripts\python -m pytest -q
```

Esperado: `14 passed`. Cobre nota nova, nota existente com conteúdo manual, id
repetido, lembrete com e sem data, entrada offline (criado_em antigo chegando
depois) na posição certa e agrupamento pelo dia de São Paulo.

Sync real: `.venv\Scripts\python sheet_to_obsidian.py` duas vezes seguidas. A
segunda deve registrar `nenhuma entrada pendente`.

## D. PWA no Android (Chrome)

URL: https://alex-caldeira-21.github.io/diario-voz/

| # | Passo | Esperado | Status |
|---|---|---|---|
| D1 | ⋮ → **Instalar app**; abrir pelo ícone | Abre em tela cheia; no primeiro uso vai para **Ajustes** | ok |
| D2 | Em 4G: tocar no anel, ditar, tocar de novo, **Salvar** | Vibra ao gravar; texto parcial em lilás; ao parar o texto fica editável; toast "Salvo como …" e o anel pisca na cor do tipo | ok |
| D3 | Modo avião → ditar pelo microfone do Gboard → **Salvar** → fechar o app → desligar o modo avião → esperar 1–2 min sem abrir | Mensagem "Sem conexão…", contador "1 na fila"; a linha aparece na planilha com o horário em que foi falada | ok |
| D4 | WhatsApp → segurar uma mensagem → **Compartilhar** → **Diário** | O texto aparece no campo, sem salvar sozinho; origem `compartilhar` na planilha | ok |
| D5 | Segurar o ícone do app | Atalhos **Ditar** (abre gravando) e **Perguntar** | ok |
| D6 | **Recentes** | Linha do tempo por dia, barra do espectro do dia, faixas coloridas, chips de tags; pendentes locais como "na fila" | não relatado |
| D7 | **Perguntar** sobre algo registrado, período de 30 dias | Resposta citando a data (DD/MM) e "Baseado em N entradas" | não relatado (o backend passou no `testePerguntar`) |

## E. Windows

| # | Passo | Esperado | Status |
|---|---|---|---|
| E1 | Abrir a URL no **Chrome** e no **Edge**; instalar pelo ícone de instalação na barra de endereço | Instala como app; ditado pelo anel funciona; origem `windows` na planilha | pendente |
| E2 | Clicar no campo de texto e usar **Win+H** (digitação por voz do Windows) | O texto ditado entra no campo; **Salvar** funciona | pendente |
| E3 | **Configurações** → **Acessibilidade** → **Efeitos visuais** → desligar **Efeitos de animação**; reabrir o app | O anel para de girar; ao ditar, os pulsos viram uma leve troca de opacidade | pendente |
| E4 | **Ajustes** → Tema **Claro** e **Escuro**; depois **Sistema** | As cores mudam na hora; em Sistema segue o tema do Windows | ok |

No Android, o equivalente ao E3 é **Configurações** → **Acessibilidade** →
**Remover animações**.

## F. Lighthouse

Chrome no PC → abrir a URL → **F12** → aba **Lighthouse** → modo **Navigation**,
dispositivo **Mobile**, categorias **Accessibility** (e as demais, se quiser)
→ **Analyze page load**. Para auditar a tela Registrar sem configurar o app,
use `https://alex-caldeira-21.github.io/diario-voz/?texto=teste`.

Resultado em 14/10/2026 (Lighthouse 13.5, mobile):

| Tela | Acessibilidade | Boas práticas | Desempenho |
|---|---|---|---|
| Ajustes (primeiro uso) | 100 | 100 | 98 (LCP 1,8 s, CLS 0) |
| Registrar | 100 | — | — |

A partir da versão 12, o Lighthouse não tem mais a categoria PWA. A
instalabilidade é comprovada pelo teste D1 ou em **F12** → **Application** →
**Manifest** (sem avisos de instalação).
