// Chamadas ao Apps Script e envio da fila. Usado pela página e pelo service worker.
// Sempre Content-Type text/plain: com application/json o navegador faria um preflight
// CORS (OPTIONS) que o Apps Script não responde.

import { listar, remover, atualizar, credenciais } from './fila.js';

const TIMEOUT_MS = 20000;

// Erros que não se resolvem tentando de novo a mesma entrada.
const ERROS_DA_ENTRADA = ['id_invalido', 'criado_em_invalido', 'texto_vazio', 'texto_grande', 'payload_grande'];

export class ErroApi extends Error {
  constructor(codigo, msg, rede = false) {
    super(msg);
    this.codigo = codigo;
    this.rede = rede;
  }
}

export async function chamar(acao, dados = {}, cred = null) {
  const { url, token } = cred || await credenciais();
  if (!url || !token) throw new ErroApi('sem_config', 'Configure a URL e o token em Ajustes.');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...dados, acao, token }),
        signal: ctrl.signal,
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new ErroApi('timeout', 'O servidor demorou mais de 20 s para responder.', true);
      throw new ErroApi('rede', 'Sem conexão com o servidor.', true);
    }
    if (!resp.ok) throw new ErroApi('http_' + resp.status, 'O servidor respondeu com erro ' + resp.status + '.', true);

    let json;
    try {
      json = await resp.json();
    } catch (err) {
      // Uma página HTML (login do Google, URL errada) cai aqui.
      throw new ErroApi('resposta_invalida', 'A URL não respondeu como o web app. Confira se termina em /exec.');
    }
    if (!json.ok) throw new ErroApi(json.erro || 'erro', json.msg || 'Erro desconhecido.');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Envia as pendentes em ordem cronológica. Remove da fila somente após ok:true
// (inclusive duplicado:true). Um lock evita que a página e o service worker
// enviem ao mesmo tempo; se acontecesse, o servidor descartaria a duplicata pelo id.
//
// Retorna { enviadas: [{ id, tipo, ... }], restantes, motivo }.
// motivo: null | 'rede' | 'sem_config' | 'nao_autorizado' | 'ocupado' | 'erro'
export function enviarFila() {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('diario-voz-enviar', () => enviarFilaSemLock());
  }
  return enviarFilaSemLock();
}

async function enviarFilaSemLock() {
  const pendentes = await listar();
  const enviadas = [];
  if (!pendentes.length) return { enviadas, restantes: 0, motivo: null };

  const cred = await credenciais();
  if (!cred.url || !cred.token) return { enviadas, restantes: pendentes.length, motivo: 'sem_config' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { enviadas, restantes: pendentes.length, motivo: 'rede' };
  }

  let motivo = null;
  for (const e of pendentes) {
    if (e.erro) continue; // entrada recusada pelo servidor: fica na fila, visível em Recentes
    try {
      const r = await chamar('registrar', { id: e.id, criado_em: e.criado_em, texto: e.texto, origem: e.origem }, cred);
      await remover(e.id);
      enviadas.push({ id: e.id, tipo: r.tipo, tags: r.tags, duplicado: !!r.duplicado, compras: r.compras || null });
    } catch (err) {
      if (err.rede) { motivo = 'rede'; break; }
      if (err.codigo === 'nao_autorizado' || err.codigo === 'resposta_invalida') { motivo = 'nao_autorizado'; break; }
      if (err.codigo === 'ocupado') { motivo = 'ocupado'; break; }
      if (ERROS_DA_ENTRADA.includes(err.codigo)) {
        await atualizar({ ...e, erro: err.codigo });
        continue;
      }
      motivo = 'erro';
      break;
    }
  }

  const restantes = (await listar()).filter((e) => !e.erro).length;
  return { enviadas, restantes, motivo };
}
