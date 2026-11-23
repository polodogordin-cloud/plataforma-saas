/**
 * Harness do modelo de cupom — Etapa 25 (parte 1).
 *
 * Alvo: `src/lib/coupons.ts`, sem DOM e sem banco.
 *
 * O que aqui, se errar, não dá erro — dá **desconto errado**:
 *
 *   1. normalização do código: a mesma palavra digitada de cinco jeitos tem de
 *      virar o mesmo código (e o banco tem de concordar);
 *   2. cálculo da prévia: percentual, teto, valor fixo maior que o pedido;
 *   3. coerência do formulário: percentual > 100, fim antes do início, limite
 *      por cliente fora da faixa;
 *   4. textos do painel: "0 de 0 usos", "Válido até 31/12" e afins.
 *
 * ─── A tabela de códigos vem do banco ─────────────────────────────────────
 *
 * Os 17 casos abaixo foram rodados em `public.normalize_coupon_code` no projeto
 * Supabase real; o resultado esperado aqui é o que o banco devolveu. É o teste
 * de paridade entre a normalização do app e a do banco.
 *
 * Rodar: node .arena-test/coupon-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-coupon-lib");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/coupons.ts")],
  bundle: true,
  outfile: path.join(OUT, "coupons.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  logLevel: "error",
});

const C = require(path.join(OUT, "coupons.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`);

/* ========================================================================== */
/* 1. Código — paridade com o banco                                         */
/* ========================================================================== */

const CODE_TABLE = [
  ["BEMVINDO10", "BEMVINDO10"],
  ["bem vindo 10", "BEMVINDO10"],
  ["  bem-vindo-10  ", "BEMVINDO10"],
  ["Volta às Aulas!", "VOLTAASAULAS"],
  ["promoção", "PROMOCAO"],
  ["açaí", "ACAI"],
  ["", null],
  ["   ", null],
  [null, null],
  ["ab", "AB"],
  ["a", "A"],
  ["ABC-123/XYZ", "ABC123XYZ"],
  ["1234567890123456789012345", "1234567890123456789012345"],
  ["café com leite", "CAFECOMLEITE"],
  ["ÑANDU", "ANDU"],
  ["50%OFF", "50OFF"],
  ["10_off", "10OFF"],
];

for (const [input, expected] of CODE_TABLE) {
  eq(`normalizeCouponCode(${JSON.stringify(input)})`, C.normalizeCouponCode(input), expected);
}

check(
  "todos os formatos do mesmo cupom caem no mesmo código",
  new Set(
    ["bem vindo 10", "BEM-VINDO-10", "BemVindo10", " bem_vindo_10 ", "BEMVINDO-10"].map(
      C.normalizeCouponCode,
    ),
  ).size === 1,
);

check("isValidCouponCode aceita 3 caracteres", C.isValidCouponCode("ABC"));
check("isValidCouponCode recusa 2 caracteres", !C.isValidCouponCode("AB"));
check("isValidCouponCode aceita 24 caracteres", C.isValidCouponCode("A".repeat(24)));
check("isValidCouponCode recusa 25 caracteres", !C.isValidCouponCode("A".repeat(25)));
check("isValidCouponCode recusa vazio", !C.isValidCouponCode(""));
check("isValidCouponCode normaliza antes de medir", C.isValidCouponCode(" b e m "));

eq("maskCouponCodeInput apara no limite", C.maskCouponCodeInput("x".repeat(40)).length, 24);
eq("maskCouponCodeInput aplica normalização", C.maskCouponCodeInput("bem vindo 10"), "BEMVINDO10");
eq("maskCouponCodeInput idempotente", C.maskCouponCodeInput(C.maskCouponCodeInput("abc-1")), "ABC1");

eq("suggestCouponCode a partir do nome", C.suggestCouponCode("Volta às aulas"), "VOLTAASAULAS");
eq("suggestCouponCode sem nome útil", C.suggestCouponCode("!!"), "PROMO");
eq("suggestCouponCode corta em 24", C.suggestCouponCode("a".repeat(40)).length, 24);

/* ========================================================================== */
/* 2. Desconto em texto                                                     */
/* ========================================================================== */

eq("percentual inteiro", C.describeDiscount("percentage", 10), "10% de desconto");
eq("percentual fracionado", C.describeDiscount("percentage", 7.5), "7,5% de desconto");
eq("valor fixo", C.describeDiscount("fixed", 5), "R$ 5,00 de desconto");
eq("frete grátis", C.describeDiscount("free_shipping", 0), "Frete grátis");

eq("formatMoney centavos", C.formatMoney(5.5), "R$ 5,50");
eq("formatMoney inteiro", C.formatMoney(10), "R$ 10,00");
eq("formatMoney inválido vira zero", C.formatMoney(Number.NaN), "R$ 0,00");
eq("formatPercent sem zeros à toa", C.formatPercent(10), "10%");
eq("formatPercent com casa", C.formatPercent(2.25), "2,25%");

/* ========================================================================== */
/* 3. Descrição do cupom                                                    */
/* ========================================================================== */

const base = {
  discount_type: "percentage",
  discount_value: 10,
  min_order_value: 0,
  max_uses_per_customer: 1,
  max_discount: null,
};

eq("regra simples", C.describeCoupon(base), "10% de desconto · 1 uso por cliente");
eq(
  "com mínimo",
  C.describeCoupon({ ...base, min_order_value: 30 }),
  "10% de desconto · pedido mínimo R$ 30,00 · 1 uso por cliente",
);
eq(
  "com teto",
  C.describeCoupon({ ...base, max_discount: 15 }),
  "10% de desconto · máximo R$ 15,00 · 1 uso por cliente",
);
eq(
  "vários usos por cliente",
  C.describeCoupon({ ...base, max_uses_per_customer: 3 }),
  "10% de desconto · 3 usos por cliente",
);
eq(
  "teto não aparece em valor fixo",
  C.describeCoupon({ ...base, discount_type: "fixed", discount_value: 5, max_discount: 15 }),
  "R$ 5,00 de desconto · 1 uso por cliente",
);

/* ========================================================================== */
/* 4. Uso e validade                                                        */
/* ========================================================================== */

eq("nunca usado, ilimitado", C.describeUsage(0, null), "Não usado ainda");
eq("um uso, ilimitado", C.describeUsage(1, null), "1 uso");
eq("vários usos, ilimitado", C.describeUsage(7, null), "7 usos");
eq("progresso com limite", C.describeUsage(3, 100), "3 de 100 usos");
eq("limite unitário", C.describeUsage(0, 1), "0 de 1 uso");
eq("uso negativo não vaza", C.describeUsage(-5, null), "Não usado ainda");

{
  /*
   * As datas são formatadas no fuso do restaurante, não no da máquina que roda
   * o teste — comparar com `getDate()` local erraria por um dia perto da meia-
   * noite. Aqui se verifica o formato e a presença/ausência do ano, que é o que
   * a função promete.
   */
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 864e5);
  const in400 = new Date(now.getTime() + 400 * 864e5);

  eq("sem prazo", C.describeValidity(null, null), "Sem prazo");

  const sameYear = C.describeValidity(null, in30.toISOString(), "America/Sao_Paulo");
  check("fim no mesmo ano: formato dd/mm", /^Até \d{2}\/\d{2}$/.test(sameYear), sameYear);

  const otherYear = C.describeValidity(null, in400.toISOString(), "America/Sao_Paulo");
  check("fim em outro ano mostra o ano", /^Até \d{2}\/\d{2}\/\d{4}$/.test(otherYear), otherYear);

  const starts = C.describeValidity(in30.toISOString(), null, "America/Sao_Paulo");
  check("início no futuro diz que começa", /^Começa em \d{2}\/\d{2}\/\d{4}$/.test(starts), starts);
}

/* ========================================================================== */
/* 5. Prévia do desconto no carrinho                                        */
/* ========================================================================== */

eq("percentual sobre o subtotal", C.couponPreviewAmount("percentage", 10, 30, null), 3);
eq("percentual com arredondamento", C.couponPreviewAmount("percentage", 10, 33.33, null), 3.33);
eq("percentual com teto", C.couponPreviewAmount("percentage", 50, 100, 20), 20);
eq("fixo menor que o pedido", C.couponPreviewAmount("fixed", 5, 30, null), 5);
eq("fixo maior que o pedido abate o pedido", C.couponPreviewAmount("fixed", 50, 30, null), 30);
eq("frete grátis não abate", C.couponPreviewAmount("free_shipping", 0, 30, null), 0);
eq("carrinho vazio não gera desconto", C.couponPreviewAmount("percentage", 10, 0, null), 0);
check(
  "nunca devolve mais que o subtotal",
  [1, 10, 99.99, 1000].every((v) => C.couponPreviewAmount("percentage", 100, v, null) <= v),
);
check("nunca devolve negativo", C.couponPreviewAmount("fixed", -5, 30, null) >= 0);

/* ========================================================================== */
/* 6. Formulário — ida e volta                                              */
/* ========================================================================== */

const couponRow = {
  id: "c1",
  name: "Boas-vindas",
  code: "BEMVINDO10",
  description: "Primeira visita",
  discount_type: "percentage",
  discount_value: 10,
  min_order_value: 30,
  max_discount: 15,
  starts_at: "2026-12-01T10:00:00Z",
  ends_at: "2026-12-31T23:00:00Z",
  max_uses: 100,
  max_uses_per_customer: 2,
  active: true,
  used_count: 0,
  total_discount: 0,
  status: "scheduled",
  created_at: "2026-11-20T10:00:00Z",
};

const form = C.toCouponForm(couponRow);
eq("form: nome", form.name, "Boas-vindas");
eq("form: código", form.code, "BEMVINDO10");
eq("form: valor com vírgula", form.discountValue, "10");
eq("form: mínimo com vírgula", form.minOrderValue, "30");
eq("form: teto", form.maxDiscount, "15");
eq("form: limite total", form.maxUses, "100");
eq("form: ativo", form.active, true);
check("form: datas preenchidas", Boolean(form.startsAt) && Boolean(form.endsAt));

const roundTrip = C.parseCouponForm(form, "c1");
check("form: ida e volta aceita", roundTrip.ok === true);
eq("form: mantém id", roundTrip.payload?.id, "c1");
eq("form: mantém código", roundTrip.payload?.code, "BEMVINDO10");
eq("form: mantém mínimo", roundTrip.payload?.min_order_value, 30);

/* ========================================================================== */
/* 7. Formulário — recusas                                                  */
/* ========================================================================== */

const bad = (over) => C.parseCouponForm({ ...C.EMPTY_COUPON_FORM, name: "Teste", code: "TESTE1", ...over });

check("recusa nome vazio", bad({ name: "" }).ok === false);
check("recusa código curto", bad({ code: "AB" }).ok === false);
check("recusa código vazio", bad({ code: "" }).ok === false);
check("recusa percentual acima de 100", bad({ discountValue: "150" }).ok === false);
check("recusa valor zero", bad({ discountValue: "0" }).ok === false);
check("recusa valor negativo", bad({ discountValue: "-5" }).ok === false);
check("recusa mínimo negativo", bad({ minOrderValue: "-1" }).ok === false);
check("recusa teto zero", bad({ maxDiscount: "0" }).ok === false);
check("recusa limite total zero", bad({ maxUses: "0" }).ok === false);
check("recusa usos por cliente zero", bad({ maxUsesPerCustomer: "0" }).ok === false);
check("recusa usos por cliente acima de 100", bad({ maxUsesPerCustomer: "101" }).ok === false);
check(
  "recusa fim antes do início",
  bad({ startsAt: "2026-12-31T10:00", endsAt: "2026-12-01T10:00" }).ok === false,
);
check("recusa descrição longa", bad({ description: "x".repeat(300) }).ok === false);

{
  const result = bad({ discountValue: "150" });
  check(
    "erro aponta o campo certo",
    result.ok === false && Boolean(result.errors.discountValue),
  );
}

{
  const result = bad({ code: "A" });
  check("erro de código aponta o campo", result.ok === false && Boolean(result.errors.code));
}

/* ========================================================================== */
/* 8. Formulário — casos aceitos de propósito                              */
/* ========================================================================== */

{
  const fixed = bad({ discountType: "fixed", discountValue: "5,50" });
  check("aceita valor fixo com vírgula", fixed.ok === true);
  eq("valor fixo vira 5.5", fixed.payload?.discount_value, 5.5);
}

{
  const unlimited = bad({ maxUses: "", maxDiscount: "" });
  check("limite vazio = ilimitado", unlimited.ok === true && unlimited.payload?.max_uses === null);
  eq("teto vazio = sem teto", unlimited.payload?.max_discount, null);
}

{
  const freeShipping = bad({ discountType: "free_shipping", discountValue: "" });
  check("frete grátis não exige valor", freeShipping.ok === true);
  eq("frete grátis grava valor 0", freeShipping.payload?.discount_value, 0);
}

{
  const minZero = bad({ minOrderValue: "" });
  check("mínimo vazio vira 0", minZero.ok === true && minZero.payload?.min_order_value === 0);
}

{
  const hundred = bad({ discountValue: "100" });
  check("100% é aceito (o banco também aceita)", hundred.ok === true);
}

{
  const fixedWithTeto = bad({ discountType: "fixed", discountValue: "5", maxDiscount: "15" });
  eq("teto é descartado fora de percentual", fixedWithTeto.payload?.max_discount, null);
}

{
  const messy = bad({ code: "bem vindo 10" });
  check("código sujo é normalizado no payload", messy.ok === true);
  eq("código normalizado", messy.payload?.code, "BEMVINDO10");
}

/* ========================================================================== */
/* 9. Motivos de recusa em português                                       */
/* ========================================================================== */

for (const reason of [
  "coupon_not_found",
  "coupon_expired",
  "coupon_exhausted",
  "customer_limit_reached",
  "below_minimum",
  "coupon_inactive",
  "coupon_not_started",
  "coupon_no_effect",
]) {
  const message = C.couponReasonMessage(reason);
  check(`motivo ${reason} tem frase`, message.length > 10 && !message.includes(reason));
}

check("motivo desconhecido cai na genérica", C.couponReasonMessage("xyz").length > 10);
check("motivo nulo cai na genérica", C.couponReasonMessage(null).length > 10);

/* ========================================================================== */
/* 10. Normalização da linha do banco                                       */
/* ========================================================================== */

const normalized = C.normalizeCoupon({
  id: "c1",
  name: "Natal",
  code: "NATAL25",
  description: null,
  discount_type: "fixed",
  discount_value: "25.00",
  min_order_value: "0.00",
  max_discount: null,
  starts_at: null,
  ends_at: null,
  max_uses: null,
  max_uses_per_customer: 1,
  active: true,
  used_count: "3",
  total_discount: "75.00",
  status: "active",
  created_at: "2026-11-01T00:00:00Z",
});

eq("row: numeric string vira número", normalized.discount_value, 25);
eq("row: uso contado", normalized.used_count, 3);
eq("row: total abatido", normalized.total_discount, 75);
eq("row: limite nulo preservado", normalized.max_uses, null);
eq("row: teto nulo preservado", normalized.max_discount, null);

/* ========================================================================== */
/* 11. Guardas estruturais                                                  */
/* ========================================================================== */

const src = fs.readFileSync(path.join(ROOT, "src/lib/coupons.ts"), "utf8");
check("lib neutra: sem server-only", !/server-only/.test(src));
check("lib neutra: sem next/*", !/from ["']next\//.test(src));
check("lib neutra: sem cliente Supabase", !/supabase/i.test(src));
check("lib não usa service_role", !/service_role/i.test(src));

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (coupon-lib.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
