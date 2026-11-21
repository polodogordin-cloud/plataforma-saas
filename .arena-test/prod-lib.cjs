/**
 * Harness da Etapa 14 — produção.
 *
 * Cobre o que é **puro e verificável sem rede**: ambiente, origem canônica,
 * redirect seguro, rate limiting, CSP e headers. O que depende de servidor
 * (404/500 reais, headers na resposta HTTP) fica para `prod-ssr.cjs`.
 *
 * Rodar: node .arena-test/prod-lib.cjs
 */

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-prod");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(detail === undefined ? name : `${name} — ${detail}`);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `recebi ${JSON.stringify(actual)}, esperava ${JSON.stringify(expected)}`);
}

/* -------------------------------------------------------------------------- */
/* Bundles                                                                    */
/* -------------------------------------------------------------------------- */

function build(entry, outfile, alias = {}) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(OUT, outfile),
    bundle: true,
    platform: "node",
    format: "cjs",
    loader: { ".ts": "ts" },
    external: ["server-only"],
    alias: { "@": path.join(ROOT, "src"), ...alias },
    logLevel: "error",
  });
  return require(path.join(OUT, outfile));
}

/*
 * `server-only` precisa de um stub: em runtime de servidor o pacote é vazio,
 * mas resolvido fora do bundler do Next ele não existe. O mesmo vale para os
 * módulos que importam `@/lib/...` com "server-only" no topo.
 */
const noop = path.join(__dirname, "stubs-prod/server-only.cjs");
fs.mkdirSync(path.join(__dirname, "stubs-prod"), { recursive: true });
fs.writeFileSync(noop, "module.exports = {};\n");

const envLib = build("src/lib/env.ts", "env.cjs", { "server-only": noop });
const rateLib = build("src/lib/rate-limit.ts", "rate.cjs", { "server-only": noop });
const secLib = build("src/lib/security-headers.ts", "sec.cjs", { "server-only": noop });

/* -------------------------------------------------------------------------- */
/* 1. Ambiente                                                                */
/* -------------------------------------------------------------------------- */

{
  // Dedução a partir de NODE_ENV
  eq("env: dev por padrão", envLib.resolveAppEnv("development", undefined), "development");
  eq("env: produção por NODE_ENV", envLib.resolveAppEnv("production", undefined), "production");

  // A Vercel roda staging com NODE_ENV=production: a variável explícita manda.
  eq(
    "env: staging vence NODE_ENV=production",
    envLib.resolveAppEnv("production", "staging"),
    "staging",
  );
  eq("env: preview vira staging", envLib.resolveAppEnv("production", "preview"), "staging");
  eq("env: prod explícito", envLib.resolveAppEnv("development", "prod"), "production");

  eq("env: isProduction só em production", envLib.isProduction("staging"), false);
  eq("env: isProduction true", envLib.isProduction("production"), true);

  // readEnvironment: estado, nunca valor
  const report = envLib.readEnvironment({
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "aaa.bbb.ccc",
    NEXT_PUBLIC_SITE_URL: "https://cardapio.exemplo.com.br",
  });
  eq("readEnvironment: ok", report.ok, true);
  eq("readEnvironment: env", report.env, "production");
  check(
    "readEnvironment: não devolve valor de variável",
    !JSON.stringify(report).includes("abc.supabase.co"),
    JSON.stringify(report).slice(0, 120),
  );

  const missing = envLib.readEnvironment({ NODE_ENV: "production" });
  eq("readEnvironment: sem chave → not ok", missing.ok, false);
  eq(
    "readEnvironment: classifica faltando",
    missing.vars.find((v) => v.name === "NEXT_PUBLIC_SUPABASE_URL").state,
    "missing",
  );

  const invalidUrl = envLib.readEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "não é url",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "aaa.bbb.ccc",
  });
  eq(
    "readEnvironment: URL inválida classificada",
    invalidUrl.vars.find((v) => v.name === "NEXT_PUBLIC_SUPABASE_URL").state,
    "invalid",
  );

  const badKey = envLib.readEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sem-formato",
  });
  eq(
    "readEnvironment: chave em formato estranho",
    badKey.vars.find((v) => v.name === "NEXT_PUBLIC_SUPABASE_ANON_KEY").state,
    "invalid",
  );

  // Chave publishable nova do Supabase
  const publishable = envLib.readEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc123",
  });
  eq(
    "readEnvironment: aceita sb_publishable_",
    publishable.vars.find((v) => v.name === "NEXT_PUBLIC_SUPABASE_ANON_KEY").state,
    "set",
  );

  // Integrações opcionais não derrubam o veredito
  eq("readEnvironment: integrações ausentes não quebram", report.ok, true);
}

/* -------------------------------------------------------------------------- */
/* 2. Origem canônica e hosts confiáveis                                      */
/* -------------------------------------------------------------------------- */

{
  // A variável manda: é o que garante QR Code estável independente do host.
  eq(
    "origem: variável de ambiente vence o host",
    envLib.resolveSiteOrigin({
      configured: "https://cardapio.exemplo.com.br",
      requestHost: "menuvo-ab12.vercel.app",
      requestProto: "https",
      env: "production",
    }),
    "https://cardapio.exemplo.com.br",
  );

  // Barra final e caminho são normalizados
  eq(
    "origem: remove barra final",
    envLib.resolveSiteOrigin({ configured: "https://exemplo.com.br/", env: "production" }),
    "https://exemplo.com.br",
  );
  eq(
    "origem: descarta caminho",
    envLib.resolveSiteOrigin({ configured: "https://exemplo.com.br/app?x=1", env: "production" }),
    "https://exemplo.com.br",
  );

  // Sem variável: host da Vercel é aceito
  eq(
    "origem: aceita host *.vercel.app",
    envLib.resolveSiteOrigin({
      configured: null,
      requestHost: "menuvo-abc.vercel.app",
      requestProto: "https",
      env: "production",
    }),
    "https://menuvo-abc.vercel.app",
  );

  // Host forjado é recusado — não vira QR Code para o site do atacante
  eq(
    "origem: recusa host desconhecido",
    envLib.resolveSiteOrigin({
      configured: null,
      requestHost: "evil.example.com",
      requestProto: "https",
      env: "production",
    }),
    null,
  );

  // http em produção não é aceito como origem canônica
  eq(
    "origem: recusa http fora de dev",
    envLib.resolveSiteOrigin({ configured: "http://exemplo.com.br", env: "production" }),
    null,
  );
  eq(
    "origem: aceita http em dev",
    envLib.resolveSiteOrigin({ configured: "http://localhost:3000", env: "development" }),
    "http://localhost:3000",
  );

  // Protocolo ausente na configuração vira https
  eq(
    "origem: completa esquema ausente",
    envLib.resolveSiteOrigin({ configured: "exemplo.com.br", env: "production" }),
    "https://exemplo.com.br",
  );

  // Proto ausente em produção → https (http quebraria o link)
  eq(
    "origem: proto padrão é https fora de dev",
    envLib.resolveSiteOrigin({ requestHost: "abc.vercel.app", env: "production" }),
    "https://abc.vercel.app",
  );

  // Hosts extras declarados
  eq(
    "origem: TRUSTED_EXTRA_HOSTS aceito",
    envLib.resolveSiteOrigin({
      requestHost: "tunel.exemplo.com",
      requestProto: "https",
      env: "production",
      trustedHosts: ["tunel.exemplo.com"],
    }),
    "https://tunel.exemplo.com",
  );

  // localhost sempre aceito (dev e preview local)
  eq("origem: localhost aceito", envLib.isTrustedHost("localhost:3000"), true);
  eq("origem: 127.0.0.1 aceito", envLib.isTrustedHost("127.0.0.1:3000"), true);

  // Injeção no header Host
  eq("origem: recusa host com barra", envLib.isTrustedHost("evil.com/path"), false);
  eq("origem: recusa host com espaço", envLib.isTrustedHost("evil .com"), false);
  eq("origem: recusa host vazio", envLib.isTrustedHost(""), false);

  // joinUrl
  eq("joinUrl: normal", envLib.joinUrl("https://a.com", "/r/x"), "https://a.com/r/x");
  eq("joinUrl: barra dupla evitada", envLib.joinUrl("https://a.com/", "/r/x"), "https://a.com/r/x");
  eq("joinUrl: sem barra inicial", envLib.joinUrl("https://a.com", "r/x"), "https://a.com/r/x");
}

/* -------------------------------------------------------------------------- */
/* 3. Redirect seguro (?next=)                                                */
/* -------------------------------------------------------------------------- */

{
  eq("redirect: caminho interno", envLib.safeRedirectPath("/app/pedidos"), "/app/pedidos");
  eq("redirect: query preservada", envLib.safeRedirectPath("/app?aba=2"), "/app?aba=2");
  eq("redirect: vazio → fallback", envLib.safeRedirectPath(""), "/app");
  eq("redirect: null → fallback", envLib.safeRedirectPath(null), "/app");
  eq("redirect: fallback customizado", envLib.safeRedirectPath(undefined, "/entrar"), "/entrar");

  // As três formas de redirect aberto
  eq("redirect: recusa //evil.com", envLib.safeRedirectPath("//evil.com"), "/app");
  eq("redirect: recusa https://evil.com", envLib.safeRedirectPath("https://evil.com"), "/app");
  eq("redirect: recusa /\\evil.com", envLib.safeRedirectPath("/\\evil.com"), "/app");
  eq("redirect: recusa esquema embutido", envLib.safeRedirectPath("/javascript:alert(1)"), "/app");
  eq("redirect: recusa caminho relativo", envLib.safeRedirectPath("app/pedidos"), "/app");

  // Caractere de controle (quebra de header)
  eq("redirect: recusa controle", envLib.safeRedirectPath("/app\nX: y"), "/app");

  // Longo demais
  eq("redirect: recusa excesso", envLib.safeRedirectPath("/" + "a".repeat(600)), "/app");
}

/* -------------------------------------------------------------------------- */
/* 4. Rate limiting                                                           */
/* -------------------------------------------------------------------------- */

{
  rateLib.resetRateLimits();

  const rule = { name: "teste", limit: 3, windowMs: 1000 };
  const t0 = 1_000_000;

  const first = rateLib.checkRateLimit(rule, "ip-1", t0);
  eq("rate: primeira passa", first.allowed, true);
  eq("rate: resta 2", first.remaining, 2);

  rateLib.checkRateLimit(rule, "ip-1", t0 + 10);
  rateLib.checkRateLimit(rule, "ip-1", t0 + 20);
  const fourth = rateLib.checkRateLimit(rule, "ip-1", t0 + 30);

  eq("rate: quarta bloqueia", fourth.allowed, false);
  eq("rate: resta 0", fourth.remaining, 0);
  check("rate: retryAfter positivo", fourth.retryAfter >= 1, String(fourth.retryAfter));

  // Baldes independentes por chave
  const other = rateLib.checkRateLimit(rule, "ip-2", t0 + 40);
  eq("rate: outro IP passa", other.allowed, true);

  // Janela expira
  const afterWindow = rateLib.checkRateLimit(rule, "ip-1", t0 + 2000);
  eq("rate: janela expirou", afterWindow.allowed, true);
  eq("rate: contador reiniciado", afterWindow.remaining, 2);

  // Reset para teste
  rateLib.resetRateLimits();
  const afterReset = rateLib.checkRateLimit(rule, "ip-1", t0 + 3000);
  eq("rate: reset limpa estado", afterReset.remaining, 2);

  // Regras reais existem e fazem sentido
  eq("rate: login 10/5min", rateLib.RATE_LIMITS.signIn.limit, 10);
  eq("rate: login janela 5min", rateLib.RATE_LIMITS.signIn.windowMs, 300000);
  eq("rate: cadastro 5/hora", rateLib.RATE_LIMITS.signUp.limit, 5);
  eq("rate: recuperação 5/hora", rateLib.RATE_LIMITS.recover.limit, 5);
  eq("rate: pedido 30/min", rateLib.RATE_LIMITS.orderCreate.limit, 30);

  // clientKey
  const h1 = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
  eq("rate: clientKey pega o primeiro IP", rateLib.clientKey(h1), "203.0.113.7");
  const h2 = new Headers({ "x-real-ip": "198.51.100.2" });
  eq("rate: clientKey usa x-real-ip", rateLib.clientKey(h2), "198.51.100.2");
  const h3 = new Headers();
  eq("rate: clientKey sem header", rateLib.clientKey(h3), "local");

  // Headers de resposta
  const limited = rateLib.checkRateLimit({ name: "h", limit: 1, windowMs: 60_000 }, "k", 5000);
  rateLib.checkRateLimit({ name: "h", limit: 1, windowMs: 60_000 }, "k", 5010);
  const blocked = rateLib.checkRateLimit({ name: "h", limit: 1, windowMs: 60_000 }, "k", 5020);
  const headers = rateLib.rateLimitHeaders(blocked);
  eq("rate: header limit", headers["X-RateLimit-Limit"], "1");
  check("rate: header Retry-After presente", Boolean(headers["Retry-After"]));
  check("rate: sem Retry-After quando permitido", !("Retry-After" in rateLib.rateLimitHeaders(limited)));
}

/* -------------------------------------------------------------------------- */
/* 5. CSP e headers de segurança                                              */
/* -------------------------------------------------------------------------- */

{
  // HSTS exige produção **e** HTTPS: as duas condições, não uma.
  const production = secLib.staticSecurityHeaders({ production: true, https: true });
  eq("sec: nosniff", production["X-Content-Type-Options"], "nosniff");
  eq("sec: frame DENY", production["X-Frame-Options"], "DENY");
  eq(
    "sec: referrer policy",
    production["Referrer-Policy"],
    "strict-origin-when-cross-origin",
  );
  check("sec: HSTS em produção", production["Strict-Transport-Security"]?.includes("max-age=63072000"));
  check("sec: HSTS inclui subdomínios", production["Strict-Transport-Security"]?.includes("includeSubDomains"));
  check("sec: permissions-policy fecha câmera", production["Permissions-Policy"]?.includes("camera=()"));

  // Staging não manda HSTS: promessa de um ano em domínio de teste tranca o dono fora
  const staging = secLib.staticSecurityHeaders({ production: false });
  check("sec: sem HSTS em staging", !("Strict-Transport-Security" in staging));

  /*
   * Produção em HTTP (sem proxy, local) também não manda HSTS. Este caso é o
   * que o harness pegou de verdade: um navegador que recebe HSTS em
   * `http://localhost` passa a exigir HTTPS e o dev perde o ambiente local até
   * limpar o cache do navegador.
   */
  const productionHttp = secLib.staticSecurityHeaders({ production: true, https: false });
  check("sec: sem HSTS em produção-http", !("Strict-Transport-Security" in productionHttp));

  // CSP de rota dinâmica: nonce, sem unsafe-inline em script
  const dynamicCsp = secLib.contentSecurityPolicy({
    production: true,
    nonce: "abc123",
    supabaseHost: "ref.supabase.co",
    cacheable: false,
  });
  check("csp: usa nonce", dynamicCsp.includes("'nonce-abc123'"));
  check("csp: strict-dynamic com nonce", dynamicCsp.includes("'strict-dynamic'"));
  check(
    "csp: não usa unsafe-inline em script quando tem nonce",
    !/script-src[^;]*unsafe-inline/.test(dynamicCsp),
    dynamicCsp.slice(0, 160),
  );
  check("csp: object-src none", dynamicCsp.includes("object-src 'none'"));
  check("csp: base-uri self", dynamicCsp.includes("base-uri 'self'"));
  check("csp: frame-ancestors none", dynamicCsp.includes("frame-ancestors 'none'"));
  check("csp: connect com supabase", dynamicCsp.includes("https://ref.supabase.co"));
  check("csp: wss com supabase", dynamicCsp.includes("wss://ref.supabase.co"));

  // CSP de rota cacheável (cardápio ISR): sem nonce, com unsafe-inline consciente
  const cacheCsp = secLib.contentSecurityPolicy({
    production: true,
    nonce: null,
    supabaseHost: "ref.supabase.co",
    cacheable: true,
  });
  check("csp: cardápio sem nonce", !cacheCsp.includes("nonce"));
  check("csp: cardápio permite inline (ISR)", /script-src[^;]*unsafe-inline/.test(cacheCsp));
  check("csp: cardápio mantém frame-ancestors", cacheCsp.includes("frame-ancestors 'none'"));
  check("csp: cardápio NÃO permite eval", !cacheCsp.includes("unsafe-eval"));

  // Sem host do Supabase: connect-src fica só no próprio site
  const noSupabase = secLib.contentSecurityPolicy({ production: true, nonce: "x" });
  check("csp: sem supabase não inventa host", noSupabase.includes("connect-src 'self'"));
}

/* -------------------------------------------------------------------------- */
/* 6. Contratos de arquivo                                                    */
/* -------------------------------------------------------------------------- */

{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

  // Nenhum segredo no repositório
  const envExample = read(".env.example");
  check(
    ".env.example não tem chave JWT real",
    !/eyJhbGciOi[A-Za-z0-9_-]{20,}/.test(envExample),
    "encontrei algo parecido com JWT real",
  );
  check(".env.example não tem service_role", !/service_role/i.test(envExample.split("# A `service_role`")[0]));

  const envLocalIgnored = read(".gitignore").includes(".env*.local");
  check(".gitignore cobre .env*.local", envLocalIgnored);

  // Documentação interna existe e não vaza valor
  const docs = read("docs/AMBIENTES.md");
  check("docs: documenta os três ambientes", /development[\s\S]*staging[\s\S]*production/i.test(docs));
  check("docs: explica domínio", docs.includes("Domínio próprio"));
  check("docs: explica PWA", docs.includes("PWA"));
  check("docs: explica storage", /bucket/i.test(docs));
  check("docs: explica autenticação", /Supabase Auth/i.test(docs));
  check("docs: sem chave real", !/eyJhbGciOi[A-Za-z0-9_-]{20,}/.test(docs));

  // Arquivos de erro existem
  check("erro: global-error existe", fs.existsSync(path.join(ROOT, "src/app/global-error.tsx")));
  check("erro: 404 raiz existe", fs.existsSync(path.join(ROOT, "src/app/not-found.tsx")));
  check("erro: 404 do cardápio existe", fs.existsSync(path.join(ROOT, "src/app/r/[slug]/not-found.tsx")));
  check("erro: 404 de mesa existe", fs.existsSync(path.join(ROOT, "src/app/r/[slug]/table/[token]/not-found.tsx")));
  check("erro: error do app existe", fs.existsSync(path.join(ROOT, "src/app/app/error.tsx")));
  check("erro: error do admin existe", fs.existsSync(path.join(ROOT, "src/app/admin/error.tsx")));
  check("erro: error do cardápio existe", fs.existsSync(path.join(ROOT, "src/app/r/[slug]/error.tsx")));
  check("saúde: endpoint existe", fs.existsSync(path.join(ROOT, "src/app/api/health/route.ts")));

  // A tela de erro não vaza mensagem crua para o visitante
  const globalError = read("src/app/global-error.tsx");
  check(
    "erro: global-error não imprime error.message na tela",
    !/\{error\.message\}|\{error\.stack\}/.test(globalError),
  );
  check("erro: global-error mostra digest", globalError.includes("error.digest"));

  // O middleware aplica os headers
  const mw = read("src/middleware.ts");
  check("middleware: aplica CSP", mw.includes("Content-Security-Policy"));
  check("middleware: aplica headers estáticos", mw.includes("staticSecurityHeaders"));
  check("middleware: redireciona http→https", mw.includes("url.protocol = \"https:\""));
  check("middleware: trata www", mw.includes("www."));
  check("middleware: usa rate limit", mw.includes("checkRateLimit"));
  check("middleware: cardápio é cacheável (sem nonce)", mw.includes("isCacheablePath"));

  // Public client não lê cookies — é o que permite ISR
  const publicClient = read("src/lib/supabase/public.ts");
  check("cliente público: não importa cookies", !publicClient.includes("next/headers"));
  check("cliente público: desliga persistSession", publicClient.includes("persistSession: false"));

  /*
   * ISR de verdade depende de DUAS coisas:
   *   1. leitura sem cookies (senão a rota é dinâmica por definição);
   *   2. `generateStaticParams` (senão o Next não tem rota para pré-renderizar).
   * A segunda foi descoberta pelo `build`, não pela leitura do código: `revalidate`
   * sozinho numa rota `[slug]` não faz nada.
   */
  const menuPage = read("src/app/r/[slug]/page.tsx");
  check("cardápio: declara generateStaticParams", menuPage.includes("export async function generateStaticParams"));
  check("cardápio: generateStaticParams tolera falha de banco", /catch\s*{[^}]*return \[\]/.test(menuPage.replace(/\n/g, " ")));
  check("cardápio: mantém revalidate", menuPage.includes("export const revalidate = 60"));

  // Mesa continua dinâmica de propósito: token não é enumerável.
  const tablePage = read("src/app/r/[slug]/table/[token]/page.tsx");
  check(
    "mesa: não tenta enumerar tokens no build",
    !tablePage.includes("generateStaticParams"),
  );

  // Leituras públicas usam o cliente sem cookies
  const publicMenu = read("src/lib/data/public-menu.ts");
  check("cardápio: usa cliente público", publicMenu.includes("createPublicClient"));
  check("cardápio: não usa cliente com cookie", !publicMenu.includes("supabase/server"));
}

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

console.log("");
if (failures.length) {
  for (const item of failures) console.log(`  ✗ ${item}`);
  console.log("");
}
console.log(`prod-lib: ${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
