// UI, abas e estado do diario-voz.

import { adicionar, listar, contar, lerConfig, salvarConfig, credenciais } from './fila.js';
import { chamar, enviarFila } from './api.js';
import { suportado as vozSuportada, criarDitado } from './voz.js';

const $ = (sel) => document.querySelector(sel);

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const TIPOS = ['trabalho', 'lembrete', 'ideia', 'decisao', 'pessoal', 'registro'];
const ROTULO = { trabalho: 'trabalho', lembrete: 'lembrete', ideia: 'ideia', decisao: 'decisão', pessoal: 'pessoal', registro: 'registro' };
const MAX_TEXTO = 10000;
const MSG_OFFLINE = 'Sem conexão. A entrada ficou na fila e será enviada quando a rede voltar.';
const ORIGEM_PADRAO = /Android/i.test(navigator.userAgent) ? 'android' : 'windows';

let origemAtual = ORIGEM_PADRAO;

// ---------- utilitários ----------

const pad = (n) => String(n).padStart(2, '0');

// ISO 8601 com o offset local: 2026-10-14T08:32:10-03:00
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sinal}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// "2026-10-14" -> Date local ao meio-dia (evita virar o dia por causa de fuso)
function dataDe(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function nomeDoDia(ymd) {
  const hoje = isoLocal(new Date()).slice(0, 10);
  const ontem = isoLocal(new Date(Date.now() - 864e5)).slice(0, 10);
  if (ymd === hoje) return 'Hoje';
  if (ymd === ontem) return 'Ontem';
  const d = dataDe(ymd);
  const ano = d.getFullYear() !== new Date().getFullYear() ? ` de ${d.getFullYear()}` : '';
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}${ano}`;
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

// ---------- toast ----------

let toastTimer = null;
function toast(msg, acao = null) {
  const caixa = $('#toast');
  const botao = $('#toast-acao');
  $('#toast-texto').textContent = msg;
  if (acao) {
    botao.textContent = acao.rotulo;
    botao.onclick = () => { esconderToast(); acao.fn(); };
    botao.hidden = false;
  } else {
    botao.hidden = true;
    botao.onclick = null;
  }
  caixa.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(esconderToast, acao ? 6000 : 4000);
}
function esconderToast() { $('#toast').hidden = true; }

// ---------- tema ----------

function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'escuro' || tema === 'claro') raiz.dataset.theme = tema;
  else delete raiz.dataset.theme;
  const cor = getComputedStyle(raiz).getPropertyValue('--tinta').trim();
  if (cor) document.querySelector('meta[name="theme-color"]').setAttribute('content', cor);
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => {
  aplicarTema(await lerConfig('tema'));
});

// ---------- abas ----------

const ABAS = ['registrar', 'perguntar', 'recentes', 'ajustes'];

function mostrarAba(nome, focar = false) {
  for (const a of ABAS) {
    const ativa = a === nome;
    const aba = $('#aba-' + a);
    aba.setAttribute('aria-selected', String(ativa));
    aba.tabIndex = ativa ? 0 : -1;
    $('#tela-' + a).hidden = !ativa;
    if (ativa && focar) aba.focus();
  }
  if (nome !== 'registrar' && ditadoPrincipal?.gravando) ditadoPrincipal.parar();
  if (nome !== 'perguntar' && ditadoPergunta?.gravando) ditadoPergunta.parar();
  if (nome === 'recentes') carregarRecentes();
  if (nome === 'ajustes') carregarAjustes();
}

$('.abas').addEventListener('click', (ev) => {
  const aba = ev.target.closest('[role="tab"]');
  if (aba) mostrarAba(aba.id.replace('aba-', ''));
});
$('.abas').addEventListener('keydown', (ev) => {
  const atual = ABAS.findIndex((a) => $('#aba-' + a).getAttribute('aria-selected') === 'true');
  let novo = null;
  if (ev.key === 'ArrowRight') novo = (atual + 1) % ABAS.length;
  if (ev.key === 'ArrowLeft') novo = (atual - 1 + ABAS.length) % ABAS.length;
  if (ev.key === 'Home') novo = 0;
  if (ev.key === 'End') novo = ABAS.length - 1;
  if (novo !== null) { ev.preventDefault(); mostrarAba(ABAS[novo], true); }
});

// ---------- anel do microfone ----------

function controlarAnel(botao, giraParado) {
  const anel = botao.querySelector('.anel');
  const cor = botao.querySelector('.anel-cor');
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)');
  let giro = null;
  let gravando = false;

  function montarGiro() {
    giro?.cancel();
    giro = null;
    if (reduzido.matches) return;
    giro = anel.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }],
      { duration: 20000, iterations: Infinity });
    aplicar();
  }
  function aplicar() {
    if (!giro) return;
    if (gravando) { giro.play(); giro.updatePlaybackRate(5); }
    else { giro.updatePlaybackRate(1); if (!giraParado) giro.pause(); }
  }
  montarGiro();
  reduzido.addEventListener('change', montarGiro);

  return {
    gravando(sim) { gravando = sim; aplicar(); },
    pulso() {
      if (reduzido.matches) botao.animate([{ opacity: 1 }, { opacity: 0.75 }, { opacity: 1 }], { duration: 180 });
      else botao.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
    },
    flash(tipo) {
      if (!TIPOS.includes(tipo)) return;
      cor.style.setProperty('--flash', `var(--c-${tipo})`);
      cor.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 500 });
    }
  };
}

// Liga um botão de microfone a um campo de texto. Durante a gravação o campo dá lugar
// a um painel ao vivo (final em --texto, parcial em --texto-2); ao parar, o texto
// volta ao campo e fica editável. Nunca salva sozinho.
function ligarDitado({ botao, campo, aoVivo, aviso, anel, rotuloParado, rotuloGravando }) {
  if (!vozSuportada) { botao.hidden = true; return null; }

  const spanFinal = aoVivo.querySelector('.final');
  const spanParcial = aoVivo.querySelector('.parcial');
  let ultimoFinal = '';
  let automatico = false;
  let esperandoParar = [];

  const ditado = criarDitado({
    aoTexto(final, parcial) {
      ultimoFinal = final;
      spanFinal.textContent = final;
      spanParcial.textContent = parcial ? (final ? ' ' : '') + parcial : '';
      aoVivo.scrollTop = aoVivo.scrollHeight;
    },
    aoResultado() { anel.pulso(); },
    aoEstado(gravando) {
      botao.setAttribute('aria-pressed', String(gravando));
      botao.setAttribute('aria-label', gravando ? rotuloGravando : rotuloParado);
      anel.gravando(gravando);
      if (gravando) {
        aviso.hidden = true;
        aoVivo.hidden = false;
        campo.hidden = true;
        navigator.vibrate?.(15);
      } else {
        campo.value = ultimoFinal;
        campo.hidden = false;
        aoVivo.hidden = true;
        automatico = false;
        esperandoParar.forEach((r) => r());
        esperandoParar = [];
      }
    },
    aoErro(codigo) {
      let msg;
      if (automatico) msg = 'Toque no microfone para começar a ditar.';
      else if (codigo === 'network') msg = 'Sem conexão para o ditado. Use o microfone do teclado; a entrada vai para a fila.';
      else if (codigo === 'not-allowed') msg = 'O microfone está bloqueado para este site. No Chrome, abra ⋮ > Configurações > Configurações do site > Microfone e permita.';
      else if (codigo === 'audio-capture') msg = 'Não encontrei um microfone funcionando. Você pode escrever no campo.';
      else msg = 'O ditado parou. Você pode escrever no campo ou tocar no microfone de novo.';
      aviso.textContent = msg;
      aviso.hidden = false;
    }
  });

  botao.addEventListener('click', () => {
    if (ditado.gravando) ditado.parar();
    else iniciar(false);
  });

  function iniciar(auto) {
    for (const outro of todosDitados) if (outro !== ditado && outro.gravando) outro.parar();
    automatico = auto;
    ultimoFinal = campo.value.trim();
    ditado.iniciar(campo.value);
  }

  // Para a gravação e espera o texto final chegar ao campo.
  ditado.pararEsperando = () => new Promise((resolve) => {
    if (!ditado.gravando) return resolve();
    esperandoParar.push(resolve);
    ditado.parar();
    setTimeout(resolve, 3000);
  });
  ditado.iniciarAutomatico = () => iniciar(true);
  todosDitados.push(ditado);
  return ditado;
}

const todosDitados = [];

// ---------- Registrar ----------

const campoTexto = $('#texto');
const anelPrincipal = controlarAnel($('#mic'), true);
const ditadoPrincipal = ligarDitado({
  botao: $('#mic'), campo: campoTexto, aoVivo: $('#ao-vivo'), aviso: $('#aviso-voz'),
  anel: anelPrincipal, rotuloParado: 'Começar a ditar', rotuloGravando: 'Parar ditado'
});

function atualizarData() {
  const d = new Date();
  $('#dia-semana').textContent = DIAS[d.getDay()] + ',';
  $('#dia-mes').textContent = `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

async function atualizarContador() {
  const n = await contar();
  const p = $('#na-fila');
  p.hidden = n === 0;
  p.textContent = `${n} na fila`;
}

$('#salvar').addEventListener('click', salvar);

async function salvar() {
  const botao = $('#salvar');
  if (botao.disabled) return;
  if (ditadoPrincipal?.gravando) await ditadoPrincipal.pararEsperando();

  const texto = campoTexto.value.trim();
  if (!texto) { toast('Dite ou escreva algo antes de salvar.'); return; }
  if (texto.length > MAX_TEXTO) { toast('O texto passou de 10.000 caracteres.'); return; }

  const entrada = { id: crypto.randomUUID(), criado_em: isoLocal(new Date()), texto, origem: origemAtual };
  botao.disabled = true;
  try {
    await adicionar(entrada);
  } catch (err) {
    botao.disabled = false;
    toast('Não consegui gravar no aparelho. O texto continua no campo.');
    return;
  }
  // A partir daqui a entrada está segura no IndexedDB.
  navigator.vibrate?.([10, 40, 10]);
  campoTexto.value = '';
  origemAtual = ORIGEM_PADRAO;
  await atualizarContador();

  try {
    await enviarComAviso(entrada.id);
  } finally {
    botao.disabled = false;
  }
}

async function enviarComAviso(idSalvo) {
  let r;
  try {
    r = await enviarFila();
  } catch (err) {
    r = { enviadas: [], restantes: 1, motivo: 'erro' };
  }
  await atualizarContador();

  const minha = r.enviadas.find((x) => x.id === idSalvo);
  if (minha) {
    toast(`Salvo como ${ROTULO[minha.tipo] || minha.tipo}`);
    anelPrincipal.flash(minha.tipo);
    reenvio.zerar();
    return;
  }
  if (r.motivo === 'sem_config') toast('Salvo na fila. Configure a URL e o token em Ajustes para enviar.');
  else if (r.motivo === 'nao_autorizado') toast('Salvo na fila, mas o servidor recusou o token. Confira em Ajustes.');
  else if (r.motivo === 'rede') { toast(MSG_OFFLINE); reenvio.agendar(); registrarSync(); }
  else if (r.motivo) { toast('Salvo na fila. O envio falhou e será tentado de novo.'); reenvio.agendar(); registrarSync(); }
  else toast('Salvo.');
}

// Backoff 2 s -> 8 s -> 30 s enquanto o app está aberto. Com o app fechado, o
// Background Sync assume.
const reenvio = (() => {
  const esperas = [2000, 8000, 30000];
  let i = 0;
  let timer = null;
  return {
    agendar() {
      if (timer || i >= esperas.length) return;
      timer = setTimeout(async () => {
        timer = null;
        i++;
        const r = await enviarEmSegundoPlano();
        if (r && r.restantes > 0 && (r.motivo === 'rede' || r.motivo === 'ocupado' || r.motivo === 'erro')) this.agendar();
        else i = 0;
      }, esperas[i]);
    },
    zerar() { i = 0; clearTimeout(timer); timer = null; }
  };
})();

async function registrarSync() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && 'sync' in reg) await reg.sync.register('enviar-fila');
  } catch (err) { /* sem Background Sync: o reenvio fica para online/visibilitychange */ }
}

async function enviarEmSegundoPlano() {
  if ((await contar()) === 0) return null;
  let r;
  try { r = await enviarFila(); } catch (err) { return null; }
  await atualizarContador();
  if (r.enviadas.length) {
    toast(r.enviadas.length === 1 ? '1 entrada da fila foi enviada.' : `${r.enviadas.length} entradas da fila foram enviadas.`);
    if (!$('#tela-recentes').hidden) carregarRecentes();
  }
  if (r.restantes > 0 && r.motivo === 'rede') registrarSync();
  return r;
}

let ultimoLimpo = '';
$('#limpar').addEventListener('click', async () => {
  if (ditadoPrincipal?.gravando) await ditadoPrincipal.pararEsperando();
  if (!campoTexto.value) return;
  ultimoLimpo = campoTexto.value;
  campoTexto.value = '';
  origemAtual = ORIGEM_PADRAO;
  toast('Texto apagado.', { rotulo: 'Desfazer', fn: () => { campoTexto.value = ultimoLimpo; } });
});

// ---------- Perguntar ----------

const campoPergunta = $('#pergunta');
const anelPergunta = controlarAnel($('#mic-pergunta'), false);
const ditadoPergunta = ligarDitado({
  botao: $('#mic-pergunta'), campo: campoPergunta, aoVivo: $('#ao-vivo-pergunta'), aviso: $('#aviso-pergunta'),
  anel: anelPergunta, rotuloParado: 'Ditar a pergunta', rotuloGravando: 'Parar ditado'
});

$('#form-pergunta').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (ditadoPergunta?.gravando) await ditadoPergunta.pararEsperando();
  const pergunta = campoPergunta.value.trim();
  if (!pergunta) { toast('Escreva ou dite a pergunta.'); return; }
  const dias = Number(new FormData(ev.target).get('dias')) || 30;

  const botao = $('#perguntar');
  const saida = $('#resposta');
  botao.disabled = true;
  saida.className = 'resposta carregando';
  saida.textContent = 'Consultando o diário…';
  try {
    const r = await chamar('perguntar', { pergunta, dias });
    desenharResposta(saida, r.resposta, r.usadas);
  } catch (err) {
    saida.className = 'resposta';
    saida.textContent = err.rede ? 'Sem conexão. Perguntar ao diário precisa de internet.' : err.message;
  } finally {
    botao.disabled = false;
  }
});

// Renderização mínima e segura: parágrafos, listas com "- " e **negrito**.
function desenharResposta(saida, texto, usadas) {
  saida.className = 'resposta';
  saida.replaceChildren();
  for (const bloco of String(texto).split(/\n\s*\n/)) {
    const linhas = bloco.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!linhas.length) continue;
    if (linhas.every((l) => /^[-*•]\s+/.test(l))) {
      const ul = el('ul');
      for (const l of linhas) ul.append(comNegrito(el('li'), l.replace(/^[-*•]\s+/, '')));
      saida.append(ul);
    } else {
      const p = el('p');
      linhas.forEach((l, i) => { if (i) p.append(el('br')); comNegrito(p, l); });
      saida.append(p);
    }
  }
  saida.append(el('p', 'nota', usadas === 1 ? 'Baseado em 1 entrada.' : `Baseado em ${usadas} entradas.`));
}

function comNegrito(alvo, linha) {
  linha.split(/(\*\*[^*]+\*\*)/).forEach((parte) => {
    if (/^\*\*[^*]+\*\*$/.test(parte)) alvo.append(el('strong', null, parte.slice(2, -2)));
    else if (parte) alvo.append(document.createTextNode(parte));
  });
  return alvo;
}

// ---------- Recentes ----------

let carregandoRecentes = null;
function carregarRecentes() {
  carregandoRecentes ??= (async () => {
    const nota = $('#nota-recentes');
    const cache = (await lerConfig('recentes')) || [];
    desenharRecentes(await listar(), cache);
    try {
      const r = await chamar('recentes', { limite: 20 });
      await salvarConfig('recentes', r.entradas);
      nota.hidden = true;
      desenharRecentes(await listar(), r.entradas);
    } catch (err) {
      nota.hidden = false;
      if (err.codigo === 'sem_config') nota.textContent = 'Configure a URL e o token em Ajustes para ver as entradas enviadas.';
      else if (err.rede) nota.textContent = cache.length ? 'Sem conexão. Mostrando a última lista carregada.' : 'Sem conexão. Mostrando só o que está na fila.';
      else nota.textContent = err.message;
    }
  })().finally(() => { carregandoRecentes = null; });
  return carregandoRecentes;
}

function desenharRecentes(locais, doServidor) {
  const alvo = $('#linha-do-tempo');
  const noServidor = new Set(doServidor.map((e) => e.id));
  const itens = [
    ...locais.filter((e) => !noServidor.has(e.id)).map((e) => ({ ...e, local: true, tags: [] })),
    ...doServidor
  ].sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em));

  if (!itens.length) {
    alvo.replaceChildren(el('p', 'vazio', 'Nada registrado ainda. Toque no microfone e conte como foi o dia.'));
    return;
  }

  const porDia = new Map();
  for (const e of itens) {
    const dia = e.criado_em.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(e);
  }

  const secoes = [];
  for (const [dia, entradas] of porDia) {
    const sec = el('section', 'dia');
    const h2 = el('h2');
    h2.append(el('span', null, nomeDoDia(dia)), espectroDoDia(entradas));
    const ul = el('ul', 'entradas');
    for (const e of entradas) ul.append(itemEntrada(e));
    sec.append(h2, ul);
    secoes.push(sec);
  }
  alvo.replaceChildren(...secoes);
}

function espectroDoDia(entradas) {
  const barra = el('span', 'espectro-dia');
  const contagem = {};
  for (const e of entradas) if (!e.local && TIPOS.includes(e.tipo)) contagem[e.tipo] = (contagem[e.tipo] || 0) + 1;
  const partes = [];
  for (const t of TIPOS) {
    if (!contagem[t]) continue;
    const s = el('span', 't-' + t);
    s.style.flexGrow = String(contagem[t]);
    s.style.background = 'var(--cor-tipo)';
    barra.append(s);
    partes.push(`${contagem[t]} ${ROTULO[t]}`);
  }
  if (partes.length) {
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', 'Espectro do dia: ' + partes.join(', '));
  } else {
    barra.setAttribute('aria-hidden', 'true');
  }
  return barra;
}

function itemEntrada(e) {
  const li = el('li', 'entrada');
  if (e.local) li.classList.add('na-fila-local');
  else if (TIPOS.includes(e.tipo)) li.classList.add('t-' + e.tipo);

  const meta = el('div', 'meta');
  meta.append(el('span', null, e.criado_em.slice(11, 16)));
  if (e.local) meta.append(el('span', 'fila', e.erro ? `recusada pelo servidor (${e.erro})` : 'na fila'));
  else meta.append(el('span', 'tipo', ROTULO[e.tipo] || e.tipo));
  if (e.lembrete_data) {
    const [, m, d] = e.lembrete_data.split('-');
    meta.append(el('span', null, `até ${d}/${m}`));
  }

  li.append(meta, el('p', null, e.texto));

  const tags = Array.isArray(e.tags) ? e.tags : String(e.tags || '').split(/\s*,\s*/).filter(Boolean);
  if (tags.length) {
    const box = el('div', 'tags');
    for (const t of tags) box.append(el('span', 'chip', t));
    li.append(box);
  }
  return li;
}

// ---------- Ajustes ----------

async function carregarAjustes() {
  const { url, token } = await credenciais();
  $('#url').value = url;
  $('#token').value = token;
  const tema = (await lerConfig('tema')) || 'sistema';
  for (const r of document.querySelectorAll('input[name="tema"]')) r.checked = r.value === tema;
  $('#boas-vindas').hidden = !!(url && token);
}

async function guardarCredenciais() {
  await salvarConfig('url', $('#url').value.trim());
  await salvarConfig('token', $('#token').value.trim());
}
$('#url').addEventListener('change', guardarCredenciais);
$('#token').addEventListener('change', guardarCredenciais);

$('#mostrar-token').addEventListener('click', (ev) => {
  const campo = $('#token');
  const mostrar = campo.type === 'password';
  campo.type = mostrar ? 'text' : 'password';
  ev.currentTarget.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  ev.currentTarget.setAttribute('aria-pressed', String(mostrar));
});

$('#form-ajustes').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await guardarCredenciais();
  const url = $('#url').value.trim();
  const token = $('#token').value.trim();
  if (!url || !token) { toast('Preencha a URL e o token.'); return; }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    toast('A URL deve ser https://script.google.com/macros/s/…/exec');
    return;
  }

  const botao = $('#testar');
  botao.disabled = true;
  try {
    const r = await chamar('ping', {}, { url, token });
    $('#boas-vindas').hidden = true;
    toast(r.ia_configurada ? 'Conexão ok' : 'Conexão ok, mas a ANTHROPIC_KEY não está configurada no Apps Script.');
    enviarEmSegundoPlano();
  } catch (err) {
    if (err.codigo === 'nao_autorizado') toast('Token incorreto.');
    else if (err.rede) toast('Não consegui falar com o servidor. Confira a URL e a internet.');
    else toast(err.message);
  } finally {
    botao.disabled = false;
  }
});

$('#enviar-fila').addEventListener('click', async () => {
  const botao = $('#enviar-fila');
  botao.disabled = true;
  try {
    if ((await contar()) === 0) { toast('A fila está vazia.'); return; }
    const r = await enviarFila();
    await atualizarContador();
    const n = r.enviadas.length;
    if (!r.restantes) toast(n === 1 ? '1 entrada enviada.' : `${n} entradas enviadas.`);
    else if (r.motivo === 'rede') toast(`Sem conexão. ${r.restantes} continuam na fila.`);
    else if (r.motivo === 'sem_config') toast('Preencha a URL e o token.');
    else if (r.motivo === 'nao_autorizado') toast('O servidor recusou o token.');
    else toast(`${n} enviadas, ${r.restantes} continuam na fila.`);
  } catch (err) {
    toast('O envio falhou. Tente de novo.');
  } finally {
    botao.disabled = false;
  }
});

for (const r of document.querySelectorAll('input[name="tema"]')) {
  r.addEventListener('change', async () => {
    await salvarConfig('tema', r.value);
    aplicarTema(r.value);
  });
}

// ---------- service worker ----------

async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) { $('#versao').textContent = 'Versão sem modo offline'; return; }
  try {
    await navigator.serviceWorker.register('sw.js', { type: 'module', scope: './' });
  } catch (err) {
    console.warn('service worker não registrado', err);
  }
  navigator.serviceWorker.addEventListener('message', async (ev) => {
    if (ev.data?.tipo === 'fila-enviada') {
      await atualizarContador();
      const n = ev.data.enviadas || 0;
      if (n) toast(n === 1 ? '1 entrada da fila foi enviada.' : `${n} entradas da fila foram enviadas.`);
      if (!$('#tela-recentes').hidden) carregarRecentes();
    }
    if (ev.data?.tipo === 'versao') $('#versao').textContent = `Versão ${ev.data.versao}`;
  });
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ tipo: 'versao' });
}

// ---------- início ----------

async function iniciar() {
  aplicarTema(await lerConfig('tema'));
  atualizarData();
  await atualizarContador();

  const p = new URLSearchParams(location.search);
  const modo = p.get('modo');
  const partes = [p.get('titulo'), p.get('texto'), p.get('url')].map((s) => (s || '').trim());
  const compartilhado = partes.some(Boolean) || p.get('origem') === 'compartilhar';
  if (partes.some(Boolean) || p.toString()) history.replaceState(null, '', location.pathname);

  if (compartilhado) {
    const [titulo, texto, url] = partes;
    const linhas = [];
    if (titulo && !texto.includes(titulo)) linhas.push(titulo);
    if (texto) linhas.push(texto);
    if (url && !texto.includes(url)) linhas.push(url);
    campoTexto.value = linhas.join('\n');
    origemAtual = 'compartilhar';
  }

  const { url, token } = await credenciais();
  if (!url || !token) {
    mostrarAba(compartilhado ? 'registrar' : 'ajustes');
    if (compartilhado) toast('Configure a URL e o token em Ajustes. A entrada pode ser salva na fila mesmo assim.');
  } else if (modo === 'perguntar') {
    mostrarAba('perguntar');
    campoPergunta.focus();
  } else {
    mostrarAba('registrar');
    if (modo === 'voz' && ditadoPrincipal) ditadoPrincipal.iniciarAutomatico();
  }

  registrarServiceWorker();
  enviarEmSegundoPlano();
}

window.addEventListener('online', enviarEmSegundoPlano);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    atualizarData();
    atualizarContador();
    enviarEmSegundoPlano();
  }
});

iniciar();
