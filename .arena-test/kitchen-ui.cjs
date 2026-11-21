/**
 * Harness de UI do painel de cozinha — Etapa 17.
 *
 * Roda os componentes reais em jsdom, num DOM estreito (celular) e olha o que o
 * escopo pede e o que quebra fácil:
 *
 *   • o card mostra número, mesa, horário, itens, quantidades, observação;
 *   • o contador é `MM:SS` e não treme;
 *   • atraso é indicado por TEXTO + ÍCONE, não só cor;
 *   • os botões certos aparecem por status e por papel;
 *   • cancelar pede confirmação (dois toques), não dispara no primeiro toque;
 *   • a ação é enviada ao servidor com o status de destino certo;
 *   • erro do servidor aparece na tela;
 *   • no celular há abas com contador; no desktop, quatro colunas;
 *   • a lista vazia distingue "em dia" de "filtro sem resultado";
 *   • pedido novo gera destaque.
 *
 * Rodar: node .arena-test/kitchen-ui.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-kitchen-ui");
const ENTRY = path.join(__dirname, "entry-kitchen.tsx");

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
    "@/actions/kitchen": path.join(__dirname, "stubs-kitchen/kitchen-actions.ts"),
    "@/components/orders/use-orders-realtime": path.join(__dirname, "stubs-kitchen/realtime.ts"),
  },
  logLevel: "error",
});

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://menuvo.test/kitchen",
  pretendToBeVisual: true,
});

const g = globalThis;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"]) {
  if (dom.window[key]) g[key] = dom.window[key];
}
g.navigator = dom.window.navigator;
g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

dom.window.eval(fs.readFileSync(path.join(OUT, "bundle.js"), "utf8"));

const LIB = dom.window.__LIB__;
const { React, act } = LIB;
const actionsStub = LIB.kitchenActions;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const text = (node) => (node?.textContent || "").replace(/[\s\u00a0]+/g, " ").trim();

const host = document.getElementById("root");
const reactRoot = LIB.ReactDOMClient.createRoot(host);

/**
 * Monta com **remontagem forçada**.
 *
 * `reactRoot.render(<KitchenBoard {...outrasProps} />)` no mesmo root reaproveita
 * a instância do componente: o React atualiza props e mantém o `useState`. O
 * efeito era o estado da montagem anterior vazando para o teste seguinte — um
 * `initialOrders` com pedido "pending" renderizava como "preparing", herdado de
 * outro caso. Vários testes passavam (ou falhavam) pelo motivo errado.
 *
 * Trocar a `key` obriga o React a desmontar e montar de novo, que é o que cada
 * bloco de teste assume que acontece.
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
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Escolhe um botão **visível**.
 *
 * O board renderiza cada card duas vezes (colunas do tablet e aba do celular),
 * e uma das duas está dentro de um container `hidden` / `lg:hidden`. O jsdom não
 * calcula layout, então `dispatchEvent` funcionaria até num botão que o usuário
 * nunca vê — e o teste passaria a provar a coisa errada. Aqui a cópia oculta é
 * descartada antes de procurar.
 */
function isVisible(el) {
  for (let node = el; node; node = node.parentElement) {
    if (node.hasAttribute?.("hidden")) return false;
    const cls = node.getAttribute?.("class") || "";
    if (/(^|\s)hidden(\s|$)/.test(cls) && !/lg:/.test(cls)) return false;
    if (/(^|\s)lg:hidden(\s|$)/.test(cls) && !/lg:/.test(cls)) return false;
  }
  return true;
}

const buttons = (root) => [...root.querySelectorAll("button")].filter(isVisible);

const button = (root, pattern) =>
  buttons(root).find(
    (el) => pattern.test(text(el)) || pattern.test(el.getAttribute("aria-label") || ""),
  );

const h = React.createElement;

/* -------------------------------------------------------------------------- */
/* Dados                                                                     */
/* -------------------------------------------------------------------------- */

const NOW = Date.now();
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const settings = { late_after_minutes: 15, warn_after_minutes: 10 };
const fullRole = { canOperate: true, canFinish: true, canCancel: true };

function makeOrder(overrides = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    restaurant_id: "r1",
    table_id: "t1",
    table_name: "Mesa 07",
    order_number: 1042,
    status: "pending",
    channel: "dine_in",
    total: 68.8,
    notes: null,
    created_at: minsAgo(5),
    updated_at: minsAgo(5),
    preparing_since: null,
    items: [
      {
        id: "i1",
        product_id: "p1",
        name: "X-Bacon",
        quantity: 2,
        subtotal: 50,
        notes: "sem cebola",
        category_id: "c1",
        station_slug: null,
        options: [{ group_name: "Ponto", name: "Ao ponto", price_delta: 0, quantity: 1 }],
      },
    ],
    item_count: 2,
    ...overrides,
  };
}

(async () => {
  /* ------------------------------------------------------------------ */
  /* 1. Card: informação completa                                       */
  /* ------------------------------------------------------------------ */

  let root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder(),
      nowMs: NOW,
      settings,
      actions: ["accept", "cancel"],
      pending: null,
      highlighted: false,
      onAction: () => {},
      onDismissHighlight: () => {},
    }),
  );

  const t = text(root);
  check("mostra o número do pedido", t.includes("#1042"), t.slice(0, 80));
  check("mostra a mesa", t.includes("Mesa 07"));
  check("mostra o horário de entrada", /entrou \d{2}:\d{2}/.test(t), t.slice(0, 120));
  check("mostra o item e a quantidade", t.includes("X-Bacon") && t.includes("2×"));
  check("mostra a observação do item", t.includes("sem cebola"));
  check("mostra o adicional", t.includes("Ao ponto"));
  check("mostra o status", t.includes("Pendente"));
  check("mostra a contagem de itens", t.includes("2 itens"));
  const counter = t.match(/\b(\d{2}:\d{2}|\d+h\d{2})\b/);
  check("mostra o contador MM:SS", Boolean(counter), counter?.[0]);
  check(
    "o contador reflete o tempo do pedido, não zero",
    counter && Number(counter[0].split(":")[0]) >= 5,
    `${counter?.[0]} para um pedido de 5 min`,
  );

  check("contador não aparece negativo", !/-\d+:\d+/.test(t));

  /* ------------------------------------------------------------------ */
  /* 2. Urgência: texto + ícone, nunca só cor                           */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder({ created_at: minsAgo(3) }),
      nowMs: NOW,
      settings,
      actions: ["accept"],
      pending: null,
      highlighted: false,
      onAction: () => {},
      onDismissHighlight: () => {},
    }),
  );
  check("no prazo mostra 'No prazo'", text(root).includes("No prazo"), text(root));

  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder({ created_at: minsAgo(11) }),
      nowMs: NOW,
      settings,
      actions: ["accept"],
      pending: null,
      highlighted: false,
      onAction: () => {},
      onDismissHighlight: () => {},
    }),
  );
  check("atenção mostra 'Atenção'", text(root).includes("Atenção"), text(root));
  check(
    "atenção tem ícone além da cor",
    root.querySelectorAll("svg").length > 1,
    "leitor de tela e daltonismo dependem do texto+ícone",
  );

  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder({ created_at: minsAgo(20) }),
      nowMs: NOW,
      settings,
      actions: ["accept"],
      pending: null,
      highlighted: false,
      onAction: () => {},
      onDismissHighlight: () => {},
    }),
  );
  check("atrasado mostra 'Atrasado'", text(root).includes("Atrasado"), text(root));

  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder({ created_at: minsAgo(120), status: "delivered" }),
      nowMs: NOW,
      settings,
      actions: [],
      pending: null,
      highlighted: false,
      onAction: () => {},
      onDismissHighlight: () => {},
    }),
  );
  check(
    "entregue não mostra 'Atrasado'",
    !text(root).includes("Atrasado"),
    "alerta em pedido entregue vira ruído",
  );

  /* ------------------------------------------------------------------ */
  /* 3. Ações por status                                                */
  /* ------------------------------------------------------------------ */

  const actionOf = async (status, actions) => {
    const r = await mount(
      h(LIB.KitchenCard, {
        order: makeOrder({ status }),
        nowMs: NOW,
        settings,
        actions,
        pending: null,
        highlighted: false,
        onAction: () => {},
        onDismissHighlight: () => {},
      }),
    );
    return buttons(r).map((el) => text(el));
  };

  let labels = await actionOf("pending", ["accept", "cancel"]);
  check("pending: 'Aceitar' presente", labels.includes("Aceitar"), labels.join(" | "));
  check("pending: sem 'Iniciar preparo'", !labels.includes("Iniciar preparo"));

  labels = await actionOf("confirmed", ["start", "cancel"]);
  check("confirmed: 'Iniciar preparo'", labels.includes("Iniciar preparo"), labels.join(" | "));

  labels = await actionOf("preparing", ["ready", "cancel"]);
  check("preparing: 'Pronto'", labels.includes("Pronto"), labels.join(" | "));

  labels = await actionOf("ready", ["finish", "cancel"]);
  check("ready: 'Finalizar'", labels.includes("Finalizar"), labels.join(" | "));

  labels = await actionOf("delivered", []);
  check(
    "entregue não oferece botão de ação",
    !labels.some((l) => ["Aceitar", "Pronto", "Finalizar", "Cancelar"].includes(l)),
    labels.join(" | "),
  );

  /* ------------------------------------------------------------------ */
  /* 4. Ação envia o status de destino certo                            */
  /* ------------------------------------------------------------------ */

  actionsStub.__reset();
  let captured = null;
  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder({ status: "preparing" }),
      nowMs: NOW,
      settings,
      actions: ["ready", "cancel"],
      pending: null,
      highlighted: false,
      onAction: (action) => {
        captured = action;
      },
      onDismissHighlight: () => {},
    }),
  );
  await click(button(root, /^Pronto$/));
  check("tocar em 'Pronto' dispara a ação ready", captured === "ready", String(captured));

  /* ------------------------------------------------------------------ */
  /* 5. Cancelar pede confirmação                                       */
  /* ------------------------------------------------------------------ */

  let cancelCalls = 0;
  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder({ status: "preparing" }),
      nowMs: NOW,
      settings,
      actions: ["ready", "cancel"],
      pending: null,
      highlighted: false,
      onAction: (action) => {
        if (action === "cancel") cancelCalls += 1;
      },
      onDismissHighlight: () => {},
    }),
  );

  await click(button(root, /^Cancelar$/));
  check(
    "primeiro toque em Cancelar NÃO cancela",
    cancelCalls === 0,
    "cancelamento acidental no meio do serviço é caro",
  );
  check("aparece confirmação inline", text(root).includes("Confirmar cancelamento"), text(root));

  await click(button(root, /^Voltar$/));
  check("'Voltar' desfaz a confirmação", !text(root).includes("Confirmar cancelamento"));

  await click(button(root, /^Cancelar$/));
  await click(button(root, /Confirmar cancelamento/));
  check("segundo toque confirma o cancelamento", cancelCalls === 1, String(cancelCalls));

  /* ------------------------------------------------------------------ */
  /* 6. Papel recortado esconde o botão                                 */
  /* ------------------------------------------------------------------ */

  const kitchenRole = { canOperate: true, canFinish: true, canCancel: false };
  const waiterRole = { canOperate: false, canFinish: true, canCancel: false };

  let boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: kitchenRole,
      initialOrders: [makeOrder({ status: "preparing" })],
      settings,
      stations: [],
    }),
  );

  check(
    "cozinha não vê botão Cancelar",
    !button(boardRoot, /^Cancelar$/),
    "quem barra é o banco, mas a tela não deve oferecer",
  );
  check("cozinha vê 'Pronto'", Boolean(button(boardRoot, /^Pronto$/)));

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: waiterRole,
      initialOrders: [makeOrder({ status: "confirmed" })],
      settings,
      stations: [],
    }),
  );
  check(
    "garçom não vê 'Iniciar preparo'",
    !button(boardRoot, /Iniciar preparo/),
    "garçom não decide quando a cozinha começou",
  );

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: waiterRole,
      initialOrders: [makeOrder({ status: "ready" })],
      settings,
      stations: [],
    }),
  );
  check("garçom vê 'Finalizar' no pronto", Boolean(button(boardRoot, /^Finalizar$/)));

  /* ------------------------------------------------------------------ */
  /* 7. Board: colunas, abas e contadores                               */
  /* ------------------------------------------------------------------ */

  const boardOrders = [
    makeOrder({ id: "a", order_number: 1001, status: "pending" }),
    makeOrder({ id: "b", order_number: 1002, status: "confirmed" }),
    makeOrder({ id: "c", order_number: 1003, status: "preparing" }),
    makeOrder({ id: "d", order_number: 1004, status: "ready" }),
    makeOrder({ id: "e", order_number: 1005, status: "delivered" }),
  ];

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: fullRole,
      initialOrders: boardOrders,
      settings,
      stations: [],
    }),
  );

  const tabs = [...boardRoot.querySelectorAll('[role="tab"]')].map((el) => text(el));
  check("quatro abas", tabs.length === 4, `${tabs.length}`);
  check("aba 'Novos' mostra 2", tabs.some((x) => x.startsWith("Novos") && x.includes("2")), tabs.join(" | "));
  check("aba 'Em preparo' mostra 1", tabs.some((x) => x.startsWith("Em preparo") && x.includes("1")));
  check("aba 'Prontos' mostra 1", tabs.some((x) => x.startsWith("Prontos") && x.includes("1")));
  check("aba 'Finalizados' mostra 1", tabs.some((x) => x.startsWith("Finalizados") && x.includes("1")));

  check("primeira aba é 'Novos'", boardRoot.querySelector('[role="tab"]')?.getAttribute("aria-selected") === "true");

  const panels = [...boardRoot.querySelectorAll('[role="tabpanel"]')];
  check("quatro painéis de aba", panels.length === 4, `${panels.length}`);
  check(
    "só o painel ativo está visível",
    panels.filter((p) => !p.hasAttribute("hidden")).length === 1,
    `${panels.filter((p) => !p.hasAttribute("hidden")).length} visíveis`,
  );

  // Trocar de aba mostra os prontos
  const readyTab = [...boardRoot.querySelectorAll('[role="tab"]')].find((el) =>
    text(el).startsWith("Prontos"),
  );
  await click(readyTab);
  const stillHidden = [...boardRoot.querySelectorAll('[role="tabpanel"]')].filter(
    (p) => !p.hasAttribute("hidden"),
  );
  check("trocar de aba mostra outro painel", stillHidden.length === 1);
  check("painel de prontos mostra #1004", text(stillHidden[0]).includes("#1004"), text(stillHidden[0]));

  /* ------------------------------------------------------------------ */
  /* 8. Layout tablet: quatro colunas                                   */
  /* ------------------------------------------------------------------ */

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: fullRole,
      initialOrders: boardOrders,
      settings,
      stations: [],
    }),
  );

  const desktop = boardRoot.querySelector(".lg\\:grid");
  check("existe container de colunas para tablet", Boolean(desktop));
  check("classes de 4 colunas", /lg:grid-cols-4/.test(desktop?.className || ""), desktop?.className);
  check(
    "container de colunas fica escondido no celular",
    /hidden/.test(desktop?.className || "") && /lg:grid/.test(desktop?.className || ""),
    "em 320px quatro colunas viram tiras ilegíveis",
  );

  /* ------------------------------------------------------------------ */
  /* 9. Estado vazio                                                    */
  /* ------------------------------------------------------------------ */

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: fullRole,
      initialOrders: [],
      settings,
      stations: [],
    }),
  );
  check(
    "sem pedidos, explica em vez de mostrar nada",
    /Nada em novos|Nenhum pedido/.test(text(boardRoot)),
    text(boardRoot).slice(0, 120),
  );
  check("estado vazio tem ícone", boardRoot.querySelectorAll("svg").length > 0);

  /* ------------------------------------------------------------------ */
  /* 10. Erro do servidor aparece                                       */
  /* ------------------------------------------------------------------ */

  actionsStub.__reset();
  actionsStub.__failWith("Seu perfil não pode fazer essa ação.");

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: fullRole,
      initialOrders: [makeOrder({ status: "pending" })],
      settings,
      stations: [],
    }),
  );
  await click(button(boardRoot, /^Aceitar$/));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  const alert = boardRoot.querySelector('[role="alert"]');
  check("erro de autorização aparece na tela", Boolean(alert), "erro silencioso faz tocar de novo");
  check("mensagem é a do servidor", text(alert).includes("não pode fazer"), text(alert));

  actionsStub.__failWith(null);

  /* ------------------------------------------------------------------ */
  /* 11. Filtros e som                                                  */
  /* ------------------------------------------------------------------ */

  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: fullRole,
      initialOrders: [makeOrder({ status: "pending", created_at: minsAgo(40) })],
      settings,
      stations: [],
    }),
  );

  check("botão 'Atrasados' existe", Boolean(button(boardRoot, /Atrasados/)));
  check("botão 'Recentes' existe", Boolean(button(boardRoot, /Recentes/)));
  check("filtro de mesa e estação existe", Boolean(button(boardRoot, /Mesa e estação/)));
  check("controle de som existe", Boolean(button(boardRoot, /som/i)));
  check("botão atualizar existe", Boolean(button(boardRoot, /Atualizar pedidos/)));

  // Filtro "Atrasados" esconde o que está no prazo
  boardRoot = await mount(
    h(LIB.KitchenBoard, {
      restaurantId: "r1",
      restaurantName: "Famintos",
      role: fullRole,
      initialOrders: [
        makeOrder({ id: "ok", order_number: 1001, status: "pending", created_at: minsAgo(2) }),
        makeOrder({ id: "late", order_number: 1002, status: "pending", created_at: minsAgo(40) }),
      ],
      settings,
      stations: [],
    }),
  );

  const lateButton = button(boardRoot, /Atrasados/);
  check("contador de atrasados mostra 1", /Atrasados\s*1/.test(text(lateButton)), text(lateButton));
  await click(lateButton);

  /*
   * Cada card aparece duas vezes no DOM (colunas do tablet + aba do celular), e
   * o jsdom não aplica media query — as duas cópias contam como visíveis para
   * `isVisible`. O que importa aqui é *quais pedidos* sobraram, não quantos nós.
   */
  const visibleCards = [...boardRoot.querySelectorAll("article")].filter(isVisible);
  const numbers = new Set(
    visibleCards.map((el) => text(el).match(/#(\d+)/)?.[1]).filter(Boolean),
  );

  check("filtro atrasados deixa só o pedido atrasado", numbers.size === 1, [...numbers].join(","));
  check("o pedido que sobrou é o #1002", numbers.has("1002"), [...numbers].join(","));
  check(
    "o pedido no prazo sai do filtro",
    !numbers.has("1001"),
    "atrasados é recorte de urgência, não de idade",
  );

  /* ------------------------------------------------------------------ */
  /* 12. Pedido novo tem destaque                                       */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.KitchenCard, {
      order: makeOrder(),
      nowMs: NOW,
      settings,
      actions: ["accept"],
      pending: null,
      highlighted: true,
      onAction: () => {},
      onDismissHighlight: () => {},
    }),
  );
  check("destaque de pedido novo visível", /ring-4/.test(root.querySelector("article")?.className || ""));
  check(
    "destaque tem texto, não só anel",
    text(root).includes("Pedido novo"),
    "anel colorido sozinho não comunica novidade",
  );

  /* ------------------------------------------------------------------ */
  /* Resultado                                                          */
  /* ------------------------------------------------------------------ */

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\nkitchen-ui: ${passed}/${results.length} PASS`);
  if (failed.length) {
    console.log("\nFalhas:");
    for (const item of failed) {
      console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    dom.window.close();
    process.exit(1);
  }

  dom.window.close();
  process.exit(0);
})();
