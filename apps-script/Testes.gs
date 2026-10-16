// Testes manuais: selecione a função no editor e clique em Executar.
// Resultado no "Registro de execução". Cada teste termina com OK ou FALHOU.
// As linhas de teste ficam na planilha (nunca apagamos linhas) e são marcadas
// como "processado" para não irem para o Obsidian.

function testeRegistrar() {
  const id = Utilities.getUuid();
  const base = { acao: 'registrar', token: tokenTeste_(), id: id, criado_em: agoraIso_(), origem: 'windows' };

  const r1 = chamar_(Object.assign({}, base, { texto: '  [teste] Troquei o filtro do ar-condicionado do POP Bauru  ' }));
  Logger.log('1º envio: ' + JSON.stringify(r1));
  confere_(r1.ok === true && !r1.duplicado, '1º envio grava');

  const r2 = chamar_(Object.assign({}, base, { texto: 'texto diferente, mesmo id' }));
  Logger.log('Reenvio do mesmo id: ' + JSON.stringify(r2));
  confere_(r2.ok === true && r2.duplicado === true, 'reenvio do mesmo id não duplica');

  const linhasDoId = lerLinhas_().filter(function (l) { return l.id === id; });
  confere_(linhasDoId.length === 1, 'existe exatamente 1 linha com o id');
  confere_(linhasDoId[0].texto === '[teste] Troquei o filtro do ar-condicionado do POP Bauru', 'texto gravado só com trim()');
  confere_(RE_ISO.test(linhasDoId[0].criado_em), 'criado_em continua texto ISO (não virou Date)');

  // Textos que o Sheets poderia interpretar como fórmula ou número precisam voltar idênticos.
  const ids = [id];
  ['=1+1 [teste] não é fórmula', '+55 14 [teste]', '- [teste] item de lista', '0012 [teste]'].forEach(function (texto) {
    const outro = Utilities.getUuid();
    ids.push(outro);
    const r = chamar_(Object.assign({}, base, { id: outro, texto: texto }));
    const lida = lerLinhas_().filter(function (l) { return l.id === outro; })[0];
    confere_(r.ok && lida && lida.texto === texto, 'texto literal: ' + JSON.stringify(texto) +
      (lida && lida.texto !== texto ? ' (lido: ' + JSON.stringify(lida.texto) + ')' : ''));
  });

  const m = chamar_({ acao: 'marcar', token: tokenTeste_(), ids: ids.concat(['id-que-nao-existe']) });
  confere_(m.ok && m.marcados === ids.length, 'marcar ignora id inexistente (' + m.marcados + ' marcados)');
}

function testeClassificar() {
  const frases = [
    'Nobreak do POP Pederneiras alarmando bateria baixa, preciso agendar troca até sexta',
    'Ideia: cardápio digital com QR code para os restaurantes da consultoria',
    'Decidi migrar o formulário de preventiva do PowerApps para Excel',
    'Levei a Athena no veterinário, tudo certo',
    'Atenuação no enlace Bauru–Jaú subiu 3 dB desde ontem'
  ];
  const esperado = ['lembrete', 'ideia', 'decisao', 'pessoal', 'trabalho'];
  const agora = agoraIso_();
  frases.forEach(function (f, i) {
    const c = classificar(f, agora);
    Logger.log(JSON.stringify(c) + '  <- ' + f);
    confere_(TIPOS.indexOf(c.tipo) >= 0 && c.tags.length >= 1 && c.tags.length <= 3, 'formato válido (frase ' + (i + 1) + ')');
    if (c.tipo !== esperado[i]) Logger.log('  aviso: esperado "' + esperado[i] + '" (não é erro, só confira)');
  });
}

function testePerguntar() {
  const r = chamar_({ acao: 'perguntar', token: tokenTeste_(), pergunta: 'O que aconteceu no POP Bauru?', dias: 30 });
  Logger.log(JSON.stringify(r, null, 2));
  confere_(r.ok === true && typeof r.resposta === 'string', 'perguntar responde');

  const rec = chamar_({ acao: 'recentes', token: tokenTeste_(), limite: 5 });
  Logger.log('recentes: ' + rec.entradas.length + ' entradas');
  confere_(rec.ok === true && Array.isArray(rec.entradas), 'recentes responde');

  const pend = chamar_({ acao: 'pendentes', token: tokenTeste_() });
  confere_(pend.ok === true && Array.isArray(pend.entradas), 'pendentes responde (' + pend.entradas.length + ')');
}

function testeTokenInvalido() {
  const r1 = chamar_({ acao: 'recentes', token: 'errado' });
  confere_(!r1.ok && r1.erro === 'nao_autorizado', 'token errado -> nao_autorizado');

  const r2 = chamar_({ acao: 'recentes' });
  confere_(!r2.ok && r2.erro === 'nao_autorizado', 'sem token -> nao_autorizado');

  const r3 = chamar_({ acao: 'apagar', token: tokenTeste_() });
  confere_(!r3.ok && r3.erro === 'acao_invalida', 'ação desconhecida -> acao_invalida');

  const grande = JSON.stringify({ acao: 'registrar', token: tokenTeste_(), texto: new Array(21 * 1024).join('a') });
  const r4 = JSON.parse(doPost({ postData: { contents: grande } }).getContent());
  confere_(!r4.ok && r4.erro === 'payload_grande', 'corpo > 20 KB -> payload_grande');

  const r5 = chamar_({ acao: 'ping', token: tokenTeste_() });
  confere_(r5.ok === true, 'ping com token certo');
  Logger.log('IA configurada: ' + r5.ia_configurada);
}

// Lista de compras: usa a lista "Compras (teste)", criada e usada só por este teste.
// Não cria evento de verdade no Calendar (criarEvento:false): confere o evento calculado.
function testeCompras() {
  const REF = '2026-10-14T10:00:00-03:00';
  const lista = listaDeTeste_();
  const n = normalizar;
  const abertos = function () { return itensAbertos_(lista).map(function (a) { return a.nome; }); };
  const passo = function (frase) {
    const c = classificar(frase, REF);
    Logger.log(JSON.stringify(c) + '  <- ' + frase);
    const r = c.compras ? aplicarCompras({ criado_em: REF, compras: c.compras, lembrete_data: c.lembrete_data,
      lembrete_hora: c.lembrete_hora }, { listaId: lista, criarEvento: false }) : null;
    if (r) Logger.log('        ' + resumoCompras_(r));
    return { c: c, r: r };
  };

  let t = passo('Acabou o café e o detergente');
  confere_(t.c.tipo === 'compra' && t.r && t.r.acao === 'adicionar' &&
    mesmos_(t.r.adicionados.map(n), ['cafe', 'detergente']), '1 adiciona café e detergente');

  t = passo('Comprar 2 litros de leite');
  confere_(t.r && t.r.adicionados.length === 1 && n(t.r.adicionados[0]) === 'leite (2 litros)', '2 adiciona "leite (2 litros)"');

  t = passo('Comprar leite');
  confere_(t.r && !t.r.adicionados.length && t.r.ja_na_lista.map(n).join() === 'leite', '3 leite já na lista, pulado');

  t = passo('Já comprei o café');
  confere_(t.r && t.r.acao === 'concluir' && t.r.concluidos.map(n).join() === 'cafe' &&
    abertos().indexOf('cafe') < 0, '4 conclui café');

  Tasks.Tasks.insert({ title: 'café' }, lista);
  Tasks.Tasks.insert({ title: 'café solúvel' }, lista);
  const antes5 = abertos().length;
  t = passo('Comprei café');
  confere_(t.r && t.r.ambiguos.length === 1 && !t.r.concluidos.length && abertos().length === antes5,
    '5 "café" e "café solúvel" abertos: ambíguo, nada muda');

  t = passo('Sábado às 9h mercado: arroz, feijão, ração do cachorro');
  const nomes6 = t.r ? t.r.adicionados.map(n) : [];
  confere_(nomes6.length === 3 && nomes6.indexOf('arroz') >= 0 && nomes6.indexOf('feijao') >= 0 &&
    nomes6.some(function (x) { return x.indexOf('racao') >= 0; }), '6 adiciona arroz, feijão e ração');
  confere_(t.c.lembrete_data === '2026-10-17' && t.c.lembrete_hora === '09:00' && t.r && t.r.evento &&
    /^Compras \(\d+ itens\)$/.test(t.r.evento.titulo), '6 evento 2026-10-17 09:00: ' + JSON.stringify(t.r && t.r.evento));

  const antes7 = abertos().length;
  t = passo('Comprei pão hoje cedo');
  confere_(t.r && t.r.nao_encontrados.map(n).join() === 'pao' && abertos().length === antes7, '7 pão não encontrado, nada muda');

  t = passo('Reunião com o fornecedor amanhã');
  confere_(t.c.tipo === 'lembrete' && !t.c.compras && !t.r, '8 lembrete, nenhuma compra');
}

// Reaproveita a lista de teste entre execuções e a deixa vazia marcando os itens
// abertos como concluídos (nunca apaga).
function listaDeTeste_() {
  let id = PROPS.getProperty('COMPRAS_TESTE_LIST_ID');
  if (!id) {
    id = Tasks.Tasklists.insert({ title: 'Compras (teste)' }).id;
    PROPS.setProperty('COMPRAS_TESTE_LIST_ID', id);
  }
  itensAbertos_(id).forEach(function (a) { Tasks.Tasks.patch({ status: 'completed' }, id, a.id); });
  return id;
}

function mesmos_(a, b) {
  return JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
}

// ---------- auxiliares ----------

function chamar_(obj) {
  return JSON.parse(doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
}

function tokenTeste_() {
  return PROPS.getProperty('APP_TOKEN');
}

function confere_(condicao, descricao) {
  Logger.log((condicao ? 'OK      ' : 'FALHOU  ') + descricao);
}
