/**
 * Harness do modelo de fidelidade — Etapa 24 (parte 1).
 *
 * Alvo: `src/lib/loyalty.ts`, sem DOM e sem banco.
 *
 * O que aqui, se errar, não dá erro — dá **dinheiro errado e dado pessoal
 * vazado**:
 *
 *   1. normalização de telefone: a mesma pessoa digitando de cinco jeitos
 *      diferentes tem de virar a mesma chave;
 *   2. pontos: piso, nunca arredondamento para cima;
 *   3. rótulos do extrato: `earn` na cara do usuário é bug de produto;
 *   4. frequência: um pedido só não é "0 pedidos/mês";
 *   5. consentimento: a versão do texto precisa existir, senão "todos
 *      consentiram" não se prova;
 *   6. o formulário de configuração: vírgula decimal, campo vazio, tetos.
 *
 * ─── A tabela de telefone vem do banco ────────────────────────────────────
 *
 * Os 16 casos abaixo foram rodados em `public.normalize_phone` no projeto
 * Supabase real e o resultado é o esperado aqui. É o teste de divergência entre
 * as duas implementações da mesma regra (a do app e a do banco).
 *
 * Rodar: node .arena-test/loyalty-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-loyalty-lib");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/loyalty.ts")],
  bundle: true,
  outfile: path.join(OUT, "loyalty.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  logLevel: "error",
});

const L = require(path.join(OUT, "loyalty.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`);

/* ========================================================================== */
/* 1. Telefone — paridade com o banco                                       */
/* ========================================================================== */

const PHONE_TABLE = [
  ["+55 (85) 99999-8888", "5585999998888"],
  ["85999998888", "5585999998888"],
  ["8599998888", "558599998888"],
  ["(85) 3232-1010", "558532321010"],
  ["085 3232-1010", "558532321010"],
  ["0 85 99999-8888", "5585999998888"],
  ["5585999998888", "5585999998888"],
  ["+5585999998888", "5585999998888"],
  ["55 85 3232-1010", "558532321010"],
  ["", null],
  ["   ", null],
  [null, null],
  ["123", "123"],
  ["abc", null],
  ["85.99999.8888", "5585999998888"],
  ["11999999999", "5511999999999"],
];

for (const [input, expected] of PHONE_TABLE) {
  eq(`normalizePhone(${JSON.stringify(input)})`, L.normalizePhone(input), expected);
}

check(
  "todos os formatos do mesmo celular caem na mesma chave",
  new Set(
    ["85999998888", "+55 85 99999-8888", "(85) 9.9999-8888", "0 85 99999 8888", "5585999998888"].map(
      L.normalizePhone,
    ),
  ).size === 1,
);

check("validPhone aceita 11 dígitos nacionais", L.isValidPhone("85999998888"));
check("validPhone recusa número curto", !L.isValidPhone("999998888"));
check("validPhone recusa vazio", !L.isValidPhone(""));
check("validPhone recusa letras", !L.isValidPhone("abc"));
// 12 a 15 dígitos passam (número estrangeiro completo não é inventado).
check("validPhone aceita 13 dígitos com DDI", L.isValidPhone("5585999998888"));

eq("formatPhone celular", L.formatPhone("5585999998888"), "(85) 99999-8888");
eq("formatPhone fixo", L.formatPhone("558532321010"), "(85) 3232-1010");
eq("formatPhone sem entrada", L.formatPhone(null), "");
eq("formatPhone número estrangeiro curto", L.formatPhone("123456789"), "123456789");

eq("maskPhoneInput parcial ddd", L.maskPhoneInput("85"), "85");
eq("maskPhoneInput fixo", L.maskPhoneInput("8532321010"), "(85) 3232-1010");
eq("maskPhoneInput celular", L.maskPhoneInput("85999998888"), "(85) 99999-8888");
eq("maskPhoneInput ignora excesso", L.maskPhoneInput("5585999998888").length > 0, true);
eq(
  "maskPhoneInput é idempotente no celular formatado",
  L.maskPhoneInput(L.maskPhoneInput("85999998888")),
  "(85) 99999-8888",
);

/* ========================================================================== */
/* 2. Nome e e-mail                                                         */
/* ========================================================================== */

eq("cleanName colapsa espaço", L.cleanName("  Ana   Paula  "), "Ana Paula");
eq("cleanName vazio é null", L.cleanName("   "), null);
eq("cleanName null", L.cleanName(null), null);
check("cleanName corta no limite", L.cleanName("a".repeat(300)).length === L.MAX_CUSTOMER_NAME);

check("email válido", L.isValidEmail("ana@exemplo.com"));
check("email inválido sem arroba", !L.isValidEmail("ana.exemplo.com"));
check("email inválido sem domínio", !L.isValidEmail("ana@exemplo"));
check("email vazio inválido", !L.isValidEmail(""));

/* ========================================================================== */
/* 3. Pontos                                                                */
/* ========================================================================== */

eq("R$ 30 × 1 = 30 pontos", L.pointsForAmount(30, 1), 30);
eq("R$ 4,90 × 1,5 = 7 (piso, não 8)", L.pointsForAmount(4.9, 1.5), 7);
eq("R$ 0,99 × 1 = 0", L.pointsForAmount(0.99, 1), 0);
eq("regra zero não dá ponto", L.pointsForAmount(100, 0), 0);
eq("total negativo vira 0", L.pointsForAmount(-50, 1), 0);
eq("regra negativa vira 0", L.pointsForAmount(50, -2), 0);
eq("total inválido vira 0", L.pointsForAmount(Number.NaN, 1), 0);
eq("R$ 10 × 2 = 20", L.pointsForAmount(10, 2), 20);
check(
  "nunca devolve ponto fracionado",
  [0.1, 0.7, 3.3, 99.99].every((v) => Number.isInteger(L.pointsForAmount(v, 1.37))),
);

eq("valor do saldo: 110 pontos a R$ 0,05", L.pointsValue(110, 0.05), 5.5);
eq("valor do saldo sem resgate", L.pointsValue(110, 0), 0);
eq("valor do saldo negativo vira 0", L.pointsValue(-10, 0.05), 0);

/* ========================================================================== */
/* 4. Rótulos do extrato                                                    */
/* ========================================================================== */

eq("earn/order", L.entryLabel("earn", "order"), "Pontos do pedido");
eq("bonus/signup", L.entryLabel("bonus", "signup"), "Bônus de cadastro");
eq("bonus/birthday", L.entryLabel("bonus", "birthday"), "Bônus de aniversário");
eq("adjust/manual", L.entryLabel("adjust", "manual"), "Ajuste do restaurante");
eq("redeem", L.entryLabel("redeem", "manual"), "Pontos utilizados");
eq("expire", L.entryLabel("expire", "manual"), "Pontos expirados");
eq("campaign", L.entryLabel("campaign", "campaign"), "Campanha");
eq("cashback", L.entryLabel("cashback", "cashback"), "Cashback");
eq("fonte desconhecida cai em Bônus", L.entryLabel("bonus", "manual"), "Bônus");

check(
  "nenhum rótulo mostra o enum cru",
  ["earn", "redeem", "bonus", "adjust", "expire", "campaign", "cashback"].every((kind) => {
    const label = L.entryLabel(kind, "order");
    return !label.includes(kind) && /[A-Za-zÀ-ÿ]/.test(label);
  }),
);

eq("formatDelta positivo", L.formatDelta(50), "+50");
eq("formatDelta negativo usa menos tipográfico", L.formatDelta(-20), "−20");
eq("formatDelta zero", L.formatDelta(0), "0");
eq("formatDelta decimal trunca", L.formatDelta(12.9), "+12");

/* ========================================================================== */
/* 5. Frequência                                                            */
/* ========================================================================== */

eq("frequência null (um pedido só)", L.formatFrequency(null), null);
eq("frequência zero", L.formatFrequency(0), null);
eq("frequência negativa", L.formatFrequency(-1), null);
eq("2 pedidos por mês", L.formatFrequency(2), "2 pedidos/mês");
eq("1,5 pedido por mês", L.formatFrequency(1.5), "1,5 pedidos/mês");
check("menos de 1/mês vira intervalo", /a cada \d+ meses/.test(L.formatFrequency(0.25)));

const now = new Date("2026-11-21T12:00:00Z");
eq("sem pedido = new", L.customerActivity(null, now), "new");
eq("pedido de hoje = active", L.customerActivity("2026-11-20T12:00:00Z", now), "active");
eq("45 dias = cooling", L.customerActivity("2026-10-07T12:00:00Z", now), "cooling");
eq("75 dias = at_risk", L.customerActivity("2026-09-07T12:00:00Z", now), "at_risk");
eq("120 dias = dormant", L.customerActivity("2026-07-24T12:00:00Z", now), "dormant");
eq("data inválida = new", L.customerActivity("nao-e-data", now), "new");

/* ========================================================================== */
/* 6. Consentimento                                                         */
/* ========================================================================== */

check("CONSENT_VERSION definida", typeof L.CONSENT_VERSION === "string" && L.CONSENT_VERSION.length > 0);
check("CONSENT_VERSION tem formato vN", /^v\d+$/.test(L.CONSENT_VERSION));
check("texto do consentimento existe", typeof L.CONSENT_TEXT === "string" && L.CONSENT_TEXT.length > 40);
check(
  "texto do consentimento promete exclusão",
  /exclus/i.test(L.CONSENT_TEXT),
);
check(
  "texto não promete envio de mensagem",
  !/enviaremos|vamos te mandar|promoç/i.test(L.CONSENT_TEXT),
);

/* ========================================================================== */
/* 7. Descrição do programa                                                 */
/* ========================================================================== */

const base = {
  enabled: true,
  points_per_currency: 1,
  signup_bonus: 0,
  birthday_bonus: 0,
  redeem_value: 0,
  cashback_percent: 0,
  program_note: null,
};

eq("desligado não descreve", L.describeProgram({ ...base, enabled: false }), null);
eq("R$ 1 = 1 ponto", L.describeProgram(base), "1 ponto por R$ 1");
eq("R$ 1 = 2 pontos (plural)", L.describeProgram({ ...base, points_per_currency: 2 }), "2 pontos por R$ 1");
eq(
  "com bônus de cadastro",
  L.describeProgram({ ...base, signup_bonus: 50 }),
  "1 ponto por R$ 1 · 50 pontos no cadastro",
);
eq(
  "com bônus de aniversário",
  L.describeProgram({ ...base, signup_bonus: 50, birthday_bonus: 100 }),
  "1 ponto por R$ 1 · 50 pontos no cadastro · 100 pontos no aniversário",
);
eq("regra zerada não descreve nada", L.describeProgram({ ...base, points_per_currency: 0 }), null);
eq(
  "nota do dono vence a descrição automática",
  L.programHeadline({ ...base, program_note: "Dobre pontos na terça" }),
  "Dobre pontos na terça",
);
eq("sem nota cai na automática", L.programHeadline(base), "1 ponto por R$ 1");
eq(
  "nota em branco não vence",
  L.programHeadline({ ...base, program_note: "   " }),
  "1 ponto por R$ 1",
);

/* ========================================================================== */
/* 8. Formulário de configuração                                            */
/* ========================================================================== */

const form = L.toLoyaltyForm({
  enabled: true,
  points_per_currency: 1.5,
  signup_bonus: 50,
  birthday_bonus: 100,
  redeem_value: 0.05,
  cashback_percent: 0,
  program_note: "Junte pontos",
});
eq("form: enabled", form.enabled, true);
eq("form: pontos usa vírgula", form.pointsPerCurrency, "1,5");
eq("form: resgate usa vírgula", form.redeemValue, "0,05");
eq("form: nota", form.programNote, "Junte pontos");

const parsedForm = L.parseLoyaltyForm(form);
check("form: ida e volta ok", parsedForm.ok === true);
eq("form: pontos 1,5 vira 1.5", parsedForm.settings.points_per_currency, 1.5);
eq("form: resgate 0,05 vira 0.05", parsedForm.settings.redeem_value, 0.05);

const zeroed = L.parseLoyaltyForm({
  enabled: false,
  pointsPerCurrency: "",
  signupBonus: "",
  birthdayBonus: "",
  redeemValue: "",
  programNote: "",
});
check("form: campo vazio é 0, não NaN", zeroed.ok === true && zeroed.settings.points_per_currency === 0);
eq("form: nota vazia vira null", zeroed.settings.program_note, null);

const tooMany = L.parseLoyaltyForm({
  ...form,
  pointsPerCurrency: "500",
});
check("form: teto de pontos por real", tooMany.ok === false && Boolean(tooMany.errors.pointsPerCurrency));

const badDecimal = L.parseLoyaltyForm({ ...form, pointsPerCurrency: "1,5,7" });
check("form: decimal inválido recusado", badDecimal.ok === false);

const longNote = L.parseLoyaltyForm({ ...form, programNote: "x".repeat(500) });
check("form: nota longa recusada", longNote.ok === false && Boolean(longNote.errors.programNote));

const payload = L.settingsPayload(parsedForm.settings);
eq("payload: nome dos parâmetros da RPC", Object.keys(payload).sort(), [
  "p_birthday_bonus",
  "p_enabled",
  "p_points_per_currency",
  "p_program_note",
  "p_redeem_value",
  "p_signup_bonus",
]);

/* ========================================================================== */
/* 9. Normalização da linha do banco                                        */
/* ========================================================================== */

const fromRow = L.normalizeSettings({
  enabled: true,
  points_per_currency: "1.50",
  signup_bonus: "50",
  birthday_bonus: 100,
  redeem_value: "0.0500",
  cashback_percent: "0.00",
  program_note: "Oi",
});
eq("row: numeric string vira número", fromRow.points_per_currency, 1.5);
eq("row: bônus vira inteiro", fromRow.signup_bonus, 50);
eq("row: resgate com 4 casas", fromRow.redeem_value, 0.05);
eq("row: nota preservada", fromRow.program_note, "Oi");

const fromNull = L.normalizeSettings(null);
eq("row: null cai no padrão desligado", fromNull.enabled, false);
eq("row: null mantém rate 1", fromNull.points_per_currency, 1);
eq("row: lixo vira 0", L.normalizeSettings({ points_per_currency: "abc" }).points_per_currency, 0);

/* ========================================================================== */
/* 10. Guardas estruturais                                                  */
/* ========================================================================== */

const src = fs.readFileSync(path.join(ROOT, "src/lib/loyalty.ts"), "utf8");
check("lib neutra: sem server-only", !/server-only/.test(src));
check("lib neutra: sem next/*", !/from ["']next\//.test(src));
check("lib neutra: sem cliente Supabase", !/supabase/i.test(src));
check("lib não usa service_role", !/service_role/i.test(src));

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (loyalty-lib.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
