/**
 * Harness de lógica da cobrança manual por PIX — Etapa 19.
 *
 * Sem DOM e sem banco. O alvo é a **aritmética e o vocabulário** que a tela
 * mostra e que o banco vai reproduzir:
 *
 *   • o valor do ciclo (mensal × 12 no anual) tem de ser o mesmo que
 *     `request_plan_payment` grava — se divergir, o cliente vê um preço e paga
 *     outro;
 *   • o estágio mostrado no dashboard (sem plano / aguardando / confirmado /
 *     ativo / vencendo / expirado) tem de seguir a precedência documentada;
 *   • validação de comprovante recusa o que o bucket recusaria, para o usuário
 *     não descobrir no meio do envio.
 *
 * As regras de autorização continuam no Postgres (26 asserções SQL à parte,
 * em `docs/AMBIENTES.md`).
 *
 * Rodar: node .arena-test/payments-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-payments-lib");
fs.rmSync(OUT, { recursive: true, force: true });

function build(entry, name) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    outfile: path.join(OUT, `${name}.js`),
    platform: "node",
    format: "cjs",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "error",
  });
  return require(path.join(OUT, `${name}.js`));
}

const P = build("src/lib/payments.ts", "payments");
const T = build("src/lib/types.ts", "types");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ===================== 1. Vocabulário ===================== */

check(
  "tipo: os quatro status da solicitação existem",
  ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"].every(
    (s) => typeof T.PAYMENT_REQUEST_STATUS_LABEL[s] === "string",
  ),
);

check(
  "tipo: todo status tem tom definido",
  ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"].every(
    (s) => typeof T.PAYMENT_REQUEST_STATUS_TONE[s] === "string",
  ),
);

check(
  "tipo: PENDING tem tom de atenção (não de erro)",
  T.PAYMENT_REQUEST_STATUS_TONE.PENDING === "warning",
  T.PAYMENT_REQUEST_STATUS_TONE.PENDING,
);

check(
  "tipo: CONFIRMED tem tom de sucesso",
  T.PAYMENT_REQUEST_STATUS_TONE.CONFIRMED === "success",
);

check(
  "tipo: método único é MANUAL_PIX",
  T.PAYMENT_REQUEST_METHOD_LABEL.MANUAL_PIX === "PIX manual",
  T.PAYMENT_REQUEST_METHOD_LABEL.MANUAL_PIX,
);

check(
  "tipo: vocabulário de status não colide com o de pagamento de pedido",
  typeof T.PAYMENT_METHOD_LABEL === "object" && typeof T.PAYMENT_REQUEST_METHOD_LABEL === "object",
  "PAYMENT_METHOD_LABEL (pedido) e PAYMENT_REQUEST_METHOD_LABEL (assinatura) coexistem",
);

/* ===================== 2. Valores do ciclo ===================== */

check("valor: mensal = preço do catálogo", P.cycleAmount(99.9, "monthly") === 99.9);
check("valor: anual = 12 mensalidades", P.cycleAmount(99.9, "yearly") === 1198.8);
check("valor: zero continua zero", P.cycleAmount(0, "monthly") === 0);
check(
  "valor: arredonda para centavos (evita 1198.7999999)",
  P.cycleAmount(49.99, "yearly") === 599.88,
  String(P.cycleAmount(49.99, "yearly")),
);
check("valor: preço inválido não vira NaN na tela", P.cycleAmount(NaN, "monthly") === 0);
check("valor: mensal = 30 dias", P.cycleDays("monthly") === 30);
check("valor: anual = 365 dias", P.cycleDays("yearly") === 365);

/* ===================== 3. Estágio do dashboard ===================== */

const panel = (over = {}) => ({
  pending: null,
  subscription: {
    status: "active",
    has_subscription: true,
    plan_id: "profissional",
    period_start: "2026-01-01T00:00:00Z",
    period_end: "2026-12-01T00:00:00Z",
    trial_end: null,
    days_left: 40,
  },
  ...over,
});

const pendingReq = { id: "r1", status: "PENDING" };

check("estágio: sem assinatura = no_plan", P.paymentStage(null) === "no_plan");
check(
  "estágio: casa sem assinatura = no_plan",
  P.paymentStage(panel({ subscription: { ...panel().subscription, has_subscription: false } })) ===
    "no_plan",
);
check("estágio: pendente vence tudo", P.paymentStage(panel({ pending: pendingReq })) === "pending");
check(
  "estágio: pendente vence até assinatura vencida",
  P.paymentStage(
    panel({
      pending: pendingReq,
      subscription: { ...panel().subscription, status: "expired", days_left: 0 },
    }),
  ) === "pending",
);
check(
  "estágio: ativo com folga = active",
  P.paymentStage(panel({ subscription: { ...panel().subscription, days_left: 40 } })) === "active",
);
check(
  "estágio: vencendo em 3 dias = expiring",
  P.paymentStage(panel({ subscription: { ...panel().subscription, days_left: 3 } })) === "expiring",
);
check(
  "estágio: exatamente no limite de 7 dias = expiring",
  P.paymentStage(panel({ subscription: { ...panel().subscription, days_left: 7 } })) === "expiring",
);
check(
  "estágio: 8 dias ainda é active",
  P.paymentStage(panel({ subscription: { ...panel().subscription, days_left: 8 } })) === "active",
);
check(
  "estágio: status expired = expired mesmo com data futura",
  P.paymentStage(
    panel({ subscription: { ...panel().subscription, status: "expired", days_left: 40 } }),
  ) === "expired",
);
check(
  "estágio: zero dias = expired (o dia chegou)",
  P.paymentStage(panel({ subscription: { ...panel().subscription, days_left: 0 } })) === "expired",
);
check(
  "estágio: sem dias (null) não inventa vencimento",
  P.paymentStage(panel({ subscription: { ...panel().subscription, days_left: null } })) === "active",
);
check(
  "estágio: justConfirmed aparece como confirmed",
  P.paymentStage(panel(), true) === "confirmed",
);
check(
  "estágio: justConfirmed não atropela pendente",
  P.paymentStage(panel({ pending: pendingReq }), true) === "pending",
);

/* ===================== 4. Textos dos estados ===================== */

const stages = ["no_plan", "pending", "confirmed", "active", "expiring", "expired"];
check("texto: todo estágio tem título", stages.every((s) => P.PAYMENT_STAGE_TITLE[s]));
check("texto: todo estágio tem tom", stages.every((s) => P.PAYMENT_STAGE_TONE[s]));
check(
  "texto: mensagem de cada estágio não é vazia",
  stages.every((s) => (P.paymentStageMessage(s, 5) || "").length > 10),
);
check(
  "texto: pendente diz que aguarda confirmação",
  /aguardando confirmação/i.test(P.paymentStageMessage("pending", null)),
  P.paymentStageMessage("pending", null),
);
check(
  "texto: vencendo diz quantos dias",
  P.paymentStageMessage("expiring", 4).includes("4 dias"),
  P.paymentStageMessage("expiring", 4),
);
check(
  "texto: um dia no singular",
  P.paymentStageMessage("expiring", 1).includes("1 dia"),
  P.paymentStageMessage("expiring", 1),
);
check(
  "texto: expirado convida a pagar de novo",
  /PIX/i.test(P.paymentStageMessage("expired", 0)),
  P.paymentStageMessage("expired", 0),
);
check(
  "texto: o aviso de renovação só aparece na janela de 7 dias",
  P.renewalNotice(3) !== null && P.renewalNotice(30) === null && P.renewalNotice(null) === null,
);
check(
  "texto: confirmado mostra a data final",
  /31\/12\/2026/.test(P.confirmedPeriodMessage("2026-12-31T12:00:00Z", 365)),
  P.confirmedPeriodMessage("2026-12-31T12:00:00Z", 365),
);
check(
  "texto: confirmado sem data não inventa prazo",
  P.confirmedPeriodMessage(null, null) === "Pagamento confirmado.",
  P.confirmedPeriodMessage(null, null),
);

/* ===================== 5. CTA por estágio ===================== */

check(
  "CTA: oferece pagar em no_plan, expired e expiring",
  P.canRequestPayment("no_plan") && P.canRequestPayment("expired") && P.canRequestPayment("expiring"),
);
check(
  "CTA: não oferece pagar quando já está pendente",
  !P.canRequestPayment("pending"),
);
check("CTA: não oferece pagar com plano ativo", !P.canRequestPayment("active"));

/* ===================== 6. PIX ===================== */

check(
  "pix: pronto exige ligado E configurado",
  P.isPixReady({ is_active: true, is_configured: true }) === true &&
    P.isPixReady({ is_active: true, is_configured: false }) === false &&
    P.isPixReady({ is_active: false, is_configured: true }) === false &&
    P.isPixReady(null) === false,
);
check(
  "pix: chave mascarada guarda as pontas",
  P.maskPixKey("12345678901234", "cpf") === "12••••1234" ||
    /^12•+1234$/.test(P.maskPixKey("12345678901234", "cpf")),
  P.maskPixKey("12345678901234", "cpf"),
);
check(
  "pix: e-mail aparece inteiro (é o que o cliente digita)",
  P.maskPixKey("pix@menuvo.com.br", "email") === "pix@menuvo.com.br",
);
check("pix: chave vazia vira null", P.maskPixKey("   ", "cpf") === null);
check(
  "pix: instrução padrão não inventa dado de pagamento",
  !/chave\s*:\s*\d/.test(P.DEFAULT_PIX_INSTRUCTIONS) && /manual/i.test(P.DEFAULT_PIX_INSTRUCTIONS),
);

/* ===================== 7. Comprovante ===================== */

const file = (name, size, type) => ({ name, size, type });

check(
  "comprovante: PNG válido passa",
  P.validateReceipt(file("c.png", 1024, "image/png")).ok === true,
);
check(
  "comprovante: PDF válido passa",
  P.validateReceipt(file("c.pdf", 1024, "application/pdf")).ok === true,
);
check(
  "comprovante: acima de 5 MB recusa",
  P.validateReceipt(file("c.pdf", 6 * 1024 * 1024, "application/pdf")).issue === "too_large",
);
check(
  "comprovante: arquivo vazio recusa",
  P.validateReceipt(file("c.pdf", 0, "application/pdf")).issue === "empty",
);
check(
  "comprovante: .exe renomeado para .png recusa",
  P.validateReceipt(file("virus.png", 100, "application/x-msdownload")).issue === "bad_type",
);
check(
  "comprovante: png declarado como pdf recusa (extensão ≠ MIME)",
  P.validateReceipt(file("c.png", 100, "application/pdf")).issue === "bad_extension",
);
check(
  "comprovante: extensão desconhecida recusa",
  P.validateReceipt(file("c.gif", 100, "image/gif")).issue === "bad_extension",
);
check(
  "comprovante: cada motivo tem mensagem própria",
  ["empty", "too_large", "bad_type", "bad_extension", "note_too_long"].every(
    (k) => (P.RECEIPT_ISSUE_MESSAGE[k] || "").length > 10,
  ),
);
check(
  "comprovante: limite do harness = limite do bucket (5 MB)",
  P.RECEIPT_MAX_BYTES === 5242880,
  String(P.RECEIPT_MAX_BYTES),
);
check(
  "comprovante: caminho começa pelo tenant",
  P.receiptPath("abc", "req-1", "png", 1).startsWith("abc/receipts/req-1-"),
  P.receiptPath("abc", "req-1", "png", 1),
);
check(
  "comprovante: observação longa é cortada em 280",
  P.normalizeReceiptNote("x".repeat(400)).length === 280,
);
check(
  "comprovante: observação vazia vira null",
  P.normalizeReceiptNote("   \n  ") === null,
);

/* ===================== 8. Aviso do admin ===================== */

const warning = P.confirmWarning(99.9, "Profissional");
check(
  "admin: o aviso manda verificar o recebimento",
  /verificar o recebimento do PIX/i.test(warning),
  warning,
);
check("admin: o aviso mostra plano e valor", warning.includes("Profissional") && warning.includes("99,90"));
check(
  "admin: o aviso diz que fica na auditoria",
  /auditoria/i.test(warning),
);
check(
  "admin: status vira frase para leitor de tela",
  P.paymentStatusAnnouncement("CONFIRMED", "Pro").includes("confirmado"),
);
check(
  "admin: moeda formatada em BRL",
  P.formatMoney(1198.8).replace(/\u00a0/g, " ") === "R$ 1.198,80",
  P.formatMoney(1198.8),
);

/* ===================== Resultado ===================== */

const passed = results.filter((r) => r.ok).length;
console.log("");
for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\npayments-lib: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
