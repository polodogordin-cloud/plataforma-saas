/**
 * Harness de SSR, dados e segurança do WhatsApp — Etapa 13.
 *
 * Três perguntas que só se respondem olhando além do componente:
 *
 *   1. **O que o servidor entrega?** O botão aparece no HTML (sem JS) — se
 *      dependesse de hidratação, sumiria no 3G do salão. E nada administrativo
 *      vaza: plano, id de restaurante, token, aceite de termos.
 *   2. **A camada de dados lê a resposta certa?** `table(...)` no PostgREST
 *      chega como **array**. Esperar objeto faria o botão nunca aparecer em
 *      produção — e o teste da lib pura não vê, porque lá o objeto já vem
 *      pronto. Este é o tipo de erro que passa em todo teste unitário.
 *   3. **O contrato do provedor é honesto?** O provedor de hoje não envia nada,
 *      e a camada oficial existe como "não configurado", não como simulação.
 *
 * Uso: node .arena-test/whatsapp-ssr.cjs [baseUrl]
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv[2] ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const lib = source("src/lib/whatsapp.ts");
const provider = source("src/lib/whatsapp/provider.ts");
const action = source("src/actions/whatsapp.ts");
const button = source("src/components/public/whatsapp-button.tsx");
const publicPage = source("src/app/r/[slug]/page.tsx");
const tablePage = source("src/app/r/[slug]/table/[token]/page.tsx");
const migration = source("supabase/migrations/0014_whatsapp.sql");

/* ========================================================================== */
/* 1. Contratos no código                                                     */
/* ========================================================================== */

/* --- o módulo puro é realmente puro ------------------------------------- */

check("lib: sem import de server-only", !/^import\s+["']server-only["']/m.test(lib));
check("lib: sem process.env", !/process\.env/.test(lib));
check("lib: sem fetch", !/\bfetch\s*\(/.test(lib));
check(
  "lib: nenhuma menção à API oficial (nada de integração falsa)",
  !/graph\.facebook\.com|whatsappbusiness|cloud\.api/i.test(lib),
);

/* --- o provedor não finge enviar ---------------------------------------- */

check("provider: é server-only", /^import\s+["']server-only["']/m.test(provider));
check(
  "provider: provedor de link declara que NÃO entrega",
  /id:\s*"link"/.test(provider) && /delivers:\s*false/.test(provider),
);
check(
  "provider: provedor oficial não configurado devolve unavailable",
  /unconfiguredCloudWhatsappProvider/.test(provider) && /provider_not_configured/.test(provider),
);
check("provider: nenhuma chamada de rede", !/\bfetch\s*\(/.test(provider));
check(
  "provider: nenhum token nem segredo",
  !/(?:api[_-]?key|bearer|access_token|app_secret)\s*[:=]\s*["'`][^"'`]{8,}/i.test(provider),
);
check(
  "provider: variável de ambiente não liga a API sozinha",
  /getWhatsappProvider/.test(provider) && !/WHATSAPP_TOKEN|WHATSAPP_ACCESS/.test(provider),
);

/* --- a Server Action não confia no cliente ----------------------------- */

check(
  "action: restaurante vem do servidor (getActiveRestaurant)",
  action.includes("getActiveRestaurant") && !/restaurantId\s*:\s*string/.test(action),
);
check("action: valida com Zod", /z\s*\n?\s*\.object\(/.test(action) && action.includes("safeParse"));
check("action: normaliza o número antes de enviar", action.includes("normalizeWhatsappNumber"));
check("action: revalida o cardápio público", action.includes("revalidatePath") && action.includes("`/r/"));

/* --- o botão público não vaza nada ------------------------------------- */

check("botão: é um link real (funciona sem JS)", /<a[\s\S]{0,400}href=\{href\}/.test(button));
check(
  "botão: abre em nova aba com noopener",
  button.includes('target="_blank"') && button.includes("noopener"),
);
check("botão: alvo de 56px", button.includes("min-h-14"));
check("botão: aria-label diz com quem é a conversa", button.includes("aria-label"));
check(
  "botão: não envia telemetria nem handler de clique",
  !/onClick=|fetch\(|track\(|analytics/.test(button.replace(/\/\*[\s\S]*?\*\//g, "")),
);
check("botão: texto não promete envio", !/"(?:Enviar|Mensagem enviada)/.test(button));

/* --- páginas públicas buscam só o necessário --------------------------- */

for (const [label, page] of [
  ["/r/[slug]", publicPage],
  ["/r/[slug]/table/[token]", tablePage],
]) {
  check(`${label}: usa a leitura pública (não a do painel)`, page.includes("getPublicWhatsappConfig"));
  check(`${label}: não importa a tabela direto`, !page.includes("whatsapp_settings"));
  check(
    `${label}: botão recebe só config e nome`,
    /WhatsappButton[\s\S]{0,220}config=\{whatsapp\}/.test(page),
  );
}

/* --- a migração protege o que deve ------------------------------------- */

check("migração: RLS ligada na configuração", /whatsapp_settings enable row level security/.test(migration));
check("migração: RLS ligada na fila", /whatsapp_messages enable row level security/.test(migration));
check(
  "migração: anon não lê a tabela base",
  /revoke all on public\.whatsapp_settings from anon/.test(migration),
);
check(
  "migração: fila sem policy de escrita",
  !/policy whatsapp_messages_(?:insert|update|delete)/.test(migration),
);
check("migração: número validado por check", /whatsapp_settings_phone_digits check/.test(migration));
check(
  "migração: escrita via RPC com checagem de vínculo",
  migration.includes("save_whatsapp_settings") && migration.includes("is_restaurant_admin"),
);
check(
  "migração: leitura pública exige plano com o recurso",
  /has_feature\(w\.restaurant_id, 'whatsapp'\)/.test(migration),
);
check("migração: view pública só de casa publicada", /where r\.status = 'published'/.test(migration));
check(
  "migração: fila preparada para os casos do escopo",
  ["order_created", "order_status", "order_confirmed", "marketing", "winback"].every((kind) =>
    migration.includes(kind),
  ),
);
check(
  "migração: nenhum token nem segredo no banco",
  !/(?:access_token|app_secret|bearer|api[_-]?key)\s+(?:text|varchar|jsonb)/i.test(migration),
);
check(
  "migração: não mexe no catálogo de planos",
  !/insert into public\.plans|update public\.plans/.test(migration),
);

/* ========================================================================== */
/* 2. Camada de dados contra a forma real da resposta                         */
/* ========================================================================== */

(async () => {
  {
    const esbuild = require("esbuild");
    const OUT = path.join(__dirname, "build-whatsapp-data");
    fs.rmSync(OUT, { recursive: true, force: true });

    esbuild.buildSync({
      entryPoints: [path.join(ROOT, "src/lib/data/whatsapp.ts")],
      bundle: true,
      outfile: path.join(OUT, "data.cjs"),
      platform: "node",
      format: "cjs",
      loader: { ".ts": "ts" },
      alias: {
        "@": path.join(ROOT, "src"),
        "@/lib/supabase/server": path.join(__dirname, "stubs-whatsapp/supabase-server.ts"),
        "@/lib/supabase/public": path.join(__dirname, "stubs-whatsapp/supabase-public.ts"),
        "server-only": path.join(__dirname, "stubs-whatsapp/server-only.cjs"),
        react: path.join(__dirname, "stubs-whatsapp/react.cjs"),
      },
      logLevel: "error",
    });

    // A stub é criada **antes** do require: o módulo captura a referência de
    // `globalThis.__wbDataStub` no momento em que é carregado (`??=`), então
    // definir depois deixaria o módulo com um objeto diferente do nosso.
    const stub = (globalThis.__wbDataStub = {
      rows: null,
      row: null,
      error: null,
      calls: [],
    });

    const data = require(path.join(OUT, "data.cjs"));

    /* a) formato de `table(...)`: array com uma linha — o caso real. */
    stub.rows = [{ phone: "5511999990000", message: "Oi" }];
    const fromArray = await data.getPublicWhatsappConfig("cantina");
    check(
      "dados: lê a RPC no formato de array (table(...))",
      fromArray?.phone === "5511999990000" && fromArray?.isActive === true,
      JSON.stringify(fromArray),
    );
    check(
      "dados: chama a RPC pública",
      stub.calls.at(-1)?.fn === "public_whatsapp_config",
      stub.calls.at(-1)?.fn,
    );
    check(
      "dados: manda o slug como p_slug",
      stub.calls.at(-1)?.args?.p_slug === "cantina",
      JSON.stringify(stub.calls.at(-1)?.args),
    );

    /* b) formato de objeto (PostgREST também devolve linha única assim). */
    stub.rows = { phone: "5511999990000", message: "Oi" };
    const fromObject = await data.getPublicWhatsappConfig("outra");
    check(
      "dados: lê a RPC no formato de objeto",
      fromObject?.phone === "5511999990000",
      JSON.stringify(fromObject),
    );

    /* c) array vazio = desligado → null (não renderiza botão). */
    stub.rows = [];
    check("dados: array vazio devolve null", (await data.getPublicWhatsappConfig("x")) === null);

    /* d) erro da RPC → null, sem derrubar o cardápio. */
    stub.rows = null;
    stub.error = { message: "boom" };
    check(
      "dados: erro devolve null (cardápio não quebra)",
      (await data.getPublicWhatsappConfig("y")) === null,
    );
    stub.error = null;

    /* e) número inválido vindo do banco → null (última defesa). */
    stub.rows = [{ phone: "1234", message: "Oi" }];
    check("dados: número inválido no banco não vira botão", (await data.getPublicWhatsappConfig("z")) === null);

    /* f) sem telefone → null. */
    stub.rows = [{ phone: null, message: "Oi" }];
    check("dados: linha sem telefone não vira botão", (await data.getPublicWhatsappConfig("w")) === null);

    /* g) slug vazio não consulta o banco. */
    const before = stub.calls.length;
    check("dados: slug vazio devolve null", (await data.getPublicWhatsappConfig("")) === null);
    check("dados: slug vazio não consulta o banco", stub.calls.length === before);

    /* h) painel: lê a tabela com RLS. */
    stub.row = { phone: "5511999990000", message: "Oi", is_active: true };
    const panel = await data.getWhatsappSettings("rest-1");
    check(
      "dados: painel lê a configuração",
      panel.phone === "5511999990000" && panel.isActive,
      JSON.stringify(panel),
    );

    stub.row = null;
    const empty = await data.getWhatsappSettings("rest-2");
    check("dados: painel sem linha cai no vazio", empty.phone === null && empty.isActive === false);

    stub.row = { phone: "5511999990000", message: "Oi", is_active: true };
    check("dados: hasWhatsappSettings vê a linha", (await data.hasWhatsappSettings("rest-3")) === true);
    stub.row = null;
    check("dados: hasWhatsappSettings sem linha", (await data.hasWhatsappSettings("rest-4")) === false);
  }

  /* ======================================================================== */
  /* 3. O que o servidor devolve                                              */
  /* ======================================================================== */

  const serverAvailable = await fetch(`${BASE}/`, { method: "HEAD" })
    .then(() => true)
    .catch(() => false);

  if (serverAvailable) {
    const notFound = await fetch(`${BASE}/r/slug-que-nao-existe-${Date.now()}`);
    check("servidor: slug inexistente responde 404", notFound.status === 404, String(notFound.status));
    check("servidor: 404 não vaza dado de WhatsApp", !/wa\.me|whatsapp/i.test(await notFound.text()));

    const config = await fetch(`${BASE}/app/configuracoes/whatsapp`, { redirect: "manual" });
    check(
      "servidor: /app/configuracoes/whatsapp exige login",
      [200, 302, 307].includes(config.status),
      String(config.status),
    );

    const home = await (await fetch(`${BASE}/`)).text();
    check("servidor: landing sem número de WhatsApp embutido", !/wa\.me\/\d{10,}/.test(home));

    const scripts = [...home.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
    let leakedProvider = false;
    let leakedToken = false;

    for (const script of scripts.slice(0, 12)) {
      const text = await (await fetch(`${BASE}${script}`)).text();
      if (text.includes("unconfiguredCloudWhatsappProvider")) leakedProvider = true;
      if (/(?:service_role|WHATSAPP_TOKEN)/.test(text)) leakedToken = true;
    }

    check("servidor: bundle de cliente não inclui o provedor", !leakedProvider);
    check("servidor: bundle de cliente sem token", !leakedToken);
  } else {
    console.log(`(servidor em ${BASE} indisponível — checagens de rede puladas)`);
  }

  /* ------------------------------------------------------------ relatório */

  const failed = results.filter((r) => !r.ok);
  console.log("");
  for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  console.log(`\nwhatsapp-ssr: ${results.length - failed.length}/${results.length} PASS\n`);
  process.exit(failed.length ? 1 : 0);
})();
