// Ações sobre a planilha: registrar, recentes, perguntar, pendentes, marcar, reclassificar.
// Regra: nunca apagar linhas. Só acrescentar e mudar status/classificação.

function acaoRegistrar_(req) {
  const id = String(req.id || '').trim().toLowerCase();
  if (!RE_UUID.test(id)) return erro_('id_invalido', 'O id precisa ser um UUID v4.');

  const criadoEm = String(req.criado_em || '').trim();
  if (!RE_ISO.test(criadoEm) || isNaN(new Date(criadoEm).getTime())) {
    return erro_('criado_em_invalido', 'criado_em precisa estar em ISO 8601 com fuso.');
  }

  const texto = typeof req.texto === 'string' ? req.texto.trim() : '';
  if (!texto) return erro_('texto_vazio', 'O texto está vazio.');
  if (texto.length > MAX_TEXTO) return erro_('texto_grande', 'O texto passou de 10.000 caracteres.');

  const origem = ORIGENS.indexOf(req.origem) >= 0 ? req.origem : 'windows';

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return erro_('ocupado', 'Servidor ocupado. Tente de novo em instantes.');
  }
  let resposta, sh, linhaCompras = null;
  try {
    sh = aba_();
    const existente = linhaDoId_(sh, id);
    if (existente) {
      const tipo = String(sh.getRange(existente, COL.tipo).getValue());
      return { ok: true, duplicado: true, tipo: tipo };
    }

    // Falha da IA nunca impede a gravação: entra como registro, reprocessável depois.
    let c = { tipo: 'registro', tags: [], lembrete_data: '', lembrete_hora: '', compras: null };
    let classificado = false;
    try {
      c = classificar(texto, criadoEm);
      classificado = true;
    } catch (err) {
      console.warn('classificar falhou: ' + err.message);
    }

    const linha = sh.getLastRow() + 1;
    gravarCelulas_(sh, linha, 1, [
      id, criadoEm, agoraIso_(), c.tipo, c.tags.join(', '), texto,
      c.lembrete_data || '', origem, 'inbox', classificado ? 'TRUE' : 'FALSE'
    ]);
    gravarCelulas_(sh, linha, coluna_('lembrete_hora'), [c.lembrete_hora || '']);
    if (c.compras) gravarCelulas_(sh, linha, coluna_('compras_json'), [JSON.stringify(c.compras)]);
    SpreadsheetApp.flush();

    resposta = {
      ok: true, tipo: c.tipo, tags: c.tags,
      lembrete_data: c.lembrete_data || null, lembrete_hora: c.lembrete_hora || null,
      classificado: classificado
    };
    if (c.compras) {
      linhaCompras = { _linha: linha, criado_em: criadoEm, compras: c.compras,
        lembrete_data: c.lembrete_data, lembrete_hora: c.lembrete_hora };
    }
  } finally {
    lock.releaseLock();
  }

  // Depois de gravar e fora do lock: a entrada já está salva, e uma falha do
  // Google Tasks fica para sincronizarLembretes().
  if (linhaCompras) {
    try {
      resposta.compras = aplicarComprasDaLinha_(sh, linhaCompras);
    } catch (err) {
      console.warn('aplicarCompras falhou: ' + err.message);
      resposta.compras = { erro: true };
    }
  }
  return resposta;
}

function acaoRecentes_(req) {
  const limite = inteiro_(req.limite, 20, 1, 200);
  const linhas = lerLinhas_();
  ordenarPorCriado_(linhas, -1);
  return { ok: true, entradas: linhas.slice(0, limite).map(objetoPublico_) };
}

function acaoPendentes_() {
  const linhas = lerLinhas_().filter(function (l) { return l.status === 'inbox'; });
  ordenarPorCriado_(linhas, 1);
  return { ok: true, entradas: linhas.map(objetoPublico_) };
}

function acaoMarcar_(req) {
  if (!Array.isArray(req.ids)) return erro_('ids_invalidos', 'ids precisa ser uma lista.');
  const alvo = {};
  req.ids.slice(0, 5000).forEach(function (id) { alvo[String(id).toLowerCase()] = true; });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return erro_('ocupado', 'Servidor ocupado. Tente de novo em instantes.');
  }
  try {
    const sh = aba_();
    const ultima = sh.getLastRow();
    if (ultima < 2) return { ok: true, marcados: 0 };

    const ids = sh.getRange(2, COL.id, ultima - 1, 1).getValues();
    const status = sh.getRange(2, COL.status, ultima - 1, 1);
    const valores = status.getValues();
    let marcados = 0;
    for (let i = 0; i < ids.length; i++) {
      if (alvo[String(ids[i][0]).toLowerCase()]) {
        valores[i][0] = 'processado';
        marcados++;
      }
    }
    if (marcados) {
      status.setNumberFormat('@');
      status.setValues(valores);
      SpreadsheetApp.flush();
    }
    return { ok: true, marcados: marcados };
  } finally {
    lock.releaseLock();
  }
}

// Reprocessa entradas gravadas sem classificação (IA indisponível no momento do registro).
// Para no primeiro erro da API para não gastar 50 chamadas com uma chave inválida.
function acaoReclassificar_() {
  const pendentes = lerLinhas_().filter(function (l) { return !l.classificado; }).slice(0, 50);
  const sh = aba_();
  let reclassificados = 0;
  let erro = null;

  for (let i = 0; i < pendentes.length; i++) {
    const l = pendentes[i];
    let c;
    try {
      c = classificar(l.texto, l.criado_em);
    } catch (err) {
      erro = err.message;
      break;
    }
    // Confere que a linha ainda é a mesma antes de escrever (linhas nunca são apagadas,
    // mas a checagem protege contra edição manual da planilha).
    if (String(sh.getRange(l._linha, COL.id).getValue()).toLowerCase() !== l.id.toLowerCase()) continue;
    gravarCelulas_(sh, l._linha, COL.tipo, [c.tipo, c.tags.join(', ')]);
    gravarCelulas_(sh, l._linha, COL.lembrete_data, [c.lembrete_data || '']);
    gravarCelulas_(sh, l._linha, coluna_('lembrete_hora'), [c.lembrete_hora || '']);
    // Se virou compra, sincronizarLembretes() aplica na lista (compras_resultado vazio).
    if (c.compras) gravarCelulas_(sh, l._linha, coluna_('compras_json'), [JSON.stringify(c.compras)]);
    gravarCelulas_(sh, l._linha, COL.classificado, ['TRUE']);
    reclassificados++;
  }
  SpreadsheetApp.flush();

  const r = { ok: true, reclassificados: reclassificados, restantes: pendentes.length - reclassificados };
  if (erro) r.aviso = 'A IA falhou: ' + erro;
  return r;
}

// Chamado pelo gatilho de tempo criado no setup().
function gatilhoReclassificar() {
  const r = acaoReclassificar_();
  console.log('reclassificar: ' + JSON.stringify(r));
  const s = sincronizarLembretes();
  console.log('sincronizarLembretes: ' + JSON.stringify(s));
}

function acaoPerguntar_(req) {
  const pergunta = typeof req.pergunta === 'string' ? req.pergunta.trim() : '';
  if (!pergunta) return erro_('pergunta_vazia', 'A pergunta está vazia.');
  if (pergunta.length > 2000) return erro_('pergunta_grande', 'A pergunta passou de 2.000 caracteres.');
  const dias = inteiro_(req.dias, 30, 1, 365);

  // Perguntas sobre compras são respondidas pela lista aberta do Google Tasks.
  const listaId = PROPS.getProperty('COMPRAS_LIST_ID');
  if (listaId && ehPerguntaDeCompras_(pergunta)) {
    const itens = itensAbertos_(listaId).map(function (a) { return a.titulo; });
    const resp = itens.length ? perguntarCompras(pergunta, itens) : 'A lista de compras está vazia.';
    return { ok: true, resposta: resp, usadas: itens.length, fonte: 'compras' };
  }

  const corte = Date.now() - dias * 24 * 3600 * 1000;
  const janela = lerLinhas_().filter(function (l) {
    const t = new Date(l.criado_em).getTime();
    return !isNaN(t) && t >= corte;
  });
  ordenarPorCriado_(janela, -1);

  const selecionadas = selecionarEntradas_(janela, pergunta, 400);
  if (!selecionadas.length) {
    return {
      ok: true, usadas: 0,
      resposta: 'Não encontrei nenhum registro nos últimos ' + dias + ' dias.'
    };
  }
  ordenarPorCriado_(selecionadas, 1);

  const resposta = perguntar(pergunta, selecionadas, dias);
  return { ok: true, resposta: resposta, usadas: selecionadas.length };
}

// Prioriza entradas que contêm termos da pergunta (4+ letras, sem acento, sem caixa)
// e completa com as mais recentes até o teto. `linhas` vem da mais nova para a mais antiga.
function selecionarEntradas_(linhas, pergunta, teto) {
  const termos = termosDaPergunta_(pergunta);
  if (!termos.length) return linhas.slice(0, teto);

  const comPontos = linhas.map(function (l, i) {
    const alvo = semAcento_(l.texto + ' ' + l.tags).toLowerCase();
    let pontos = 0;
    termos.forEach(function (t) { if (alvo.indexOf(t) >= 0) pontos++; });
    return { l: l, i: i, pontos: pontos };
  });

  const relevantes = comPontos.filter(function (x) { return x.pontos > 0; })
    .sort(function (a, b) { return b.pontos - a.pontos || a.i - b.i; });
  const resto = comPontos.filter(function (x) { return x.pontos === 0; });

  return relevantes.concat(resto).slice(0, teto).map(function (x) { return x.l; });
}

const PALAVRAS_VAZIAS_ = ['aconteceu', 'acontecer', 'quando', 'sobre', 'quais', 'onde', 'como',
  'semana', 'passada', 'passado', 'esta', 'essa', 'esse', 'este', 'isso', 'isto', 'para',
  'pelo', 'pela', 'tenho', 'tive', 'foram', 'ultimo', 'ultima', 'ultimos', 'ultimas',
  'dias', 'hoje', 'ontem', 'algum', 'alguma', 'alguem', 'fazer', 'feito', 'teve', 'tinha',
  'qual', 'porque', 'entao', 'mais', 'menos', 'muito', 'pouco', 'registrei', 'registro',
  'falei', 'disse', 'anotei', 'ainda', 'depois', 'antes', 'todos', 'todas', 'tudo'];

function termosDaPergunta_(pergunta) {
  const vistos = {};
  return semAcento_(pergunta).toLowerCase().split(/[^a-z0-9]+/).filter(function (t) {
    if (t.length < 4 || PALAVRAS_VAZIAS_.indexOf(t) >= 0 || vistos[t]) return false;
    vistos[t] = true;
    return true;
  });
}

function ordenarPorCriado_(linhas, direcao) {
  linhas.sort(function (a, b) {
    return direcao * (new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime());
  });
}
