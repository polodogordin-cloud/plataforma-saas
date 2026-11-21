/**
 * Harness da Etapa 16 — lógica pura do analytics.
 *
 * Cobre o que é verificável **sem rede e sem banco**: formatação de dinheiro
 * compacto, comparação entre períodos ("cresceu quanto?"), escala de gráfico,
 * estados de "sem dados"/"dados insuficientes" e validação do período
 * personalizado.
 *
 * O que NÃO está aqui, de propósito: as agregações SQL. Essas foram testadas
 * contra o banco real (ver README) porque o jeito de errá-las é justamente o
 * que um mock não reproduz — `timezone`, `date_trunc`, filtro de status e o
 * `return next` que sumiu na primeira versão de `analytics_period`.
 *
 * Rodar: node .arena-test/analytics-lib.cjs
 */

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-analytics");
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

/**
 * O `Intl` do Node separa "R$" do número com espaço **não separável** (U+00A0),
 * não com o espaço comum. Comparar com "R$ 45,90" digitado falha por um byte
 * invisível — foi o que aconteceu na primeira execução deste harness. A
 * normalização deixa a asserção legível sem esconder o valor real.
 */
function money(name, actual, expected) {
  const norm = (text) => text.replace(/\u00a0/g, " ");
  check(name, norm(actual) === norm(expected), `recebi ${JSON.stringify(actual)}, esperava ${JSON.stringify(expected)}`);
}

function eq(name, actual, expected) {
  check(
    name,
    Object.is(actual, expected),
    `recebi ${JSON.stringify(actual)}, esperava ${JSON.stringify(expected)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Bundle                                                                     */
/* -------------------------------------------------------------------------- */

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/analytics.ts")],
  outfile: path.join(OUT, "analytics.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  external: ["server-only"],
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "silent",
});

const A = require(path.join(OUT, "analytics.cjs"));

/* -------------------------------------------------------------------------- */
/* 1. Dinheiro — o que cabe em 320px                                          */
/* -------------------------------------------------------------------------- */

money("valor pequeno mantém centavos", A.formatMoneyCompact(45.9), "R$ 45,90");
money("zero é explícito", A.formatMoneyCompact(0), "R$ 0,00");
money("999 não abrevia", A.formatMoneyCompact(999), "R$ 999,00");
money("1000 vira mil", A.formatMoneyCompact(1000), "R$ 1 mil");
money("1500 vira 1,5 mil", A.formatMoneyCompact(1500), "R$ 1,5 mil");
money("9999 ainda tem casa decimal", A.formatMoneyCompact(9999), "R$ 10 mil");
money("12345 arredonda milhar", A.formatMoneyCompact(12345), "R$ 12 mil");
money("milhão usa mi", A.formatMoneyCompact(1_250_000), "R$ 1,3 mi");
money("negativo com sinal antes de R$", A.formatMoneyCompact(-1500), "-R$ 1,5 mil");
money("negativo pequeno", A.formatMoneyCompact(-45.9), "-R$ 45,90");
check(
  "abreviação é sempre mais curta que o valor completo",
  A.formatMoneyCompact(1_250_000).length < A.formatMoney(1_250_000).length,
);
check(
  "NaN não vira 'R$ NaN'",
  !A.formatMoneyCompact(NaN).includes("NaN"),
  A.formatMoneyCompact(NaN),
);

/* -------------------------------------------------------------------------- */
/* 2. Crescimento — os três casos que enganam dashboard                       */
/* -------------------------------------------------------------------------- */

// Caso feliz
let g = A.computeGrowth(120, 100);
eq("crescimento de 20%", g.percent, 20);
eq("direção up", g.direction, "up");
eq("rótulo +20%", g.label, "+20%");

g = A.computeGrowth(80, 100);
eq("queda de 20%", g.percent, -20);
eq("direção down", g.direction, "down");
eq("rótulo com menos tipográfico", g.label, "−20%");

// Base zero: NÃO é +∞% nem +100%
g = A.computeGrowth(3, 0);
eq("base zero devolve percent null", g.percent, null);
eq("base zero não é 'up'", g.direction, "flat");
eq("base zero diz 'sem base'", g.label, "sem base");

// Período anterior sem dados: mesmo com divisor > 0, não compara
g = A.computeGrowth(50, 10, false);
eq("hasData false ignora a conta", g.percent, null);
eq("hasData false diz 'sem base'", g.label, "sem base");

// Variação mínima arredonda para 0 → "estável", sem flecha
g = A.computeGrowth(100.2, 100);
eq("0,2% arredonda para 0", g.percent, 0);
eq("0,2% é 'estável'", g.label, "estável");
eq("0,2% não tem direção", g.direction, "flat");

// Queda total
g = A.computeGrowth(0, 100);
eq("queda de 100%", g.percent, -100);
eq("queda total é down", g.direction, "down");

// Sem divisão por zero
check(
  "nunca devolve Infinity",
  !String(A.computeGrowth(5, 0).percent).includes("Infinity"),
);

/* -------------------------------------------------------------------------- */
/* 3. Escala de gráfico                                                       */
/* -------------------------------------------------------------------------- */

eq("barra proporcional", A.barHeightPercent(50, 100), 50);
eq("barra máxima", A.barHeightPercent(100, 100), 100);
eq("máximo zero devolve 0 (não NaN)", A.barHeightPercent(10, 0), 0);
check("máximo zero não é NaN", !Number.isNaN(A.barHeightPercent(10, 0)));
eq("valor negativo vira 0", A.barHeightPercent(-5, 100), 0);
eq("acima do máximo satura em 100", A.barHeightPercent(150, 100), 100);
eq("NaN devolve 0", A.barHeightPercent(NaN, 100), 0);

/* -------------------------------------------------------------------------- */
/* 4. Estados de dados                                                        */
/* -------------------------------------------------------------------------- */

check(
  "dois dias com venda formam tendência",
  A.hasEnoughForTrend(2) === true,
);
check("um dia não forma tendência", A.hasEnoughForTrend(1) === false);
check("zero dias não forma tendência", A.hasEnoughForTrend(0) === false);

check(
  "período totalmente vazio é 'sem dados'",
  A.isEmptyPeriod({ orders_count: 0, paid_value: 0, waiter_calls: 0, bill_requests: 0 }) === true,
);
check(
  "pedido sem venda ainda não é vazio",
  A.isEmptyPeriod({ orders_count: 1, paid_value: 0, waiter_calls: 0, bill_requests: 0 }) === false,
);
check(
  "chamada de garçom sem pedido não é vazio",
  A.isEmptyPeriod({ orders_count: 0, paid_value: 0, waiter_calls: 2, bill_requests: 0 }) === false,
);
check(
  "pagamento sem pedido não é vazio",
  A.isEmptyPeriod({ orders_count: 0, paid_value: 30, waiter_calls: 0, bill_requests: 0 }) === false,
);

/* -------------------------------------------------------------------------- */
/* 5. Período personalizado                                                   */
/* -------------------------------------------------------------------------- */

eq("intervalo válido", A.validateCustomRange("2026-11-01", "2026-11-21"), null);
eq("mesmo dia é válido", A.validateCustomRange("2026-11-21", "2026-11-21"), null);
check(
  "invertido é recusado",
  typeof A.validateCustomRange("2026-11-21", "2026-11-01") === "string",
);
check("vazio é recusado", typeof A.validateCustomRange("", "2026-11-21") === "string");
check(
  "formato inválido é recusado",
  typeof A.validateCustomRange("21/11/2026", "2026-11-21") === "string",
);
check(
  "mais de um ano é recusado",
  typeof A.validateCustomRange("2024-01-01", "2026-11-21") === "string",
);
eq(
  "exatamente um ano é aceito",
  A.validateCustomRange("2025-11-21", "2026-11-20"),
  null,
);

/* -------------------------------------------------------------------------- */
/* 6. Rótulos                                                                 */
/* -------------------------------------------------------------------------- */

eq("dia curto", A.formatDayShort("2026-11-21"), "21/11");
eq("dia por extenso curto", A.formatDayLabel("2026-11-21"), "21 nov");
eq("dia sem zero à esquerda", A.formatDayLabel("2026-01-05"), "5 jan");
eq("hora com dois dígitos", A.formatHour(9), "09h");
eq("hora cheia", A.formatHour(23), "23h");

eq(
  "hoje não repete a data",
  A.describePeriod("today", "2026-11-21", "2026-11-21"),
  "Hoje, 21 nov",
);
eq(
  "ontem nomeado",
  A.describePeriod("yesterday", "2026-11-20", "2026-11-20"),
  "Ontem, 20 nov",
);
eq(
  "intervalo mostra as duas pontas",
  A.describePeriod("last7", "2026-11-15", "2026-11-21"),
  "15 nov – 21 nov",
);

/* -------------------------------------------------------------------------- */
/* 7. Utilidades de lista                                                     */
/* -------------------------------------------------------------------------- */

eq("máximo de lista", A.maxOf([3, 9, 2], (n) => n), 9);
eq("máximo de lista vazia", A.maxOf([], (n) => n), 0);
eq(
  "máximo por seletor",
  A.maxOf([{ v: 1 }, { v: 7 }], (o) => o.v),
  7,
);

const top = A.topN([{ q: 1 }, { q: 9 }, { q: 5 }], 2, (o) => o.q);
eq("topN corta o excedente", top.length, 2);
eq("topN ordena desc", top[0].q, 9);
eq("topN segundo", top[1].q, 5);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

console.log(`\nanalytics-lib: ${pass}/${pass + fail} PASS`);
if (fail > 0) {
  console.log("\nFalhas:");
  for (const item of failures) console.log(`  ✗ ${item}`);
  process.exit(1);
}
