/**
 * Configuração do PWA — Etapa 12.
 *
 * Módulo **neutro** (sem `next/*`, sem `window`): o manifest, o service worker e
 * a geração de ícones compartilham estes valores, e o harness de teste importa
 * este arquivo direto. Duplicar cor ou caminho aqui e ali é como o manifest
 * passa a divergir do ícone gerado — e o sintoma aparece só no celular do
 * cliente, que é o pior lugar para descobrir.
 */

export const APP_NAME = "Menuvo";
export const APP_FULL_NAME = "Menuvo · Cardápios digitais";
export const APP_DESCRIPTION =
  "Cardápio digital, mesas, pedidos e gestão do seu restaurante — no celular.";
export const APP_LANG = "pt-BR";

/** Cor da marca. Igual ao `--color-brand-600` do CSS e ao manifest. */
export const THEME_COLOR = "#0f9250";
/** Fundo do splash gerado pelo sistema operacional no Android. */
export const BACKGROUND_COLOR = "#ffffff";
/** Splash e barra de status quando instalado em modo escuro. */
export const BACKGROUND_COLOR_DARK = "#0e0f14";

/**
 * Onde o app abre ao ser tocado no ícone.
 *
 * `/app` é o painel: quem instala é o dono do restaurante, não o cliente final
 * (cliente final abre pelo QR Code e não instala). O middleware manda para
 * `/entrar?next=/app` quando não há sessão, e volta para `/app` depois do login
 * — então o `start_url` continua correto nos dois casos.
 */
export const START_URL = "/app";
/** Escopo do app: nada fora de `/` (o cardápio público também é nosso). */
export const SCOPE = "/";
export const DISPLAY = "standalone";
export const ORIENTATION = "portrait";

/* -------------------------------------------------------------------------- */
/* Ícones                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ícones exigidos pela instalação.
 *
 * 192 e 512 são o mínimo real: o Chrome Android usa o 192 na gaveta de apps e o
 * 512 na splash/tela inicial; o iOS usa o `apple-touch-icon` (180) e ignora o
 * manifest para isso. Declarar só SVG funciona no papel e falha no aparelho —
 * navegador nenhum instala confiável com SVG sozinho.
 *
 * `maskable` existe separado porque o Android recorta o ícone em círculo/squircle:
 * usar a arte "any" nesse recorte corta a haste do garfo. A versão maskable é
 * desenhada dentro da zona segura.
 */
export const ICON_SIZES = [192, 512] as const;

export type IconEntry = {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
};

export const ICONS: IconEntry[] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

/** iOS ignora o manifest para o ícone: precisa deste link no `<head>`. */
export const APPLE_TOUCH_ICON = "/icons/apple-touch-icon.png";
export const FAVICON = "/icons/favicon-32.png";

/* -------------------------------------------------------------------------- */
/* Service worker                                                              */
/* -------------------------------------------------------------------------- */

export const SW_PATH = "/sw.js";
/** Escopo padrão do SW na raiz: cobre cardápio público e o shell do painel. */
export const SW_SCOPE = "/";

/**
 * Versão do cache.
 *
 * **Trocar este valor é o que faz uma nova versão chegar ao aparelho.** O SW
 * apaga caches de versões anteriores no `activate`, então subir a string é
 * equivalente a um "deploy" do lado do cliente. O build injeta a versão do
 * `package.json` + hash dos assets, mas manter o padrão explícito aqui evita
 * servir HTML antigo com JS novo (ou o contrário) depois de um deploy.
 */
export const CACHE_VERSION = "menuvo-v1";

/* -------------------------------------------------------------------------- */
/* Política de cache — o coração da etapa 5 do escopo                          */
/* -------------------------------------------------------------------------- */

/**
 * Regras, em ordem de prioridade. A primeira que casar decide.
 *
 * O princípio que guia a lista: **o SW pode guardar o que é igual para todo
 * mundo e não muda com o pedido de ninguém**. HTML de cardápio entra com
 * estratégia de rede-primeiro porque preço e disponibilidade mudam; dados de
 * pedido, sessão e API **nunca** entram.
 */
export type CacheStrategy =
  /** Busca na rede e guarda; se a rede falhar, usa o cache. */
  | "network-first"
  /** Usa o cache; se não houver, busca e guarda. */
  | "cache-first"
  /** Só rede. Nunca guarda, nunca serve do cache. */
  | "network-only";

export type CacheRule = {
  /** Nome simbólico (aparece nos testes e nos comentários). */
  id: string;
  match: RegExp;
  strategy: CacheStrategy;
  /** Nome do cache onde a resposta pode ser guardada. */
  cache?: string;
  /** Teto de entradas, para o cache não crescer sem limite no celular. */
  maxEntries?: number;
  /** Por que esta regra existe — fica documentado no próprio arquivo. */
  reason: string;
};

export const ASSET_CACHE = "menuvo-assets";
export const PAGE_CACHE = "menuvo-pages";
export const IMAGE_CACHE = "menuvo-images";

export const CACHE_RULES: CacheRule[] = [
  {
    id: "mutations",
    // Qualquer escrita e qualquer chamada de API/Auth passa direto.
    match: /^\/(?:api|auth)\//,
    strategy: "network-only",
    reason:
      "Login, logout, Server Actions e webhooks. Uma resposta de escrita em cache é um bug de dados, não um ganho de performance.",
  },
  // Antes da regra do Supabase de propósito: `/storage/v1/object/public/` é
  // público de verdade (sem RLS, sem token) e é a maior payload do cardápio.
  // Deixar a regra `network-only` do Supabase capturar estas URLs primeiro
  // anulava o maior ganho da etapa — o harness pegou exatamente isso.
  {
    id: "menu-images",
    // Fotos de produto ficam no Storage público do Supabase.
    match: /\/storage\/v1\/object\/public\//,
    strategy: "cache-first",
    cache: IMAGE_CACHE,
    maxEntries: 120,
    reason:
      "Foto de produto é a maior payload do cardápio e muda pouco. Guardar acelera a segunda visita sem risco: a URL é o próprio caminho do arquivo.",
  },
  {
    id: "supabase-auth",
    // Chamadas diretas ao Supabase (REST/Auth/Realtime) nunca são cacheadas.
    match: /^https:\/\/[a-z0-9-]+\.supabase\.co\//i,
    strategy: "network-only",
    reason:
      "Toda resposta do Supabase é por usuário (RLS) ou por token de mesa. Cachear aqui serviria dado de uma casa para outra pessoa.",
  },
  {
    id: "private-panel",
    // O painel nunca é servido offline: dado de uma sessão não pode reaparecer
    // para outra pessoa no mesmo aparelho.
    match: /^\/app(?:\/|$)|^\/admin(?:\/|$)|^\/onboarding(?:\/|$)|\/configuracoes(?:\/|$)/,
    strategy: "network-only",
    reason:
      "Painel e cadastro são por sessão. Sem rede, o certo é mostrar a tela de offline — não uma página de outra conta.",
  },
  {
    id: "static-assets",
    match: /^\/_next\/static\//,
    strategy: "cache-first",
    cache: ASSET_CACHE,
    reason:
      "Build do Next tem hash no nome do arquivo: o conteúdo daquela URL nunca muda, então cache-first é seguro e é o maior ganho de abertura.",
  },
  {
    id: "fonts-and-icons",
    match: /^\/icons\/|^\/fonts\/|^\/favicon\.ico$|^\/icon\.svg$/,
    strategy: "cache-first",
    cache: ASSET_CACHE,
    maxEntries: 60,
    reason: "Ícones e fontes são imutáveis e pequenos; sem eles o app instalado abre 'quebrado'.",
  },
  {
    id: "public-menu-page",
    // Cardápio público: HTML que contém preço. Rede primeiro, cache como rede
    // de segurança.
    match: /^\/r\/[^/]+(?:\/table\/[^/]+)?\/?(?:\?.*)?$/,
    strategy: "network-first",
    cache: PAGE_CACHE,
    maxEntries: 20,
    reason:
      "Preço e disponibilidade precisam ser os de agora. Offline, a última versão conhecida é melhor que a tela de erro — e o carrinho nunca é restaurado do cache (ver `isSensitiveRequest`).",
  },
  {
    id: "app-shell",
    // Navegação de páginas públicas (landing, planos, login) pode vir do cache.
    match: /^\/(?:$|planos|entrar|criar-conta|recuperar-senha|redefinir-senha|privacidade|termos)/,
    strategy: "network-first",
    cache: PAGE_CACHE,
    maxEntries: 20,
    reason:
      "Páginas de marketing e login mudam pouco e precisam abrir sem rede. Continua network-first para não servir copy antiga por dias.",
  },
];

/** Aplica as regras na ordem declarada. Sem regra = rede pura (padrão seguro). */
export function resolveCacheRule(url: URL | string): CacheRule | null {
  const raw = typeof url === "string" ? url : `${url.pathname}${url.search}`;
  for (const rule of CACHE_RULES) {
    // Regras de URL absoluta testam a URL inteira; as de caminho, o caminho.
    const target = rule.match.source.startsWith("^https") ? raw : raw.replace(/^https?:\/\/[^/]+/i, "");
    if (rule.match.test(target)) return rule;
  }
  return null;
}

/**
 * Requisição que **jamais** pode ser guardada nem servida do cache?
 *
 * Camada redundante de propósito. As regras acima já excluem API, auth e
 * painel; esta função existe porque a regra que protege dados de pedido é a
 * mais importante da etapa e não pode depender de alguém lembrar da ordem da
 * lista ao acrescentar uma regra nova no futuro.
 */
export function isSensitiveRequest(url: URL | string): boolean {
  const text = typeof url === "string" ? url : `${url.pathname}${url.search}`;
  return (
    // Nunca cachear resposta de escrita.
    /^\/(?:api|auth)\//.test(text) ||
    // Nunca cachear nada do Supabase.
    /supabase\.co\//i.test(text) ||
    // Nunca cachear painel, admin, onboarding, configurações.
    /^\/(?:app|admin|onboarding)(?:\/|$)/.test(text) ||
    /\/configuracoes(?:\/|$)/.test(text) ||
    // Pedido e carrinho: mesmo em cardápio público, o POST/estado de pedido
    // nunca é cacheado. A URL de mesa *pode* ser cacheada (ver regra
    // public-menu-page), mas nenhuma resposta de criação de pedido entra.
    /\/order|\/orders|\/carrinho|\/cart/i.test(text)
  );
}

/* -------------------------------------------------------------------------- */
/* Instalação                                                                 */
/* -------------------------------------------------------------------------- */

export const INSTALL_DISMISS_KEY = "menuvo:install-dismissed-at";
/** Não insistir antes disso, mesmo que o navegador ofereça de novo. */
export const INSTALL_DISMISS_DAYS = 30;
/** Só sugerir instalação depois que a pessoa usou o app de verdade. */
export const INSTALL_MIN_VISITS = 2;

export type InstallPlatform = "android" | "ios" | "desktop" | "unknown";

/**
 * Classifica o aparelho para escolher **qual** instrução mostrar.
 *
 * iOS não dispara `beforeinstallprompt`: a única instalação é pelo menu
 * Compartilhar do Safari. Mostrar "toque em Instalar" para iPhone é prometer um
 * botão que não existe — por isso a distinção.
 */
export function detectPlatform(input: {
  userAgent: string;
  maxTouchPoints?: number;
  platform?: string;
}): InstallPlatform {
  const ua = input.userAgent;
  const isIpad =
    /iPad/i.test(ua) || (input.platform === "MacIntel" && (input.maxTouchPoints ?? 0) > 1);
  if (/iPhone|iPod/i.test(ua) || isIpad) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "unknown";
}

/** Já está rodando instalado (standalone/fullscreen)? Não faz sentido oferecer. */
export function isStandalone(input: {
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
}): boolean {
  return Boolean(input.displayModeStandalone || input.navigatorStandalone);
}

/**
 * Ainda vale mostrar o convite?
 *
 * Regra explícita do escopo: **não mostrar repetidamente** e permitir
 * dispensar. Um convite que reaparece é o jeito mais rápido de ensinar o usuário
 * a ignorar qualquer aviso nosso.
 */
export function shouldOfferInstall(input: {
  dismissAt: number | null;
  now: number;
  visits: number;
  platform: InstallPlatform;
  standalone: boolean;
  minVisits?: number;
  dismissDays?: number;
}): boolean {
  if (input.standalone) return false;
  if (input.platform === "desktop" || input.platform === "unknown") return false;

  const minVisits = input.minVisits ?? INSTALL_MIN_VISITS;
  if (input.visits < minVisits) return false;

  if (input.dismissAt === null) return true;

  const days = input.dismissDays ?? INSTALL_DISMISS_DAYS;
  return input.now - input.dismissAt > days * 24 * 60 * 60 * 1000;
}

/** Texto por plataforma. iPhone recebe o caminho do Safari, não um botão falso. */
export const INSTALL_COPY = {
  title: "Instale o app para acessar mais rápido.",
  androidBody: "Adicione o Menuvo à tela inicial e abra com um toque, sem passar pelo navegador.",
  iosBody: 'Toque em Compartilhar e depois em "Adicionar à Tela de Início".',
  androidCta: "Instalar",
  iosCta: "Entendi",
  dismiss: "Agora não",
} as const;
