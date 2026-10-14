// Ponto de entrada do web app: doPost, roteamento e utilitários comuns.
// Contrato: sempre HTTP 200 com JSON { ok: true, ... } ou { ok: false, erro, msg }.

const PROPS = PropertiesService.getScriptProperties();
const FUSO = 'America/Sao_Paulo';
const ABA = 'diario';
const CABECALHO = ['id', 'criado_em', 'recebido_em', 'tipo', 'tags', 'texto',
  'lembrete_data', 'origem', 'status', 'classificado'];
const COL = {
  id: 1, criado_em: 2, recebido_em: 3, tipo: 4, tags: 5, texto: 6,
  lembrete_data: 7, origem: 8, status: 9, classificado: 10
};
const TIPOS = ['registro', 'trabalho', 'lembrete', 'ideia', 'decisao', 'pessoal'];
const ORIGENS = ['android', 'windows', 'compartilhar'];
const MAX_TEXTO = 10000;
const MAX_CORPO = 20 * 1024;
const MODELO_PADRAO = 'claude-haiku-4-5';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

const ACOES = {
  ping: acaoPing_,
  registrar: acaoRegistrar_,
  recentes: acaoRecentes_,
  perguntar: acaoPerguntar_,
  pendentes: acaoPendentes_,
  marcar: acaoMarcar_,
  reclassificar: acaoReclassificar_
};

function doPost(e) {
  try {
    const corpo = (e && e.postData && e.postData.contents) || '';
    if (Utilities.newBlob(corpo).getBytes().length > MAX_CORPO) {
      return resposta_(erro_('payload_grande', 'A requisição passou de 20 KB.'));
    }

    let req;
    try {
      req = JSON.parse(corpo);
    } catch (err) {
      return resposta_(erro_('json_invalido', 'O corpo não é um JSON válido.'));
    }
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      return resposta_(erro_('json_invalido', 'O corpo precisa ser um objeto JSON.'));
    }

    if (!tokenValido_(req.token)) {
      return resposta_(erro_('nao_autorizado', 'Token ausente ou incorreto.'));
    }

    const acao = Object.prototype.hasOwnProperty.call(ACOES, req.acao) ? ACOES[req.acao] : null;
    if (!acao) {
      return resposta_(erro_('acao_invalida', 'Ação desconhecida.'));
    }

    return resposta_(acao(req));
  } catch (err) {
    console.error('doPost: ' + (err && err.stack || err));
    return resposta_(erro_('erro_interno', 'Erro interno: ' + (err && err.message || err)));
  }
}

// Abrir a URL no navegador não expõe nada: só confirma que o serviço está no ar.
function doGet() {
  return resposta_({ ok: true, servico: 'diario-voz', msg: 'Use POST.' });
}

// Confere a conexão e o token sem tocar na planilha. Usado por "Testar conexão".
function acaoPing_() {
  return { ok: true, servico: 'diario-voz', ia_configurada: !!PROPS.getProperty('ANTHROPIC_KEY') };
}

// ---------- utilitários ----------

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function erro_(codigo, msg) {
  return { ok: false, erro: codigo, msg: msg };
}

// Comparação em tempo constante: percorre todos os caracteres do token esperado
// independentemente de onde aparece a primeira diferença.
function tokenValido_(recebido) {
  const esperado = PROPS.getProperty('APP_TOKEN') || '';
  if (!esperado) return false;
  const r = typeof recebido === 'string' ? recebido : '';
  let dif = r.length ^ esperado.length;
  for (let i = 0; i < esperado.length; i++) {
    dif |= esperado.charCodeAt(i) ^ (i < r.length ? r.charCodeAt(i) : 0);
  }
  return dif === 0;
}

function agoraIso_() {
  return Utilities.formatDate(new Date(), FUSO, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function semAcento_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function kebab_(s) {
  return semAcento_(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function inteiro_(v, padrao, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

// ---------- planilha ----------

let abaCache_ = null;

function aba_() {
  if (abaCache_) return abaCache_;
  const id = PROPS.getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID ausente. Rode setup() no editor.');
  const sh = SpreadsheetApp.openById(id).getSheetByName(ABA);
  if (!sh) throw new Error('Aba "' + ABA + '" não encontrada. Rode setup() no editor.');
  abaCache_ = sh;
  return sh;
}

// Todas as linhas de dados como objetos, com o número da linha em _linha.
function lerLinhas_() {
  const sh = aba_();
  const ultima = sh.getLastRow();
  if (ultima < 2) return [];
  const valores = sh.getRange(2, 1, ultima - 1, CABECALHO.length).getValues();
  const linhas = [];
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (!v[0]) continue;
    linhas.push({
      _linha: i + 2,
      id: String(v[0]),
      criado_em: String(v[1]),
      recebido_em: String(v[2]),
      tipo: String(v[3]),
      tags: String(v[4]),
      texto: String(v[5]),
      lembrete_data: String(v[6]),
      origem: String(v[7]),
      status: String(v[8]),
      classificado: v[9] === true || String(v[9]).toUpperCase() === 'TRUE'
    });
  }
  return linhas;
}

function linhaDoId_(sh, id) {
  const ultima = sh.getLastRow();
  if (ultima < 2) return 0;
  const achado = sh.getRange(2, COL.id, ultima - 1, 1)
    .createTextFinder(id).matchEntireCell(true).matchCase(false).findNext();
  return achado ? achado.getRow() : 0;
}

// Grava valores como texto puro. O formato "@" impede que o Sheets converta
// datas ISO e números; o apóstrofo inicial (quote prefix, não faz parte do valor)
// impede que um texto começando com "=" ou "+" vire fórmula.
function gravarCelulas_(sh, linha, coluna, valores) {
  const r = sh.getRange(linha, coluna, 1, valores.length);
  r.setNumberFormat('@');
  r.setValues([valores.map(function (v) {
    return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
  })]);
}

function objetoPublico_(l) {
  return {
    id: l.id,
    criado_em: l.criado_em,
    recebido_em: l.recebido_em,
    tipo: l.tipo,
    tags: l.tags ? l.tags.split(/\s*,\s*/).filter(String) : [],
    texto: l.texto,
    lembrete_data: l.lembrete_data || null,
    origem: l.origem,
    status: l.status,
    classificado: l.classificado
  };
}
