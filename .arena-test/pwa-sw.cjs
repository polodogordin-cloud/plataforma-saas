/**
 * Harness do service worker — Etapa 12, item 5.
 *
 * Executa o **arquivo real** (`src/sw-source.js`, com a versão carimbada como em
 * produção) dentro de um ambiente simulado de service worker: `self`, `caches`,
 * `fetch`, `clients` e `Request`/`Response` reais do Node.
 *
 * Por que simular em vez de só ler o texto: as regras de cache são um conjunto de
 * `if`s encadeados, e a ordem deles muda o resultado. O bug encontrado na
 * primeira versão (fotos de produto capturadas pela regra do Supabase) só
 * apareceu ao rodar. Aqui cada URL entra pelo `fetch` de verdade e o teste diz
 * qual estratégia respondeu e o que ficou no cache.
 */
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "src/sw-source.js");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ------------------------------------------------------ CacheStorage fake */

class FakeCache {
  /** `fetchImpl` fiel ao navegador: `cache.add()` é um `fetch` + `put`. */
  constructor(fetchImpl) {
    this.entries = new Map();
    this.fetchImpl = fetchImpl;
  }
  key(request) {
    return typeof request === "string" ? new URL(request, "https://menuvo.test").href : request.url;
  }
  async match(request) {
    return this.entries.get(this.key(request));
  }
  async put(request, response) {
    this.entries.set(this.key(request), response);
  }
  async add(request) {
    const url = this.key(request);
    // No navegador, `add` busca de verdade e guarda a resposta. Usar um corpo
    // inventado aqui esconderia justamente o caso em que o precache falha.
    const response = this.fetchImpl
      ? await this.fetchImpl(url)
      : new Response(`precache:${url}`, { status: 200 });

    this.entries.set(url, response);
  }
  async addAll(requests) {
    for (const request of requests) await this.add(request);
  }
  async delete(request) {
    return this.entries.delete(this.key(request));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

class FakeCaches {
  constructor(fetchImpl) {
    this.stores = new Map();
    this.fetchImpl = fetchImpl;
  }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.fetchImpl));
    return this.stores.get(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name) {
    return this.stores.delete(name);
  }
  async match(request) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

/* ------------------------------------------------------------- ambiente */

function createWorker({ fetchImpl, failing = false } = {}) {
  const listeners = new Map();
  const caches = new FakeCaches((url) => fetch(url));
  const requests = [];
  const clientCalls = [];

  // Estado mutável: um cenário precisa ficar online, instalar, e então "perder a
  // rede". Com a falha fixa no fechamento, o teste do modo offline passava sem
  // nunca simular a queda — e não provava nada.
  const net = { fetchImpl, failing: failing || !fetchImpl };
  const setOffline = (value) => {
    net.failing = value;
  };

  const fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    requests.push(url);

    if (net.failing || !net.fetchImpl) throw new TypeError("Failed to fetch");

    return net.fetchImpl(url);
  };

  const self = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: () => clientCalls.push("skipWaiting"),
    clients: { claim: async () => clientCalls.push("claim") },
    location: new URL("https://menuvo.test/"),
  };

  /*
   * Em service workers, `new Request("/offline.html")` resolve contra o escopo
   * do SW. No Node, `Request` exige URL absoluta — o SW real deste projeto usa
   * caminhos relativos no precache, então o harness precisa reproduzir a regra
   * do navegador em vez de "consertar" o SW para o teste.
   */
  class ScopedRequest extends Request {
    constructor(input, init) {
      super(typeof input === "string" ? new URL(input, "https://menuvo.test/").href : input, init);
    }
  }

  const context = vm.createContext({
    self,
    caches,
    fetch,
    Request: ScopedRequest,
    Response,
    URL,
    console,
  });

  const code = fs.readFileSync(SOURCE, "utf8").replaceAll("__CACHE_VERSION__", "teste-1");

  vm.runInContext(code, context, { filename: "sw-source.js" });

  /** Dispara um evento e devolve a resposta que o SW entregou (ou null). */
  async function dispatchFetch({ url, method = "GET", mode = "cors" }) {
    // `mode: "navigate"` é proibido no construtor de `Request` (só o navegador
    // pode criá-lo). Ele define apenas `request.mode`, que é o que o SW lê, então
    // montamos o objeto e ajustamos a propriedade.
    const request = new ScopedRequest(url, { method, mode: mode === "navigate" ? "cors" : mode });
    if (mode === "navigate") {
      Object.defineProperty(request, "mode", { value: "navigate", configurable: true });
    }
    let responded = null;
    let waited = null;

    listeners.get("fetch")?.({
      request,
      respondWith: (promise) => {
        responded = promise;
      },
      waitUntil: (promise) => {
        waited = promise;
      },
    });

    if (waited) await waited;
    if (!responded) return null;

    try {
      return await responded;
    } catch {
      return { error: true };
    }
  }

  async function lifecycle(type) {
    let waited = null;
    listeners.get(type)?.({ waitUntil: (promise) => (waited = promise) });
    if (waited) await waited;
  }

  return {
    dispatchFetch,
    lifecycle,
    caches,
    requests,
    clientCalls,
    listeners,
    setOffline,
    dispatchMessage: (data) => listeners.get("message")?.({ data }),
  };
}

/* --------------------------------------------------------------- testes */

(async () => {
  /* --- 1. ordem das regras: foto de produto é cache-first ---------------- */

  {
    const imageUrl =
      "https://abc.supabase.co/storage/v1/object/public/menu/produto-1.jpg";
    const worker = createWorker({
      fetchImpl: () => new Response("imagem", { status: 200 }),
    });

    await worker.dispatchFetch({ url: imageUrl });
    await worker.dispatchFetch({ url: imageUrl });

    const imageCache = worker.caches.stores.get(
      [...worker.caches.stores.keys()].find((name) => name.startsWith("menuvo-images")),
    );

    check(
      "cache: foto de produto é guardada",
      Boolean(imageCache && imageCache.entries.size === 1),
      `${imageCache?.entries.size ?? 0} entradas`,
    );
    check(
      "cache: segunda visita à foto não vai à rede",
      worker.requests.length === 1,
      `${worker.requests.length} requisições`,
    );
  }

  /* --- 2. dado de usuário nunca é cacheado ------------------------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("{}", { status: 200 }) });
    await worker.lifecycle("install").catch(() => undefined);

    const sensitive = [
      "https://abc.supabase.co/rest/v1/orders?select=*",
      "https://abc.supabase.co/auth/v1/user",
      "https://menuvo.test/api/pedidos",
      "https://menuvo.test/auth/callback",
      "https://menuvo.test/app/pedidos",
      "https://menuvo.test/app/configuracoes",
      "https://menuvo.test/admin/assinaturas",
      "https://menuvo.test/onboarding",
      "https://menuvo.test/r/pizzaria/order",
      "https://menuvo.test/carrinho",
    ];

    for (const url of sensitive) {
      await worker.dispatchFetch({ url, mode: url.includes("/app") ? "navigate" : "cors" });
    }

    const cachedUrls = [...worker.caches.stores.values()].flatMap((cache) =>
      [...cache.entries.keys()],
    );
    const leaked = cachedUrls.filter((url) => sensitive.some((s) => url.startsWith(s)));

    check(
      "segurança: nenhuma URL sensível entra no cache",
      leaked.length === 0,
      leaked.join(", ") || `${sensitive.length} URLs testadas`,
    );
  }

  /* --- 3. POST nunca é interceptado -------------------------------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("ok", { status: 200 }) });
    const response = await worker.dispatchFetch({
      url: "https://menuvo.test/app/pedidos",
      method: "POST",
    });

    check("segurança: POST passa direto (SW não responde)", response === null);
    check("segurança: POST não gera requisição nossa", worker.requests.length === 0);
  }

  /* --- 4. estáticos: cache-first e poda ---------------------------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("js", { status: 200 }) });
    const url = "https://menuvo.test/_next/static/chunks/main-abc123.js";

    await worker.dispatchFetch({ url });
    const second = await worker.dispatchFetch({ url });

    check("cache: estático com hash é cache-first", worker.requests.length === 1);
    check("cache: estático servido do cache na segunda vez", Boolean(second) && !second.error);
  }

  {
    const worker = createWorker({ fetchImpl: () => new Response("png", { status: 200 }) });
    const limit = 120;

    for (let i = 0; i < limit + 10; i++) {
      await worker.dispatchFetch({
        url: `https://abc.supabase.co/storage/v1/object/public/menu/foto-${i}.jpg`,
      });
    }

    const imageCache = worker.caches.stores.get(
      [...worker.caches.stores.keys()].find((name) => name.startsWith("menuvo-images")),
    );

    check(
      "cache: fotos respeitam o teto de 120 (celular não enche)",
      imageCache.entries.size === limit,
      `${imageCache.entries.size} entradas`,
    );

    const keys = [...imageCache.entries.keys()];
    check(
      "cache: poda remove as mais antigas, mantém as recentes",
      keys[0].endsWith("foto-10.jpg") && keys.at(-1).endsWith(`foto-${limit + 9}.jpg`),
      `${keys[0]?.split("/").at(-1)} … ${keys.at(-1)?.split("/").at(-1)}`,
    );
  }

  /* --- 5. resposta de erro não contamina o cache ------------------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("erro", { status: 500 }) });
    await worker.dispatchFetch({ url: "https://menuvo.test/_next/static/chunks/x.js" });

    const assetCache = worker.caches.stores.get(
      [...worker.caches.stores.keys()].find((name) => name.startsWith("menuvo-assets")),
    );

    check("cache: resposta 500 não é guardada", (assetCache?.entries.size ?? 0) === 0);
  }

  /* --- 6. cardápio público: rede primeiro, cache como rede de segurança -- */

  {
    let online = true;
    const worker = createWorker({
      fetchImpl: () => {
        if (!online) throw new TypeError("Failed to fetch");
        return new Response("cardapio v1", { status: 200 });
      },
    });

    const url = "https://menuvo.test/r/pizzaria";
    await worker.dispatchFetch({ url, mode: "navigate" });
    online = false;
    const offlineResponse = await worker.dispatchFetch({ url, mode: "navigate" });

    check(
      "offline: cardápio já visitado abre sem rede",
      Boolean(offlineResponse) && !offlineResponse.error,
    );

    // E o mais importante: o conteúdo é o **da rede**, não uma cópia velha,
    // quando a rede está de pé.
    online = true;
    const fresh = await worker.dispatchFetch({ url, mode: "navigate" });
    check("offline: com rede, cardápio vem atualizado", (await fresh.text()) === "cardapio v1");
  }

  /* --- 7. painel sem rede mostra a tela de aviso, não erro do navegador -- */

  {
    // Mesmo worker durante todo o cenário: instala com rede, depois perde a
    // conexão. É a sequência real de quem está no salão e o sinal cai.
    const worker = createWorker({
      fetchImpl: (url) =>
        url.endsWith("/offline.html")
          ? new Response("<html>sem conexão</html>", { status: 200 })
          : new Response("<html>painel</html>", { status: 200 }),
    });

    await worker.lifecycle("install");
    await worker.lifecycle("activate");

    const offlineCached = [...worker.caches.stores.values()].some((cache) =>
      [...cache.entries.keys()].some((url) => url.endsWith("/offline.html")),
    );
    check("offline: offline.html é precacheado na instalação", offlineCached);

    worker.setOffline(true);
    const response = await worker.dispatchFetch({
      url: "https://menuvo.test/app/pedidos",
      mode: "navigate",
    });

    const body = response && !response.error ? await response.text() : "";

    check(
      "offline: painel sem rede entrega a tela de aviso",
      body.includes("sem conexão"),
      response?.error ? "erro nativo do navegador" : body.slice(0, 30),
    );

    // E, com rede, o painel vem do servidor: nunca do cache.
    worker.setOffline(false);
    const online = await worker.dispatchFetch({
      url: "https://menuvo.test/app/pedidos",
      mode: "navigate",
    });
    check("offline: com rede, painel vem do servidor", (await online.text()).includes("painel"));
  }

  /* --- 8. ativação limpa caches de versões antigas ----------------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("ok", { status: 200 }) });
    await worker.caches.open("menuvo-assets-v0-antigo");
    await worker.caches.open("menuvo-assets"); // versão de etapa anterior, sem prefixo de versão
    await worker.caches.open("outra-coisa-do-site");
    // Instala para existirem caches da versão atual antes do activate.
    await worker.lifecycle("install");
    await worker.lifecycle("activate");

    const names = await worker.caches.keys();
    check(
      "atualização: caches antigos do Menuvo são apagados",
      !names.includes("menuvo-assets-v0-antigo") && !names.includes("menuvo-assets"),
      names.join(","),
    );
    check("atualização: cache de terceiros é preservado", names.includes("outra-coisa-do-site"));
    check(
      "atualização: caches da versão atual sobrevivem",
      names.some((name) => name.includes("teste-1")),
      names.join(","),
    );
  }

  /* --- 9. skipWaiting só sob pedido ------------------------------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("ok", { status: 200 }) });
    await worker.lifecycle("install");

    check(
      "atualização: instalação NÃO assume o controle sozinha",
      !worker.clientCalls.includes("skipWaiting"),
      worker.clientCalls.join(","),
    );

    worker.dispatchMessage({ type: "SKIP_WAITING" });
    check(
      "atualização: mensagem SKIP_WAITING faz o SW novo assumir",
      worker.clientCalls.includes("skipWaiting"),
    );

    worker.dispatchMessage({ type: "OUTRA_COISA" });
    check(
      "atualização: mensagem desconhecida é ignorada",
      worker.clientCalls.filter((c) => c === "skipWaiting").length === 1,
    );
  }

  /* --- 10. instalação sobrevive a precache parcial ---------------------- */

  {
    let calls = 0;
    const worker = createWorker({
      fetchImpl: () => {
        calls++;
        if (calls === 2) throw new TypeError("Failed to fetch");
        return new Response("ok", { status: 200 });
      },
    });

    let threw = false;
    try {
      await worker.lifecycle("install");
    } catch {
      threw = true;
    }

    check("instalação: um arquivo faltando não derruba a instalação", !threw);
  }

  /* --- 11. esquemas e extensões de navegador são ignorados -------------- */

  {
    const worker = createWorker({ fetchImpl: () => new Response("ok", { status: 200 }) });

    check(
      "escopo: chrome-extension não é interceptado",
      (await worker.dispatchFetch({ url: "chrome-extension://abc/script.js" })) === null,
    );
  }

  /* ------------------------------------------------------------ relatório */
  const failed = results.filter((r) => !r.ok);
  console.log("");
  for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  console.log(`\npwa-sw: ${results.length - failed.length}/${results.length} PASS\n`);
  process.exit(failed.length ? 1 : 0);
})();
