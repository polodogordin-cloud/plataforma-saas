/**
 * Headers de segurança — Etapa 14.
 *
 * Módulo neutro: recebe o contexto e devolve o mapa de headers. Quem aplica é o
 * middleware (e, para o que é estável, o `next.config.ts`).
 *
 * ─── A decisão difícil: nonce ou `unsafe-inline` no cardápio ──────────────
 *
 * Uma CSP com `nonce` é mais forte: cada `<script>` precisa carregar o nonce
 * daquela resposta, então script injetado por XSS não roda. O preço é que o
 * Next **deixa de poder gerar HTML estático** — o nonce muda a cada resposta,
 * logo a página passa a ser renderizada por requisição. No cardápio público
 * isso significaria perder o ISR de 60 s e pagar uma consulta ao banco a cada
 * visita de cliente. O item 6 do escopo pede "extremamente rápido"; trocar
 * cache por nonce ali é o trade-off errado.
 *
 * Por isso as rotas se dividem:
 *
 *   • **app autenticado** (`/app`, `/admin`, `/entrar`…) já é dinâmico — lê
 *     cookie e sessão em toda requisição. Nonce sai de graça e é usado.
 *   • **cardápio público** (`/r/...`) é ISR. Recebe CSP com `'unsafe-inline'`
 *     para script, e a proteção real fica nas diretivas que não dependem de
 *     nonce: `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
 *     `frame-ancestors` e `connect-src` limitado ao próprio site + Supabase.
 *     Continua impedindo exfiltração e injeção de `<object>`/`<base>`, que é o
 *     que um cardápio com texto de terceiros precisa.
 *
 * Está escrito aqui porque, lendo só o header, alguém pode achar que é
 * descuido. É escolha, e a nota de rodapé é o preço.
 */

export type SecurityContext = {
  /**
   * Produção **e** servindo em HTTPS: habilita HSTS.
   *
   * As duas condições são necessárias. Mandar HSTS numa resposta `http://`
   * (local, `next start` sem proxy, ambiente de teste) faz o navegador do
   * desenvolvedor passar a exigir HTTPS para aquele host — e aí `localhost`
   * para de responder em http até alguém limpar o cache do navegador. Foi
   * exatamente o que este harness pegou.
   */
  production: boolean;
  /** A resposta sai por HTTPS? */
  https?: boolean;
  /** Nonce da resposta. Ausente = política sem nonce (rota estática). */
  nonce?: string | null;
  /** Host do Supabase, para liberar `connect-src`/`img-src`. */
  supabaseHost?: string | null;
  /** `true` em rotas de conteúdo público cacheável (ISR). */
  cacheable?: boolean;
};

const BASE_DIRECTIVES = [
  "default-src 'self'",
  // `data:` é usado pelo preview de imagem no painel; `blob:` pelo upload
  // otimizado no cliente antes de enviar ao Supabase Storage.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nada de embutir o app num iframe de terceiro (clickjacking). O mesmo
  // recado do X-Frame-Options, mas em CSP — que é o que navegador moderno lê.
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
];

export function contentSecurityPolicy(context: SecurityContext): string {
  const connect = ["'self'"];
  const supabase = (context.supabaseHost ?? "").trim();

  if (supabase) {
    connect.push(`https://${supabase}`, `wss://${supabase}`);
  }

  const script = !context.cacheable && context.nonce
    ? [
        "'self'",
        `'nonce-${context.nonce}'`,
        // O Next carrega chunks adicionais a partir do primeiro script
        // confiável; sem isto, `nonce` + code splitting brigam.
        "'strict-dynamic'",
      ]
    : ["'self'", "'unsafe-inline'"];

  const directives = [
    `script-src ${script.join(" ")}`,
    `connect-src ${connect.join(" ")}`,
    ...BASE_DIRECTIVES,
  ];

  /*
   * `'strict-dynamic'` faz navegador ignorar `'self'` em `script-src`. Em
   * navegador que não o conhece, `'self'` é o que sobra — por isso os dois
   * aparecem juntos, em vez de um só.
   */

  return directives.join("; ");
}

/** Headers que valem em qualquer rota, sem depender de nonce. */
export function staticSecurityHeaders(context: SecurityContext): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
    "X-DNS-Prefetch-Control": "off",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  /*
   * HSTS só em produção e só via HTTPS: mandar `includeSubDomains` a partir de
   * um domínio que ainda não tem todos os subdomínios em HTTPS tranca o dono
   * fora do próprio painel por um ano. Staging fica de fora de propósito.
   */
  if (context.production && context.https) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }

  return headers;
}
