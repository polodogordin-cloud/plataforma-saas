/**
 * Harness da Etapa 16 — multi-tenant e RBAC nas funções de analytics.
 *
 * ─── O que este arquivo testa, e por que assim ─────────────────────────────
 *
 * As agregações rodam no Postgres. Testá-las com mock de cliente Supabase
 * provaria só que o mock concorda comigo — o risco real é outro: alguém editar
 * uma função e **remover o guard** de tenant, ou conceder `EXECUTE` a `anon`.
 *
 * Por isso o harness lê o SQL de `supabase/migrations/0016_analytics.sql` como
 * texto e verifica invariantes estruturais:
 *
 *   1. toda função `restaurant_analytics_*` contém `is_restaurant_member`;
 *   2. nenhuma delas é executável por `anon` (revoke presente);
 *   3. as funções `admin_*` contêm `is_platform_admin`;
 *   4. o livro de pagamentos não tem policy de escrita — só de select;
 *   5. o teto de pagamento existe (não dá para "marcar pago" acima do total).
 *
 * É análise estática, não execução. Complementa — e não substitui — o teste
 * contra o banco real, que está registrado no README (`set local role anon` +
 * `request.jwt.claims`). Aqui a garantia é a de que a migração **no
 * repositório** mantém as propriedades; o teste vivo garante que o banco
 * aplicado também está nelas.
 *
 * Rodar: node .arena-test/analytics-security.cjs
 */

const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const SQL = fs.readFileSync(path.join(ROOT, "supabase/migrations/0016_analytics.sql"), "utf8");

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

/** Recorta o corpo de uma função pelo nome, até o `$$;` que a fecha. */
function functionBody(name) {
  const start = SQL.indexOf(`function public.${name}(`);
  if (start === -1) return null;
  const end = SQL.indexOf("$$;", start);
  return end === -1 ? SQL.slice(start) : SQL.slice(start, end);
}

/* -------------------------------------------------------------------------- */
/* 1. Funções de analytics por restaurante                                    */
/* -------------------------------------------------------------------------- */

const TENANT_FUNCTIONS = [
  "restaurant_analytics_summary",
  "restaurant_analytics_daily",
  "restaurant_analytics_hours",
  "restaurant_analytics_top_products",
  "restaurant_analytics_categories",
  "restaurant_analytics_tables",
  "restaurant_analytics_payment_methods",
  "restaurant_analytics_previous",
];

for (const name of TENANT_FUNCTIONS) {
  const body = functionBody(name);
  check(`${name} existe`, body !== null);

  if (!body) continue;

  check(
    `${name} confere vínculo de equipe`,
    body.includes("is_restaurant_member"),
    "sem is_restaurant_member, a função devolve dado de qualquer casa",
  );

  check(
    `${name} recorta por restaurant_id`,
    body.includes("restaurant_id = p_restaurant_id"),
  );

  check(
    `${name} é security definer (RLS não basta sozinha)`,
    body.includes("security definer"),
  );

  check(
    `${name} fixa search_path`,
    body.includes("set search_path = public"),
  );

  // O guard precisa estar ANTES de qualquer dado ser devolvido.
  const guardIndex = body.indexOf("is_restaurant_member");
  const returnIndex = body.indexOf("return query");
  check(
    `${name} checa o vínculo antes de consultar`,
    guardIndex !== -1 && (returnIndex === -1 || guardIndex < returnIndex),
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Nada de analytics por restaurante executável por anon                    */
/* -------------------------------------------------------------------------- */

for (const name of TENANT_FUNCTIONS) {
  const revoke = new RegExp(
    `revoke all on function public\\.${name}\\([^)]*\\) from public, anon`,
    "i",
  );
  check(
    `${name} revogada de anon`,
    revoke.test(SQL),
    "função de analytics aberta a anon vaza faturamento",
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Livro de pagamentos                                                     */
/* -------------------------------------------------------------------------- */

const paymentsBlock = SQL.slice(
  SQL.indexOf("create table if not exists public.order_payments"),
  SQL.indexOf("-- 3. Índices do analytics"),
);

check("tabela order_payments existe", paymentsBlock.length > 0);
check("order_payments tem RLS", paymentsBlock.includes("enable row level security"));
check(
  "order_payments filtra por membro na policy",
  paymentsBlock.includes("is_restaurant_member"),
);
check(
  "order_payments não é legível por anon",
  /revoke all on public\.order_payments from anon/i.test(paymentsBlock),
);

/*
 * Só a policy de SELECT é permitida. Se alguém adicionar `for insert` ou
 * `for update`, um navegador pode forjar um pagamento direto na tabela e o
 * faturamento inteiro perde sentido — o teto do pedido e o `recorded_by` são
 * conferidos na RPC, não na tabela.
 */
const writePolicy = /create policy[^;]*on public\.order_payments\s+for\s+(insert|update|delete|all)/i;
check(
  "order_payments não aceita escrita direta",
  !writePolicy.test(SQL),
  "policy de escrita permitiria forjar pagamento pelo cliente",
);

/* -------------------------------------------------------------------------- */
/* 4. Teto de pagamento (o "0" a mais)                                        */
/* -------------------------------------------------------------------------- */

const recordBody = functionBody("record_order_payment");
check("record_order_payment existe", recordBody !== null);

if (recordBody) {
  check(
    "confere vínculo antes de gravar",
    recordBody.includes("is_restaurant_member"),
  );
  check(
    "recusa valor maior que o total do pedido",
    recordBody.includes("amount_exceeds_total"),
    "sem teto, um dedo escorregado infla o faturamento para sempre",
  );
  check("recusa valor não positivo", recordBody.includes("invalid_amount"));
  check(
    "soma só pagamentos com status paid",
    recordBody.includes("p.status = 'paid'"),
  );
  check("registra quem lançou", recordBody.includes("recorded_by"));
}

const refundBody = functionBody("refund_order_payment");
check("refund_order_payment existe", refundBody !== null);
if (refundBody) {
  check("estorno confere vínculo", refundBody.includes("is_restaurant_member"));
  check(
    "estorno marca em vez de apagar",
    refundBody.includes("status = 'refunded'") && !refundBody.includes("delete from"),
    "apagar muda o relatório de ontem sem rastro",
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Admin master                                                            */
/* -------------------------------------------------------------------------- */

for (const name of ["admin_analytics", "admin_analytics_daily"]) {
  const body = functionBody(name);
  check(`${name} existe`, body !== null);
  if (!body) continue;

  check(`${name} exige admin da plataforma`, body.includes("is_platform_admin"));
  check(`${name} levanta admin_forbidden`, body.includes("admin_forbidden"));
  check(
    `${name} valida a janela recebida`,
    body.includes("least(greatest"),
    "sem clamp, p_days gigante vira varredura da tabela inteira",
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Período: validação no banco, não no cliente                             */
/* -------------------------------------------------------------------------- */

const periodBody = (functionBody("analytics_period") || "") + (functionBody("analytics_previous_period") || "");
check("analytics_period existe", periodBody.length > 0);
check("recusa preset desconhecido", periodBody.includes("unknown_preset"));
check("recusa intervalo invertido", periodBody.includes("period_inverted"));
check("recusa intervalo maior que um ano", periodBody.includes("period_too_long"));
check("recusa custom sem datas", periodBody.includes("period_required"));
check(
  "intervalo é semiaberto (não perde o último segundo do dia)",
  periodBody.includes("(v_to + 1)"),
  "`<= 23:59:59` perde pedido feito nos últimos milissegundos do dia",
);
check(
  "emite a linha (return next) — sem isso devolve vazio em silêncio",
  periodBody.includes("return next"),
);

/* -------------------------------------------------------------------------- */
/* 7. Multi-tenant no frontend                                                */
/* -------------------------------------------------------------------------- */

const dataFile = fs.readFileSync(path.join(ROOT, "src/lib/data/analytics.ts"), "utf8");

check(
  "camada de dados não aceita restaurante vindo da URL",
  !/searchParams[^\n]*restaurantId/.test(dataFile),
);
check(
  "todas as RPCs recebem p_restaurant_id",
  (dataFile.match(/restaurant_analytics_/g) || []).length >= 7,
);
check(
  "resumo vazio é tratado como sem acesso",
  dataFile.includes("if (!summaryRow) return null"),
);
check("arquivo é server-only", dataFile.includes('import "server-only"'));

const pageFile = fs.readFileSync(path.join(ROOT, "src/app/app/analytics/page.tsx"), "utf8");
check(
  "página pega o restaurante da sessão",
  pageFile.includes("getActiveRestaurant"),
  "id de restaurante na URL permitiria trocar de tenant",
);
check(
  "página não é indexável",
  pageFile.includes("index: false"),
);
check(
  "página é dinâmica (relatório de minutos atrás)",
  pageFile.includes('dynamic = "force-dynamic"'),
);

const actionFile = fs.readFileSync(path.join(ROOT, "src/actions/payments.ts"), "utf8");
check(
  "action valida entrada com zod",
  actionFile.includes("safeParse"),
);
check(
  "action confirma restaurante ativo antes de gravar",
  actionFile.includes("getActiveRestaurant"),
);
check(
  "action não marca pedido como pago por status",
  !/status\s*[:=]\s*["']paid["']/.test(actionFile.replace(/p_method|method:/g, "")),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

console.log(`\nanalytics-security: ${pass}/${pass + fail} PASS`);
if (fail > 0) {
  console.log("\nFalhas:");
  for (const item of failures) console.log(`  ✗ ${item}`);
  process.exit(1);
}
