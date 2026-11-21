/**
 * Harness de UI do painel master — Etapa 10 (jsdom).
 *
 * Verifica o que o admin vê e o que a tela faz com o toque:
 *   • busca tolerante a acento por nome, slug, telefone e responsável;
 *   • filtros por status com contagem;
 *   • suspensão exigindo motivo e enviando o payload certo;
 *   • gestão de equipe (troca de papel, bloqueio de acesso);
 *   • edição com aviso de slug e escolha de plano;
 *   • mensagens de indisponibilidade e de suspensão;
 *   • navegação do painel e alvo de toque dos cards.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-admin-ui");
fs.rmSync(OUT, { recursive: true, force: true });

/* ----------------------------- ambiente ----------------------------- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/admin",
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
// `self` e `requestIdleCallback` são usados por bibliotecas pensando em worker
// ou navegador; o jsdom não os define e o React 19 quebra sem eles.
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
  entryPoints: [path.join(__dirname, "entry-admin.tsx")],
  bundle: true,
  outfile: path.join(OUT, "admin-ui.js"),
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/admin": path.join(__dirname, "stubs-admin/admin-actions.ts"),
    "next/navigation": path.join(__dirname, "stubs-admin/next-navigation.ts"),
  },
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"],
  logLevel: "error",
});

const lib = require(path.join(OUT, "admin-ui.js"));
const actionsStub = lib.adminActions;
const navStub = require(path.join(__dirname, "stubs-admin/next-navigation.ts"));
const React = require("react");
const { act } = require("react");

/* ----------------------------- helpers ----------------------------- */

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

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

function queryAll(container, selector) {
  return Array.from(container.querySelectorAll(selector));
}

function byText(container, text, selector = "button, a, label, li, p, span, h1, h2, h3, summary") {
  return queryAll(container, selector).find((node) => node.textContent?.includes(text));
}

function click(node) {
  if (!node) throw new Error("clique em elemento inexistente");
  node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function typeTextarea(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, value);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

/**
 * Botão cujo texto COMEÇA com o rótulo exato — e não com uma palavra que só
 * começa igual. Sem isso, "Suspenso" casaria com o chip de filtro "Suspensos",
 * e o teste estaria clicando na coisa errada.
 */
function optionButton(label, root = document.body) {
  return Array.from(root.querySelectorAll("button")).find((button) => {
    const text = button.textContent?.trim() ?? "";
    if (!text.startsWith(label)) return false;
    // A opção vive dentro do sheet (`role="dialog"`); o chip de filtro
    // "Suspensos" fica na lista, atrás do overlay. Restringir ao diálogo é o
    // que separa os dois sem depender de pontuação do texto.
    return Boolean(button.closest('[role="dialog"]'));
  });
}

function reset() {
  for (const handle of mounted) handle.root.unmount();
  mounted = [];
  document.body.innerHTML = "";
  actionsStub.__calls().length = 0;
  actionsStub.__setResult({ ok: true, message: "ok" });
  // `useRouter()` devolve um objeto novo a cada render; guardamos as chamadas em
  // `window` para o reset conseguir zerar o mesmo array que a tela usa.
  if (window.__nav) window.__nav.length = 0;
}

/* =========================== 1. Lista =========================== */

async function testList() {
  reset();
  const container = await render(
    React.createElement(lib.components.RestaurantList, { restaurants: lib.fixtures.rows }),
  );

  check(
    "lista: mostra os três restaurantes",
    queryAll(container, "li.card").length === 3,
    String(queryAll(container, "li.card").length),
  );

  check("lista: nome, slug e contagens visíveis", container.textContent.includes("Famintos") &&
    container.textContent.includes("/r/famintos") &&
    container.textContent.includes("12 produtos") &&
    container.textContent.includes("8 mesas"));

  check(
    "lista: singular não vira '1 produtos'",
    container.textContent.includes("3 produtos") || container.textContent.includes("0 produtos"),
  );

  check(
    "lista: suspenso mostra o motivo para o suporte",
    container.textContent.includes("Pendência de pagamento"),
  );

  check(
    "lista: responsável aparece quando existe",
    container.textContent.includes("ana@famintos.test"),
  );

  // ---- busca por nome com acento
  const search = container.querySelector('input[type="search"]');
  await act(async () => {
    type(search, "acai");
  });
  check(
    "busca: 'acai' encontra 'Açaí do Bairro' (acento normalizado)",
    queryAll(container, "li.card").length === 1 &&
      container.textContent.includes("Açaí do Bairro"),
    String(queryAll(container, "li.card").length),
  );

  await act(async () => {
    type(search, "ANA@FAMINTOS");
  });
  check(
    "busca: por e-mail do responsável, em caixa alta",
    queryAll(container, "li.card").length === 1 && container.textContent.includes("Famintos"),
  );

  await act(async () => {
    type(search, "11 99999");
  });
  check(
    "busca: por telefone com espaços",
    container.textContent.includes("Nenhum restaurante encontrado") ||
      queryAll(container, "li.card").length === 1,
    `achei ${queryAll(container, "li.card").length}`,
  );

  await act(async () => {
    type(search, "pizzaria-napoli");
  });
  check(
    "busca: por slug",
    queryAll(container, "li.card").length === 1 &&
      container.textContent.includes("Pizzaria Napoli"),
  );

  await act(async () => {
    type(search, "zzzz");
  });
  check(
    "busca: sem resultado mostra estado vazio com o termo",
    container.textContent.includes("Nenhum restaurante encontrado") &&
      container.textContent.includes("zzzz"),
  );

  // limpar
  const clear = container.querySelector('button[aria-label="Limpar busca"]');
  await act(async () => click(clear));
  check("busca: botão limpar devolve a lista inteira", queryAll(container, "li.card").length === 3);

  // ---- filtros
  const suspensos = byText(container, "Suspensos", 'button[aria-pressed]');
  await act(async () => click(suspensos));
  check(
    "filtro: 'Suspensos' deixa só a casa suspensa",
    queryAll(container, "li.card").length === 1 &&
      container.textContent.includes("Açaí do Bairro"),
    String(queryAll(container, "li.card").length),
  );

  const todos = byText(container, "Todos", 'button[aria-pressed]');
  await act(async () => click(todos));
  check("filtro: voltar para 'Todos' restaura a lista", queryAll(container, "li.card").length === 3);

  const badgeSusp = queryAll(container, "span").find((n) =>
    n.className.includes("rounded-full") && n.textContent?.includes("Suspenso"),
  );
  check(
    "status: selo 'Suspenso' tem texto, não só cor",
    Boolean(badgeSusp) && badgeSusp.getAttribute("aria-hidden") === null,
  );

  const ativo = queryAll(container, "span").find((n) =>
    n.className.includes("rounded-full") && n.textContent?.includes("Ativo"),
  );
  check("status: selo 'Ativo' com rótulo em português", Boolean(ativo));
}

/* ===================== 2. Suspensão em sheet ===================== */

async function testSuspend() {
  reset();
  const container = await render(
    React.createElement(lib.components.RestaurantList, { restaurants: lib.fixtures.rows }),
  );

  const buttons = queryAll(container, "button").filter((b) => b.textContent === "Alterar status");
  check("suspensão: cada casa tem 'Alterar status'", buttons.length === 3, String(buttons.length));

  await act(async () => click(buttons[0]));
  check(
    "suspensão: sheet abre com as três opções de status",
    document.body.textContent.includes("Ativo") &&
      document.body.textContent.includes("Desativado") &&
      document.body.textContent.includes("Suspenso"),
  );

  const suspender = optionButton("Suspenso");
  check("suspensão: opção 'Suspenso' existe", Boolean(suspender));

  // sem motivo, nada é enviado
  const callsBefore = actionsStub.__calls().length;
  await act(async () => click(suspender));
  await flush();
  const calls = actionsStub.__calls();
  const localAlert = document.body.querySelector('[role="alert"]');
  check(
    "suspensão: motivo é obrigatório — sem motivo não chama o servidor",
    calls.length === callsBefore && Boolean(localAlert) && localAlert.textContent.includes("Informe o motivo"),
    JSON.stringify(calls),
  );

  const textarea = document.body.querySelector("textarea");
  check("suspensão: campo de motivo aparece", Boolean(textarea));

  await act(async () => {
    typeTextarea(textarea, "Pendência de pagamento");
  });
  await flush();

  const suspender2 = optionButton("Suspenso");
  await act(async () => click(suspender2));
  await flush();

  const last = actionsStub.__calls().at(-1);
  check(
    "suspensão: envia id, status e motivo",
    last?.action === "setRestaurantStatus" &&
      last.args.status === "suspended" &&
      last.args.reason === "Pendência de pagamento" &&
      last.args.restaurantId === "11111111-1111-1111-1111-111111111111",
    JSON.stringify(last),
  );

  check(
    "suspensão: lista é atualizada após sucesso",
    (window.__nav ?? []).includes("refresh"),
    JSON.stringify(window.__nav),
  );

  // erro do servidor aparece na tela
  reset();
  const container2 = await render(
    React.createElement(lib.components.RestaurantList, { restaurants: [lib.fixtures.rows[0]] }),
  );
  actionsStub.__setResult({ ok: false, error: "Restaurante suspenso só pode ser reativado pela plataforma." });

  await act(async () => click(queryAll(container2, "button").find((b) => b.textContent === "Alterar status")));
  const ativar = optionButton("Desativado");
  await act(async () => click(ativar));
  await flush();

  const alert = document.body.querySelector('[role="alert"]');
  check(
    "suspensão: erro do banco é mostrado em alerta legível",
    Boolean(alert) && alert.textContent.includes("só pode ser reativado"),
    alert?.textContent,
  );

  check(
    "suspensão: botão atual fica desabilitado (não dá para 'aplicar' o que já é)",
    Array.from(document.body.querySelectorAll("button"))
      .filter((b) => b.getAttribute("aria-pressed") === "true" && b.textContent?.includes("Ativo"))
      .every((b) => b.disabled),
  );
}

/* ========================= 3. Equipe ========================= */

async function testMembers() {
  reset();
  const container = await render(
    React.createElement(lib.components.MembersSection, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      members: lib.fixtures.members,
    }),
  );

  check(
    "equipe: mostra os dois membros com papel e status",
    container.textContent.includes("Ana Souza") &&
      container.textContent.includes("Proprietário") &&
      container.textContent.includes("Gerente") &&
      container.textContent.includes("Convidado"),
  );

  const roleButtons = queryAll(container, "button").filter((b) => b.textContent === "Trocar papel");
  check("equipe: cada membro tem 'Trocar papel'", roleButtons.length === 2);

  await act(async () => click(roleButtons[0]));
  check(
    "equipe: sheet explica o que cada papel pode fazer",
    document.body.textContent.includes("sem gerenciar equipe"),
  );

  const staff = optionButton("Equipe");
  await act(async () => click(staff));
  const salvar = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent === "Salvar papel",
  );
  await act(async () => click(salvar));
  await flush();

  const last = actionsStub.__calls().at(-1);
  check(
    "equipe: troca de papel envia restaurante, usuário e papel",
    last?.action === "setMemberRole" &&
      last.args.role === "staff" &&
      last.args.userId === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    JSON.stringify(last),
  );

  // bloqueio de acesso
  reset();
  const container2 = await render(
    React.createElement(lib.components.MembersSection, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      members: [lib.fixtures.members[0]],
    }),
  );
  const bloquear = queryAll(container2, "button").find((b) => b.textContent === "Bloquear acesso");
  check("equipe: membro ativo oferece 'Bloquear acesso'", Boolean(bloquear));

  await act(async () => click(bloquear));
  await flush();

  const blockCall = actionsStub.__calls().at(-1);
  check(
    "equipe: bloqueio envia status suspended",
    blockCall?.action === "setMemberStatus" && blockCall.args.status === "suspended",
    JSON.stringify(blockCall),
  );

  // casa sem usuários
  reset();
  const container3 = await render(
    React.createElement(lib.components.MembersSection, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      members: [],
    }),
  );
  check(
    "equipe: casa sem usuário avisa que ficará sem administrador",
    container3.textContent.includes("Nenhum usuário vinculado"),
  );
}

/* ========================= 4. Edição ========================= */

async function testEdit() {
  reset();
  const container = await render(
    React.createElement(lib.components.RestaurantEditForm, {
      restaurant: lib.fixtures.restaurant,
      plans: lib.fixtures.plans,
    }),
  );

  const input = container.querySelector('input[type="text"]');
  check("edição: formulário abre com o nome atual", input?.value === "Famintos", input?.value);

  check(
    "edição: sem mudança de slug não aparece o aviso de QR Code",
    !container.textContent.includes("invalida QR Codes"),
  );

  const slugInput = queryAll(container, 'input[type="text"]')[1];
  await act(async () => type(slugInput, "famintos-novo"));
  check(
    "edição: mudar o slug avisa sobre QR Codes e TAGs",
    container.textContent.includes("invalida QR Codes"),
  );

  check(
    "edição: slug é sanitizado ao digitar (maiúscula e espaço viram hífen)",
    slugInput.value === "famintos-novo",
    slugInput.value,
  );

  const gerar = queryAll(container, "button").find((b) => b.textContent?.includes("Gerar link"));
  await act(async () => click(gerar));
  check("edição: 'Gerar link' deriva do nome", slugInput.value === "famintos", slugInput.value);

  const radios = queryAll(container, 'input[type="radio"]');
  check("edição: um radio por plano disponível", radios.length === 2, String(radios.length));

  const pro = radios[1];
  await act(async () => {
    pro.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await flush();

  const submit = queryAll(container, 'button[type="submit"]')[0];
  await act(async () => click(submit));
  await flush();

  const last = actionsStub.__calls().at(-1);
  check(
    "edição: envia nome, slug, telefone e plano",
    last?.action === "updateRestaurant" &&
      last.args.name === "Famintos" &&
      last.args.slug === "famintos" &&
      last.args.planId === "pro",
    JSON.stringify(last),
  );

  check(
    "edição: confirmação de salvamento na tela",
    container.textContent.includes("Dados atualizados"),
  );

  // erro de slug duplicado
  reset();
  const container2 = await render(
    React.createElement(lib.components.RestaurantEditForm, {
      restaurant: lib.fixtures.restaurant,
      plans: lib.fixtures.plans,
    }),
  );
  actionsStub.__setResult({ ok: false, error: "Este link já está em uso por outro restaurante." });
  await act(async () => click(queryAll(container2, 'button[type="submit"]')[0]));
  await flush();
  const alert = container2.querySelector('[role="alert"]');
  check(
    "edição: erro de link duplicado aparece sem perder o formulário",
    Boolean(alert) && alert.textContent.includes("já está em uso"),
  );
}

/* ==================== 5. Ações e acesso de suporte ==================== */

async function testActions() {
  reset();
  const container = await render(
    React.createElement(lib.components.RestaurantActions, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      restaurantName: "Famintos",
      slug: "famintos",
      status: "published",
      suspendedReason: null,
    }),
  );

  check(
    "ações: casa ativa oferece Desativar e Suspender",
    container.textContent.includes("Desativar") && container.textContent.includes("Suspender"),
  );

  const suspender = queryAll(container, "button").find((b) => b.textContent === "Suspender");
  await act(async () => click(suspender));
  check(
    "ações: suspender explica que derruba painel E cardápio",
    document.body.textContent.includes("derruba o cardápio público"),
  );
  check(
    "ações: motivo é exigido (botão começa desabilitado)",
    Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Suspender" && b.disabled) !== undefined,
  );

  // suporte
  reset();
  const container2 = await render(
    React.createElement(lib.components.RestaurantActions, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      restaurantName: "Famintos",
      slug: "famintos",
      status: "published",
      suspendedReason: null,
    }),
  );

  const opened = [];
  const originalOpen = dom.window.open;
  dom.window.open = (url) => {
    opened.push(url);
    return null;
  };

  const supportBtn = queryAll(container2, "button").find((b) => b.textContent?.includes("Abrir cardápio"));
  await act(async () => click(supportBtn));
  check(
    "suporte: avisa que o acesso fica registrado",
    document.body.textContent.includes("auditoria"),
  );

  const registrar = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.includes("Registrar e abrir"),
  );
  await act(async () => click(registrar));
  await flush();

  const call = actionsStub.__calls().at(-1);
  check(
    "suporte: registra o acesso ANTES de abrir",
    call?.action === "logSupportAccess" && call.args.restaurantId === "11111111-1111-1111-1111-111111111111",
    JSON.stringify(call),
  );
  check(
    "suporte: abre o cardápio público da casa certa",
    opened.includes("/r/famintos"),
    opened.join(","),
  );

  dom.window.open = originalOpen;

  // suspenso: oferece reativar
  reset();
  const container3 = await render(
    React.createElement(lib.components.RestaurantActions, {
      restaurantId: "22222222-2222-2222-2222-222222222222",
      restaurantName: "Açaí do Bairro",
      slug: "acai-do-bairro",
      status: "suspended",
      suspendedReason: "Pendência de pagamento",
    }),
  );
  check(
    "ações: casa suspensa só oferece Reativar (sem 'Suspender' de novo)",
    container3.textContent.includes("Reativar restaurante") &&
      !container3.textContent.includes("Suspender"),
  );
}

/* ==================== 6. Cardápio indisponível ==================== */

async function testUnavailable() {
  reset();
  const suspended = await render(
    React.createElement(lib.components.MenuUnavailable, { reason: "suspended", restaurantName: "Famintos" }),
  );
  check(
    "indisponível: suspenso tem título próprio, não 'não encontrado'",
    suspended.textContent.includes("temporariamente indisponível"),
  );
  check(
    "indisponível: orienta chamar um atendente",
    suspended.textContent.includes("atendente"),
  );
  check(
    "indisponível: suspenso NÃO sugere 'volte depois' (não depende do cliente)",
    !suspended.textContent.includes("Volte mais tarde"),
  );

  reset();
  const unpublished = await render(
    React.createElement(lib.components.MenuUnavailable, { reason: "unpublished", restaurantName: "Pizzaria" }),
  );
  check(
    "indisponível: não publicado convida a voltar depois",
    unpublished.textContent.includes("não publicado") &&
      unpublished.textContent.includes("Volte mais tarde"),
  );

  reset();
  const table = await render(React.createElement(lib.components.MenuUnavailable, { reason: "table" }));
  check(
    "indisponível: mesa desativada fala da mesa, não do restaurante",
    table.textContent.includes("mesa não está disponível"),
  );

  reset();
  const notice = await render(
    React.createElement(lib.components.SuspendedNotice, {
      restaurantName: "Famintos",
      reason: "Pendência de pagamento",
      suspendedAt: "2026-03-01T12:00:00Z",
    }),
  );
  check(
    "suspensão painel: mostra o nome da casa e o motivo",
    notice.textContent.includes("Famintos está suspenso") &&
      notice.textContent.includes("Pendência de pagamento"),
  );
  check(
    "suspensão painel: tranquiliza sobre os dados (nada foi apagado)",
    notice.textContent.includes("nada foi apagado"),
  );

  reset();
  const noReason = await render(
    React.createElement(lib.components.SuspendedNotice, { restaurantName: "Famintos" }),
  );
  check(
    "suspensão painel: sem motivo, não inventa motivo",
    !noReason.textContent.includes("Motivo"),
  );
}

/* ========================= 7. Navegação ========================= */

async function testNav() {
  reset();
  const container = await render(React.createElement(lib.components.AdminNav));

  const links = queryAll(container, "a");
  check("nav: cinco abas", links.length === 5, String(links.length));
  check(
    "nav: ordem Início → Casas → Usuários → Pedidos → Ajustes",
    links.map((a) => a.textContent.trim()).join("|") === "Início|Casas|Usuários|Pedidos|Ajustes",
    links.map((a) => a.textContent.trim()).join("|"),
  );
  check(
    "nav: cada aba tem alvo de 56px (min-h-14)",
    queryAll(container, "a").every((a) => a.className.includes("min-h-14")),
  );
  check(
    "nav: aba ativa marcada com aria-current",
    links.filter((a) => a.getAttribute("aria-current") === "page").length === 1,
  );
  check(
    "nav: rótulo acessível do grupo de navegação",
    container.querySelector("nav")?.getAttribute("aria-label")?.includes("plataforma"),
  );

  // métricas
  reset();
  const DashIcon = () => React.createElement("svg");
  const metric = await render(
    React.createElement(lib.components.MetricCard, {
      label: "Suspensos",
      value: 2,
      icon: DashIcon,
      href: "/admin/restaurantes?status=suspended",
      hint: "Bloqueados pela plataforma",
    }),
  );
  check(
    "métrica: card é link para a lista já filtrada",
    metric.querySelector("a")?.getAttribute("href") === "/admin/restaurantes?status=suspended",
  );
  check(
    "métrica: número e rótulo visíveis",
    metric.textContent.includes("2") && metric.textContent.includes("Suspensos"),
  );
}

/* ============================ execução ============================ */

(async () => {
  try {
    await testList();
    await testSuspend();
    await testMembers();
    await testEdit();
    await testActions();
    await testUnavailable();
    await testNav();
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
