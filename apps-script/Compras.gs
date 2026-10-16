// Lista de compras contínua no Google Tasks (lista "Compras").
// Regras: nunca usar Tasks.Tasks.remove nem clear; só inserir e marcar como concluído.
// Falha aqui nunca derruba o registro: a linha fica com compras_resultado vazio e
// sincronizarLembretes() reprocessa depois.

const NOME_LISTA_COMPRAS = 'Compras';

function normalizar(nome) {
  return semAcento_(nome).toLowerCase().replace(/\s+/g, ' ').trim();
}

// "leite (2 litros)" -> "leite"
function nomeDoTitulo_(titulo) {
  return String(titulo).replace(/\s*\([^)]*\)\s*$/, '');
}

function escaparRegex_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// O nome normalizado do item aberto contém o item procurado como palavra(s) inteira(s).
function contemItem_(nomeAberto, procurado) {
  return new RegExp('(^|[^a-z0-9])' + escaparRegex_(procurado) + '($|[^a-z0-9])').test(nomeAberto);
}

// [{ id, titulo, nome }] dos itens em aberto.
function itensAbertos_(listaId) {
  const itens = [];
  let pagina = null;
  do {
    const r = Tasks.Tasks.list(listaId, {
      showCompleted: false, showHidden: false, maxResults: 100, pageToken: pagina || undefined
    });
    (r.items || []).forEach(function (t) {
      if (t.status === 'completed' || !t.title) return;
      itens.push({ id: t.id, titulo: t.title, nome: normalizar(nomeDoTitulo_(t.title)) });
    });
    pagina = r.nextPageToken;
  } while (pagina);
  return itens;
}

/**
 * Aplica a ação de compras de uma entrada na lista do Google Tasks.
 * @param {{ criado_em: string, compras: {acao, itens}, lembrete_data?: string, lembrete_hora?: string }} l
 * @param {{ listaId?: string, criarEvento?: boolean }} opcoes  criarEvento=false só calcula o evento (testes)
 * @return resultado { acao, adicionados, ja_na_lista, concluidos, nao_encontrados, ambiguos, evento }
 */
function aplicarCompras(l, opcoes) {
  opcoes = opcoes || {};
  const listaId = opcoes.listaId || PROPS.getProperty('COMPRAS_LIST_ID');
  if (!listaId) throw new Error('COMPRAS_LIST_ID ausente. Rode setup() no editor.');
  const c = l.compras;
  const r = { acao: c ? c.acao : null, adicionados: [], ja_na_lista: [], concluidos: [],
    nao_encontrados: [], ambiguos: [], evento: null };
  if (!c || !c.itens || !c.itens.length) return r;

  const abertos = itensAbertos_(listaId);

  if (c.acao === 'adicionar') {
    const quando = l.criado_em.substring(8, 10) + '/' + l.criado_em.substring(5, 7) + ' ' + l.criado_em.substring(11, 16);
    c.itens.forEach(function (item) {
      const n = normalizar(item.nome);
      if (abertos.some(function (a) { return a.nome === n; })) {
        r.ja_na_lista.push(item.nome);
        return;
      }
      const titulo = item.quantidade ? item.nome + ' (' + item.quantidade + ')' : item.nome;
      const t = Tasks.Tasks.insert({ title: titulo, notes: 'Diário ' + quando }, listaId);
      abertos.push({ id: t.id, titulo: titulo, nome: n });
      r.adicionados.push(titulo);
    });
  } else if (c.acao === 'concluir') {
    c.itens.forEach(function (item) {
      const n = normalizar(item.nome);
      const achados = abertos.filter(function (a) { return contemItem_(a.nome, n); });
      if (achados.length === 1) {
        Tasks.Tasks.patch({ status: 'completed' }, listaId, achados[0].id);
        abertos.splice(abertos.indexOf(achados[0]), 1);
        r.concluidos.push(achados[0].titulo);
      } else if (!achados.length) {
        r.nao_encontrados.push(item.nome);
      } else {
        r.ambiguos.push({ item: item.nome, candidatos: achados.map(function (a) { return a.titulo; }) });
      }
    });
  }

  if (l.lembrete_data) {
    r.evento = eventoCompras_(l.lembrete_data, l.lembrete_hora, abertos, opcoes.criarEvento !== false);
  }
  return r;
}

// UM evento "Compras (N itens)" com a lista atual. Sem hora, vira evento de dia inteiro.
function eventoCompras_(data, hora, abertos, criar) {
  const n = abertos.length;
  const titulo = 'Compras (' + n + (n === 1 ? ' item)' : ' itens)');
  const descricao = abertos.map(function (a) { return '- ' + a.titulo; }).join('\n') +
    '\n\nMarque os itens no Google Tasks: ' + NOME_LISTA_COMPRAS;
  const ev = { titulo: titulo, data: data, hora: hora || null };
  if (!criar) return ev;
  const cal = CalendarApp.getDefaultCalendar();
  if (hora) {
    const inicio = Utilities.parseDate(data + ' ' + hora, FUSO, 'yyyy-MM-dd HH:mm');
    cal.createEvent(titulo, inicio, new Date(inicio.getTime() + 3600 * 1000), { description: descricao });
  } else {
    cal.createAllDayEvent(titulo, Utilities.parseDate(data, FUSO, 'yyyy-MM-dd'), { description: descricao });
  }
  return ev;
}

// Texto curto para a coluna compras_resultado.
function resumoCompras_(r) {
  const partes = [];
  if (r.adicionados.length) partes.push('adicionados: ' + r.adicionados.join(', '));
  if (r.ja_na_lista.length) partes.push('já na lista: ' + r.ja_na_lista.join(', '));
  if (r.concluidos.length) partes.push('concluídos: ' + r.concluidos.join(', '));
  if (r.nao_encontrados.length) partes.push('não encontrado: ' + r.nao_encontrados.join(', '));
  r.ambiguos.forEach(function (a) { partes.push('ambíguo: ' + a.candidatos.join(', ')); });
  if (r.evento) partes.push('evento: ' + r.evento.data + (r.evento.hora ? ' ' + r.evento.hora : ''));
  return partes.join(' | ') || 'sem itens';
}

// Aplica as compras de uma linha já gravada e registra o resumo. Lança erro se falhar.
function aplicarComprasDaLinha_(sh, linha) {
  const r = aplicarCompras(linha);
  gravarCelulas_(sh, linha._linha, coluna_('compras_resultado'), [resumoCompras_(r)]);
  return r;
}

// Reprocessa linhas tipo=compra cujo compras_resultado ficou vazio (Tasks fora do ar,
// lista ainda não criada, reclassificação que virou compra). Chamado pelo gatilho de 6 h.
function sincronizarLembretes() {
  if (!PROPS.getProperty('COMPRAS_LIST_ID')) return { ok: true, compras_reprocessadas: 0, aviso: 'COMPRAS_LIST_ID ausente' };
  const sh = aba_();
  const pendentes = lerLinhas_().filter(function (l) {
    return l.tipo === 'compra' && l.compras_json && !l.compras_resultado;
  }).slice(0, 50);
  let feitas = 0;
  let erro = null;
  for (let i = 0; i < pendentes.length; i++) {
    const l = pendentes[i];
    l.compras = lerComprasJson_(l.compras_json);
    try {
      aplicarComprasDaLinha_(sh, l);
      feitas++;
    } catch (err) {
      erro = err.message;
      break;
    }
  }
  SpreadsheetApp.flush();
  const r = { ok: true, compras_reprocessadas: feitas, restantes: pendentes.length - feitas };
  if (erro) r.aviso = erro;
  return r;
}

const RE_PERGUNTA_COMPRAS_ = /(^|[^a-z])(compra|compras|comprar|mercado|supermercado|feira|falta comprar|faltando comprar)([^a-z]|$)/;

function ehPerguntaDeCompras_(pergunta) {
  return RE_PERGUNTA_COMPRAS_.test(normalizar(pergunta));
}

// Usado pelo setup(): reaproveita uma lista "Compras" existente ou cria uma.
function obterOuCriarLista_(titulo) {
  let pagina = null;
  do {
    const r = Tasks.Tasklists.list({ maxResults: 100, pageToken: pagina || undefined });
    const achada = (r.items || []).filter(function (l) { return l.title === titulo; })[0];
    if (achada) return { id: achada.id, criada: false };
    pagina = r.nextPageToken;
  } while (pagina);
  return { id: Tasks.Tasklists.insert({ title: titulo }).id, criada: true };
}
