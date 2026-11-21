import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  TABLE_SESSION_COOKIE,
  TABLE_URL_PATTERN,
  parseTableToken,
} from "@/lib/table-session";
import { resolveAppEnv, isLocalHost } from "@/lib/env";
import {
  RATE_LIMITS,
  checkRateLimit,
  clientKey,
  rateLimitHeaders,
  type RateLimitRule,
} from "@/lib/rate-limit";
import { contentSecurityPolicy, staticSecurityHeaders } from "@/lib/security-headers";

/**
 * Middleware — sessão, HTTPS canônico, CSP e limite de requisições.
 *
 * Roda em **toda** navegação (o matcher exclui só asset estático). Por isso
 * tudo aqui é barato: nenhuma consulta ao banco, só cookie e contadores em
 * memória. Decisão de autorização continua no banco.
 */

const SENSITIVE_RULES: Array<{ path: RegExp | string; rule: RateLimitRule }> = [
  { path: "/api/auth/signin", rule: RATE_LIMITS.signIn },
  { path: "/api/auth/signup", rule: RATE_LIMITS.signUp },
  { path: "/api/auth/recover", rule: RATE_LIMITS.recover },
];

export async function middleware(request: NextRequest) {
  const env = resolveAppEnv();
  const { pathname, search } = request.nextUrl;

  /*
   * ─── 1. HTTPS e host canônico ────────────────────────────────────────────
   *
   * A Vercel já responde só em HTTPS. Este bloco existe para:
   *   • quem estiver atrás de outro proxy em HTTP (o `next start` numa VPS);
   *   • o domínio com `www.`, que deve virar o canônico e não servir conteúdo
   *     duplicado (o Google trata como dois sites o mesmo cardápio).
   *
   * Não redireciona em dev: `localhost` é http e ponto.
   */
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")
    ?? request.nextUrl.host;

  if (env !== "development" && forwardedProto === "http" && !isLocalHost(host)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = host;
    return NextResponse.redirect(url, 308);
  }

  /*
   * `www.` → apex. Só quando existir um domínio configurado: sem essa âncora,
   * a regra transformaria `menuvo.vercel.app` em `vercel.app` num deploy de
   * preview — o tipo de redirecionamento que ninguém descobre até o link
   * quebrar no celular do cliente.
   */
  const configuredHost = safeConfiguredHost();
  if (
    env !== "development" &&
    configuredHost &&
    host === `www.${configuredHost}`
  ) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = configuredHost;
    return NextResponse.redirect(url, 308);
  }

  /*
   * ─── 2. Limite de requisições ────────────────────────────────────────────
   *
   * Serve para uma camada extra de defesa nos endpoints de autenticação — que
   * aqui são Server Actions, não rotas. As actions chamam o mesmo módulo
   * (`checkRateLimit`) por conta própria; estas entradas cobrem o caso de
   * alguém bater direto numa rota de API equivalente.
   *
   * O cardápio público **não** é limitado aqui: ele é cacheado e servido pelo
   * CDN, e limitar no edge por IP tem custo real em restaurante cheio (todo
   * mundo atrás do mesmo Wi-Fi sai com o mesmo IP público).
   */
  for (const entry of SENSITIVE_RULES) {
    const matches =
      typeof entry.path === "string" ? pathname === entry.path : entry.path.test(pathname);

    if (matches) {
      const result = checkRateLimit(entry.rule, clientKey(request.headers));
      if (!result.allowed) {
        return new NextResponse(
          JSON.stringify({ error: "Muitas tentativas. Tente novamente em alguns minutos." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...rateLimitHeaders(result),
            },
          },
        );
      }
    }
  }

  // ─── 3. Sessão do Supabase + proteção de rota privada ───────────────────
  const response = await updateSession(request);

  // ─── 4. Mesa aberta por QR Code/NFC ─────────────────────────────────────
  // Um Server Component não pode gravar cookie; o middleware pode, e roda
  // antes da página. É assim que a Etapa 6 acha a mesa na sessão.
  const match = TABLE_URL_PATTERN.exec(pathname);
  const token = parseTableToken(match?.[2]);

  if (token) {
    if (request.cookies.get(TABLE_SESSION_COOKIE)?.value !== token) {
      response.cookies.set(TABLE_SESSION_COOKIE, token, {
        path: "/",
        maxAge: 60 * 60 * 3,
        sameSite: "lax",
        secure: env !== "development",
      });
    }
  }

  // ─── 5. CSP e headers de segurança ──────────────────────────────────────
  applySecurityHeaders(request, response, env);

  return response;
}

/**
 * O cardápio público é ISR: HTML gerado uma vez e servido por 60 s. Nonce
 * nele forçaria renderização por requisição — o oposto do que o item 6 pede.
 * Fora dele (app autenticado, admin, login) a página já é dinâmica e o nonce
 * não custa nada.
 */
function isCacheablePath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/r/");
}

function applySecurityHeaders(
  request: NextRequest,
  response: NextResponse,
  env: ReturnType<typeof resolveAppEnv>,
) {
  const pathname = request.nextUrl.pathname;
  const cacheable = isCacheablePath(pathname);

  /*
   * Nonce por resposta. Gerado com Web Crypto (disponível no edge); se por
   * algum motivo falhar, seguimos sem nonce em vez de derrubar a página.
   */
  let nonce: string | null = null;
  if (!cacheable) {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      nonce = btoa(String.fromCharCode(...bytes));
    } catch {
      nonce = null;
    }
  }

  /*
   * HSTS exige as duas coisas: produção **e** HTTPS real. Em produção atrás de
   * proxy (Vercel), o protocolo chega em `x-forwarded-proto`; é ele que vale,
   * não o `request.nextUrl.protocol` (que é sempre http do lado de dentro).
   */
  const isHttps = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() === "https";

  const context = {
    production: env === "production",
    https: isHttps,
    nonce,
    supabaseHost: supabaseHostname(),
    cacheable,
  };

  const headers = staticSecurityHeaders(context);
  headers["Content-Security-Policy"] = contentSecurityPolicy(context);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  // O Next lê o nonce deste header para carimbar os próprios scripts.
  if (nonce) response.headers.set("x-nonce", nonce);
}

function supabaseHostname(): string | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

function safeConfiguredHost(): string | null {
  try {
    const url = process.env.NEXT_PUBLIC_SITE_URL;
    if (!url) return null;
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    // Não redireciona a partir de IP/vercel.app: só faz sentido com domínio
    // próprio, que é justamente o que a Etapa 14 prepara.
    if (/\d+\.\d+\.\d+\.\d+/.test(parsed.hostname)) return null;
    if (parsed.hostname.endsWith(".vercel.app")) return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto assets estáticos e imagens.
     *
     * Etapa 12 — as exclusões **não** são otimização, são correção:
     *
     *   • `manifest.webmanifest` e `sw.js` são o que o navegador busca para
     *     instalar o app. Passando pelo middleware, cada busca criava um cliente
     *     Supabase e um `getUser()` — e, com o Supabase fora do ar, a instalação
     *     falhava por um erro que nada tem a ver com ela.
     *
     *   • `offline.html` é servido **justamente quando não há rede**. Se
     *     dependesse do middleware, poderia virar um 500 no lugar da tela de
     *     "sem conexão".
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|offline\\.html$|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
