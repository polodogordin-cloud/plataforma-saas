/**
 * Configuração de ambiente — Etapa 14.
 *
 * ─── O problema que este arquivo resolve ──────────────────────────────────
 *
 * Antes desta etapa, cada lugar que precisava da URL pública do site fazia a
 * sua conta: `headers()` num arquivo, `request.nextUrl.origin` noutro,
 * `process.env.NEXT_PUBLIC_SITE_URL ?? "https://menuvo.app"` num terceiro. Três
 * respostas diferentes para a mesma pergunta geram três bugs diferentes:
 *
 *   • o QR Code impresso aponta para `http://` porque quem montou a URL não
 *     soube que estava atrás de um proxy;
 *   • o `canonical` do cardápio sai com o domínio da Vercel e o Google indexa
 *     o endereço errado;
 *   • o link de recuperação de senha aponta para `localhost` em produção.
 *
 * Aqui existe **uma** função (`getSiteOrigin`) e **um** diagnóstico
 * (`readEnvironment`). O resto do app não lê `process.env` para descobrir onde
 * está.
 *
 * ─── Sobre secrets ────────────────────────────────────────────────────────
 *
 * Nada aqui imprime valor de variável. `readEnvironment` devolve *estado*
 * (`set` / `missing` / `invalid`), nunca conteúdo — ele é seguro para log e para
 * o endpoint de diagnóstico em `/api/health`.
 *
 * O módulo é neutro: sem `next/*`, sem `window`. Roda no servidor, no navegador
 * e nos harnesses de teste.
 */

/* -------------------------------------------------------------------------- */
/* Origens confiáveis                                                         */
/* -------------------------------------------------------------------------- */

export type AppEnv = "development" | "staging" | "production";

/**
 * Classifica o ambiente.
 *
 * A ordem importa: `staging` é reconhecido **antes** de `production`, porque um
 * deploy de staging costuma rodar com `NODE_ENV=production` (é o que a Vercel
 * faz). Sem essa precedência, staging se apresentaria como produção — e
 * staging é justamente onde a gente testa coisas que quebrariam produção.
 */
export function resolveAppEnv(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
): AppEnv {
  const explicit = (appEnv ?? "").trim().toLowerCase();
  if (explicit === "staging" || explicit === "preview") return "staging";
  if (explicit === "production" || explicit === "prod") return "production";
  if (explicit === "development" || explicit === "dev") return "development";

  return nodeEnv === "production" ? "production" : "development";
}

/** `true` quando o app roda em produção de verdade (não staging). */
export function isProduction(env: AppEnv = resolveAppEnv()): boolean {
  return env === "production";
}

/**
 * Hosts extras aceitos além do domínio próprio.
 *
 * A Vercel cria uma URL por deploy (`menuvo-abc123-....vercel.app`) e uma por
 * branch. Sem aceitá-las, o preview de um PR não renderiza — e é nele que a
 * gente revisa antes de publicar. O padrão cobre o sufixo da Vercel; quem usar
 * outra plataforma declara os hosts em `TRUSTED_EXTRA_HOSTS`.
 */
const PLATFORM_HOST_PATTERN = /\.vercel\.app$/i;

export function extraTrustedHosts(
  raw: string | undefined = process.env.TRUSTED_EXTRA_HOSTS,
): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A origem canônica da implantação — a que vai no QR Code, no `canonical`, no
 * sitemap e no e-mail de recuperação.
 *
 * Ordem de decisão:
 *   1. `NEXT_PUBLIC_SITE_URL`, se estiver preenchida e for https (ou http em dev);
 *   2. o host que atendeu a requisição, quando ele é confiável;
 *   3. vazio — e aí o chamador decide (nunca inventamos um domínio).
 *
 * O passo 2 existe porque esquecer de configurar `NEXT_PUBLIC_SITE_URL` não
 * pode transformar todo QR Code em `https://menuvo.app`. O passo 3 existe
 * porque devolver um domínio que não é o nosso é pior que devolver nada: um QR
 * apontando para o site de outra pessoa é um bug que só aparece impresso.
 */
export function resolveSiteOrigin({
  configured = process.env.NEXT_PUBLIC_SITE_URL,
  requestHost,
  requestProto,
  env = resolveAppEnv(),
  trustedHosts,
}: {
  configured?: string | null;
  requestHost?: string | null;
  requestProto?: string | null;
  env?: AppEnv;
  trustedHosts?: string[];
} = {}): string | null {
  const fromEnv = normalizeOrigin(configured, env);
  if (fromEnv) return fromEnv;

  const host = (requestHost ?? "").trim().toLowerCase();
  if (!host || !isTrustedHost(host, { env, trustedHosts })) return null;

  return `${normalizeProto(requestProto, env)}://${host}`;
}

/**
 * Normaliza uma origem: valida esquema, remove barra final e caminho.
 *
 * `env` é parâmetro, não leitura global. A primeira versão lia
 * `resolveAppEnv()` direto e por isso aceitava `http://` em produção quando o
 * teste (ou um processo com NODE_ENV diferente) chamava com outro ambiente —
 * o harness pegou exatamente isso.
 */
export function normalizeOrigin(
  value: string | null | undefined,
  env: AppEnv = resolveAppEnv(),
): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Fora de desenvolvimento, http só é aceitável em host local — o resto é
    // erro de configuração e o navegador vai bloquear de qualquer forma.
    if (url.protocol === "http:" && !isLocalHost(url.hostname) && env !== "development") {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function isLocalHost(host: string): boolean {
  const name = (host.split(":")[0] ?? "").toLowerCase();
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "0.0.0.0" ||
    name === "[::1]" ||
    name === "::1" ||
    name.endsWith(".localhost")
  );
}

/**
 * O host pode ser usado para montar URL pública?
 *
 * Aceita: localhost (dev), o host de `NEXT_PUBLIC_SITE_URL`, os hosts extras e
 * o sufixo da Vercel. Recusa qualquer outro — um header `Host` forjado não
 * vira QR Code apontando para o site do atacante.
 */
export function isTrustedHost(
  host: string | null | undefined,
  {
    env = resolveAppEnv(),
    trustedHosts = extraTrustedHosts(),
  }: { env?: AppEnv; trustedHosts?: string[] } = {},
): boolean {
  const name = (host ?? "").trim().toLowerCase();
  if (!name) return false;
  // `Host` não traz esquema nem caminho; qualquer coisa além de host[:porta]
  // é tentativa de injeção.
  if (!/^[a-z0-9.\-[\]:]+$/.test(name)) return false;
  if (isLocalHost(name)) return true;

  if (trustedHosts.some((trusted) => trusted === name)) return true;
  if (PLATFORM_HOST_PATTERN.test(name)) return true;

  const configured = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL, env);
  if (configured) {
    try {
      if (new URL(configured).host.toLowerCase() === name) return true;
    } catch {
      // origem configurada inválida: cai no padrão da plataforma
    }
  }

  // Em desenvolvimento, qualquer host serve: túnel (ngrok), IP da rede local
  // para testar no celular de verdade.
  return env === "development";
}

function normalizeProto(proto: string | null | undefined, env: AppEnv): "http" | "https" {
  const value = (proto ?? "").trim().toLowerCase();
  if (value === "http" || value === "https") return value;
  // Sem header (ou header estranho): em dev assume http, fora dele https. O
  // contrário produziria link `http://` num site que só responde em https.
  return env === "development" ? "http" : "https";
}

/* -------------------------------------------------------------------------- */
/* Diagnóstico                                                                */
/* -------------------------------------------------------------------------- */

export type EnvVarState = "set" | "missing" | "invalid";

export type EnvVarReport = {
  name: string;
  state: EnvVarState;
  /** O que quebra quando falta. Vai para log e para o README. */
  impact: string;
  /** Chave pública: pode aparecer no navegador, protegida por RLS. */
  public: boolean;
};

/**
 * Lê o ambiente e devolve **estado**, nunca valores.
 *
 * Usado por `/api/health` (protegido) e pelos testes. É o que transforma "o
 * deploy subiu e o login não funciona" em "falta NEXT_PUBLIC_SUPABASE_ANON_KEY".
 */
export function readEnvironment(
  source: Record<string, string | undefined> = process.env,
  env: AppEnv = resolveAppEnv(source.NODE_ENV, source.NEXT_PUBLIC_APP_ENV),
): { env: AppEnv; vars: EnvVarReport[]; ok: boolean } {
  const supabaseUrl = (source.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const siteUrl = (source.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const anonKey = (source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  const vars: EnvVarReport[] = [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      state: !supabaseUrl ? "missing" : isHttpUrl(supabaseUrl) ? "set" : "invalid",
      impact: "Sem ela, nenhuma leitura de banco funciona: login, cardápio e painel.",
      public: true,
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      state: !anonKey ? "missing" : isJwtLike(anonKey) ? "set" : "invalid",
      impact: "Sem ela, o cliente Supabase não autentica nem em modo anônimo.",
      public: true,
    },
    {
      name: "NEXT_PUBLIC_SITE_URL",
      state: !siteUrl ? "missing" : normalizeOrigin(siteUrl) ? "set" : "invalid",
      impact:
        "Sem ela, QR Code, canonical e e-mail de recuperação usam o host da requisição.",
      public: true,
    },
    {
      name: "NEXT_PUBLIC_APP_ENV",
      state: source.NEXT_PUBLIC_APP_ENV ? "set" : "missing",
      impact: "Ausente: o ambiente é deduzido de NODE_ENV (staging pode se passar por produção).",
      public: true,
    },
    {
      name: "PAYMENT_PROVIDER",
      state: source.PAYMENT_PROVIDER ? "set" : "missing",
      impact: "Ausente: nenhuma cobrança é feita (esperado nesta fase).",
      public: false,
    },
    {
      name: "WHATSAPP_PROVIDER",
      state: source.WHATSAPP_PROVIDER ? "set" : "missing",
      impact: "Ausente: o botão usa wa.me (link), que é o padrão esperado.",
      public: false,
    },
  ];

  // Só o que é obrigatório em qualquer ambiente entra no veredito. As
  // integrações opcionais aparecem no relatório mas não derrubam o /api/health:
  // um deploy sem gateway de pagamento é um deploy válido nesta fase.
  const required = new Set([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]);

  const ok =
    vars.every((item) => !required.has(item.name) || item.state === "set") &&
    // Em produção, site URL ausente não impede o app de subir, mas é o tipo de
    // erro que só aparece no QR Code impresso. Conta como falha.
    (env !== "production" || vars.find((v) => v.name === "NEXT_PUBLIC_SITE_URL")?.state === "set");

  return { env, vars, ok };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Chave do Supabase tem forma de JWT (`xxx.yyy.zzz`) ou o prefixo novo
 * `sb_publishable_`. Só checamos a forma: validar assinatura aqui seria
 * duplicar o que o próprio Supabase faz na primeira chamada.
 */
function isJwtLike(value: string): boolean {
  if (value.startsWith("sb_publishable_")) return true;
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Helpers de URL                                                             */
/* -------------------------------------------------------------------------- */

/** Concatena caminho à origem sem barra dupla nem barra faltando. */
export function joinUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tail}`;
}

/**
 * Destino de redirecionamento seguro.
 *
 * Aceita só caminho **interno** (`/app/pedidos`). Recusa `//evil.com`,
 * `https://evil.com` e `/\evil.com` — as três formas clássicas de transformar
 * `?next=` em redirect aberto, usado em phishing com o domínio do restaurante
 * na barra de endereço.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/app",
): string {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith("/")) return fallback;
  // `//host` e `/\host` são protocol-relative: o navegador trata como externo.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Caminho interno nunca tem esquema nem caractere de controle.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return fallback;
  return raw;
}
