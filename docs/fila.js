// IndexedDB "diario-voz": store `pendentes` (entradas ainda não confirmadas pelo servidor)
// e `config` (url, token, tema, cache de recentes).
// Usado pela página e pelo service worker, por isso não toca em window nem document.
// O token fica aqui, e não no localStorage, porque o service worker precisa dele.

const NOME = 'diario-voz';
const VERSAO_DB = 1;

let conexao = null;

function abrir() {
  if (conexao) return conexao;
  conexao = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME, VERSAO_DB);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pendentes')) db.createObjectStore('pendentes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); conexao = null; };
      resolve(db);
    };
    req.onerror = () => { conexao = null; reject(req.error); };
  });
  return conexao;
}

async function operacao(store, modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, modo);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------- pendentes ----------

export function adicionar(entrada) {
  return operacao('pendentes', 'readwrite', (s) => s.put(entrada));
}

export function atualizar(entrada) {
  return operacao('pendentes', 'readwrite', (s) => s.put(entrada));
}

export function remover(id) {
  return operacao('pendentes', 'readwrite', (s) => s.delete(id));
}

export async function listar() {
  const todas = await operacao('pendentes', 'readonly', (s) => s.getAll());
  return todas.sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em));
}

export function contar() {
  return operacao('pendentes', 'readonly', (s) => s.count());
}

// ---------- config ----------

export function lerConfig(chave) {
  return operacao('config', 'readonly', (s) => s.get(chave));
}

export function salvarConfig(chave, valor) {
  return operacao('config', 'readwrite', (s) => s.put(valor, chave));
}

export async function credenciais() {
  const [url, token] = await Promise.all([lerConfig('url'), lerConfig('token')]);
  return { url: url || '', token: token || '' };
}
