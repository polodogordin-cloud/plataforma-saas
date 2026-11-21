/**
 * Service Worker do Menuvo — Etapa 12, item 5.
 *
 * ─── Regra que governa este arquivo ─────────────────────────────────────────
 *
 * **O cache pode guardar o que é igual para todo mundo; nunca o que depende de
 * quem está pedindo.**
 *
 * Uma resposta em cache não passa por RLS, por cookie de sessão nem pelo
 * middleware: quem abrir o app depois — no mesmo aparelho ou no aparelho
 * compartilhado de um salão — recebe exatamente o que ficou guardado. Por isso:
 *
 *   • painel (`/app`, `/admin`), login e qualquer `/api` ou `/auth` = rede pura;
 *   • todo `*.supabase.co` = rede pura (a resposta é por usuário ou por token);
 *   • cardápio público (`/r/...`) = rede primeiro, cache só como rede de
 *     segurança para não mostrar erro de conexão no salão;
 *   • estáticos com hash no nome, ícones e fotos de produto = cache primeiro.
 *
 * ─── Sobre pedido errado (o risco real) ─────────────────────────────────────
 *
 * O carrinho e o pedido vivem em estado do React e em Server Actions — nada
 * disso passa por este arquivo. Ainda assim, o SW nunca guarda resposta de
 * `POST`, `/order`, `/orders`, `/carrinho` nem chamada ao Supabase, e todo
 * `POST` sai direto para a rede. Se um dia algum dado de pedido virar `GET`, o
 * `isSensitiveRequest` do `src/lib/pwa.ts` já o barra — e o teste automatizado
 * compara as duas listas para garantir que não divergem.
 *
 * ─── Atualização ────────────────────────────────────────────────────────────
 *
 * `VERSION` muda a cada build. No `install` o SW novo baixa os arquivos do shell
 * e fica em `waiting`; no `activate` apaga caches de versões antigas e assume.
 * A página manda `SKIP_WAITING` quando o usuário aceita recarregar — nunca
 * recarregamos por conta própria, porque isso jogaria fora um pedido pela
 * metade.
 */

/// <reference lib="webworker" />

/* global self, caches, fetch, Response */

const VERSION = "__CACHE_VERSION__";
const ASSET_CACHE = `menuvo-assets-${VERSION}`;
const PAGE_CACHE = `menuvo-pages-${VERSION}`;
const IMAGE_CACHE = `menuvo-images-${VERSION}`;
const OFFLINE_URL = "/offline.html";

/** Teto de entradas por cache: celular tem pouco espaço e o SO despeja caches. */
const LIMITS = { [ASSET_CACHE]: 80, [PAGE_CACHE]: 24, [IMAGE_CACHE]: 120 };

/** Arquivos mínimos para o app abrir sem rede. */
const PRECACHE = ["/", OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png"];

/**
 * Requisição que jamais pode ser guardada ou servida do cache.
 *
 * Cópia deliberada da regra de `src/lib/pwa.ts`: o SW não é transpilado e não
 * pode importar TS. Os testes comparam os dois comportamentos numa tabela de
 * URLs — se um mudar sem o outro, o teste falha.
 */
function isSensitive(url) {
  return (
    /^\/(?:api|auth)\//.test(url.pathname) ||
    // Fotos públicas de produto ficam no Storage do Supabase e **podem** ser
    // cacheadas (ver `isSupabaseImage`). Sem esta exceção, a regra genérica do
    // Supabase abaixo bloquearia o maior ganho de carga do cardápio.
    (/supabase\.co$/i.test(url.hostname) && !isSupabaseImage(url)) ||
    /^\/(?:app|admin|onboarding)(?:\/|$)/.test(url.pathname) ||
    /\/configuracoes(?:\/|$)/.test(url.pathname) ||
    /\/order|\/orders|\/carrinho|\/cart/i.test(url.pathname + url.search)
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /^\/icons\/|^\/fonts\/|^\/favicon\.ico$|^\/icon\.svg$/.test(url.pathname)
  );
}

function isMenuPage(url) {
  return /^\/r\/[^/]+(?:\/table\/[^/]+)?\/?$/.test(url.pathname);
}

function isSupabaseImage(url) {
  return /supabase\.co$/.test(url.hostname) && url.pathname.includes("/storage/v1/object/public/");
}

/* ------------------------------------------------------------------ limites */

/**
 * Poda o cache em excesso.
 *
 * `CacheStorage` não tem LRU: sem poda, um cardápio com 400 fotos guarda as 400
 * e o celular fica sem espaço. Removemos as entradas mais antigas (a ordem de
 * `keys()` é a ordem de inserção, então as primeiras são as mais velhas).
 */
async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

/* -------------------------------------------------------------- estratégias */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Só guarda resposta íntegra: `opaque` (cross-origin sem CORS) não serve para
  // nada aqui e `error` não deve contaminar o cache.
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cacheName);
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trim(cacheName);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Navegação sem rede e sem cache: mostra a tela de offline, nunca o erro
    // nativo do navegador (que no iOS parece que o site acabou).
    if (request.mode === "navigate") {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw error;
  }
}

/* ---------------------------------------------------------------- eventos */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Caches por nome: o precache do HTML vai para PAGE_CACHE e o dos ícones
      // para ASSET_CACHE. Guardar tudo no mesmo cache faria a poda de estáticos
      // apagar o próprio HTML de abertura.
      const [pageCache, assetCache] = await Promise.all([
        caches.open(PAGE_CACHE),
        caches.open(ASSET_CACHE),
      ]);

      // `addAll` falha inteiro se um arquivo falhar; buscamos um a um para o
      // precache não derrubar a instalação por causa de um ícone.
      await Promise.all([
        pageCache.add(new Request("/", { cache: "reload" })).catch(() => undefined),
        pageCache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch(() => undefined),
        assetCache.add(new Request("/manifest.webmanifest", { cache: "reload" })).catch(() => undefined),
        assetCache.add(new Request("/icons/icon-192.png", { cache: "reload" })).catch(() => undefined),
      ]);
      // Sem `skipWaiting` aqui: a nova versão espera o usuário aceitar. Um SW
      // que assume no meio de um pedido é como se atualiza o app por baixo.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Apaga caches de versões anteriores — inclusive os de uma etapa antiga
      // do projeto, que não têm o prefixo (nome fixo).
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              (name.startsWith("menuvo-") &&
                name !== ASSET_CACHE &&
                name !== PAGE_CACHE &&
                name !== IMAGE_CACHE) ||
              name === "menuvo-assets" ||
              name === "menuvo-pages",
          )
          .map((name) => caches.delete(name)),
      );

      // Faz o app instalado abrir sem rede já na primeira vez.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Só GET entra em cache. POST/PUT/PATCH/DELETE (Server Actions, login,
  // pedido) vão direto para a rede — uma resposta de escrita em cache é um bug
  // de dados, não um ganho de performance.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Extensões de navegador e esquemas estranhos ficam de fora.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Nada sensível toca no cache, em nenhuma circunstância.
  //
  // Ainda assim, quando o que falhou foi a **abertura de uma tela do painel**, a
  // pessoa merece a tela de "sem conexão" e não o erro nativo do navegador —
  // que no iPhone parece que o app quebrou. Servimos o `offline.html` do cache:
  // ele não tem dado de ninguém, é igual para todo mundo. Nenhuma resposta do
  // painel é guardada; só a página de aviso.
  if (isSensitive(url)) {
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request).catch(async () => {
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? Response.error();
        }),
      );
    }
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (isSupabaseImage(url)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  if (isMenuPage(url) || request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE));
  }
});
