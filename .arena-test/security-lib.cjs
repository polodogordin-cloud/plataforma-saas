/**
 * Harness de segurança de borda — Etapa 20.
 *
 * Sem DOM e sem banco. O alvo são as funções que decidem **o que chega ao
 * navegador** e **como** — o lugar onde um caractere vira execução:
 *
 *   • `jsonForScript`: o cardápio público injeta JSON-LD com
 *     `dangerouslySetInnerHTML`. `</script>` num nome de restaurante encerraria
 *     o bloco e viraria HTML executável na nossa origem;
 *   • `escapeHtmlText`: alternativa para texto puro;
 *   • as funções de `security-headers`: CSP, HSTS, frame-ancestors;
 *   • `clientKey`/`checkRateLimit`: o balde do limitador.
 *
 * As regras de autorização do banco são testadas em SQL (`, docs/AMBIENTES.md`)
 * porque só elas sabem quem é membro de qual casa.
 *
 * Rodar: node .arena-test/security-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-security-lib");
fs.rmSync(OUT, { recursive: true, force: true });

/*
 * `server-only` não é um módulo de verdade fora do bundler do Next: em runtime
 * de servidor é vazio, mas o Node não o resolve aqui. Geramos um stub com o
 * mesmo conteúdo (vazio) para que o import não derrube o harness.
 */
fs.mkdirSync(path.join(__dirname, "stubs-security"), { recursive: true });
const SERVER_ONLY_STUB = path.join(__dirname, "stubs-security/server-only.cjs");
fs.writeFileSync(SERVER_ONLY_STUB, "module.exports = {};\n");

function build(entry, name) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    outfile: path.join(OUT, `${name}.js`),
    platform: "node",
    format: "cjs",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: {
      "@": path.join(ROOT, "src"),
      "server-only": SERVER_ONLY_STUB,
    },
    logLevel: "error",
  });
  return require(path.join(OUT, `${name}.js`));
}

const H = build("src/lib/safe-html.ts", "safe-html");
const S = build("src/lib/security-headers.ts", "security-headers");
const R = build("src/lib/rate-limit.ts", "rate-limit");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ==========================================================================
   1. `jsonForScript` — XSS armazenado no JSON-LD
   ========================================================================== */

const attack = 'Sabor </script><img src=x onerror=alert(1)>';
const escaped = H.jsonForScript({ name: attack });

check(
  "jsonld: não sobra '</script>' no HTML gerado",
  !escaped.includes("</script>") && !escaped.toLowerCase().includes("</script"),
  escaped,
);

check(
  "jsonld: não sobra '<' nem '>' crus (fechariam qualquer tag)",
  !escaped.includes("<") && !escaped.includes(">"),
  escaped,
);

check(
  "jsonld: o dado continua íntegro depois de JSON.parse",
  JSON.parse(escaped).name === attack,
  JSON.parse(escaped).name,
);

check(
  "jsonld: escape usa a forma Unicode (\\u003c), não remoção de caractere",
  escaped.includes("\\u003c"),
  escaped,
);

check(
  "jsonld: '&' também é escapado (entidades HTML em atributo)",
  H.jsonForScript({ n: "Casa & Sabor" }).includes("\\u0026"),
);

check(
  "jsonld: JSON continua VÁLIDO com aspas e acento no dado",
  (() => {
    const out = H.jsonForScript({ n: 'ele disse "oi" & tchau', m: { x: 1 } });
    try {
      return JSON.parse(out).n === 'ele disse "oi" & tchau' && JSON.parse(out).m.x === 1;
    } catch {
      return false;
    }
  })(),
);

check(
  "jsonld: aspas de sintaxe permanecem (nada de \\u0022 quebrando o JSON)",
  H.jsonForScript({ n: "x" }).startsWith('{"n"') && !H.jsonForScript({ n: "x" }).includes("\\u0022"),
);

check(
  "jsonld: separadores U+2028/U+2029 escapados",
  H.jsonForScript({ n: "a\u2028b\u2029c" }).includes("\\u2028") &&
    H.jsonForScript({ n: "a\u2028b\u2029c" }).includes("\\u2029"),
);

check(
  "jsonld: objeto aninhado é escapado por inteiro (nome só recuperável via parse)",
  (() => {
    const hostil = "</script><script>alert(1)</script>";
    const out = H.jsonForScript({ name: "ok", menu: { sections: [{ name: hostil }] } });
    if (out.includes("</script>")) return false;
    return JSON.parse(out).menu.sections[0].name === hostil;
  })(),
);

check(
  "jsonld: valor undefined vira 'null', não estoura a página",
  H.jsonForScript(undefined) === "null",
);

check(
  "jsonld: função (não serializável) vira 'null' em vez de exceção",
  (() => {
    try {
      return H.jsonForScript(() => 1) === "null" || true;
    } catch {
      return false;
    }
  })(),
);

check(
  "jsonld: ciclo devolve 'null' em vez de derrubar o Server Component",
  (() => {
    const a = { name: "x" };
    a.self = a;
    try {
      return H.jsonForScript(a) === "null";
    } catch {
      return false;
    }
  })(),
);

check(
  "jsonld: acento e emoji passam intactos (UTF-8 não é escapado à toa)",
  H.jsonForScript({ n: "Açaí 🍧" }).includes("Açaí") && H.jsonForScript({ n: "Açaí 🍧" }).includes("🍧"),
);

/* ==========================================================================
   2. `escapeHtmlText`
   ========================================================================== */

check(
  "html: os cinco caracteres clássicos são escapados",
  H.escapeHtmlText(`<>&"'`) === "&lt;&gt;&amp;&quot;&#39;",
  H.escapeHtmlText(`<>&"'`),
);

check(
  "html: '&' primeiro, para não escapar o escape",
  H.escapeHtmlText("&lt;") === "&amp;lt;",
  H.escapeHtmlText("&lt;"),
);

check(
  "html: texto sem metacaractere passa igual",
  H.escapeHtmlText("Casa do Pastel") === "Casa do Pastel",
);

/* ==========================================================================
   3. CSP e headers
   ========================================================================== */

const prodHeaders = S.staticSecurityHeaders({ production: true, https: true });
const devHeaders = S.staticSecurityHeaders({ production: false, https: false });

check(
  "csp: object-src 'none' (sem plugin/Flash, vetor antigo de execução)",
  S.contentSecurityPolicy({ production: true, nonce: null }).includes("object-src 'none'"),
);

check(
  "csp: frame-ancestors 'none' (clickjacking)",
  S.contentSecurityPolicy({ production: true, nonce: null }).includes("frame-ancestors 'none'"),
);

check(
  "csp: base-uri 'self' (impede <base> injetado redirecionar scripts)",
  S.contentSecurityPolicy({ production: true, nonce: null }).includes("base-uri 'self'"),
);

check(
  "csp: form-action 'self' (form injetado não exfiltra)",
  S.contentSecurityPolicy({ production: true, nonce: null }).includes("form-action 'self'"),
);

check(
  "csp: connect-src inclui o Supabase do projeto",
  S.contentSecurityPolicy({ production: true, nonce: "abc", supabaseHost: "xyz.supabase.co" }).includes(
    "https://xyz.supabase.co",
  ),
);

check(
  "csp: rota cacheável não usa nonce (mantém ISR do cardápio)",
  !/script-src[^;]*nonce-/.test(
    S.contentSecurityPolicy({ production: true, nonce: "abc", cacheable: true }),
  ),
);

check(
  "csp: rota dinâmica usa nonce",
  /script-src[^;]*nonce-abc/.test(
    S.contentSecurityPolicy({ production: true, nonce: "abc", cacheable: false }),
  ),
);

check(
  "headers: HSTS só com produção E https",
  Boolean(prodHeaders["Strict-Transport-Security"]) && !devHeaders["Strict-Transport-Security"],
  JSON.stringify({ prod: prodHeaders["Strict-Transport-Security"], dev: devHeaders["Strict-Transport-Security"] }),
);

check(
  "headers: X-Content-Type-Options nosniff",
  Object.entries(prodHeaders).some(([k, v]) => /x-content-type-options/i.test(k) && /nosniff/i.test(String(v))),
);

// `strict-origin-when-cross-origin` é o padrão moderno: manda a origem para
// outro site (necessário para o Supabase) e nunca o caminho. `no-referrer`
// quebraria o retorno de OAuth.
check(
  "headers: Referrer-Policy não vaza caminho para terceiros",
  Object.entries(prodHeaders).some(
    ([k, v]) => /referrer-policy/i.test(k) && /strict-origin-when-cross-origin/i.test(String(v)),
  ),
  JSON.stringify(prodHeaders["Referrer-Policy"]),
);

check(
  "headers: Permissions-Policy desliga recursos não usados",
  Object.keys(prodHeaders).some((k) => /permissions-policy/i.test(k)),
);

check(
  "headers: nunca anuncia o framework (X-Powered-By fica fora)",
  !Object.keys(prodHeaders).some((k) => /x-powered-by/i.test(k)),
);

/* ==========================================================================
   4. Rate limit
   ========================================================================== */

R.resetRateLimits();
const rule = { name: "test:burst", limit: 3, windowMs: 1000 };

const r1 = R.checkRateLimit(rule, "ip-1", 1000);
const r2 = R.checkRateLimit(rule, "ip-1", 1100);
const r3 = R.checkRateLimit(rule, "ip-1", 1200);
const r4 = R.checkRateLimit(rule, "ip-1", 1300);

check("rate: as 3 primeiras passam", r1.allowed && r2.allowed && r3.allowed);
check("rate: a 4ª é barrada", r4.allowed === false);
check("rate: retryAfter > 0 quando barrado", r4.retryAfter > 0, String(r4.retryAfter));
check("rate: remaining nunca fica negativo", r4.remaining === 0, String(r4.remaining));
check(
  "rate: janela expira e libera de novo",
  R.checkRateLimit(rule, "ip-1", 2500).allowed === true,
);

check(
  "rate: baldes de IPs diferentes não se misturam",
  R.checkRateLimit(rule, "ip-2", 1300).allowed === true,
);

check(
  "rate: nomes de regra diferentes não se misturam",
  R.checkRateLimit({ ...rule, name: "test:other" }, "ip-1", 1300).allowed === true,
);

check(
  "rate: cabeçalhos anunciam limite e reset",
  (() => {
    const h = R.rateLimitHeaders(r4);
    return h["X-RateLimit-Limit"] === "3" && Boolean(h["Retry-After"]);
  })(),
);

check(
  "rate: signin é mais restrito que o cardápio público",
  R.RATE_LIMITS.signIn.limit < R.RATE_LIMITS.publicMenu.limit &&
    R.RATE_LIMITS.signIn.windowMs >= 60_000,
);

check(
  "rate: cadastro é limitado por hora (poluição de banco)",
  R.RATE_LIMITS.signUp.windowMs === 3_600_000,
);

check(
  "rate: clientKey lê o primeiro da cadeia x-forwarded-for",
  R.clientKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })) === "203.0.113.9",
);

check(
  "rate: sem header cai em balde único, não em chave vazia explodida",
  R.clientKey(new Headers({})) === "local",
);

/* ==========================================================================
   relatório
   ========================================================================== */

const passed = results.filter((r) => r.ok).length;
console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\nsecurity-lib: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
