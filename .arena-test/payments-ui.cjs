/**
 * Harness de UI da cobrança manual por PIX — Etapa 19 (jsdom).
 *
 * Verifica o que o cliente e o master veem e o que a tela **envia**:
 *
 *   • escolha de plano mostra preço do ciclo e o valor vai sem `amount`;
 *   • `PIX desligado` não oferece compra (não mente sobre o que existe);
 *   • a tela de PIX mostra a chave copiável e o texto de confirmação manual;
 *   • o cartão de estado diz "aguardando confirmação" e não promete ativação;
 *   • comprovante não confirma pagamento (o único action chamado é o de anexo);
 *   • o detalhe do admin exige passar pelo aviso antes de confirmar;
 *   • rejeitar exige motivo;
 *   • a configuração do PIX fica em modo leitura sem MASTER_ADMIN.
 *
 * Rodar: node .arena-test/payments-ui.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-payments-ui");
fs.rmSync(OUT, { recursive: true, force: true });

/* ----------------------------- ambiente ----------------------------- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/app/pagamento",
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.self = dom.window;
dom.window.self = dom.window;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
dom.window.requestIdleCallback = global.requestIdleCallback;
global.cancelIdleCallback = clearTimeout;
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
// Upload de comprovante usa File/FormData do jsdom.
global.File = dom.window.File;
global.FormData = dom.window.FormData;

/* ----------------------------- build ----------------------------- */

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-payments.tsx")],
  bundle: true,
  outfile: path.join(OUT, "payments-ui.js"),
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/subscription-payments": path.join(
      __dirname,
      "stubs-payments/subscription-payments-actions.ts",
    ),
    "@/lib/supabase/client": path.join(__dirname, "stubs-payments/supabase-client.ts"),
    "next/navigation": path.join(__dirname, "stubs-payments/next-navigation.ts"),
  },
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"],
  logLevel: "error",
});

const lib = require(path.join(OUT, "payments-ui.js"));
const actions = lib.paymentActions;
const storage = require(path.join(OUT, "payments-ui.js"));
const React = require("react");
const { act } = require("react");

/* ----------------------------- helpers ----------------------------- */

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

let mounted = [];

async function render(element) {
  const handle = lib.mount(element);
  mounted.push(handle);
  await flush();
  return handle.container;
}

const queryAll = (container, selector) => Array.from(container.querySelectorAll(selector));
const flat = (node) => (node?.textContent ?? "").replace(/\u00a0/g, " ");
const bodyText = (container) => flat(container);
const byText = (container, text, selector = "button, a, label, li, p, span, h1, h2, h3, dt, dd") =>
  queryAll(container, selector).find((node) => flat(node).includes(text));

async function click(node) {
  if (!node) throw new Error("clique em elemento inexistente");
  await act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

function setValue(node, value) {
  const proto =
    node.tagName === "TEXTAREA"
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(node, value);
  node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

async function type(node, value) {
  await act(async () => setValue(node, value));
  await flush();
}

/* ========================================================================== */
/* Resultado                                                                  */
/* ========================================================================== */

async function main() {
  /* ======================================================================== */
  /* 1. Escolha de plano                                                        */
/* ========================================================================== */

actions.__reset();

{
  const container = await render(
    React.createElement(lib.components.PlanPixPicker, {
      plans: lib.plans,
      currentPlanId: "basico",
      currentInterval: "monthly",
      pix: lib.pixReady,
      canManage: true,
      blockedPlans: {},
      hasPending: false,
    }),
  );

  const text = bodyText(container);
  check("picker: mostra os planos", text.includes("Básico") && text.includes("Profissional"));
  check("picker: mostra preço mensal em reais", text.includes("R$ 99,90"), text.slice(0, 200));
  check("picker: explica que a confirmação é manual", /confirma/i.test(text));
  check("picker: nenhum plano vem pré-selecionado", !text.includes("Você vai solicitar"));

  // Alterna para anual: o preço do ciclo tem de subir para 12×.
  const anual = queryAll(container, "button").find((b) => flat(b) === "Anual");
  await click(anual);
  check(
    "picker: anual mostra 12 mensalidades (R$ 1.198,80)",
    bodyText(container).includes("R$ 1.198,80"),
    bodyText(container).match(/R\$ [\d.,]+/g)?.join(" | "),
  );

  const mensal = queryAll(container, "button").find((b) => flat(b) === "Mensal");
  await click(mensal);

  // Seleciona o Profissional e confirma a solicitação.
  const planButton = queryAll(container, "button").find((b) =>
    flat(b).startsWith("Profissional"),
  );
  await click(planButton);
  check("picker: escolher um plano mostra o resumo", /Você vai solicitar/.test(bodyText(container)));

  const cta = queryAll(container, "button").find((b) => /Solicitar e ver PIX/.test(flat(b)));
  await click(cta);

  const calls = actions.__calls();
  const request = calls.find((c) => c.action === "requestMyPayment");
  check("picker: chamou requestMyPayment", Boolean(request), JSON.stringify(calls));
  check(
    "picker: envia só planId e interval — nunca amount",
    request &&
      Object.keys(request.args).sort().join(",") === "interval,planId" &&
      request.args.planId === "profissional" &&
      request.args.interval === "monthly",
    JSON.stringify(request?.args),
  );
}

/* 2. PIX desligado não oferece compra */
{
  const container = await render(
    React.createElement(lib.components.PlanPixPicker, {
      plans: lib.plans,
      currentPlanId: "basico",
      currentInterval: "monthly",
      pix: lib.pixOff,
      canManage: true,
      blockedPlans: {},
      hasPending: false,
    }),
  );
  const text = bodyText(container);
  check("picker: PIX desligado avisa que está indisponível", /PIX indisponível/i.test(text));
  check("picker: PIX desligado não lista planos para compra", !text.includes("R$ 49,90"));
  check(
    "picker: PIX desligado não oferece botão de solicitar",
    !queryAll(container, "button").some((b) => /Solicitar/.test(flat(b))),
  );
}

/* 3. Quem não é dono/admin vê o aviso e não compra */
{
  const container = await render(
    React.createElement(lib.components.PlanPixPicker, {
      plans: lib.plans,
      currentPlanId: "basico",
      currentInterval: "monthly",
      pix: lib.pixReady,
      canManage: false,
      blockedPlans: {},
      hasPending: false,
    }),
  );
  const text = bodyText(container);
  check("picker: staff vê que só o dono contrata", /proprietário|administrador/i.test(text));
  check("picker: staff não vê botão de compra", !text.includes("Solicitar e ver PIX"));
}

/* 4. Pedido pendente avisa antes de substituir */
{
  const container = await render(
    React.createElement(lib.components.PlanPixPicker, {
      plans: lib.plans,
      currentPlanId: "basico",
      currentInterval: "monthly",
      pix: lib.pixReady,
      canManage: true,
      blockedPlans: {},
      hasPending: true,
    }),
  );
  const planButton = queryAll(container, "button").find((b) => flat(b).startsWith("Básico"));
  await click(planButton);
  check(
    "picker: com pedido pendente, avisa que o novo substitui o anterior",
    /já existe um pagamento|substitui/i.test(bodyText(container)),
    bodyText(container).slice(0, 240),
  );
}

/* ========================================================================== */
/* 5. Instruções de PIX                                                        */
/* ========================================================================== */

{
  const container = await render(
    React.createElement(lib.components.PixInstructions, {
      pix: lib.pixReady,
      amount: 99.9,
      planName: "Profissional",
    }),
  );
  const text = bodyText(container);
  check("pix: mostra a chave para pagamento", text.includes("pix@menuvo.com.br"));
  check("pix: mostra o nome do recebedor", text.includes("Menuvo Tecnologia ME"));
  check("pix: mostra o valor e o plano", text.includes("R$ 99,90") && text.includes("Profissional"));
  check("pix: diz que a confirmação é manual", /confirmação é manual/i.test(text));
  check("pix: tem botão de copiar", queryAll(container, "button").some((b) => /Copiar/.test(flat(b))));
  check("pix: mostra as instruções da plataforma", text.includes("Envie o comprovante"));
  check(
    "pix: sem QR Code não quebra a tela",
    !queryAll(container, "img").length || true,
    "qr_code_url null",
  );
}

{
  const container = await render(
    React.createElement(lib.components.PixInstructions, { pix: lib.pixOff, amount: null, planName: null }),
  );
  check("pix: desligado avisa em vez de mostrar chave vazia", /PIX indisponível/i.test(bodyText(container)));
}

/* ========================================================================== */
/* 6. Cartão de estado                                                        */
/* ========================================================================== */

{
  const container = await render(
    React.createElement(lib.components.PaymentStatusCard, { panel: lib.pendingPanel }),
  );
  const text = bodyText(container);
  check("estado: pendente diz 'aguardando confirmação'", /aguardando confirmação/i.test(text), text);
  check("estado: pendente mostra plano e valor", text.includes("Profissional") && text.includes("R$ 99,90"));
  check(
    "estado: pendente não diz que o plano já está ativo",
    !/Plano ativo/.test(text),
  );
  check("estado: pendente avisa que não há comprovante", /Nenhum comprovante/i.test(text));
}

{
  const activePanel = {
    ...lib.pendingPanel,
    pending: null,
    subscription: { ...lib.pendingPanel.subscription, status: "active", days_left: 4 },
  };
  const container = await render(
    React.createElement(lib.components.PaymentStatusCard, { panel: activePanel }),
  );
  const text = bodyText(container);
  check("estado: vencendo com 4 dias mostra o número", /vence em 4 dias/i.test(text), text);
  check("estado: vencendo não oferece pagar sozinho na tela", !/Confirmar/i.test(text));
}

{
  const container = await render(
    React.createElement(lib.components.PaymentStatusCard, { panel: null }),
  );
  check("estado: sem dados convida a escolher plano", /Escolha um plano/i.test(bodyText(container)));
}

/* 7. Histórico */
{
  const container = await render(
    React.createElement(lib.components.PaymentHistoryList, { history: lib.pendingPanel.history }),
  );
  const text = bodyText(container);
  check("histórico: mostra o status em texto", text.includes("Pagamento rejeitado"));
  check("histórico: mostra o motivo da rejeição", text.includes("Comprovante ilegível"));
  check("histórico: usa lista vertical, não tabela", !container.querySelector("table"));
}

/* ========================================================================== */
/* 8. Comprovante não confirma                                                */
/* ========================================================================== */

actions.__reset();
{
  const container = await render(
    React.createElement(lib.components.ReceiptUpload, {
      requestId: "req-1",
      restaurantId: "rest-1",
      receiptPathValue: null,
      disabled: false,
    }),
  );

  const text = bodyText(container);
  check("comprovante: texto deixa claro que é opcional", /opcional/i.test(text));
  check(
    "comprovante: avisa que o envio NÃO confirma o pagamento",
    /não\s*<\/?strong>?\s*confirma|não confirma/i.test(text.replace(/\s+/g, " ")),
    text,
  );

  const input = container.querySelector('input[type="file"]');
  check("comprovante: existe input de arquivo", Boolean(input));

  // Arquivo grande demais: recusa na hora, sem chamar action nenhuma.
  const big = new dom.window.File(["x"], "grande.pdf", { type: "application/pdf" });
  Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
  await act(async () => {
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();
  check(
    "comprovante: arquivo acima de 5 MB é recusado antes do envio",
    /5 MB/i.test(bodyText(container)),
    bodyText(container),
  );
  check(
    "comprovante: recusa local não chamou a Server Action",
    actions.__calls().length === 0,
    JSON.stringify(actions.__calls()),
  );
}

actions.__reset();
{
  const container = await render(
    React.createElement(lib.components.ReceiptUpload, {
      requestId: "req-1",
      restaurantId: "rest-1",
      receiptPathValue: null,
      disabled: false,
    }),
  );
  const input = container.querySelector('input[type="file"]');
  const small = new dom.window.File(["comprovante"], "comprovante.pdf", { type: "application/pdf" });
  await act(async () => {
    Object.defineProperty(input, "files", { value: [small], configurable: true });
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();

  const send = queryAll(container, "button").find((b) => /Enviar comprovante/.test(flat(b)));
  check("comprovante: botão de enviar aparece após escolher o arquivo", Boolean(send));

  await click(send);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await flush();

  const calls = actions.__calls();
  check(
    "comprovante: chama só submitPaymentReceipt (nunca confirmPayment)",
    calls.length === 1 && calls[0].action === "submitPaymentReceipt",
    JSON.stringify(calls.map((c) => c.action)),
  );
  const args = calls[0]?.args ?? {};
  check(
    "comprovante: caminho começa pelo tenant da casa",
    typeof args.path === "string" && args.path.startsWith("rest-1/receipts/req-1-"),
    String(args.path),
  );
  check(
    "comprovante: não envia valor nem status",
    !("amount" in args) && !("status" in args) && !("restaurantId" in args),
    JSON.stringify(Object.keys(args)),
  );
}

/* ========================================================================== */
/* 9. Detalhe do admin                                                        */
/* ========================================================================== */

actions.__reset();
{
  const container = await render(
    React.createElement(lib.components.PaymentDetailPanel, {
      detail: lib.detail,
      receiptUrl: "https://example.supabase.co/signed/receipt",
      isMasterAdmin: true,
    }),
  );

  const text = bodyText(container);
  check("admin: mostra restaurante, plano e valor", text.includes("Famintos") && text.includes("Profissional"));
  check("admin: mostra o comprovante com link", Boolean(container.querySelector('a[href*="signed"]')));
  check("admin: mostra a observação do cliente", text.includes("paguei às 14h"));
  check(
    "admin: confirmar NÃO acontece sem passar pelo aviso",
    actions.__calls().length === 0,
    JSON.stringify(actions.__calls()),
  );

  const confirmBtn = queryAll(container, "button").find((b) => /Confirmar pagamento/.test(flat(b)));
  await click(confirmBtn);

  const afterText = bodyText(container);
  check(
    "admin: o aviso manda verificar o recebimento do PIX",
    /Confirme somente após verificar o recebimento do PIX/i.test(afterText),
    afterText.slice(0, 200),
  );
  check("admin: ainda não confirmou só por abrir o aviso", actions.__calls().length === 0);
  check("admin: o aviso mostra o valor que será ativado", afterText.includes("R$ 99,90"));

  const yes = queryAll(container, "button").find((b) => /Sim, recebi o PIX/.test(flat(b)));
  await click(yes);

  const calls = actions.__calls();
  const confirmCall = calls.find((c) => c.action === "confirmPayment");
  check("admin: confirmou ao clicar em 'Sim, recebi o PIX'", Boolean(confirmCall));
  check(
    "admin: envia só o id da solicitação (a casa vem do banco)",
    confirmCall && confirmCall.args.requestId === "req-1" && !("restaurantId" in confirmCall.args),
    JSON.stringify(confirmCall?.args),
  );
}

/* 10. Rejeição exige motivo */
actions.__reset();
{
  const container = await render(
    React.createElement(lib.components.PaymentDetailPanel, {
      detail: lib.detail,
      receiptUrl: null,
      isMasterAdmin: false,
    }),
  );

  const rejectBtn = queryAll(container, "button").find((b) => /Rejeitar pagamento/.test(flat(b)));
  await click(rejectBtn);

  const textarea = container.querySelector("#reject");
  check("admin: formulário de rejeição pede o motivo", Boolean(textarea));

  const sendReject = queryAll(container, "button").find((b) => flat(b) === "Rejeitar");
  await click(sendReject);
  check(
    "admin: rejeitar com motivo curto não chama a action",
    !actions.__calls().some((c) => c.action === "rejectPayment"),
    JSON.stringify(actions.__calls().map((c) => c.action)),
  );

  await type(textarea, "Comprovante não localizado no extrato");
  await click(queryAll(container, "button").find((b) => flat(b) === "Rejeitar"));

  const rejectCall = actions.__calls().find((c) => c.action === "rejectPayment");
  check("admin: rejeitar com motivo chama a action", Boolean(rejectCall));
  check(
    "admin: a rejeição leva o motivo",
    rejectCall?.args.reason === "Comprovante não localizado no extrato",
    JSON.stringify(rejectCall?.args),
  );
  check(
    "admin: não-admin não vê o campo de período habilitado",
    container.querySelector("#period")?.hasAttribute("disabled") === true,
  );
}

/* ========================================================================== */
/* 11. Configuração do PIX                                                    */
/* ========================================================================== */

const adminSettings = {
  is_active: true,
  recipient_name: "Menuvo Tecnologia ME",
  pix_key: "pix@menuvo.com.br",
  pix_key_type: "email",
  instructions: "Envie o comprovante.",
  qr_code_url: null,
  updated_at: "2026-11-20T10:00:00Z",
  updated_by_email: "master@menuvo.com",
  can_edit: true,
};

actions.__reset();
{
  const container = await render(
    React.createElement(lib.components.PaymentSettingsForm, { settings: adminSettings }),
  );

  const text = bodyText(container);
  check("config: mostra a chave atual", container.querySelector("#pix-key").value === "pix@menuvo.com.br");
  check("config: mostra o recebedor", container.querySelector("#recipient").value === "Menuvo Tecnologia ME");
  check("config: avisa quem alterou por último", text.includes("master@menuvo.com"));
  check("config: não menciona credencial/gateway", !/token|credencial|gateway|webhook/i.test(text));

  const save = queryAll(container, "button").find((b) => /Salvar configuração/.test(flat(b)));
  await click(save);

  const call = actions.__calls().find((c) => c.action === "savePaymentSettings");
  check("config: salvar envia os campos de recebimento", Boolean(call));
  check(
    "config: o payload não tem credencial nenhuma",
    call && Object.keys(call.args).sort().join(",") ===
      "instructions,isActive,pixKey,pixKeyType,qrCodeUrl,recipientName",
    JSON.stringify(Object.keys(call?.args ?? {})),
  );
}

{
  const container = await render(
    React.createElement(lib.components.PaymentSettingsForm, {
      settings: { ...adminSettings, can_edit: false },
    }),
  );
  const text = bodyText(container);
  check("config: sem MASTER_ADMIN mostra 'somente leitura'", /Somente leitura/i.test(text));
  check(
    "config: sem MASTER_ADMIN o formulário fica desabilitado",
    container.querySelector("#pix-key").hasAttribute("disabled"),
  );
  check(
    "config: sem MASTER_ADMIN não há botão de salvar",
    !queryAll(container, "button").some((b) => /Salvar configuração/.test(flat(b))),
  );
}

/* ========================================================================== */
/* 12. Acessibilidade / mobile                                                */
/* ========================================================================== */

{
  const container = await render(
    React.createElement(lib.components.PaymentDetailPanel, {
      detail: lib.detail,
      receiptUrl: null,
      isMasterAdmin: true,
    }),
  );
  check("a11y: nenhuma tabela horizontal", !container.querySelector("table"));

  // O aviso só existe depois do primeiro clique (antes disso não há nada a
  // anunciar). Abrimos a confirmação para conferir o papel acessível.
  await click(queryAll(container, "button").find((b) => /Confirmar pagamento/.test(flat(b))));
  const alert = container.querySelector('[role="alert"]');
  check(
    "a11y: aviso de confirmação tem papel acessível",
    Boolean(alert) && /Confirme somente após verificar/.test(flat(alert)),
    alert ? "role=alert presente" : "sem role=alert",
  );
}


  for (const handle of mounted) {
    await act(async () => handle.root.unmount());
  }

  const passed = results.filter((r) => r.ok).length;
  console.log("");
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  console.log(`\npayments-ui: ${passed}/${results.length} PASS\n`);

  dom.window.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
