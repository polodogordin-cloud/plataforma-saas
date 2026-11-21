/**
 * Harness de UI da Etapa 16 — tela de relatórios em jsdom.
 *
 * Roda os componentes reais (gráficos, cards, seção de pagamento) num DOM de
 * 320px de largura e verifica o que o escopo exige e o que quebra fácil:
 *
 *   • gráfico com dados desenha barras; sem dados **não** desenha barra falsa;
 *   • "dados insuficientes" mostra número em vez de gráfico de um ponto;
 *   • o card de dinheiro distingue "pedido" de "recebido";
 *   • crescimento tem rótulo coerente (e não "Infinity%" ou "NaN%");
 *   • a tabela acessível acompanha cada gráfico (leitor de tela recebe o dado);
 *   • pagamento parcial: o campo já vem com o que falta e não deixa lançar
 *     acima do saldo;
 *   • nenhum elemento critica `height: NaN%`.
 *
 * Rodar: node .arena-test/analytics-ui.cjs
 */

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-analytics-ui");
const ENTRY = path.join(__dirname, "entry-analytics.tsx");

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
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "error",
});

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://menuvo.test/app/analytics",
  pretendToBeVisual: true,
});

const g = globalThis;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) {
  if (dom.window[key]) g[key] = dom.window[key];
}
g.navigator = dom.window.navigator;
g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;

dom.window.eval(fs.readFileSync(path.join(OUT, "bundle.js"), "utf8"));

const LIB = dom.window.__LIB__;
const { React, act } = LIB;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const text = (node) => (node?.textContent || "").replace(/[\s\u00a0]+/g, " ").trim();

/**
 * Um único `createRoot` para o arquivo inteiro.
 *
 * Criar um root novo por componente deixava o anterior montado: o processo não
 * encerrava (os timeouts do React ficavam vivos) e cada mount reclamava no
 * console. Reaproveitar o root e trocar a árvore com `render` é o padrão do
 * React 18+ e resolve os dois.
 */
const host = document.getElementById("root");
const reactRoot = LIB.ReactDOMClient.createRoot(host);

async function mount(node) {
  await act(async () => {
    reactRoot.render(node);
  });
  return host;
}

const h = React.createElement;

/* -------------------------------------------------------------------------- */
/* Dados de exemplo                                                          */
/* -------------------------------------------------------------------------- */

const days = [
  { day: "2026-11-15", orders_count: 3, orders_value: 120, paid_value: 100, cancelled_count: 0 },
  { day: "2026-11-16", orders_count: 0, orders_value: 0, paid_value: 0, cancelled_count: 0 },
  { day: "2026-11-17", orders_count: 7, orders_value: 340, paid_value: 300, cancelled_count: 1 },
  { day: "2026-11-18", orders_count: 5, orders_value: 210, paid_value: 210, cancelled_count: 0 },
];

const hours = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  orders_count: hour === 20 ? 9 : hour === 12 ? 4 : 0,
  orders_value: hour === 20 ? 450 : 0,
}));

(async () => {
  /* ------------------------------------------------------------------ */
  /* 1. Barras por dia                                                   */
  /* ------------------------------------------------------------------ */

  let root = await mount(
    h(LIB.DailyBars, { data: days, metric: "orders_count", formatValue: String }),
  );

  const bars = [...root.querySelectorAll("div[title]")];
  check("barras renderizam um elemento por dia", bars.length === days.length, `recebi ${bars.length}`);

  const zeroBar = bars.find((el) => el.title.startsWith("16/11"));
  check(
    "dia sem venda tem barra mínima visível (não some do eixo)",
    zeroBar && /height:\s*3px/.test(zeroBar.getAttribute("style") || ""),
    zeroBar?.getAttribute("style"),
  );

  const filled = bars.find((el) => el.title.startsWith("17/11"));
  check(
    "dia com venda tem altura proporcional",
    filled && /max\(\s*[\d.]+%/.test(filled.getAttribute("style") || ""),
    filled?.getAttribute("style"),
  );

  check(
    "nenhuma barra com altura NaN",
    ![...root.querySelectorAll("[style]")].some((el) =>
      /NaN/.test(el.getAttribute("style") || ""),
    ),
  );

  check(
    "tabela acessível acompanha o gráfico",
    root.querySelector("table") !== null,
    "leitor de tela ficaria sem o dado",
  );
  check(
    "tabela acessível tem uma linha por dia",
    root.querySelectorAll("table tbody tr").length === days.length,
  );
  check(
    "gráfico tem role=img e descrição",
    root.querySelector('[role="img"]')?.getAttribute("aria-describedby") ===
      root.querySelector("table")?.id,
  );

  // Eixo X: só as pontas, para caber em 320px
  const axis = [...root.querySelectorAll("span")].map((s) => text(s)).filter(Boolean);
  check("eixo mostra primeiro dia", axis.includes("15/11"), axis.join(","));
  check("eixo mostra último dia", axis.includes("18/11"), axis.join(","));

  /* ------------------------------------------------------------------ */
  /* 2. Período vazio: nada de barra inventada                           */
  /* ------------------------------------------------------------------ */

  const emptyDays = days.map((d) => ({ ...d, orders_count: 0, orders_value: 0 }));
  root = await mount(
    h(LIB.DailyBars, { data: emptyDays, metric: "orders_count", formatValue: String }),
  );
  check(
    "sem venda, todas as barras ficam no piso",
    [...root.querySelectorAll("div[title]")].every((el) =>
      /height:\s*3px/.test(el.getAttribute("style") || ""),
    ),
  );
  check(
    "sem venda, nenhuma barra com altura percentual",
    ![...root.querySelectorAll("div[title]")].some((el) =>
      /%/.test(el.getAttribute("style") || ""),
    ),
  );

  /* ------------------------------------------------------------------ */
  /* 3. Tendência: um ponto só não vira gráfico                          */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.TrendArea, { data: [days[0]], metric: "orders_value", formatValue: String }),
  );
  check(
    "um único dia não desenha linha de tendência",
    root.querySelector("svg") === null,
    "linha com um ponto parece dado perdido",
  );

  root = await mount(h(LIB.TrendArea, { data: days, metric: "orders_value", formatValue: String }));
  check("dois ou mais dias desenham a linha", root.querySelector("svg") !== null);
  check("linha tem path", root.querySelectorAll("svg path").length >= 2);
  check(
    "traço não escala com o container",
    [...root.querySelectorAll("path")].some(
      (p) => p.getAttribute("vector-effect") === "non-scaling-stroke",
    ),
    "sem isso o traço fica grosso em tela grande",
  );

  /* ------------------------------------------------------------------ */
  /* 4. Horários de pico                                                 */
  /* ------------------------------------------------------------------ */

  root = await mount(h(LIB.HoursBars, { data: hours }));
  check("24 barras de hora", root.querySelectorAll("div[title]").length === 24);
  check(
    "pico é identificado",
    (root.querySelector('[role="img"]')?.getAttribute("aria-label") || "").includes("20h"),
    root.querySelector('[role="img"]')?.getAttribute("aria-label"),
  );
  const peakBar = [...root.querySelectorAll("div[title]")].find((el) =>
    el.title.startsWith("20h"),
  );
  check(
    "hora de pico usa cor de destaque",
    /amber|bg-amber/.test(peakBar?.className || ""),
    peakBar?.className,
  );

  /* ------------------------------------------------------------------ */
  /* 5. Lista ranqueada                                                  */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.RankedBars, {
      items: [
        { key: "a", label: "X-Bacon", value: 40, valueLabel: "40 un." },
        { key: "b", label: "Batata", value: 10, valueLabel: "10 un." },
        { key: "c", label: "Suco", value: 0, valueLabel: "0 un." },
      ],
    }),
  );
  check("lista ranqueada mostra os três itens", root.querySelectorAll("li").length === 3);
  const widths = [...root.querySelectorAll("li div[role='img'] div")].map(
    (el) => el.getAttribute("style") || "",
  );
  check("primeiro item ocupa a barra inteira", /width:\s*100%/.test(widths[0]), widths[0]);
  check("item menor tem barra proporcional", /width:\s*25%/.test(widths[1]), widths[1]);
  check("item zerado não tem largura", /width:\s*0%/.test(widths[2]), widths[2]);

  /* ------------------------------------------------------------------ */
  /* 6. Card de métrica e crescimento                                    */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.AnalyticsMetric, {
      label: "Pedido",
      value: "R$ 1,2 mil",
      rawValue: "R$ 1.234,56",
      growth: { current: 1200, previous: 1000, hasPreviousData: true },
    }),
  );
  check("valor abreviado aparece", text(root).includes("R$ 1,2 mil"));
  check(
    "valor completo fica no title (conferência sem ocupar espaço)",
    root.querySelector("[title]")?.getAttribute("title") === "R$ 1.234,56",
  );
  check("crescimento positivo aparece", text(root).includes("+20%"), text(root));

  root = await mount(
    h(LIB.AnalyticsMetric, {
      label: "Pedido",
      value: "R$ 1,2 mil",
      growth: { current: 3, previous: 0, hasPreviousData: true },
    }),
  );
  check(
    "base zero não vira porcentagem",
    text(root).includes("sem base") && !text(root).includes("Infinity"),
    text(root),
  );

  root = await mount(
    h(LIB.AnalyticsMetric, {
      label: "Pedido",
      value: "R$ 100",
      growth: { current: 80, previous: 100, hasPreviousData: true },
    }),
  );
  check("queda mostra sinal negativo", text(root).includes("−20%"), text(root));
  check(
    "queda não aparece como 'up'",
    !root.querySelector(".text-brand-700") || text(root).includes("−"),
  );

  /* ------------------------------------------------------------------ */
  /* 7. Pagamento: parcial é o caso normal                               */
  /* ------------------------------------------------------------------ */

  const order = {
    id: "o1",
    restaurant_id: "r1",
    table_id: "t1",
    table_name: "Mesa 01",
    order_number: 1001,
    status: "delivered",
    channel: "dine_in",
    subtotal: 45,
    fees: 0,
    discount: 0,
    total: 45,
    notes: null,
    created_at: "2026-11-21T20:00:00Z",
    updated_at: "2026-11-21T20:00:00Z",
    items: [],
    item_count: 0,
  };

  const recorded = [];
  root = await mount(
    h(LIB.PaymentSection, {
      order,
      payments: [
        {
          payment_id: "p1",
          amount: 30,
          method: "pix",
          status: "paid",
          paid_at: "2026-11-21T20:05:00Z",
          note: "entrada",
        },
        {
          payment_id: "p2",
          amount: 5,
          method: "cash",
          status: "refunded",
          paid_at: "2026-11-21T20:06:00Z",
          note: null,
        },
      ],
      onRecord: async (input) => {
        recorded.push(input);
        return null;
      },
      onRefund: async () => null,
    }),
  );

  check("total do pedido aparece", text(root).includes("45,00"), text(root));
  check("recebido soma só os pagos", text(root).includes("30,00"));
  check("saldo em aberto é a diferença", text(root).includes("15,00"), text(root));
  check("badge mostra o que falta", text(root).includes("em aberto"), text(root));
  check(
    "pagamento estornado marcado como estornado",
    text(root).includes("estornado"),
    text(root),
  );

  // Abre o formulário de recebimento
  const openButton = [...root.querySelectorAll("button")].find((el) =>
    text(el).includes("Registrar recebimento"),
  );
  check("existe botão de registrar recebimento", Boolean(openButton));

  await act(async () => {
    openButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  const input = root.querySelector('input[type="number"]');
  check("formulário abre com campo de valor", Boolean(input));
  check(
    "campo já vem com o saldo, não com o total",
    input?.value === "15.00",
    `recebi ${input?.value}; se vier 45, o segundo lançamento falha por excedente`,
  );
  check(
    "campo limita ao saldo",
    input?.getAttribute("max") === "15.00",
    input?.getAttribute("max"),
  );

  const methodButtons = [...root.querySelectorAll("button[aria-pressed]")];
  check("quatro formas de pagamento", methodButtons.length === 4, `${methodButtons.length}`);
  check("dinheiro é o padrão", methodButtons[0]?.getAttribute("aria-pressed") === "true");

  // Escolhe Pix e confirma
  const pix = methodButtons.find((el) => text(el).includes("Pix"));
  await act(async () => {
    pix.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  const confirm = [...root.querySelectorAll("button")].find((el) => text(el) === "Confirmar");
  await act(async () => {
    confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  check("lançamento enviado ao servidor", recorded.length === 1, JSON.stringify(recorded));
  check("valor do lançamento é o saldo", recorded[0]?.amount === "15.00", JSON.stringify(recorded));
  check("método escolhido é o do botão", recorded[0]?.method === "pix", JSON.stringify(recorded));

  /* ------------------------------------------------------------------ */
  /* 8. Pedido totalmente pago: sem botão de lançar                      */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.PaymentSection, {
      order,
      payments: [
        {
          payment_id: "p3",
          amount: 45,
          method: "cash",
          status: "paid",
          paid_at: "2026-11-21T20:05:00Z",
          note: null,
        },
      ],
      onRecord: async () => null,
      onRefund: async () => null,
    }),
  );
  check("quitação mostra 'Recebido'", text(root).includes("Recebido"), text(root));
  check(
    "pedido quitado não oferece novo lançamento",
    ![...root.querySelectorAll("button")].some((el) => text(el).includes("Registrar recebimento")),
  );
  check(
    "pedido quitado não mostra 'em aberto'",
    !text(root).includes("em aberto"),
    text(root),
  );

  /* ------------------------------------------------------------------ */
  /* 9. Erro do servidor aparece na tela                                 */
  /* ------------------------------------------------------------------ */

  root = await mount(
    h(LIB.PaymentSection, {
      order,
      payments: [],
      onRecord: async () => "O valor passa do total do pedido.",
      onRefund: async () => null,
    }),
  );

  const open2 = [...root.querySelectorAll("button")].find((el) =>
    text(el).includes("Registrar recebimento"),
  );
  await act(async () => {
    open2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const confirm2 = [...root.querySelectorAll("button")].find((el) => text(el) === "Confirmar");
  await act(async () => {
    confirm2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  const alert = root.querySelector('[role="alert"]');
  check("erro do banco é exibido", Boolean(alert), "erro silencioso faz o operador tentar de novo");
  check("mensagem de erro é legível", text(alert).includes("passa do total"), text(alert));

  /* ------------------------------------------------------------------ */
  /* 10. Alvos de toque                                                  */
  /* ------------------------------------------------------------------ */

  const small = [...root.querySelectorAll("button")].filter((el) => {
    // `tap-target` garante min-height; aqui só conferimos a classe, porque
    // jsdom não calcula layout.
    return !el.classList.contains("tap-target");
  });
  check("todo botão da seção tem alvo de toque", small.length === 0, `${small.length} sem tap-target`);

  /* ------------------------------------------------------------------ */
  /* Resultado                                                           */
  /* ------------------------------------------------------------------ */

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\nanalytics-ui: ${passed}/${results.length} PASS`);
  if (failed.length) {
    console.log("\nFalhas:");
    for (const item of failed) {
      console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    process.exit(1);
  }

  /*
   * `process.exit(0)` explícito, e não uma saída natural.
   *
   * O jsdom mantém `pretendToBeVisual` com um `requestAnimationFrame` interno
   * que nunca é cancelado enquanto a janela existir; somado a isso, os
   * `setTimeout` que o próprio harness agenda para o shim do rAF seguram o
   * event loop. O sintoma é o pior tipo: todas as checagens passam, o
   * resultado correto é impresso, e o comando **trava** — num CI isso é um job
   * pendurado até o timeout global. `dom.window.close()` sozinho não basta.
   */
  dom.window.close();
  process.exit(0);
})();
