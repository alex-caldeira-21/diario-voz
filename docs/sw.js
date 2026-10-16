// Service worker (módulo): cache do app shell e Background Sync da fila.
// Para publicar uma atualização do app, aumente VERSAO.

import { enviarFila } from './api.js';

const VERSAO = '3';
const CACHE = `diario-voz-v${VERSAO}`;

const SHELL = [
  './',
  './index.html',
  './app.js',
  './voz.js',
  './fila.js',
  './api.js',
  './estilo.css',
  './manifest.json',
  './fontes/bricolage-grotesque.woff2',
  './fontes/atkinson-hyperlegible-400.woff2',
  './fontes/atkinson-hyperlegible-700.woff2',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-maskable-512.png',
  './icones/atalho-voz-96.png',
  './icones/atalho-perguntar-96.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith('diario-voz-v') && nome !== CACHE) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

// Cache-first só para arquivos deste site. Chamadas ao Apps Script (outra origem,
// e POST) nunca passam pelo cache.
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Navegações (inclusive ?modo=voz e o alvo de compartilhamento) recebem o index.
    const chave = req.mode === 'navigate' ? './index.html' : req;
    const achado = await cache.match(chave, { ignoreSearch: req.mode === 'navigate' });
    if (achado) return achado;
    try {
      return await fetch(req);
    } catch (err) {
      return new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

// Disparado pelo navegador quando a rede volta, mesmo com o app fechado.
// Se ainda houver pendentes por falta de rede, rejeita para o navegador tentar de novo.
self.addEventListener('sync', (ev) => {
  if (ev.tag === 'enviar-fila') ev.waitUntil(sincronizar());
});

async function sincronizar() {
  const r = await enviarFila();
  const janelas = await self.clients.matchAll({ type: 'window' });
  for (const j of janelas) j.postMessage({ tipo: 'fila-enviada', enviadas: r.enviadas.length });
  if (r.restantes > 0 && (r.motivo === 'rede' || r.motivo === 'ocupado' || r.motivo === 'erro')) {
    throw new Error('fila ainda pendente: ' + r.motivo);
  }
}

self.addEventListener('message', (ev) => {
  if (ev.data?.tipo === 'versao') ev.source?.postMessage({ tipo: 'versao', versao: VERSAO });
});
