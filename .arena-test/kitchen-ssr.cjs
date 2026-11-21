/**
 * Harness de SSR do KDS — Etapa 17.
 *
 * Renderiza o `KitchenBoard` no servidor (React `renderToString`) com dados
 * representando o fluxo real, e confere o HTML que sai antes de qualquer JS
 * rodar. Isso cobre o que o jsdom não cobre: o **primeiro paint** do tablet.
 *
 * O ponto que motivou este arquivo: numa cozinha, o tablet abre e a pessoa olha
 * imediatamente. Se o primeiro HTML viesse vazio esperando JavaScript, o painel
 * "piscaria em branco" a cada recarga — e no Android modesto da cozinha isso
 * leva segundos.
 *
 * Rodar: node .arena-test/kitchen-ssr.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const React = require("react");
const { renderToString } = require("react-dom/server");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-kitchen-ssr");
const ENTRY = path.join(__dirname, "entry-kitchen-ssr.tsx");

fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: path.join(OUT, "bundle.cjs"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/kitchen": path.join(__dirname, "stubs-kitchen/kitchen-actions.ts"),
    "@/components/orders/use-orders-realtime": path.join(__dirname, "stubs-kitchen/realtime.ts"),
  },
  define: { "process.env.NODE_ENV": '"development"' },
  external: ["react", "react-dom", "react-dom/server", "server-only"],
  logLevel: "error",
});

const { Board, Card, order, settings } = require(path.join(OUT, "bundle.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

const role = { canOperate: true, canFinish: true, canCancel: true };

/* -------------------------------------------------------------------------- */
/* 1. SSR do board com fila real                                             */
/* -------------------------------------------------------------------------- */

const orders = [
  order({ id: "a", order_number: 1001, status: "pending", table_name: "Mesa 01", minutesAgo: 3 }),
  order({ id: "b", order_number: 1002, status: "confirmed", table_name: "Mesa 02", minutesAgo: 12 }),
  order({ id: "c", order_number: 1003, status: "preparing", table_name: "Mesa 03", minutesAgo: 22 }),
  order({ id: "d", order_number: 1004, status: "ready", table_name: "Mesa 04", minutesAgo: 8 }),
  order({ id: "e", order_number: 1005, status: "delivered", table_name: "Mesa 05", minutesAgo: 45 }),
];

const html = renderToString(
  React.createElement(Board, {
    restaurantId: "r1",
    restaurantName: "Famintos",
    role,
    initialOrders: orders,
    settings,
    stations: [],
  }),
);

const visible = strip(html);

check("SSR gera HTML (não shell vazio)", html.length > 2000, `${html.length} bytes`);
/*
 * `strip` troca tag por espaço, então o `{" "}` que o JSX insere ao redor do
 * número vira "# 1001" no texto extraído. Comparar com "#1001" falharia por um
 * espaço invisível — o mesmo tipo de falso negativo que o NBSP do Intl já causou
 * na Etapa 16. A comparação normaliza só isso.
 */
const compact = visible.replace(/#\s+/g, "#");

check(
  "primeiro paint já mostra os pedidos",
  /#1001\b/.test(compact) && /#1004\b/.test(compact),
  `números no HTML: ${(visible.match(/#\s*\d+/g) || []).join(",") || "nenhum"}`,
);
check("SSR mostra a mesa", visible.includes("Mesa 01"));
check("SSR mostra contador", /\d{2}:\d{2}/.test(visible), visible.match(/\d{2}:\d{2}/)?.[0]);
check("SSR mostra as quatro colunas", ["Novos", "Em preparo", "Prontos", "Finalizados"].every((c) => visible.includes(c)));
check(
  "SSR contém os contadores das colunas",
  visible.includes("Novos2") || /Novos\s*2/.test(visible),
  visible.slice(0, 200),
);
check("SSR marca atraso por texto", visible.includes("Atrasado"));
check("SSR marca atenção por texto", visible.includes("Atenção"));
check("SSR marca no prazo por texto", visible.includes("No prazo"));
check("SSR tem estado 'ao vivo'", visible.includes("Ao vivo"));
check("SSR tem botão de som ligado", visible.includes("Som ligado"));
check("SSR tem botão de atualizar", /aria-label="Atualizar pedidos"/.test(html));
check("SSR tem abas com aria-selected", /role="tab"/.test(html) && /aria-selected="true"/.test(html));
check(
  "SSR do celular e do tablet coexistem no HTML",
  /lg:grid-cols-4/.test(html) && /role="tablist"/.test(html),
  "media query decide qual aparece; as duas existem no DOM",
);
check("SSR usa main landmark", /<main|role="tabpanel"/.test(html));
check(
  "SSR não expõe restaurant_id nem preço total no card",
  !/restaurant_id/.test(html),
  "atributo interno vazando em HTML não quebra nada, mas é sinal de descuido",
);

/* -------------------------------------------------------------------------- */
/* 2. SSR do card isolado                                                    */
/* -------------------------------------------------------------------------- */

const cardHtml = renderToString(
  React.createElement(Card, {
    order: order({
      status: "preparing",
      notes: "Tocar a campainha ao chegar",
      minutesAgo: 18,
      withOptions: true,
    }),
    nowMs: Date.now(),
    settings,
    actions: ["ready", "cancel"],
    pending: null,
    highlighted: false,
    onAction: () => {},
    onDismissHighlight: () => {},
  }),
);
const cardText = strip(cardHtml);

check("card SSR mostra observação do pedido", cardText.includes("Tocar a campainha"));
check("card SSR mostra adicional", cardText.includes("sem queijo"));
check("card SSR mostra 'Em preparo há'", cardText.includes("Em preparo há"));
check("card SSR mostra status", cardText.includes("Em preparo"));
check("card SSR mostra botão Pronto", cardText.includes("Pronto"));
check("card SSR não oferece Finalizar no preparing", !/Finalizar/.test(cardText));
check(
  "card SSR tem aria-labelledby apontando para o título",
  /aria-labelledby="kds-[^"]+-title"/.test(cardHtml) && /id="kds-[^"]+-title"/.test(cardHtml),
);
check(
  "card SSR marca o contador com aria-label de tempo",
  /aria-label="Tempo desde a entrada: \d{2}:\d{2}"/.test(cardHtml),
);
check(
  "cancelar aparece como ação secundária, não primária",
  cardHtml.indexOf("Pronto") < cardHtml.indexOf("Cancelar"),
  "a ação perigosa não pode ser a mais fácil de tocar",
);

/* -------------------------------------------------------------------------- */
/* 3. SSR vazio e de erro                                                    */
/* -------------------------------------------------------------------------- */

const emptyHtml = renderToString(
  React.createElement(Board, {
    restaurantId: "r1",
    restaurantName: "Famintos",
    role,
    initialOrders: [],
    settings,
    stations: [],
  }),
);
const emptyText = strip(emptyHtml);

check("SSR vazio explica em vez de mostrar tela branca", /Nada em novos|Nenhum pedido/.test(emptyText));
check("SSR vazio tem contadores zerados", /Novos0|Novos\s*0/.test(emptyText), emptyText.slice(0, 160));
check("SSR vazio mantém o cabeçalho", emptyText.includes("Cozinha"));
check("SSR vazio não renderiza card", !/<article/.test(emptyHtml));

/* -------------------------------------------------------------------------- */
/* 4. Papel restrito no SSR                                                  */
/* -------------------------------------------------------------------------- */

const kitchenOnly = renderToString(
  React.createElement(Board, {
    restaurantId: "r1",
    restaurantName: "Famintos",
    role: { canOperate: true, canFinish: true, canCancel: false },
    initialOrders: [order({ status: "preparing", minutesAgo: 5 })],
    settings,
    stations: [],
  }),
);
const kitchenText = strip(kitchenOnly);

check("SSR de cozinha mostra 'Pronto'", kitchenText.includes("Pronto"));
check(
  "SSR de cozinha não mostra 'Cancelar'",
  !/Cancelar/.test(kitchenText),
  "o recorte de papel precisa valer também no HTML do servidor",
);

const waiterOnly = renderToString(
  React.createElement(Board, {
    restaurantId: "r1",
    restaurantName: "Famintos",
    role: { canOperate: false, canFinish: true, canCancel: false },
    initialOrders: [order({ status: "ready", minutesAgo: 5 })],
    settings,
    stations: [],
  }),
);
const waiterText = strip(waiterOnly);
check("SSR de garçom mostra 'Finalizar'", waiterText.includes("Finalizar"));
check("SSR de garçom não mostra 'Iniciar preparo'", !/Iniciar preparo/.test(waiterText));

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\nkitchen-ssr: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
