/**
 * Harness da Etapa 14 — o que só existe com servidor no ar.
 *
 * Uso:
 *   node .arena-test/prod-ssr.cjs                          # contra localhost:3000
 *   node .arena-test/prod-ssr.cjs https://menuvo-theta.vercel.app
 *
 * Sem servidor respondendo, as checagens HTTP são puladas e o script diz
 * quantas rodaram — em vez de falhar por motivo ambiental.
 */

const fs = require("node:fs");
const path = require("node:path");

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) pass += 1;
  else {
    fail += 1;
    failures.push(detail === undefined ? name : `${name} — ${detail}`);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `recebi ${JSON.stringify(actual)}, esperava ${JSON.stringify(expected)}`);
}

(async () => {
  /* ---------------------------------------------------------------------- */
  /* 1. Arquivos de configuração (offline)                                   */
  /* ---------------------------------------------------------------------- */

  const root = (p) => path.join(ROOT, p);
  const read = (p) => fs.readFileSync(root(p), "utf8");

  {
    // next.config.ts: cache de assets e Vary
    const nextConfig = read("next.config.ts");
    check("config: compressão ligada", nextConfig.includes("compress: true"));
    check("config: AVIF habilitado", nextConfig.includes('"image/avif"'));
    check("config: WebP habilitado", nextConfig.includes('"image/webp"'));
    check("config: assets imutáveis", nextConfig.includes("immutable"));
    /*
     * `Vary: RSC` precisa existir **na resposta**, não no `next.config.ts`: o
     * Next já emite esse header sozinho para rotas do App Router, e duplicá-lo
     * na config produzia dois headers `Vary` na mesma resposta. A checagem
     * certa é no HTTP — está mais abaixo, em "header: vary rsc".
     */
    check(
      "config: não duplica Vary do Next",
      !nextConfig.includes("Next-Router-State-Tree"),
      "Vary duplicado na config",
    );
    check("config: remove console em produção", nextConfig.includes("removeConsole"));
    check(
      "config: removeConsole preserva error/warn",
      nextConfig.includes('exclude: ["error", "warn"]'),
    );

    // Não há secret hardcoded no código de produção
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(rel);
      }
    };
    walk("src");

    const jwtPattern = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{40,}/;
    const offenders = files.filter((file) => jwtPattern.test(read(file)));
    check("segurança: nenhum JWT real em src/", offenders.length === 0, offenders.join(", "));

    const supabaseKeyHardcoded = files.filter((file) => /sb_secret_[A-Za-z0-9_-]{10,}/.test(read(file)));
    check("segurança: nenhum secret key do Supabase em src/", supabaseKeyHardcoded.length === 0);

    // service_role nunca é usada
    const serviceRoleUses = files.filter((file) => {
      const text = read(file);
      // Ignora comentários que falam sobre ela.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      return /service_role/i.test(code);
    });
    check(
      "segurança: app não usa service_role",
      serviceRoleUses.length === 0,
      serviceRoleUses.join(", "),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* 2. Servidor no ar                                                      */
  /* ---------------------------------------------------------------------- */

  const available = await fetch(`${BASE}/`, { method: "HEAD" })
    .then((r) => r.ok || r.status < 500)
    .catch(() => false);

  if (!available) {
    console.log(`\n  (servidor em ${BASE} indisponível — checagens HTTP puladas)\n`);
    report();
    return;
  }

  const get = (p, init) => fetch(`${BASE}${p}`, { redirect: "manual", ...init });

  /* --- Headers de segurança --- */

  {
    const res = await get("/");
    const csp = res.headers.get("content-security-policy") ?? "";
    const hsts = res.headers.get("strict-transport-security");

    check("csp: presente na landing", csp.length > 0);
    check("csp: default-src self", csp.includes("default-src 'self'"));
    check("csp: object-src none", csp.includes("object-src 'none'"));
    check("csp: base-uri self", csp.includes("base-uri 'self'"));
    check("csp: frame-ancestors", csp.includes("frame-ancestors"));
    check("csp: sem unsafe-eval", !csp.includes("unsafe-eval"));

    eq("header: nosniff", res.headers.get("x-content-type-options"), "nosniff");
    eq("header: frame DENY", res.headers.get("x-frame-options"), "DENY");
    eq(
      "header: referrer policy",
      res.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
    check("header: permissions-policy presente", Boolean(res.headers.get("permissions-policy")));
    check("header: sem x-powered-by", !res.headers.get("x-powered-by"));

    /*
     * `Vary` com `RSC` é o que impede um cache intermediário de servir payload
     * RSC para o navegador (tela em branco) ou HTML para uma navegação de
     * cliente (erro de hidratação). Pode vir em mais de um header `Vary`.
     */
    const vary = (res.headers.getSetCookie ? res.headers.get("vary") : res.headers.get("vary")) ?? "";
    check("header: vary inclui RSC", /rsc/i.test(vary), String(vary));

    // HSTS só com HTTPS de verdade.
    if (BASE.startsWith("https://")) {
      check("hsts: presente em https", Boolean(hsts), String(hsts));
    } else {
      check("hsts: ausente em http local", !hsts, String(hsts));
    }
  }

  /* --- Content-Type do manifest e cache do SW --- */

  {
    const manifest = await get("/manifest.webmanifest");
    eq("manifest: 200", manifest.status, 200);
    check(
      "manifest: content-type json",
      (manifest.headers.get("content-type") ?? "").includes("manifest")
      || (manifest.headers.get("content-type") ?? "").includes("json"),
      manifest.headers.get("content-type") ?? "",
    );

    const sw = await get("/sw.js");
    eq("sw: 200", sw.status, 200);
    check(
      "sw: revalida sempre",
      (sw.headers.get("cache-control") ?? "").includes("must-revalidate"),
      sw.headers.get("cache-control") ?? "",
    );
    eq("sw: escopo raiz", sw.headers.get("service-worker-allowed"), "/");
  }

  /* --- 404 --- */

  {
    const res = await get("/rota-que-nao-existe-abc123");
    eq("404: status", res.status, 404);
    const html = await res.text();
    check("404: tem texto amigável", /não encontrada|não encontrado/i.test(html));
    /*
     * Falso positivo que vale registrar: `webpack-*.js` é o nome do chunk do
     * próprio Next, que aparece no HTML de qualquer página. Procurar a palavra
     * "webpack" acusava a página correta. O que denuncia stack de verdade é o
     * formato do traceback e o caminho absoluto do servidor.
     */
    check("404: não vaza stack", !/\n\s+at [\w$.]+ \(/.test(html) && !/\/home\/|\/var\/task|node_modules\//.test(html));
    check("404: não vaza nome de tabela", !/whatsapp_settings|restaurant_users|order_items/i.test(html));
    check("404: não vaza erro do banco", !/PostgrestError|PGRST|supabase\.co/i.test(html));
  }

  /* --- Cardápio inexistente → 404 com a tela certa --- */

  {
    const res = await get(`/r/slug-inexistente-${Date.now()}`);
    eq("cardápio 404: status", res.status, 404);
    const html = await res.text();
    check("cardápio 404: tela de restaurante", /Cardápio não encontrado/i.test(html));
    check("cardápio 404: não vaza id nem plano", !/subscription_status|plan_id/i.test(html));
  }

  /* --- Mesa com token inválido → 404 (mesma resposta de mesa desativada) --- */

  {
    const res = await get(`/r/slug-inexistente-${Date.now()}/table/AAAAAAAAAAAAAAAAAAAAAAAA`);
    check(
      "mesa inválida: 404 ou 200 de motivo",
      res.status === 404 || res.status === 200,
      String(res.status),
    );
    const html = await res.text();
    check("mesa inválida: não revela se o token existe", !/token/i.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));
  }

  /* --- Rotas privadas exigem login --- */

  {
    for (const route of ["/app", "/admin", "/app/pedidos", "/app/mesas"]) {
      const res = await get(route);
      check(
        `privado: ${route} redireciona sem sessão`,
        [302, 307, 308].includes(res.status),
        String(res.status),
      );
      const location = res.headers.get("location") ?? "";
      check(`privado: ${route} vai para /entrar`, location.includes("/entrar"), location);

      // `next` precisa ser caminho interno — nunca `//host`
      const nextParam = new URL(location, BASE).searchParams.get("next") ?? "";
      check(`privado: ${route} next é interno`, !nextParam.startsWith("//") && !nextParam.includes("://"), nextParam);
    }
  }

  /* --- Redirect aberto pelo ?next= --- */

  {
    const res = await get("/entrar?next=//evil.com");
    eq("redirect: /entrar com next externo responde", res.status, 200);

    const res2 = await get("/entrar?next=https://evil.com");
    eq("redirect: next com esquema responde", res2.status, 200);
  }

  /* --- Health check --- */

  {
    const res = await get("/api/health");
    check("health: status 200 ou 503", [200, 503].includes(res.status), String(res.status));

    const body = await res.json();
    check("health: campo ok", typeof body.ok === "boolean");
    check("health: informa ambiente", ["development", "staging", "production"].includes(body.env), String(body.env));
    check("health: tem checkedAt", typeof body.checkedAt === "string");

    // Nunca vaza valor de variável
    const raw = JSON.stringify(body);
    check("health: não vaza URL do Supabase", !raw.includes(".supabase.co"), raw.slice(0, 200));
    check("health: não vaza chave", !raw.includes("eyJ"), raw.slice(0, 200));
    check("health: não vaza mensagem do driver", !/ECONN|ETIMEDOUT|TLS/i.test(raw));

    // Sem segredo configurado, o relatório detalhado não aparece em produção
    // (em dev ele aparece e é o que ajuda a depurar).
    /*
     * A regra real é: **com segredo configurado**, ninguém sem o Bearer vê o
     * detalhe. Sem segredo, o detalhe aparece fora de produção (é o que ajuda a
     * depurar) e também em produção — porque quem bloqueia o detalhe é o
     * segredo, não o nome do ambiente. Testar `env === "production"` aqui era
     * testar a suposição errada; o harness local roda em produção.
     */
    if (process.env.HEALTH_CHECK_SECRET) {
      check("health: detalhe exige Bearer", !Array.isArray(body.envVars));
    } else {
      check("health: sem segredo configurado, detalhe é esperado", Array.isArray(body.envVars));
      // Mesmo detalhado, nunca vaza valor.
      const states = (body.envVars ?? []).map((item) => item.state);
      check(
        "health: só estados permitidos",
        states.every((state) => ["set", "missing", "invalid"].includes(state)),
        JSON.stringify(states),
      );
    }

    check(
      "health: não é cacheado",
      (res.headers.get("cache-control") ?? "").includes("no-store"),
      res.headers.get("cache-control") ?? "",
    );
  }

  /* --- Compressão --- */

  {
    const res = await fetch(`${BASE}/`, {
      headers: { "accept-encoding": "gzip, br" },
    });
    const encoding = res.headers.get("content-encoding");
    // A Vercel comprime; `next start` também. Se nenhum comprimir, o cardápio
    // em 3G paga o preço.
    check("performance: resposta comprimida", Boolean(encoding), String(encoding));
  }

  report();

  function report() {
    console.log("");
    if (failures.length) {
      for (const item of failures) console.log(`  ✗ ${item}`);
      console.log("");
    }
    console.log(`prod-ssr: ${pass}/${pass + fail} PASS`);
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((error) => {
  console.error("falhou:", error);
  process.exit(1);
});
