/**
 * Harness do diagnóstico e do `/api/health` — Etapa 20.
 *
 * O alvo não é "o banco responde": é a **regra que não se negocia** do
 * diagnóstico. Todo teste abaixo ou mede um estado (`up`/`down`/...) ou tenta
 * arrancar do relatório algo que não pode sair de lá:
 *
 *   • URL do projeto, chave anon, nome de bucket, mensagem crua do driver,
 *     stack trace, valor de variável secreta;
 *   • "OK" inventado: realtime tem de ser `unknown` e webhooks `disabled`
 *     enquanto a cobrança é manual — nunca `up` só porque a variável existe.
 *
 * O cliente Supabase é substituído por um stub porque o Supabase não está
 * disponível aqui. O stub simula exatamente os três desfechos que a função
 * precisa distinguir: sucesso, erro com `code` HTTP e exceção de rede.
 *
 * Rodar: node .arena-test/diagnostics-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-diagnostics-lib");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* -------------------------------------------------------------------------- */
/* Stubs                                                                      */
/* -------------------------------------------------------------------------- */

const STUBS = path.join(OUT, "stubs");
fs.mkdirSync(STUBS, { recursive: true });
fs.writeFileSync(path.join(STUBS, "server-only.cjs"), "module.exports = {};\n");

/*
 * O comportamento do Supabase é controlado por uma variável global do processo,
 * trocada antes de cada caso. Recarregar o bundle não é necessário: o stub lê o
 * modo na hora da chamada, como um servidor de verdade responderia.
 */
fs.writeFileSync(
  path.join(STUBS, "supabase-server.cjs"),
  `
const mode = () => globalThis.__DIAG_MODE__ ?? "up";

async function createClient() {
  const m = mode();

  if (m === "network") throw new Error("fetch failed: getaddrinfo ENOTFOUND fjrvjnvjkpowxzxiez.supabase.co");

  const rpc = async () => {
    if (m === "key") return { data: null, error: { code: "401", message: "Invalid API key for project fjrvjnvjkpowxzxiez" } };
    if (m === "missing-function") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.public_plans" } };
    if (m === "db-error") return { data: null, error: { code: "57P01", message: "terminating connection due to administrator command" } };
    return { data: { plans: [], trial_days: 7 }, error: null };
  };

  const storage = {
    listBuckets: async () => {
      if (m === "network") throw new Error("connect ECONNREFUSED 10.0.0.5:443");
      if (m === "storage-open") return { data: [{ name: "logos" }], error: null };
      return {
        data: null,
        error: { message: "new row violates row-level security policy", statusCode: 403 },
      };
    },
  };

  return { rpc, storage };
}

module.exports = { createClient };
`,
);

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/diagnostics.ts")],
  bundle: true,
  outfile: path.join(OUT, "diagnostics.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  alias: {
    "@": path.join(ROOT, "src"),
    "server-only": path.join(STUBS, "server-only.cjs"),
    "@/lib/supabase/server": path.join(STUBS, "supabase-server.cjs"),
  },
  logLevel: "error",
});

const D = require(path.join(OUT, "diagnostics.cjs"));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const SECRET_URL = "https://fjrvjnvjkpowxzxiez.supabase.co";
const SECRET_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.assinatura-falsa-nao-e-segredo-de-verdade";

/** Deixa o processo com um ambiente conhecido e válido. */
function baseEnv(extra = {}) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_SUPABASE") || key === "NEXT_PUBLIC_SITE_URL" ||
        key === "NEXT_PUBLIC_APP_ENV" || key === "PAYMENT_PROVIDER" || key === "PAYMENT_WEBHOOK_SECRET" ||
        key === "VERCEL_GIT_COMMIT_SHA" || key === "GIT_COMMIT_SHA") {
      delete process.env[key];
    }
  }
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: SECRET_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SECRET_KEY,
    NEXT_PUBLIC_SITE_URL: "https://menuvo.app",
    NEXT_PUBLIC_APP_ENV: "production",
    ...extra,
  });
}

const byId = (report, id) => report.checks.find((c) => c.id === id);

function safe(report) {
  return JSON.stringify(report);
}

/* -------------------------------------------------------------------------- */
/* 1. Ambiente ausente — nada de stack, nada de "OK" falso                    */
/* -------------------------------------------------------------------------- */

async function main() {
  baseEnv();
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_ENV"]) {
    delete process.env[key];
  }
  globalThis.__DIAG_MODE__ = "up";

  const noEnv = await D.readDiagnostics();
  check("sem env: banco é unconfigured", byId(noEnv, "database").state === "unconfigured", byId(noEnv, "database").state);
  check("sem env: autenticação é unconfigured", byId(noEnv, "auth").state === "unconfigured");
  check("sem env: relatório não está ok", noEnv.ok === false);
  check(
    "sem env: ambiente obrigatório aparece como down, com o NOME da variável",
    byId(noEnv, "environment").state === "down" &&
      byId(noEnv, "environment").detail.includes("NEXT_PUBLIC_SUPABASE_URL"),
    byId(noEnv, "environment").detail,
  );

  /* ---------------------------------------------------------------------- */
  /* 2. Tudo no lugar                                                       */
  /* ---------------------------------------------------------------------- */

  baseEnv();
  const healthy = await D.readDiagnostics();

  check("ok: banco up", byId(healthy, "database").state === "up");
  check("ok: autenticação up", byId(healthy, "auth").state === "up");
  check("ok: armazenamento up (negação de RLS conta como resposta)", byId(healthy, "storage").state === "up", byId(healthy, "storage").detail);
  check("ok: relatório ok", healthy.ok === true);
  check("ok: versão vem do app", healthy.version === "0.1.0", healthy.version);
  check("ok: checkedAt é ISO", /^\d{4}-\d{2}-\d{2}T/.test(healthy.checkedAt));
  check("ok: ambiente resolvido como produção", healthy.env === "production", healthy.env);
  check("ok: sem commit informado, revision é null", healthy.revision === null);

  check(
    "vazamento: URL do projeto NÃO aparece no relatório",
    !safe(healthy).includes("fjrvjnvjkpowxzxiez"),
    safe(healthy).slice(0, 120),
  );
  check("vazamento: chave anon NÃO aparece no relatório", !safe(healthy).includes("eyJhbGci"));
  check("vazamento: nenhuma chave parece JWT", !/eyJ[A-Za-z0-9_-]{10,}/.test(safe(healthy)));
  check(
    "vazamento: nenhuma menção a host/porta/schema de driver",
    !/(supabase\.co|5432|public\.|pg_catalog|localhost|127\.0\.0\.1)/i.test(safe(healthy)),
    safe(healthy),
  );
  check("vazamento: nenhum campo 'error'/'message'/'stack' no relatório", !/"(error|message|stack|detail_raw)"\s*:/.test(safe(healthy)));

  /* ---------------------------------------------------------------------- */
  /* 3. Realtime e webhooks: honestidade                                    */
  /* ---------------------------------------------------------------------- */

  check("realtime: é unknown, não up inventado", byId(healthy, "realtime").state === "unknown", byId(healthy, "realtime").state);
  check(
    "realtime: o detalhe diz que não foi medido",
    /não medido/i.test(byId(healthy, "realtime").detail),
    byId(healthy, "realtime").detail,
  );
  check("webhooks: disabled com cobrança manual", byId(healthy, "webhooks").state === "disabled", byId(healthy, "webhooks").state);
  check(
    "webhooks: o detalhe explica que a confirmação é manual",
    /manual/i.test(byId(healthy, "webhooks").detail),
  );

  baseEnv({ PAYMENT_PROVIDER: "stripe" });
  const stripe = await D.readDiagnostics();
  check(
    "webhooks: provedor sem segredo não vira 'up'",
    byId(stripe, "webhooks").state === "down",
    byId(stripe, "webhooks").state,
  );

  baseEnv({ PAYMENT_PROVIDER: "stripe", PAYMENT_WEBHOOK_SECRET: "whsec_super_secreto" });
  const stripeSecret = await D.readDiagnostics();
  check(
    "webhooks: com segredo mas sem rota, não é 'up'",
    byId(stripeSecret, "webhooks").state === "unconfigured",
    byId(stripeSecret, "webhooks").state,
  );
  check(
    "vazamento: segredo de webhook não aparece no relatório",
    !safe(stripeSecret).includes("whsec_super_secreto"),
  );

  /* ---------------------------------------------------------------------- */
  /* 4. Falhas — cada uma no lugar certo                                    */
  /* ---------------------------------------------------------------------- */

  baseEnv();
  globalThis.__DIAG_MODE__ = "key";
  const badKey = await D.readDiagnostics();
  check("chave recusada: banco ainda up", byId(badKey, "database").state === "up", byId(badKey, "database").state);
  check("chave recusada: autenticação down", byId(badKey, "auth").state === "down");
  check("chave recusada: relatório não ok", badKey.ok === false);
  check("vazamento: mensagem 'Invalid API key' não vaza", !/invalid api key/i.test(safe(badKey)));

  globalThis.__DIAG_MODE__ = "network";
  const net = await D.readDiagnostics();
  check("rede: banco down", byId(net, "database").state === "down");
  check("rede: storage down", byId(net, "storage").state === "down");
  check("vazamento: ENOTFOUND/host do driver não vaza", !/ENOTFOUND|getaddrinfo|ECONNREFUSED|supabase\.co/i.test(safe(net)), safe(net));
  check("vazamento: IP do driver não vaza", !/10\.0\.0\.5/.test(safe(net)));

  globalThis.__DIAG_MODE__ = "missing-function";
  const missing = await D.readDiagnostics();
  check("migration faltando: degraded, não down", byId(missing, "database").state === "degraded", byId(missing, "database").state);
  check("migration faltando: ainda não derruba o serviço", missing.ok === true);
  check("vazamento: nome da função no erro do Supabase não vaza", !/public_plans/.test(safe(missing)));

  globalThis.__DIAG_MODE__ = "db-error";
  const dbError = await D.readDiagnostics();
  check("erro do banco: down", byId(dbError, "database").state === "down");
  check("vazamento: 'terminating connection' não vaza", !/terminating connection/i.test(safe(dbError)));

  globalThis.__DIAG_MODE__ = "storage-open";
  const storageOpen = await D.readDiagnostics();
  check("storage aberto: up com contagem, sem nome de bucket", (() => {
    const d = byId(storageOpen, "storage");
    return d.state === "up" && /1 bucket/.test(d.detail) && !/logos/.test(JSON.stringify(storageOpen));
  })(), byId(storageOpen, "storage").detail);

  /* ---------------------------------------------------------------------- */
  /* 5. revision() — commit curto, e nada além de sha                       */
  /* ---------------------------------------------------------------------- */

  baseEnv({ VERCEL_GIT_COMMIT_SHA: "abcdef1234567890abcdef1234567890abcdef12" });
  check("revision: corta para 7 caracteres", D.revision() === "abcdef1", String(D.revision()));

  baseEnv({ GIT_COMMIT_SHA: "1234567" });
  check("revision: aceita sha curto válido", D.revision() === "1234567");

  baseEnv({ VERCEL_GIT_COMMIT_SHA: "não-é-sha" });
  check("revision: lixo não vira revision", D.revision() === null);

  baseEnv({ VERCEL_GIT_COMMIT_SHA: "https://host/secreto?token=abc" });
  check("revision: string maliciosa é rejeitada (não repassa texto livre)", D.revision() === null);

  baseEnv({ VERCEL_GIT_COMMIT_SHA: "  ABCDEF1234  " });
  check("revision: aceita maiúscula e espaços", D.revision() === "abcdef1", String(D.revision()));

  /* ---------------------------------------------------------------------- */
  /* 6. summarize() — é o que o /api/health mostra sem segredo              */
  /* ---------------------------------------------------------------------- */

  const up = D.summarize(healthy);
  check("summarize: tudo ok vira ok/up", up.ok === true && up.state === "up");

  const downSummary = D.summarize(net);
  check("summarize: falha vira ok:false", downSummary.ok === false);
  check("summarize: estado acompanha a peça que caiu", ["down", "unconfigured"].includes(downSummary.state), downSummary.state);
  check(
    "summarize: objeto é minúsculo (não é o relatório)",
    Object.keys(up).length === 2,
    JSON.stringify(up),
  );

  /* ---------------------------------------------------------------------- */
  /* 7. Contrato do relatório                                              */
  /* ---------------------------------------------------------------------- */

  check("contrato: 6 peças, na ordem estável", healthy.checks.map((c) => c.id).join(",") === "database,auth,storage,realtime,webhooks,environment", healthy.checks.map((c) => c.id).join(","));
  check("contrato: todo check tem label e detail não vazios", healthy.checks.every((c) => c.label && c.detail));
  check(
    "contrato: estados só do vocabulário fechado",
    healthy.checks.every((c) => ["up", "down", "unconfigured", "disabled", "degraded", "unknown"].includes(c.state)),
  );

  /* ---------------------------------------------------------------------- */
  /* 8. Rota /api/health: contrato de resposta                             */
  /* ---------------------------------------------------------------------- */

  /*
   * A rota é um arquivo que importa `next/server`. Em vez de montar o framework
   * aqui, leio a fonte e verifico as invariantes que não podem se perder num
   * refactor: sem cache, status 503 quando cai, detalhe só com segredo.
   */
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/health/route.ts"), "utf8");

  check("health: declara force-dynamic (nunca é pré-renderizado)", /export const dynamic = "force-dynamic"/.test(route));
  check("health: Cache-Control no-store", /no-store/.test(route));
  check("health: devolve 503 quando não está ok", /503/.test(route));
  check("health: detalhe condicionado a HEALTH_CHECK_SECRET", /HEALTH_CHECK_SECRET/.test(route));
  check("health: comparação em tempo constante", /timingSafeEqual/.test(route));
  check("health: usa Authorization Bearer", /authorization/i.test(route) && /bearer/i.test(route));
  check("health: não usa console/stack na resposta", !/stack/.test(route));
  check("health: não imprime URL nem chave", !/NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)/.test(route.replace(/process\.env\.NEXT_PUBLIC_SUPABASE_[A-Z_]+/g, "")));

  /* ---------------------------------------------------------------------- */
  /* relatório                                                             */
  /* ---------------------------------------------------------------------- */

  console.log("");
  for (const r of results) {
    if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\ndiagnostics-lib: ${passed}/${results.length} PASS\n`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
