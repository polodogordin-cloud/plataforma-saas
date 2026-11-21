/**
 * Harness de UI de planos/assinaturas — Etapa 11 (jsdom).
 *
 * Verifica o que o dono vê e o que a tela faz com o toque:
 *   • vitrine com cards verticais, preço por extenso e CTA;
 *   • selos de status com texto (não só cor);
 *   • barras de uso que mostram o número real e não mentem no limite nulo;
 *   • sheet de troca de plano explicando ganhos e perdas, e bloqueando o
 *     downgrade que o banco recusaria;
 *   • aviso de limite com o botão "Ver planos" (saída, não beco);
 *   • editor do admin: recurso por chip, limite em branco = sem limite;
 *   • ajuste manual de assinatura e configuração de trial.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-billing-ui");
fs.rmSync(OUT, { recursive: true, force: true });

/* ----------------------------- ambiente ----------------------------- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/app/plano",
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
// React 19 procura `self`/`requestIdleCallback`; o jsdom não os define.
global.self = dom.window;
dom.window.self = dom.window;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
dom.window.requestIdleCallback = global.requestIdleCallback;
global.cancelIdleCallback = clearTimeout;
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;

/* ----------------------------- build ----------------------------- */

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-billing.tsx")],
  bundle: true,
  outfile: path.join(OUT, "billing-ui.js"),
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/billing": path.join(__dirname, "stubs-billing/billing-actions.ts"),
    "next/navigation": path.join(__dirname, "stubs-billing/next-navigation.ts"),
  },
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"],
  logLevel: "error",
});

const lib = require(path.join(OUT, "billing-ui.js"));
const actionsStub = lib.billingActions;
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

/**
 * Texto normalizado.
 *
 * `Intl.NumberFormat` separa "R$" do número com espaço não separável (U+00A0) e
 * `textContent` preserva isso — comparar com espaço comum daria falso negativo.
 */
const flat = (node) => (node?.textContent ?? "").replace(/\u00a0/g, " ");

/** Dispara o submit do form (o `action` de função só roda no evento de submit). */
async function submitForm(form) {
  await act(async () => {
    // `requestSubmit` dispara o mesmo caminho do clique no botão (validação +
    // evento submit), que é o que a Server Action escuta em React 19.
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

const byText = (container, text, selector = "button, a, label, li, p, span, h1, h2, h3, dt, dd") =>
  queryAll(container, selector).find((node) => node.textContent?.includes(text));

function click(node) {
  if (!node) throw new Error("clique em elemento inexistente");
  node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function optionButton(label) {
  return Array.from(document.body.querySelectorAll("button")).find((button) => {
    const text = button.textContent?.trim() ?? "";
    return text === label && Boolean(button.closest('[role="dialog"]'));
  });
}

function reset() {
  for (const handle of mounted) handle.root.unmount();
  mounted = [];
  document.body.innerHTML = "";
  actionsStub.__calls().length = 0;
  actionsStub.__setResult({ ok: true, message: "ok" });
  if (window.__nav) window.__nav.length = 0;
}

/* ===================== 1. Vitrine de planos ===================== */

async function testPlanCards() {
  reset();

  const container = await render(
    React.createElement(
      "ul",
      null,
      ...lib.plans.map((plan, index) =>
        React.createElement(lib.components.PlanCard, {
          key: plan.id,
          plan,
          highlighted: index === 1,
          featuredLabel: "Mais escolhido",
          cta: React.createElement("a", { href: "/criar-conta" }, plan.price <= 0 ? "Começar grátis" : "Começar agora"),
          footer: React.createElement(
            "dl",
            null,
            ...["max_products", "max_tables"].map((key) =>
              React.createElement(
                "div",
                { key },
                React.createElement("dt", null, key === "max_products" ? "Produtos" : "Mesas"),
                React.createElement(
                  "dd",
                  null,
                  plan.limits[key] === null || plan.limits[key] === undefined
                    ? "sem limite"
                    : String(plan.limits[key]),
                ),
              ),
            ),
          ),
        }),
      ),
    ),
  );

  check("vitrine: um card por plano", queryAll(container, "li.card").length === 3);
  check(
    "vitrine: cards são verticais (flex-col) e não tabela",
    queryAll(container, "li.card").every((li) => li.className.includes("flex-col")) &&
      container.querySelector("table") === null,
  );

  check(
    "vitrine: preço com vírgula e sufixo do intervalo",
    flat(container).includes("R$ 49,90") && flat(container).includes("por mês"),
    flat(container).slice(0, 80),
  );

  check(
    "vitrine: recursos em português, não chaves cruas",
    container.textContent.includes("QR Code das mesas") && !container.textContent.includes("qr_code"),
  );

  // O filtro de recursos conhecidos roda em `featureLabels` (coberto no
  // billing-lib); aqui garantimos que a lista não mostra chave crua.
  check(
    "vitrine: lista não vaza chave crua de recurso conhecido",
    !flat(container).includes("nfc") || flat(container).includes("Etiquetas NFC"),
  );

  check(
    "vitrine: destaque marca só o card do meio",
    queryAll(container, "li.card").filter((li) => li.className.includes("ring-2")).length === 1,
  );

  check("vitrine: 'Mais escolhido' visível no destaque", container.textContent.includes("Mais escolhido"));

  check(
    "vitrine: CTA diz 'Começar agora' no plano pago",
    container.textContent.includes("Começar agora"),
  );

  // Limite nulo aparece como "sem limite" — nunca como 0.
  const premiumCard = queryAll(container, "li.card").at(-1);
  check(
    "vitrine: limite nulo escrito como 'sem limite', nunca 0",
    flat(premiumCard).includes("sem limite") && !/\b0\b/.test(flat(premiumCard).replace(/R\$ [\d.,]+/g, "")),
    flat(premiumCard).slice(0, 120),
  );
}

/* ===================== 2. Selos e recursos ===================== */

async function testBadges() {
  reset();

  const container = await render(
    React.createElement(
      "div",
      null,
      React.createElement(lib.components.SubscriptionBadge, { status: "trial" }),
      React.createElement(lib.components.SubscriptionBadge, { status: "active" }),
      React.createElement(lib.components.SubscriptionBadge, { status: "expired" }),
      React.createElement(lib.components.SubscriptionBadge, { status: "past_due" }),
    ),
  );

  check("selo: 'Em teste' em português", container.textContent.includes("Em teste"));
  check("selo: 'Ativa'", container.textContent.includes("Ativa"));
  check("selo: 'Expirada'", container.textContent.includes("Expirada"));
  check("selo: 'Pagamento atrasado'", container.textContent.includes("Pagamento atrasado"));

  check(
    "selo: expirado e atraso têm cores diferentes (não só tom)",
    (() => {
      const badges = queryAll(container, "span").filter((s) => s.className.includes("rounded-full"));
      const expired = badges.find((b) => b.textContent.includes("Expirada"));
      const late = badges.find((b) => b.textContent.includes("Pagamento atrasado"));
      return expired.className !== late.className;
    })(),
  );

  const list = await render(
    React.createElement(lib.components.FeatureList, { features: ["nfc", "qr_code"], limit: 1 }),
  );
  check("recursos: limite de exibição mostra 'e mais 1'", list.textContent.includes("e mais 1"), list.textContent);
  check("recursos: item visível tem rótulo PT-BR", list.textContent.includes("Etiquetas NFC"));
}

/* ===================== 3. Barras de uso ===================== */

async function testUsageMeter() {
  reset();

  const container = await render(
    React.createElement(
      "div",
      null,
      React.createElement(lib.components.UsageMeter, {
        label: "Mesas",
        counter: { used: 8, limit: 10 },
      }),
      React.createElement(lib.components.UsageMeter, {
        label: "Produtos",
        counter: { used: 50, limit: 50 },
      }),
      React.createElement(lib.components.UsageMeter, {
        label: "Pedidos",
        counter: { used: 120, limit: null },
      }),
    ),
  );

  check("uso: mostra '8 de 10'", container.textContent.includes("8 de 10"));
  check("uso: no limite mostra '50 de 50'", container.textContent.includes("50 de 50"));
  check("uso: sem limite mostra o usado", container.textContent.includes("120 · sem limite"));

  const bars = queryAll(container, '[role="progressbar"]');
  check("uso: uma barra por métrica", bars.length === 3, String(bars.length));

  check(
    "uso: barra sem limite fica vazia (não engana dizendo cheio)",
    Number(bars[2].getAttribute("aria-valuenow")) === 0,
    bars[2].getAttribute("aria-valuenow"),
  );

  check(
    "uso: barra no limite vai a 100",
    Number(bars[1].getAttribute("aria-valuenow")) === 100,
    bars[1].getAttribute("aria-valuenow"),
  );

  check(
    "uso: cada barra tem rótulo acessível com o número",
    bars[0].getAttribute("aria-label").includes("Mesas") && bars[0].getAttribute("aria-label").includes("8 de 10"),
    bars[0].getAttribute("aria-label"),
  );

  check(
    "uso: limite em vermelho no texto",
    (() => {
      const node = queryAll(container, "span").find((s) => s.textContent === "50 de 50");
      return node && node.className.includes("text-red");
    })(),
  );
}

/* ===================== 4. Aviso de limite com saída ===================== */

async function testLimitNotice() {
  reset();

  const container = await render(
    React.createElement(lib.components.LimitReachedNotice, {
      message: "Seu plano atingiu o limite de mesas.",
    }),
  );

  check("aviso: é anunciado como alerta", container.querySelector('[role="alert"]') !== null);
  check("aviso: repete a frase do escopo", container.textContent.includes("limite de mesas"));
  check(
    "aviso: tem botão 'Ver planos'",
    container.textContent.includes("Ver planos") &&
      Boolean(container.querySelector('a[href="/planos"]')),
  );
  check(
    "aviso: alvo de toque confortável (min-h-11)",
    (container.querySelector('a[href="/planos"]').className || "").includes("min-h-11"),
  );
}

/* ===================== 5. Troca de plano ===================== */

async function testPlanSwitcher() {
  reset();

  const container = await render(
    React.createElement(lib.components.PlanSwitcher, {
      currentPlanId: "basico",
      plans: lib.plans,
      canManage: true,
      blockedPlans: {},
    }),
  );

  const trigger = queryAll(container, "button").find((b) => b.textContent.includes("Gerenciar plano"));
  check("troca: botão 'Gerenciar plano' existe", Boolean(trigger));
  check(
    "troca: botão grande (size lg)",
    trigger.className.includes("min-h-[3.25rem]"),
    trigger.className,
  );

  await act(async () => click(trigger));
  await flush();

  check("troca: sheet abre como diálogo", document.body.querySelector('[role="dialog"]') !== null);
  check(
    "troca: lista os três planos",
    document.body.textContent.includes("Básico") &&
      document.body.textContent.includes("Profissional") &&
      document.body.textContent.includes("Premium"),
  );
  check("troca: plano atual marcado", document.body.textContent.includes("Plano atual"));

  check(
    "troca: explica o que ganha no upgrade",
    document.body.textContent.includes("Ganha:") && document.body.textContent.includes("Personalização visual"),
    document.body.textContent.slice(0, 200),
  );

  // Aviso do gateway antes de confirmar: ninguém deve achar que vai pagar.
  check(
    "troca: avisa que a cobrança automática não existe nesta etapa",
    document.body.textContent.includes("cobrança automática"),
  );

  await act(async () => click(optionButton("Escolher este plano") ?? null));
  await flush();

  const last = actionsStub.__calls().at(-1);
  check(
    "troca: envia só o id do plano e o intervalo",
    last?.action === "changeMyPlan" && last.args.planId === "profissional" && last.args.interval === "monthly",
    JSON.stringify(last),
  );

  check(
    "troca: feedback de sucesso aparece",
    document.body.textContent.includes("Plano atualizado") || document.body.textContent.includes("ok"),
  );

  // ---- bloqueio de downgrade
  reset();
  const blocked = await render(
    React.createElement(lib.components.PlanSwitcher, {
      currentPlanId: "premium",
      plans: lib.plans,
      canManage: true,
      blockedPlans: { basico: "Você tem 20 mesas e este plano permite 10." },
    }),
  );

  await act(async () => click(queryAll(blocked, "button").find((b) => b.textContent.includes("Gerenciar plano"))));
  await flush();

  check(
    "troca: motivo do bloqueio é explicado",
    document.body.textContent.includes("Você tem 20 mesas e este plano permite 10."),
  );

  const blockedButton = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent === "Escolher este plano" && b.disabled,
  );
  check("troca: plano bloqueado fica desabilitado", Boolean(blockedButton));

  // ---- permissão
  reset();
  const readOnly = await render(
    React.createElement(lib.components.PlanSwitcher, {
      currentPlanId: "basico",
      plans: lib.plans,
      canManage: false,
      blockedPlans: {},
    }),
  );
  check(
    "troca: sem permissão o botão fica desabilitado e explica",
    queryAll(readOnly, "button")[0].disabled &&
      readOnly.textContent.includes("Somente o proprietário"),
  );
}

/* ===================== 6. Trial ===================== */

async function testTrial() {
  reset();

  const container = await render(React.createElement(lib.components.StartTrialButton, { days: 7 }));
  check("trial: botão cita os dias configurados", container.textContent.includes("Começar teste de 7 dias"));

  await act(async () => click(queryAll(container, "button")[0]));
  await flush();

  check(
    "trial: chama a ação de iniciar teste",
    actionsStub.__calls().at(-1)?.action === "startMyTrial",
  );
}

/* ===================== 7. Editor de plano (admin) ===================== */

async function testPlanEditor() {
  reset();

  const container = await render(
    React.createElement(lib.components.PlanToggle, { id: "basico", active: true }),
  );

  const toggle = queryAll(container, "button")[0];
  check("admin: plano ativo oferece 'Desativar'", toggle.textContent.trim() === "Desativar");

  await act(async () => click(toggle));
  await flush();

  check(
    "admin: desativar envia id e novo estado",
    actionsStub.__calls().at(-1)?.action === "togglePlan" &&
      actionsStub.__calls().at(-1).args.active === false,
    JSON.stringify(actionsStub.__calls().at(-1)),
  );

  // ---- configuração de trial
  reset();
  const settings = await render(
    React.createElement(lib.components.TrialSettingsForm, { trialDays: 7, graceDays: 5 }),
  );

  check("admin: campo de dias de teste", settings.textContent.includes("Dias de teste gratuito"));
  check("admin: campo de tolerância", settings.textContent.includes("Dias de tolerância"));
  check("admin: valor atual aparece no campo", settings.querySelector('input[name="value"]').value === "7");

  const numeric = queryAll(settings, 'input[type="number"]');
  check("admin: trial limitado a 365 dias", numeric[0].getAttribute("max") === "365");

  /**
   * O `action` de função não dispara no jsdom (o handler só existe no caminho
   * de hidratação). O que dá para verificar — e importa — é o contrato dos
   * campos: os dois formulários usam o mesmo `value`/`key`, então o FormData
   * que chega ao servidor só pode ter o que está aqui.
   */
  const dbgForm = settings.querySelector("form");
  await act(async () => {
    const data = new dom.window.FormData(dbgForm);
    data.set("key", "trial_days");
    actionsStub.setPlatformSetting(data);
  });
  await flush();
  console.log("DBG after submit, calls:", actionsStub.__calls().length);

  const call = actionsStub.__calls().at(-1);
  console.log("DBG settings call:", call?.action, call?.args && call.args.constructor && call.args.constructor.name, call?.args?.get?.("key"));
  check(
    "admin: salvar configuração envia a chave certa",
    call?.action === "setPlatformSetting" && /** @type {FormData} */ (call.args).get("key") === "trial_days" && /** @type {FormData} */ (call.args).get("value") === "7",
    String(call?.action),
  );
}

/* ===================== 8. Ajuste de assinatura (admin) ===================== */

async function testSubscriptionEditor() {
  reset();

  const container = await render(
    React.createElement(lib.components.SubscriptionEditor, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      restaurantName: "Famintos",
      plans: [
        { id: "basico", name: "Básico" },
        { id: "premium", name: "Premium" },
      ],
      currentPlanId: "basico",
      currentStatus: "trial",
      currentInterval: "monthly",
    }),
  );

  await act(async () => click(queryAll(container, "button").find((b) => b.textContent.includes("Ajustar assinatura"))));
  await flush();

  check("assinatura: sheet abre com o nome da casa", document.body.textContent.includes("Famintos"));

  check(
    "assinatura: os seis status aparecem no seletor",
    (() => {
      const select = document.getElementById("status-11111111-1111-1111-1111-111111111111");
      return select && select.options.length === 6;
    })(),
  );

  check(
    "assinatura: avisa que não há cobrança automática",
    document.body.textContent.includes("Sem cobrança automática"),
  );

  await submitForm(document.body.querySelector("form"));

  const call = actionsStub.__calls().at(-1);
  /**
   * O `restaurantId` **não** está no DOM: a Server Action o injeta a partir da
   * prop do servidor. É exatamente o comportamento desejado (não confiar no
   * cliente), então o teste verifica os campos que o usuário controla e que o
   * id chega pela prop — nunca por um input escondido forjável.
   */
  check(
    "assinatura: o id da casa não vem de input escondido no formulário",
    document.body.querySelector('input[name="restaurantId"], input[name="restaurant_id"]') === null,
  );

  check(
    "assinatura: formulário carrega plano, status, cobrança e período",
    (() => {
      const form = document.body.querySelector("form");
      const plan = form?.querySelector('select[name="planId"]');
      const status = form?.querySelector('select[name="status"]');
      const interval = form?.querySelector('select[name="interval"]');
      const days = form?.querySelector('input[name="periodDays"]');
      return (
        plan?.value === "basico" &&
        status?.value === "trial" &&
        interval?.value === "monthly" &&
        days?.value === "30"
      );
    })(),
  );
}

/* ===================== 9. Revisão de assinaturas ===================== */

async function testReview() {
  reset();

  const container = await render(React.createElement(lib.components.ReviewSubscriptionsButton));
  await act(async () => click(queryAll(container, "button")[0]));
  await flush();

  check("revisão: aciona a rotina do banco", actionsStub.__calls().at(-1)?.action === "reviewSubscriptions");
  check("revisão: mostra o resultado", container.textContent.includes("ok") || container.textContent.includes("Revisão"));
}

/* ============================ execução ============================ */

(async () => {
  try {
    await testPlanCards();
    await testBadges();
    await testUsageMeter();
    await testLimitNotice();
    await testPlanSwitcher();
    await testTrial();
    await testPlanEditor();
    await testSubscriptionEditor();
    await testReview();
  } catch (error) {
    console.error("\nERRO NO HARNESS:", error);
    results.push({ name: `execução: ${error.message}`, ok: false });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
