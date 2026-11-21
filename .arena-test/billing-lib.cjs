/**
 * Harness de lógica de planos/assinaturas — Etapa 11.
 *
 * Sem DOM e sem banco: o alvo é a **aritmética** que a tela mostra. Se a barra
 * disser "12 de 50" e o banco recusar a 13ª, o dono perde a confiança na tela
 * inteira — por isso as funções de `plan-rules` são testadas nas bordas
 * (limite nulo, zero, estourado, exatamente no limite).
 *
 * As regras de verdade continuam no Postgres (26 checagens SQL à parte).
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-billing-lib");
fs.rmSync(OUT, { recursive: true, force: true });

function build(entry, name, externals = []) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    outfile: path.join(OUT, `${name}.js`),
    platform: "node",
    format: "cjs",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(ROOT, "src") },
    external: externals,
    logLevel: "error",
  });
  return require(path.join(OUT, `${name}.js`));
}

const T = build("src/lib/types.ts", "types");
const R = build("src/lib/plan-rules.ts", "rules");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ===================== 1. Vocabulário ===================== */

check(
  "tipo: os seis estados de assinatura existem",
  ["trial", "active", "past_due", "cancelled", "expired", "suspended"].every(
    (s) => typeof T.SUBSCRIPTION_STATE_LABEL[s] === "string",
  ),
);

check(
  "tipo: todo estado tem tom definido",
  ["trial", "active", "past_due", "cancelled", "expired", "suspended"].every(
    (s) => typeof T.SUBSCRIPTION_STATE_TONE[s] === "string",
  ),
);

check(
  "tipo: só trial, active e past_due liberam o painel",
  T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.trial &&
    T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.active &&
    T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.past_due &&
    !T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.cancelled &&
    !T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.expired &&
    !T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.suspended,
);

check(
  "tipo: as cinco chaves de limite do escopo",
  T.PLAN_LIMIT_KEYS.length === 5 &&
    ["max_products", "max_tables", "max_users", "max_categories", "max_orders_month"].every((k) =>
      T.PLAN_LIMIT_KEYS.includes(k),
    ),
  T.PLAN_LIMIT_KEYS.join(","),
);

check(
  "tipo: as nove chaves de recurso do escopo",
  ["custom_theme", "nfc", "qr_code", "waiter_call", "bill_request", "analytics", "custom_domain", "whatsapp", "pix"].every(
    (k) => T.PLAN_FEATURE_KEYS.includes(k),
  ),
  T.PLAN_FEATURE_KEYS.join(","),
);

check(
  "tipo: toda chave de recurso tem rótulo em PT-BR",
  T.PLAN_FEATURE_KEYS.every((k) => typeof T.PLAN_FEATURE_LABEL[k] === "string"),
);

check(
  "tipo: toda chave de limite tem rótulo e mensagem de bloqueio",
  T.PLAN_LIMIT_KEYS.every(
    (k) => typeof T.PLAN_LIMIT_LABEL[k] === "string" && typeof T.PLAN_LIMIT_MESSAGE[k] === "string",
  ),
);

check(
  "mensagem: o texto do escopo aparece literalmente",
  T.PLAN_LIMIT_MESSAGE.max_tables === "Seu plano atingiu o limite de mesas.",
  T.PLAN_LIMIT_MESSAGE.max_tables,
);

check(
  "tipo: isPlanFeatureKey recusa chave desconhecida",
  T.isPlanFeatureKey("nfc") && !T.isPlanFeatureKey("nfc_falso") && !T.isPlanFeatureKey(""),
);

/* ===================== 2. Normalização do jsonb ===================== */

check(
  "normalizar: features ignora valores que não são string",
  JSON.stringify(T.normalizePlanFeatures(["nfc", 3, null, "pix"])) === JSON.stringify(["nfc", "pix"]),
  JSON.stringify(T.normalizePlanFeatures(["nfc", 3, null, "pix"])),
);

check(
  "normalizar: features com entrada inválida devolve lista vazia",
  T.normalizePlanFeatures(null).length === 0 && T.normalizePlanFeatures("nfc").length === 0,
);

check(
  "normalizar: limites ignora chave desconhecida",
  (() => {
    const l = T.normalizePlanLimits({ max_tables: 50, max_bananas: 2 });
    return l.max_tables === 50 && l.max_bananas === undefined;
  })(),
);

check(
  "normalizar: limite null continua null (sem limite), não vira 0",
  T.normalizePlanLimits({ max_tables: null }).max_tables === null,
);

check(
  "normalizar: limite em string vira número",
  T.normalizePlanLimits({ max_products: "500" }).max_products === 500,
);

check(
  "normalizar: jsonb inválido devolve objeto vazio",
  Object.keys(T.normalizePlanLimits(undefined)).length === 0 &&
    Object.keys(T.normalizePlanLimits([])).length === 0,
);

/* ===================== 3. Uso vs. limite ===================== */

const counter = (used, limit) => ({ used, limit });

check("limite: limitOf devolve null quando ausente", R.limitOf({}, "max_tables") === null);
check("limite: limitOf devolve o número quando definido", R.limitOf({ max_tables: 50 }, "max_tables") === 50);

check(
  "uso: razão sem limite é 0 (barra não mente cheia)",
  R.usageRatio(counter(40, null)) === 0,
);

check("uso: razão no meio é 0.5", Math.abs(R.usageRatio(counter(25, 50)) - 0.5) < 1e-9);
check("uso: razão nunca passa de 1", R.usageRatio(counter(90, 50)) === 1);
check("uso: razão nunca é negativa", R.usageRatio(counter(-1, 50)) === 0);

check("uso: exatamente no limite conta como atingido", R.isLimitReached(counter(50, 50)));
check("uso: acima do limite conta como atingido", R.isLimitReached(counter(51, 50)));
check("uso: um abaixo do limite não conta como atingido", !R.isLimitReached(counter(49, 50)));
check("uso: sem limite nunca está atingido", !R.isLimitReached(counter(9999, null)));

check("aviso: 80% já avisa", R.isLimitWarning(counter(40, 50)));
check("aviso: 20% não avisa", !R.isLimitWarning(counter(10, 50)));
check("aviso: sem limite nunca avisa", !R.isLimitWarning(counter(500, null)));
check("aviso: limite zero avisa sempre", R.isLimitWarning(counter(0, 0)));

check("texto: '12 de 50'", R.formatUsage(counter(12, 50)) === "12 de 50", R.formatUsage(counter(12, 50)));
check(
  "texto: sem limite mostra o usado",
  R.formatUsage(counter(12, null)) === "12 · sem limite",
  R.formatUsage(counter(12, null)),
);
check("texto: percentual arredondado", R.usagePercent(counter(1, 3)) === 33, String(R.usagePercent(counter(1, 3))));

/* ===================== 4. Recursos e preço ===================== */

check(
  "recursos: rótulos em PT-BR na ordem do plano",
  JSON.stringify(R.featureLabels(["nfc", "qr_code"])) === JSON.stringify(["Etiquetas NFC", "QR Code das mesas"]),
  JSON.stringify(R.featureLabels(["nfc", "qr_code"])),
);

check(
  "recursos: chave desconhecida é descartada do rótulo",
  R.featureLabels(["nfc", "coisa_nova"]).length === 1,
);

check(
  "recursos: chave desconhecida aparece crua em featureLabel",
  R.featureLabel("coisa_nova") === "coisa_nova",
);

check(
  "preço: zero é 'Grátis'",
  R.priceLabel({ price: 0, interval: "monthly" }) === "Grátis",
);
check(
  "preço: mensal diz 'por mês'",
  R.priceLabel({ price: 99.9, interval: "monthly" }) === "por mês",
);
check("preço: anual diz 'por ano'", R.priceLabel({ price: 999, interval: "yearly" }) === "por ano");

check("cta: grátis chama 'Começar grátis'", R.ctaLabel({ price: 0 }) === "Começar grátis");
check("cta: pago chama 'Começar agora'", R.ctaLabel({ price: 49.9 }) === "Começar agora");

/* ===================== 5. Textos de estado ===================== */

check(
  "estado: trial com dias restantes",
  R.subscriptionHeadline("trial", 3) === "Seu teste termina em 3 dias.",
  R.subscriptionHeadline("trial", 3),
);
check("estado: trial com 1 dia usa singular", R.subscriptionHeadline("trial", 1) === "Seu teste termina em 1 dia.");
check("estado: trial no último dia", R.subscriptionHeadline("trial", 0) === "Seu teste termina hoje.");
check(
  "estado: ativo não fala de teste",
  !R.subscriptionHeadline("active", null).includes("teste"),
  R.subscriptionHeadline("active", null),
);
check("estado: expirado pede ação", R.subscriptionHeadline("expired", null).includes("terminou"));
check("estado: suspenso cita a plataforma", R.subscriptionHeadline("suspended", null).includes("plataforma"));

check("dias: data futura conta para cima", R.daysUntil("2030-01-01T00:00:00Z", new Date("2029-12-30T00:00:00Z")) === 2);
check("dias: data passada vira 0, nunca negativo", R.daysUntil("2020-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z")) === 0);
check("dias: null devolve null", R.daysUntil(null) === null);
check("dias: data inválida devolve null", R.daysUntil("não é data") === null);

/* ===================== 6. Comparação de planos ===================== */

const basico = {
  id: "basico",
  name: "Básico",
  description: null,
  price: 49.9,
  interval: "monthly",
  features: ["qr_code", "waiter_call"],
  limits: { max_tables: 10, max_products: 50 },
};
const premium = {
  id: "premium",
  name: "Premium",
  description: null,
  price: 199.9,
  interval: "monthly",
  features: ["qr_code", "nfc", "analytics"],
  limits: { max_tables: null, max_products: 500 },
};

const up = R.comparePlans(basico, premium);
check("comparar: upgrade ganha recursos", JSON.stringify(up.gained) === JSON.stringify(["nfc", "analytics"]), up.gained.join(","));
check("comparar: upgrade perde waiter_call", JSON.stringify(up.lost) === JSON.stringify(["waiter_call"]));
check("comparar: upgrade eleva limites", up.raisedLimits.includes("max_tables") && up.raisedLimits.includes("max_products"));
check("comparar: upgrade não rebaixa limite", up.loweredLimits.length === 0);

const down = R.comparePlans(premium, basico);
check("comparar: downgrade rebaixa limites", down.loweredLimits.includes("max_tables"));
check("comparar: downgrade perde recursos", down.lost.includes("nfc"));

const same = R.comparePlans(basico, basico);
check("comparar: mesmo plano não muda nada", same.gained.length === 0 && same.lost.length === 0 && same.raisedLimits.length === 0 && same.loweredLimits.length === 0);

/* ===================== 7. Ações: as regras de segurança ===================== */

const fsSrc = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const billingActions = fsSrc("src/actions/billing.ts");
const adminActions = fsSrc("src/actions/admin.ts");
const menuActions = fsSrc("src/actions/menu.ts");
const tablesActions = fsSrc("src/actions/tables.ts");
const themeActions = fsSrc("src/actions/theme.ts");
const appLayout = fsSrc("src/app/app/layout.tsx");

const count = (src, needle) => src.split(needle).length - 1;

check(
  "ações: toda ação do painel master confere isPlatformAdmin",
  count(billingActions, "await isPlatformAdmin()") >= 5,
  String(count(billingActions, "await isPlatformAdmin()")),
);

// O admin escolhe a casa no formulário (é o trabalho dele); a ação do dono, não.
// Recortamos a parte do arquivo que pertence ao restaurante e conferimos que ali
// não existe id vindo do payload.
const ownerSection = billingActions.split("/* Painel master")[0];

check(
  "ações: ação do restaurante usa getActiveRestaurant (não id do payload)",
  ownerSection.includes("getActiveRestaurant()") &&
    !ownerSection.includes('formData.get("restaurantId")') &&
    !ownerSection.includes("input.restaurantId"),
  ownerSection.includes('formData.get("restaurantId")') ? "id veio do formulário" : "",
);

check(
  "ações: troca de plano exige owner/admin",
  billingActions.includes('restaurant.role !== "owner"') && billingActions.includes('restaurant.role !== "admin"'),
);

check(
  "ações: limite de mesas é traduzido na Server Action",
  tablesActions.includes("plan_limit_reached") && tablesActions.includes("limite de mesas"),
);

check(
  "ações: limite de produtos é traduzido com saída para /planos",
  menuActions.includes("plan_limit_reached") && menuActions.includes("Seu plano atingiu o limite de"),
);

check(
  "ações: tema exige recurso custom_theme no servidor",
  themeActions.includes('p_feature: "custom_theme"') && count(themeActions, "requireThemeFeature(restaurant.id)") >= 2,
);

check(
  "layout: assinatura sem acesso mostra a tela, não um erro",
  appLayout.includes("SubscriptionNotice") && appLayout.includes("SUBSCRIPTION_STATE_ALLOWS_ACCESS"),
);

check(
  "layout: bloqueio considera expired e cancelled, libera past_due",
  T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.past_due && !T.SUBSCRIPTION_STATE_ALLOWS_ACCESS.expired,
);

check(
  "segurança: nenhum id de autor vem do formulário nas ações de assinatura",
  !billingActions.includes("actorId") && !billingActions.includes("p_actor"),
);

/* ===================== 8. Camada de pagamento ===================== */

const billingLib = fsSrc("src/lib/billing/index.ts");

check(
  "gateway: as seis funções conceituais do escopo estão no contrato",
  ["createCustomer", "createSubscription", "cancelSubscription", "changePlan", "getSubscriptionStatus", "handleWebhook"].every(
    (fn) => billingLib.includes(`${fn}(`) || billingLib.includes(`${fn}:`),
  ),
);

check(
  "gateway: provedor manual não finge estar ligado",
  billingLib.includes("live: false") && billingLib.includes("requiresProvider: true"),
);

check(
  "gateway: não inventa id externo",
  !/externalId:\s*["'](sub|cus|pi)_/.test(billingLib),
);

check(
  "gateway: webhook do manual é explícito sobre não haver provedor",
  billingLib.includes("Nenhum provedor de pagamento está configurado"),
);

check(
  "gateway: troca de provedor é configuração, não código",
  billingLib.includes("PAYMENT_PROVIDER"),
);

check(
  "gateway: o banco é quem aplica o plano (RPC change_plan)",
  billingLib.includes('rpc("change_plan"'),
);

/* ============ catálogo comercial: vitrine e plano do teste ============ */
//
// Três defeitos reais apareceram só ao abrir a produção depois do merge:
//   1. o plano herdado `pro` (R$ 0, limite ilimitado) estava ativo na vitrine;
//   2. os nomes/descrições dos planos novos perderam a acentuação na aplicação;
//   3. o teste gratuito era concedido no plano MAIS CARO — o cliente terminava
//      o período acima do limite do plano que conseguiria pagar e ficava preso.
// As checagens abaixo prendem a correção no código, não só no banco.

const billingData = fsSrc("src/lib/data/billing.ts");
const plansPage = fsSrc("src/app/planos/page.tsx");
const adminPlansPage = fsSrc("src/app/admin/planos/page.tsx");
const trialSettings = fsSrc("src/components/admin/trial-settings.tsx");
const billingActionsFile = fsSrc("src/actions/billing.ts");

// O filtro de "plano pago" é do banco: `public_plans` só devolve ativo E com
// preço acima de zero. Aqui conferimos que o SQL aplicado carrega esse filtro e
// que a tela consome a RPC (não faz select direto em `plans`).
const fixSql = fsSrc("supabase/migrations/0013_plan_catalog_and_trial_fix.sql");

check(
  "vitrine: o banco só oferece plano ativo e pago",
  /where pl\.is_active\s*\n?\s*and pl\.price_monthly > 0/.test(fixSql),
  "filtro ausente em public_plans",
);

check(
  "vitrine: a tela lê a RPC, não a tabela",
  billingData.includes('rpc("public_plans")') && !/from\("plans"\)/.test(billingData),
);

check(
  "vitrine: anuncia qual plano o teste concede, vindo do banco",
  plansPage.includes("trial_plan_id") && /trialPlanName/.test(plansPage),
);

check(
  "vitrine: CTA não promete plano grátis (não há plano de preço zero na oferta)",
  !plansPage.includes('"Começar grátis"') && plansPage.includes("Começar agora"),
);

check(
  "vitrine: cards seguem verticais, sem tabela de comparação",
  !/<table/.test(plansPage) && plansPage.includes("flex-col"),
);

check(
  "trial: plano configurável é lido em `platform_settings`",
  billingData.includes("trial_plan_id") && /trial_plan_id/.test(fsSrc("src/lib/types.ts")),
);

check(
  "trial: seletor do plano lista apenas planos ativos e pagos",
  /is_active\s*&&\s*plan\.price\s*>\s*0/.test(adminPlansPage),
);

check(
  "trial: opção automática existe (banco escolhe o mais barato)",
  trialSettings.includes("Automático (plano pago mais barato)"),
);

check(
  "trial: a tela explica o risco de conceder o plano mais caro",
  /mais caro/.test(trialSettings),
);

check(
  "config: aceita trial_plan_id como texto, dias como número",
  billingActionsFile.includes('key === "trial_plan_id"') &&
    billingActionsFile.includes("payload = raw.trim()"),
);

check(
  "config: erro de plano inválido vira mensagem em PT-BR",
  billingActionsFile.includes("Escolha um plano ativo."),
);

check(
  "config: dias fora de 0..365 continuam recusados no servidor",
  billingActionsFile.includes("value < 0 || value > 365"),
);

/* ===================== relatório ===================== */

const passed = results.filter((r) => r.ok).length;
console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\nbilling-lib: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
