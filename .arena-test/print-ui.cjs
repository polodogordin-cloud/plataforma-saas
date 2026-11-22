/**
 * Harness de UI da configuração de impressão — Etapa 18.
 *
 * Roda o formulário real em jsdom, num DOM de 360px, e confere o que o escopo
 * pede e o que quebra fácil:
 *
 *   • o aviso de realidade aparece antes de qualquer campo (o dono precisa
 *     saber que o navegador não escolhe a térmica);
 *   • seções expansíveis, sem formulário gigante sempre aberto;
 *   • salvar modo/papel/interruptor chama a action com o valor certo;
 *   • erro do servidor aparece na tela, não some;
 *   • modo automático avisa do bloqueio do navegador;
 *   • perfil e impressora novos vão para a action com o payload certo;
 *   • provedor "em breve" é rotulado como não disponível;
 *   • a prévia mostra o cupom na largura pedida;
 *   • a página de teste mostra régua, bordas e a contagem de colunas.
 *
 * Rodar: node .arena-test/print-ui.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-print-ui");
const ENTRY = path.join(__dirname, "entry-print.tsx");

fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: path.join(OUT, "bundle.js"),
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/printing": path.join(__dirname, "stubs-print/print-actions.ts"),
  },
  logLevel: "error",
});

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://menuvo.test/app/configuracoes/impressao",
  pretendToBeVisual: true,
});

const g = globalThis;
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
]) {
  if (dom.window[key]) g[key] = dom.window[key];
}
g.navigator = dom.window.navigator;
g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

dom.window.eval(fs.readFileSync(path.join(OUT, "bundle.js"), "utf8"));

const LIB = dom.window.__LIB__;
const { React, act } = LIB;
const actionsStub = LIB.printActions;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const text = (node) => (node?.textContent || "").replace(/[\s\u00a0]+/g, " ").trim();

const host = document.getElementById("root");
const reactRoot = LIB.ReactDOMClient.createRoot(host);

/**
 * Remontagem forçada com `key`: no mesmo root, `render()` reaproveita o
 * `useState` da montagem anterior e o teste seguinte herdaria a configuração do
 * anterior (foi exatamente o bug que o harness do KDS encontrou).
 */
let mountSeq = 0;
async function mount(node) {
  mountSeq += 1;
  await act(async () => {
    reactRoot.render(React.cloneElement(node, { key: `mount-${mountSeq}` }));
  });
  return host;
}

async function click(el) {
  if (!el) throw new Error("elemento não encontrado para clique");
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const buttons = (root) => [...root.querySelectorAll("button")];
const button = (root, pattern) =>
  buttons(root).find(
    (el) => pattern.test(text(el)) || pattern.test(el.getAttribute("aria-label") || ""),
  );
const byRole = (root, role) => [...root.querySelectorAll(`[role="${role}"]`)];

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function settings(overrides = {}) {
  return {
    mode: "manual",
    default_paper_width: "80",
    print_orders: true,
    print_tickets: true,
    print_kitchen: true,
    print_counter: true,
    copies: 1,
    footer_note: null,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    settings: settings(),
    profiles: [],
    printers: [],
    can_configure: true,
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Cozinha",
    slug: "cozinha",
    kind: "kitchen",
    paper_width: "58",
    copies: 1,
    is_active: true,
    sort_order: 0,
    ...overrides,
  };
}

function printer(overrides = {}) {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    profile_id: null,
    name: "Térmica Cozinha",
    provider: "browser",
    identifier: null,
    paper_width: "58",
    is_default: true,
    is_active: true,
    notes: null,
    ...overrides,
  };
}

async function render(configValue) {
  actionsStub.__reset();
  actionsStub.__setConfig(configValue);
  return mount(React.createElement(LIB.PrintConfigForm, { initialConfig: configValue }));
}

async function main() {
  /* ------------------------------------------------- 1. aviso de realidade */

  let root = await render(config());
  let body = text(root);

  check("mostra o aviso sobre o navegador", /O que o navegador consegue fazer/.test(body), body.slice(0, 80));
  check(
    "diz que a térmica é escolhida na janela do sistema",
    /escolhe a térmica nessa janela|Escolha a impressora térmica/i.test(body),
  );
  check("diz que o navegador não confirma a impressão", /não confirma se o papel saiu/.test(body));
  check("diz que automático exige bridge", /bridge local/i.test(body));
  check(
    "diz que o histórico registra 'solicitada'",
    /solicitada/i.test(body),
  );

  /* ------------------------------------------------ 2. seções expansíveis */

  const details = [...root.querySelectorAll("details")];
  check("seções expansíveis usam <details>", details.length >= 4, `${details.length}`);
  check(
    "nem todas as seções abrem de uma vez",
    details.filter((d) => d.hasAttribute("open")).length < details.length,
    "formulário com tudo aberto é o que o escopo manda evitar no celular",
  );
  check(
    "a primeira seção (modo/papel) já vem aberta",
    details[0]?.hasAttribute("open"),
  );
  check("existe resumo do estado atual", /Como está hoje/.test(body));

  /* ------------------------------------------------------- 3. modo manual */

  const radios = byRole(root, "radio");
  check("modo é escolhido por radiogroup", radios.length >= 2, `${radios.length}`);
  const manual = radios.find((el) => /Manual/.test(text(el)));
  check("modo manual presente", Boolean(manual));
  check("manual está marcado", manual?.getAttribute("aria-checked") === "true", manual?.getAttribute("aria-checked"));

  const auto = radios.find((el) => /Automática/.test(text(el)));
  await click(auto);

  const savedMode = actionsStub.calls.find((c) => c.name === "savePrintSettings");
  check("tocar em automática chama a action", Boolean(savedMode));
  check(
    "envia mode=auto",
    savedMode?.input?.mode === "auto",
    JSON.stringify(savedMode?.input),
  );
  check(
    "envia o restaurante? não — a action resolve no servidor",
    savedMode?.input && !("restaurantId" in savedMode.input),
  );

  /* ------------------------------------------------- 4. aviso do automático */

  root = await render(config({ settings: settings({ mode: "auto" }) }));
  body = text(root);
  check(
    "modo automático avisa do bloqueio do navegador",
    /pode bloquear|confirmar a janela/i.test(body),
    body.slice(0, 200),
  );

  /* ---------------------------------------------------------- 5. papel */

  root = await render(config());
  const widths = byRole(root, "radio").filter((el) => /58mm|80mm/.test(text(el)));
  check("as duas larguras aparecem", widths.length >= 2, `${widths.length}`);
  check("58mm mostra a área útil", /48mm úteis/.test(text(root)));
  check("80mm mostra 48 colunas", /48 colunas/.test(text(root)));

  const w58 = widths.find((el) => /58mm/.test(text(el)));
  await click(w58);
  const savedWidth = actionsStub.calls.find(
    (c) => c.name === "savePrintSettings" && c.input?.default_paper_width === "58",
  );
  check("tocar em 58mm salva a largura", Boolean(savedWidth));
  check(
    "preserva o restante da configuração ao trocar o papel",
    savedWidth?.input?.mode === "manual" && savedWidth?.input?.copies === 1,
    JSON.stringify(savedWidth?.input),
  );

  /* ------------------------------------------------- 6. interruptores */

  root = await render(config({ settings: settings({ print_counter: false }) }));
  const switches = [...root.querySelectorAll('[role="switch"]')];
  check("quatro interruptores de destino", switches.length === 4, `${switches.length}`);
  check(
    "o interruptor desligado vem desligado",
    switches.filter((el) => el.getAttribute("aria-checked") === "false").length === 1,
  );

  const ticketsSwitch = switches[1];
  await click(ticketsSwitch);
  const savedToggle = actionsStub.calls.find(
    (c) => c.name === "savePrintSettings" && c.input?.print_tickets === false,
  );
  check("tocar no interruptor salva o valor invertido", Boolean(savedToggle));

  /* -------------------------------------------------------- 7. cópias */

  const copies3 = button(root, /^3 vias$/);
  check("opção de 3 vias existe", Boolean(copies3));
  await click(copies3);
  check(
    "3 vias chama a action com copies=3",
    actionsStub.calls.some((c) => c.name === "savePrintSettings" && c.input?.copies === 3),
  );

  /* ---------------------------------------------------- 8. erro do servidor */

  root = await render(config());
  actionsStub.__failWith("Você não tem permissão para configurar a impressão desta casa.");
  const w80 = byRole(root, "radio").find((el) => /80mm/.test(text(el)));
  await click(w80);
  const alert = root.querySelector('[role="alert"]');
  check("erro do servidor aparece na tela", Boolean(alert));
  check(
    "mensagem é a do servidor",
    /não tem permissão/.test(text(alert)),
    text(alert),
  );

  /* ------------------------------------------------ 9. sem permissão */

  root = await render(config({ can_configure: false }));
  body = text(root);
  check("avisa que só admin altera", /Só administradores e gerentes/.test(body));
  const disabledSwitches = [...root.querySelectorAll('[role="switch"]')];
  check(
    "interruptores desabilitados para quem não configura",
    disabledSwitches.length > 0 && disabledSwitches.every((el) => el.disabled === true),
  );

  /* ------------------------------------------------------ 10. perfis vazios */

  root = await render(config());
  body = text(root);
  check("sem perfis, mostra o estado vazio", /Nenhum perfil configurado/.test(body));
  const seedButton = button(root, /Criar perfis padrão/);
  check("botão de criar perfis padrão existe", Boolean(seedButton));
  await click(seedButton);
  check(
    "criar perfis padrão chama seedPrintProfiles",
    actionsStub.calls.some((c) => c.name === "seedPrintProfiles"),
  );

  /* ---------------------------------------------------- 11. perfil existente */

  root = await render(
    config({
      profiles: [
        profile(),
        profile({ id: "44444444-4444-4444-4444-444444444444", name: "Bar", slug: "bar", kind: "bar", is_active: false }),
      ],
    }),
  );
  body = text(root);
  check("perfil aparece na lista", /Cozinha/.test(body));
  check("perfil inativo é marcado", /off/.test(body));
  check("mostra papel do perfil", /58mm/.test(body));

  const deactivate = buttons(root).find((el) => /^Desativar$/.test(text(el)));
  check("botão de desativar perfil existe", Boolean(deactivate));
  await click(deactivate);
  check(
    "desativar chama savePrintProfile",
    actionsStub.calls.some((c) => c.name === "savePrintProfile"),
  );

  const removeProfile = root.querySelector('[aria-label="Remover perfil Cozinha"]');
  check("botão de remover perfil tem rótulo acessível", Boolean(removeProfile));
  await click(removeProfile);
  check(
    "remover chama deletePrintProfile",
    actionsStub.calls.some((c) => c.name === "deletePrintProfile"),
  );

  /* -------------------------------------------------- 12. criar perfil */

  root = await render(config({ profiles: [profile()] }));
  const addProfile = button(root, /Adicionar perfil/);
  check("botão de adicionar perfil existe", Boolean(addProfile));
  await click(addProfile);

  const nameInput = root.querySelector('input[name="profile_name"]');
  check("formulário de perfil abre com campo de nome", Boolean(nameInput));
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    setter.call(nameInput, "Chapa");
    nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });

  const createProfile = button(root, /^Criar perfil$/);
  check("campo preenchido habilita criar", createProfile?.disabled === false);
  await click(createProfile);
  const created = actionsStub.calls.find((c) => c.name === "savePrintProfile");
  check("perfil novo é enviado com o nome digitado", created?.input?.name === "Chapa", JSON.stringify(created?.input));
  check(
    "perfil novo não envia id (cria, não edita)",
    created?.input?.id === undefined || created?.input?.id === null,
  );

  /* -------------------------------------------------- 13. impressoras */

  root = await render(config({ printers: [printer()] }));
  body = text(root);
  check("impressora aparece na lista", /Térmica Cozinha/.test(body));
  check("impressora padrão é marcada", /padrão/.test(body));

  root = await render(
    config({ printers: [printer({ provider: "bridge", identifier: "192.168.0.50:9100" })] }),
  );
  body = text(root);
  check(
    "provedor indisponível é avisado",
    /ainda não disponível/.test(body),
    body.slice(0, 200),
  );
  check("identificador aparece", /192\.168\.0\.50:9100/.test(body));

  root = await render(config({ profiles: [profile()] }));
  const addPrinter = button(root, /Adicionar impressora/);
  check("botão de adicionar impressora existe", Boolean(addPrinter));
  await click(addPrinter);
  const printerName = root.querySelector('input[name="printer_name"]');
  check("formulário de impressora abre", Boolean(printerName));
  const providerSelect = root.querySelector("#printer-provider");
  const providerOptions = providerSelect ? [...providerSelect.querySelectorAll("option")] : [];
  check("select de provedor lista os cinco", providerOptions.length === 5, `${providerOptions.length}`);
  check(
    "provedores futuros aparecem como 'em breve'",
    providerOptions.filter((opt) => /em breve/.test(text(opt))).length === 4,
  );
  check(
    "navegador é o único sem 'em breve'",
    !/em breve/.test(text(providerOptions.find((opt) => opt.value === "browser"))),
  );

  /* ------------------------------------------------ 14. cupom de prévia */

  const doc = {
    restaurant: {
      id: "r1",
      name: "Famintos Burger",
      phone: null,
      address: null,
      city: null,
      timezone: "America/Sao_Paulo",
    },
    settings: {
      mode: "manual",
      default_paper_width: "80",
      copies: 1,
      footer_note: null,
      show_prices: true,
    },
    order: {
      id: "o1",
      order_number: 1042,
      status: "confirmed",
      channel: "dine_in",
      table_name: "Mesa 07",
      subtotal: 45,
      fees: 0,
      discount: 0,
      total: 45,
      notes: "sem talheres",
      created_at: "2026-11-21T21:00:00Z",
      updated_at: "2026-11-21T21:00:00Z",
      items: [
        { name: "X-Bacon", quantity: 2, unit_price: 20, subtotal: 40, notes: null, options: [] },
        { name: "Coca-Cola", quantity: 1, unit_price: 5, subtotal: 5, notes: null, options: [] },
      ],
      payments: [],
    },
  };

  const lines = LIB.buildTicketLines(doc, { width: "58" });
  root = await mount(React.createElement(LIB.ThermalTicket, { lines, width: "58" }));
  const pre = root.querySelector("pre");
  check("cupom é renderizado em <pre>", Boolean(pre));
  check("cupom declara a largura do papel", pre?.getAttribute("data-paper") === "58");
  check("cupom tem classe térmica", /thermal-ticket/.test(pre?.className ?? ""));
  check("cupom tem rótulo acessível", pre?.getAttribute("aria-label") === "Cupom de impressão");
  check("cupom mostra o número do pedido", text(pre).includes("#1042"));
  check("cupom preserva o texto puro", text(pre).includes("X-Bacon"));
  check(
    "nenhuma linha do cupom renderizado passa de 32 colunas",
    lines.every((line) => line.length <= 32),
  );

  /* ------------------------------------------------- 15. página de teste */

  root = await mount(
    React.createElement(LIB.PrintTestPanel, { paperWidth: "58", restaurantName: "Famintos" }),
  );
  body = text(root);
  check("painel de teste tem título", /Imprimir teste/.test(body));
  check("explica o que conferir", /régua vai até o fim/i.test(body));
  check("tem seleção de papel do teste", byRole(root, "radio").length >= 2);
  check("tem botão de imprimir teste", Boolean(button(root, /Imprimir teste/)));

  const previewButton = button(root, /Prévia/);
  check("tem botão de prévia", Boolean(previewButton));
  await click(previewButton);
  check("prévia abre ao tocar", Boolean(root.querySelector("pre")));
  const previewText = text(root.querySelector("pre"));
  check("prévia mostra régua", /\.\.\.\./.test(previewText), previewText.slice(0, 60));
  check("prévia mostra colunas", /32/.test(previewText));
  check("prévia mostra linha de borda", /\|/.test(previewText));

  /* ------------------------------------------------- 16. mobile e toque */

  root = await render(config({ profiles: [profile()], printers: [printer()] }));
  const tappable = buttons(root).filter((el) => {
    const cls = el.className || "";
    return /min-h-1[124]/.test(cls);
  });
  check("controles usam alvo de 44px+", tappable.length > 0, `${tappable.length}`);
  check(
    "nenhuma tabela horizontal na tela",
    !root.querySelector("table"),
    "o escopo proíbe tabela horizontal no celular",
  );

  /* --------------------------------------------------------- resultado */

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\nprint-ui: ${passed}/${results.length} PASS`);
  if (failed.length) {
    console.log("\nFalhas:");
    for (const item of failed) {
      console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    dom.window.close();
    process.exit(1);
  }

  /*
   * Sair explicitamente: o scheduler do React (e o jsdom) deixam timers vivos e
   * o node fica pendurado depois do último teste — o harness "passa" e nunca
   * termina, o que num CI vira timeout.
   */
  dom.window.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Harness quebrou:", error);
  process.exit(1);
});
