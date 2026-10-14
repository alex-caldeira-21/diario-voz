// Chamadas à API da Anthropic: classificar e perguntar.
// A chave fica só em Script Properties e nunca aparece em respostas ou logs.

const SISTEMA_CLASSIFICAR = [
  'Você classifica entradas de um diário pessoal de um técnico de',
  'infraestrutura de telecom (POPs, datacenters, nobreaks, fibra óptica) que',
  'também estuda, empreende e tem vida pessoal.',
  'Responda SOMENTE com JSON válido, sem texto extra:',
  '{"tipo": "...", "tags": ["..."], "lembrete_data": "AAAA-MM-DD" | null}',
  '- tipo: um de registro, trabalho, lembrete, ideia, decisao, pessoal.',
  '  "lembrete" = algo que a pessoa precisa fazer ou lembrar no futuro.',
  '  "trabalho" = qualquer fato técnico ou profissional (medições, alarmes,',
  '  manutenção, enlaces, equipamentos, clientes), mesmo sem ação pendente.',
  '  "registro" = fato do dia que não é trabalho nem pessoal.',
  '- tags: 1 a 3, kebab-case, minúsculas, sem acento; prefira nomes próprios',
  '  citados (cidade/POP, equipamento, projeto).',
  '- lembrete_data: só se houver prazo; resolva datas relativas ("sexta",',
  '  "amanhã") usando a data de referência fornecida.'
].join('\n');

const SISTEMA_PERGUNTAR = [
  'Você responde perguntas sobre o diário pessoal do usuário usando SOMENTE',
  'as entradas fornecidas. Cite a data (DD/MM) de cada fato usado. Se a',
  'resposta não estiver nas entradas, diga que não encontrou registro sobre',
  'isso no período. Nunca invente. Português do Brasil, direto, sem',
  'introdução.'
].join('\n');

const DIAS_SEMANA_ = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];

// Retorna { tipo, tags: [], lembrete_data: 'AAAA-MM-DD' | '' }. Lança erro se a API falhar.
function classificar(texto, criadoEm) {
  // O dia da semana ajuda o modelo a resolver "sexta", "amanhã" etc. sem errar a conta.
  const usuario = 'Data de referência: ' + criadoEm + ' (' + diaDaSemana_(criadoEm) + ')\n' +
    'Entrada: ' + texto;
  const bruto = chamarClaude_(SISTEMA_CLASSIFICAR, usuario, 150);
  const r = parseJson_(bruto);

  const tipo = TIPOS.indexOf(r.tipo) >= 0 ? r.tipo : 'registro';
  const vistas = {};
  const tags = (Array.isArray(r.tags) ? r.tags : [])
    .map(kebab_)
    .filter(function (t) {
      if (!t || vistas[t]) return false;
      vistas[t] = true;
      return true;
    })
    .slice(0, 3);
  const data = (tipo === 'lembrete' && typeof r.lembrete_data === 'string' &&
    RE_DATA.test(r.lembrete_data)) ? r.lembrete_data : '';

  return { tipo: tipo, tags: tags, lembrete_data: data };
}

// `entradas` já vem em ordem cronológica.
function perguntar(pergunta, entradas, dias) {
  const linhas = entradas.map(function (l) {
    const quando = l.criado_em.substring(0, 10) + ' ' + l.criado_em.substring(11, 16);
    return '[' + quando + '] (' + l.tipo + '; ' + l.tags + ') ' + l.texto.replace(/\s*\n\s*/g, ' ');
  });
  const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
  const usuario = 'Hoje: ' + hoje + ' (' + diaDaSemana_(hoje) + '). Período: últimos ' + dias + ' dias.\n\n' +
    'Entradas:\n' + linhas.join('\n') + '\n\n' +
    'Pergunta: ' + pergunta;
  return chamarClaude_(SISTEMA_PERGUNTAR, usuario, 800).trim();
}

function chamarClaude_(sistema, usuario, maxTokens) {
  const chave = PROPS.getProperty('ANTHROPIC_KEY');
  if (!chave) throw new Error('ANTHROPIC_KEY não configurada.');
  const modelo = PROPS.getProperty('MODELO') || MODELO_PADRAO;

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': chave,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      system: sistema,
      messages: [{ role: 'user', content: usuario }]
    })
  });

  const status = resp.getResponseCode();
  const corpo = resp.getContentText();
  if (status !== 200) {
    throw new Error('API Anthropic HTTP ' + status + ': ' + corpo.substring(0, 200));
  }

  const json = JSON.parse(corpo);
  const texto = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  if (!texto) throw new Error('API Anthropic respondeu sem texto (stop_reason=' + json.stop_reason + ').');
  return texto;
}

// Remove cercas ``` e qualquer texto fora do primeiro objeto JSON.
function parseJson_(texto) {
  let s = String(texto).replace(/```(?:json)?/gi, '').trim();
  const ini = s.indexOf('{');
  const fim = s.lastIndexOf('}');
  if (ini >= 0 && fim > ini) s = s.substring(ini, fim + 1);
  try {
    return JSON.parse(s);
  } catch (err) {
    throw new Error('Resposta da IA não é JSON: ' + s.substring(0, 200));
  }
}

function diaDaSemana_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return '';
  return DIAS_SEMANA_[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
}
