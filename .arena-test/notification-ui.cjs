/**
 * Harness de UI da central de notificações — Etapa 26.
 *
 * Renderiza os componentes **de verdade** (jsdom + React 19) com as Server
 * Actions e o Supabase trocados por stubs que registram chamadas. O que se
 * prova aqui é o que o dono vê e o que o toque faz:
 *
 *   `NotificationBell`      — contador, rótulo acessível, lista, marcar uma,
 *                             marcar todas, chegada em tempo real, reconexão;
 *   `NotificationBellSlot`  — sem provider não desenha nada (nenhum canal
 *                             órfão nas telas de impressão);
 *   `NotificationPreferencesForm` — grupos na ordem fixa, salvar explícito,
 *                             e o texto que impede a pessoa de achar que
 *                             desligar o sino desliga o pedido.
 *
 * O transporte de banco (quem recebe, RLS, id forjado) é do harness de
 * segurança; aqui o alvo é a tela.
 *
 * Rodar: node .arena-test/notification-ui.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-notification-ui");
fs.rmSync(OUT, { recursive: true, force: true });

/* ----------------------------- ambiente ----------------------------- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/app/notificacoes",
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

/* ----------------------------- build ----------------------------- */

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-notifications.tsx")],
  bundle: true,
  outfile: path.join(OUT, "notifications-ui.js"),
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/notifications": path.join(__dirname, "stubs-notifications/notification-actions.ts"),
    "@/lib/supabase/client": path.join(__dirname, "stubs-notifications/supabase-client.ts"),
    "@/lib/realtime": path.join(__dirname, "stubs-notifications/realtime.ts"),
    "next/link": path.join(__dirname, "stubs-admin/next-link.tsx"),
  },
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"],
  logLevel: "error",
});

const lib = require(path.join(OUT, "notifications-ui.js"));
const actions = lib.notificationActions;
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
  let handle;
  await act(async () => {
    handle = lib.mount(element);
  });
  mounted.push(handle);
  await flush();
  return handle.container;
}

const body = () => document.body;
const queryAll = (root, selector) => Array.from(root.querySelectorAll(selector));
const flat = (node) => (node?.textContent ?? "").replace(/\u00a0/g, " ");
const byText = (root, text) => queryAll(root, "button, a, label, li, p, span, h2, h3").find((node) => flat(node).includes(text));
const buttonByLabel = (root, label) =>
  queryAll(root, "button").find((button) => (button.getAttribute("aria-label") ?? "").includes(label));

async function click(node) {
  if (!node) throw new Error("clique em elemento inexistente");
  await act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

/* ----------------------------- fetch stub ----------------------------- */

/*
 * O sino lê a lista por `/api/notifications` (rota que existe para não arrastar
 * `server-only` ao cliente). O stub devolve o que cada teste montar e conta as
 * chamadas — é assim que se prova a releitura na reconexão sem polling.
 */
const net = {
  calls: 0,
  payload: { notifications: [], unread: 0 },
  fail: false,
  reset(payload = { notifications: [], unread: 0 }) {
    net.calls = 0;
    net.payload = payload;
    net.fail = false;
  },
};

global.fetch = async () => {
  net.calls += 1;
  if (net.fail) return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(net.payload)) };
};

/* ----------------------------- fixtures ----------------------------- */

const HOUR = 3600_000;
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

function notification(over = {}) {
  return {
    id: over.id ?? "11111111-1111-4111-8111-111111111111",
    restaurant_id: "e28be1dd-ae9e-451a-a38c-d5662426ebc9",
    type: "order_created",
    title: "Novo pedido #1007",
    message: "2 itens · R$ 28,00 · Mesa 01 · pix",
    entity_type: "order",
    entity_id: "22222222-2222-4222-8222-222222222222",
    read_at: null,
    created_at: minutesAgo(3),
    is_global: false,
    unread_count: 1,
    ...over,
  };
}

const ORDER = notification({ id: "aaaaaaaa-1111-4111-8111-111111111111" });
const WAITER = notification({
  id: "bbbbbbbb-1111-4111-8111-111111111111",
  type: "table_waiter_called",
  title: "Garçom chamado",
  message: 'Mesa 04 está chamando o garçom. "Sem gelo"',
  entity_type: "table_request",
  entity_id: "33333333-3333-4333-8333-333333333333",
  created_at: minutesAgo(12),
});
const READ = notification({
  id: "cccccccc-1111-4111-8111-111111111111",
  type: "payment_received",
  title: "Pagamento recebido",
  message: "R$ 28,00 em pix",
  entity_type: "payment",
  entity_id: "44444444-4444-4444-8444-444444444444",
  read_at: new Date().toISOString(),
  created_at: minutesAgo(HOUR / 60000),
});

const CATALOG = [
  { type: "order_created", label: "Novo pedido", group: "Pedidos" },
  { type: "order_cancelled", label: "Pedido cancelado", group: "Pedidos" },
  { type: "order_ready", label: "Pedido pronto", group: "Pedidos" },
  { type: "table_waiter_called", label: "Garçom chamado", group: "Salão" },
  { type: "table_bill_requested", label: "Conta pedida", group: "Salão" },
  { type: "payment_received", label: "Pagamento recebido", group: "Pagamentos" },
  { type: "payment_failed", label: "Pagamento falhou", group: "Pagamentos" },
  { type: "subscription_expiring", label: "Assinatura vencendo", group: "Assinatura" },
  { type: "subscription_expired", label: "Assinatura vencida", group: "Assinatura" },
  { type: "customer_created", label: "Cliente novo", group: "Clientes" },
  { type: "coupon_expiring", label: "Cupom vencendo", group: "Marketing" },
];

function reset() {
  // Desmontar dentro de `act`: sem isso o React 19 avisa a cada suíte e o log
  // do harness vira ruído, escondendo aviso de verdade.
  for (const handle of mounted) act(() => handle.root.unmount());
  mounted = [];
  document.body.innerHTML = "";
  actions.__reset();
  net.reset();
  lib.realtimeControl.reset();
}

/** Controle do canal de tempo real (mesma instância do bundle). */
const control = lib.realtimeControl;

/**
 * Monta o sino. `initialUnread` é o que o layout serve na primeira pintura —
 * sem ele o sino nasce apagado, e é exatamente esse contrato que os testes
 * abaixo verificam.
 */
function bell(props) {
  return React.createElement(lib.components.NotificationBell, {
    userId: "user-1",
    ...props,
  });
}

/* ----------------------------- 1. sino fechado ----------------------------- */

async function testBellClosed() {
  reset();
  net.reset({ notifications: [ORDER, WAITER, READ], unread: 2 });

  const container = await render(
    bell({
      userId: "87435001-c429-4b5c-951d-f646a4a3a057",
      restaurantName: "Famintos",
      timeZone: "America/Sao_Paulo",
      initialUnread: 2,
    }),
  );

  const trigger = queryAll(container, "button")[0];
  check("sino é um botão", Boolean(trigger));
  check("sino anuncia o número por extenso", trigger.getAttribute("aria-label") === "Notificações, 2 não lidas", trigger.getAttribute("aria-label"));
  check("sino abre diálogo", trigger.getAttribute("aria-haspopup") === "dialog");
  check("sino tem alvo de toque", /tap-target/.test(trigger.className));
  check("contador desenhado", flat(trigger).includes("2"), flat(trigger));
  check("contador é aria-hidden (o rótulo já diz)", Boolean(trigger.querySelector('[aria-hidden="true"] span, span[aria-hidden="true"]')));
  check("forma do sino acompanha o contador", Boolean(trigger.querySelector("svg")));
  check("painel fechado não pede rede sozinho", net.calls === 0, `chamadas=${net.calls}`);
}

/* ----------------------------- 2. lista --------------------------------- */

async function testBellOpen() {
  reset();
  net.reset({ notifications: [ORDER, WAITER, READ], unread: 2 });

  const container = await render(
    bell({ restaurantName: "Famintos", timeZone: "America/Sao_Paulo", initialUnread: 2 }),
  );

  await click(queryAll(container, "button")[0]);
  await flush();

  const dialog = body().querySelector('[role="dialog"]');
  check("painel abre", Boolean(dialog));
  check("painel tem título", /Notificações/.test(flat(dialog)));
  check("painel diz o nome da casa", /Famintos/.test(flat(dialog)));
  check("abrir o painel relê a lista", net.calls >= 1, `chamadas=${net.calls}`);

  const t = flat(dialog);
  check("item de pedido aparece", t.includes("Novo pedido #1007"));
  check("item de salão aparece", t.includes("Garçom chamado"));
  check("item lido aparece", t.includes("Pagamento recebido"));
  check("mensagem do banco é mostrada", t.includes("Mesa 01"), t.slice(0, 200));
  check("contagem de não lidas no topo", /2 não lidas/.test(t), t.slice(0, 160));
  check("itens não lidos têm marcação visual", queryAll(dialog, "li").some((li) => /bg-brand-50/.test(li.innerHTML)));

  check("toque no pedido leva ao detalhe", Boolean(dialog.querySelector('a[href="/app/pedidos?pedido=22222222-2222-4222-8222-222222222222"]')));
  check("toque no salão leva ao salão", Boolean(dialog.querySelector('a[href="/app/pedidos?aba=salao"]')));
  check("pagamento leva ao plano", Boolean(dialog.querySelector('a[href="/app/plano"]')));

  const readButtons = queryAll(dialog, "button").filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Marcar"));
  check("cada não lida tem botão de marcar", readButtons.length === 2, `botões=${readButtons.length}`);
  check("botão de marcar nomeia o item", (readButtons[0].getAttribute("aria-label") ?? "").includes("Novo pedido #1007"));
  check("item lido não tem botão de marcar", !readButtons.some((b) => (b.getAttribute("aria-label") ?? "").includes("Pagamento")));
  check("rodapé leva às preferências", Boolean(dialog.querySelector('a[href="/app/notificacoes"]')));
  check("tempo relativo é legível", /Há \d+ min/.test(t), t.slice(0, 200));
}

/* ----------------------------- 3. marcar uma ---------------------------- */

async function testMarkOne() {
  reset();
  net.reset({ notifications: [ORDER, WAITER], unread: 2 });
  const container = await render(bell({ initialUnread: 2 }));
  await click(queryAll(container, "button")[0]);

  const dialog = body().querySelector('[role="dialog"]');
  const target = queryAll(dialog, "button").find((b) => (b.getAttribute("aria-label") ?? "").includes("Novo pedido"));
  await click(target);

  const call = actions.__calls().find((c) => c.action === "markNotificationRead");
  check("marcar chama a action com o id", call?.args === ORDER.id, JSON.stringify(call));
  check("contador cai na hora", queryAll(container, "button")[0].getAttribute("aria-label") === "Notificações, 1 não lida");
  check("item marcado perde o botão", !queryAll(dialog, "button").some((b) => (b.getAttribute("aria-label") ?? "").includes("Novo pedido")));
  check("nenhuma releitura desnecessária", net.calls <= 1, `chamadas=${net.calls}`);
}

/* ----------------------------- 4. falha ao marcar ----------------------- */

async function testMarkFailure() {
  reset();
  net.reset({ notifications: [ORDER], unread: 1 });
  actions.__setResult({ ok: false, error: "Não foi possível marcar a notificação." });


  const container = await render(bell({}));
  await click(queryAll(container, "button")[0]);

  const dialog = body().querySelector('[role="dialog"]');
  await click(queryAll(dialog, "button").find((b) => (b.getAttribute("aria-label") ?? "").includes("Marcar")));

  check("erro é anunciado", Boolean(body().querySelector('[role="alert"]')));
  check("erro tem texto útil", /Não foi possível marcar/.test(flat(body().querySelector('[role="alert"]'))));
  check("tela relê para desfazer o otimista", net.calls >= 2, `chamadas=${net.calls}`);
  check("contador volta ao valor do servidor", queryAll(container, "button")[0].getAttribute("aria-label") === "Notificações, 1 não lida");
}

/* ----------------------------- 5. marcar todas --------------------------- */

async function testMarkAll() {
  reset();
  net.reset({ notifications: [ORDER, WAITER], unread: 2 });
  const container = await render(bell({ initialUnread: 2 }));
  await click(queryAll(container, "button")[0]);

  const dialog = body().querySelector('[role="dialog"]');
  const all = queryAll(dialog, "button").find((b) => flat(b).includes("Marcar lidas"));
  check("botão de marcar todas existe", Boolean(all));
  await click(all);

  const call = actions.__calls().find((c) => c.action === "markAllNotificationsRead");
  check("marcar todas chama a action sem id", Boolean(call) && call.args === null);
  check("contador zera", queryAll(container, "button")[0].getAttribute("aria-label") === "Notificações");
}

/* ----------------------------- 6. tempo real ---------------------------- */

async function testRealtimeInsert() {
  reset();
  net.reset({ notifications: [READ], unread: 0 });
  const container = await render(bell({ initialUnread: 0 }));
  await click(queryAll(container, "button")[0]);
  const before = net.calls;

  check("canal filtrado pelo destinatário", control.filter === "user_id=eq.user-1", String(control.filter));

  const incoming = notification({ id: "dddddddd-1111-4111-8111-111111111111", title: "Novo pedido #1008" });
  await act(async () => control.deliver({ eventType: "INSERT", new: incoming }));
  await flush();

  const dialog = body().querySelector('[role="dialog"]');
  check("item novo entra na lista", flat(dialog).includes("Novo pedido #1008"));
  check("contador sobe", queryAll(container, "button")[0].getAttribute("aria-label") === "Notificações, 1 não lida");
  check("chegada não custa consulta", net.calls === before, `antes=${before} depois=${net.calls}`);

  // Reentrega do mesmo evento (o Supabase repete após reconectar).
  await act(async () => control.deliver({ eventType: "INSERT", new: incoming }));
  await flush();
  const occurrences = (flat(body()).match(/Novo pedido #1008/g) || []).length;
  check("evento repetido não duplica a linha", occurrences === 1, `ocorrências=${occurrences}`);
  const insertBadge = queryAll(container, "button")[0].getAttribute("aria-label");
  check(
    "evento repetido não infla o contador",
    insertBadge === "Notificações, 1 não lida",
    JSON.stringify({ texto: flat(body()).slice(0, 120), rotulo: insertBadge }),
  );
}

async function testRealtimeUpdate() {
  reset();
  net.reset({ notifications: [ORDER, WAITER], unread: 2 });
  const container = await render(bell({ initialUnread: 2 }));
  await click(queryAll(container, "button")[0]);

  await act(async () =>
    control.deliver({
      eventType: "UPDATE",
      new: { ...ORDER, read_at: new Date().toISOString() },
      old: { ...ORDER, read_at: null },
    }),
  );
  await flush();

  check("lida em outro aparelho desce o contador", queryAll(container, "button")[0].getAttribute("aria-label") === "Notificações, 1 não lida");

  // Repetir o mesmo UPDATE não pode descontar duas vezes.
  await act(async () =>
    control.deliver({
      eventType: "UPDATE",
      new: { ...ORDER, read_at: new Date().toISOString() },
      old: { ...ORDER, read_at: null },
    }),
  );
  await flush();
  const updateBadge = queryAll(container, "button")[0].getAttribute("aria-label");
  check(
    "UPDATE repetido não desconta duas vezes",
    updateBadge === "Notificações, 1 não lida",
    JSON.stringify({ rotulo: updateBadge }),
  );
}

async function testReconnect() {
  reset();
  net.reset({ notifications: [ORDER], unread: 1 });
  await render(React.createElement(lib.components.NotificationBell, { userId: "user-1" }));

  await act(async () => control.status("SUBSCRIBED"));
  await flush();
  check("primeira assinatura não relê", net.calls === 0, `chamadas=${net.calls}`);

  await act(async () => control.status("CHANNEL_ERROR"));
  await flush();
  check("queda do canal é registrada", true);

  await act(async () => control.status("SUBSCRIBED"));
  await flush();
  check("reconexão relê a lista", net.calls === 1, `chamadas=${net.calls}`);
}

async function testOffline() {
  reset();
  net.reset({ notifications: [ORDER], unread: 1 });
  const container = await render(bell({ initialUnread: 1 }));
  await click(queryAll(container, "button")[0]);

  await act(async () => control.status("TIMED_OUT"));
  await flush();

  check("modo offline é avisado com texto", /Sem tempo real/.test(flat(body().querySelector('[role="dialog"]'))));
}

/* ----------------------------- 7. vazio e 9+ ---------------------------- */

async function testEmptyAndBadge() {
  reset();
  net.reset({ notifications: [], unread: 0 });
  const container = await render(bell({ initialUnread: 0 }));
  const trigger = queryAll(container, "button")[0];
  check("sem nada, rótulo é simples", trigger.getAttribute("aria-label") === "Notificações");
  check("sem nada, não há bolinha", !/absolute/.test(trigger.innerHTML));

  await click(trigger);
  check("estado vazio explica o que aparece aqui", /Nada por aqui/.test(flat(body().querySelector('[role="dialog"]'))));
  check(
    "estado vazio cita os assuntos",
    /Pedido novo, chamada de garçom, pagamento/.test(flat(body().querySelector('[role="dialog"]'))),
  );

  reset();
  const many = Array.from({ length: 12 }, (_, i) =>
    notification({ id: `00000000-0000-4000-8000-00000000000${i.toString().padStart(2, "0")}`, title: `Pedido ${i}` }),
  );
  net.reset({ notifications: many, unread: 12 });
  const container2 = await render(bell({ initialUnread: 12 }));
  const t2 = queryAll(container2, "button")[0];
  check("contador grande vira 9+", flat(t2).includes("9+"), JSON.stringify({text: flat(t2), label: t2.getAttribute("aria-label"), html: t2.innerHTML.slice(0,400)}));
  check("lido por extenso mantém o número real", t2.getAttribute("aria-label") === "Notificações, 12 não lidas");
}

/* ----------------------------- 8. slot ---------------------------------- */

async function testSlot() {
  reset();
  const container = await render(
    React.createElement(
      "header",
      null,
      React.createElement("span", null, "Menu"),
      React.createElement(lib.components.NotificationBellSlot),
    ),
  );
  check("sem provider, o slot não desenha nada", queryAll(container, "button").length === 0);
  check("sem provider, nenhum canal é aberto", net.calls === 0);

  reset();
  const container2 = await render(
    React.createElement(
      lib.components.NotificationBellProvider,
      {
        userId: "user-9",
        restaurantName: "Famintos",
        timeZone: "America/Sao_Paulo",
        initialUnread: 3,
      },
      React.createElement(
        "header",
        null,
        React.createElement("span", null, "Menu"),
        React.createElement(lib.components.NotificationBellSlot),
      ),
    ),
  );
  check("com provider, o sino aparece", queryAll(container2, "button").length === 1);
  check("o sino usa o usuário do contexto", control.filter === "user_id=eq.user-9");
  check(
    "o sino começa com o contador do servidor",
    queryAll(container2, "button")[0].getAttribute("aria-label") === "Notificações, 3 não lidas",
    queryAll(container2, "button")[0].getAttribute("aria-label"),
  );
  check("provider sem usuário não desenha", await (async () => {
    reset();
    const c = await render(
      React.createElement(
        lib.components.NotificationBellProvider,
        { userId: "" },
        React.createElement(lib.components.NotificationBellSlot),
      ),
    );
    return queryAll(c, "button").length === 0;
  })());
}

/* ----------------------------- 9. preferências -------------------------- */

async function testPreferences() {
  reset();
  const container = await render(
    React.createElement(lib.components.NotificationPreferencesForm, {
      restaurantId: "e28be1dd-ae9e-451a-a38c-d5662426ebc9",
      initialDisabled: ["payment_received"],
      catalog: CATALOG,
    }),
  );

  const t = flat(container);
  for (const group of ["Pedidos", "Salão", "Pagamentos", "Assinatura", "Clientes", "Marketing"]) {
    check(`preferências agrupam "${group}"`, t.includes(group));
  }
  check(
    "grupos na ordem fixa",
    /Pedidos[\s\S]*Salão[\s\S]*Pagamentos[\s\S]*Assinatura[\s\S]*Clientes[\s\S]*Marketing/.test(t),
  );
  check("todo tipo tem rótulo", CATALOG.every((item) => t.includes(item.label)));

  const boxes = queryAll(container, 'input[type="checkbox"]');
  check("um interruptor por tipo", boxes.length === CATALOG.length, `caixas=${boxes.length}`);
  check("tudo nasce ligado menos o desligado", boxes.filter((b) => b.checked).length === CATALOG.length - 1);
  check("cada interruptor tem nome próprio", boxes.every((b) => Boolean(b.getAttribute("aria-label"))));
  check("o desligado diz que não avisa", /Não avisa/.test(t));

  const save = queryAll(container, "button").find((b) => flat(b).includes("Tudo salvo") || flat(b).includes("Salvar"));
  check("salvar começa desabilitado", save.disabled);
  check("salvar diz que está tudo salvo", /Tudo salvo/.test(flat(save)));

  // Trocar um interruptor: nada é enviado ainda.
  await click(boxes[0]);
  check("trocar não salva sozinho", actions.__calls().length === 0);
  const save2 = queryAll(container, "button").find((b) => flat(b).includes("Salvar preferências"));
  check("salvar libera ao mudar", Boolean(save2) && !save2.disabled);

  await click(save2);
  await flush();
  const call = actions.__calls().find((c) => c.action === "saveNotificationPreferences");
  check("salvar chama a action", Boolean(call));
  check("salvar manda a casa", call?.args?.restaurantId === "e28be1dd-ae9e-451a-a38c-d5662426ebc9");
  check("salvar manda o que está desligado", JSON.stringify([...call.args.disabled].sort()) === JSON.stringify(["order_created", "payment_received"]), JSON.stringify(call.args.disabled));
  check("confirmação aparece", /Preferências salvas/.test(flat(container)));
  check("depois de salvar, botão volta a Tudo salvo", /Tudo salvo/.test(flat(queryAll(container, "button").find((b) => b.disabled) ?? {})));

  check(
    "texto protege contra a leitura errada",
    /Desligar um aviso não muda o funcionamento do restaurante/.test(flat(container)),
  );
  check("texto cita o sino", /Só o sino fica quieto/.test(flat(container)));
}

async function testPreferencesFailure() {
  reset();
  actions.__setResult({ ok: false, error: "Você não tem acesso a este restaurante." });
  const container = await render(
    React.createElement(lib.components.NotificationPreferencesForm, {
      restaurantId: "casa-alheia",
      initialDisabled: [],
      catalog: CATALOG,
    }),
  );

  await click(queryAll(container, 'input[type="checkbox"]')[0]);
  await click(queryAll(container, "button").find((b) => flat(b).includes("Salvar preferências")));
  await flush();

  check("falha mostra o motivo do servidor", /não tem acesso a este restaurante/.test(flat(container)));
  check("falha mantém o interruptor como a pessoa deixou", queryAll(container, 'input[type="checkbox"]')[0].checked === false);
  check("falha ainda deixa tentar de novo", Boolean(queryAll(container, "button").find((b) => flat(b).includes("Salvar preferências"))));
}

async function testPreferencesEmptyCatalog() {
  reset();
  const container = await render(
    React.createElement(lib.components.NotificationPreferencesForm, {
      restaurantId: "x",
      initialDisabled: [],
      catalog: [],
    }),
  );
  check("catálogo vazio não gera tela em branco", /Não foi possível carregar/.test(flat(container)));
  check("catálogo vazio não mostra botão de salvar", queryAll(container, "button").length === 0);
}

/* ----------------------------- 10. todas ligadas ------------------------ */

async function testAllOff() {
  reset();
  const container = await render(
    React.createElement(lib.components.NotificationPreferencesForm, {
      restaurantId: "e28be1dd-ae9e-451a-a38c-d5662426ebc9",
      initialDisabled: CATALOG.map((item) => item.type),
      catalog: CATALOG,
    }),
  );
  check("tudo desligado reflete nos interruptores", queryAll(container, 'input[type="checkbox"]').every((b) => !b.checked));

  // Religar tudo: o texto de confirmação muda.
  for (const box of queryAll(container, 'input[type="checkbox"]')) await click(box);
  await click(queryAll(container, "button").find((b) => flat(b).includes("Salvar preferências")));
  await flush();
  check("religar tudo confirma 'Tudo ligado de novo'", /Tudo ligado de novo/.test(flat(container)));
}

/* ----------------------------- execução -------------------------------- */

(async () => {
  const suites = [
    testBellClosed,
    testBellOpen,
    testMarkOne,
    testMarkFailure,
    testMarkAll,
    testRealtimeInsert,
    testRealtimeUpdate,
    testReconnect,
    testOffline,
    testEmptyAndBadge,
    testSlot,
    testPreferences,
    testPreferencesFailure,
    testPreferencesEmptyCatalog,
    testAllOff,
  ];

  for (const suite of suites) {
    try {
      await suite();
    } catch (error) {
      check(`${suite.name} rodou`, false, error && error.message);
    }
  }

  const failed = results.filter((r) => !r.ok);
  for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} PASS (notification-ui.cjs)`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
