/**
 * Harness de SSR da impressão — Etapa 18.
 *
 * Renderiza a configuração e o cupom no servidor com `renderToString` e confere
 * o HTML que sai **antes de qualquer JavaScript**. Isso cobre o que o jsdom não
 * cobre:
 *
 *   • o cupom chega pronto no primeiro paint (num tablet de cozinha, esperar
 *     hidratação para ver o pedido é o mesmo que não ver);
 *   • o texto do cupom não depende de JS para existir;
 *   • a configuração já sai com os valores do banco (nunca "carregando");
 *   • quem não é admin vê a tela travada já no HTML, não depois.
 *
 * Rodar: node .arena-test/print-ssr.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const React = require("react");
const { renderToString } = require("react-dom/server");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-print-ssr");
const ENTRY = path.join(__dirname, "entry-print-ssr.tsx");

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
    "@/actions/printing": path.join(__dirname, "stubs-print/print-actions.ts"),
  },
  define: { "process.env.NODE_ENV": '"development"' },
  // React fora do bundle: sem isto o bundle traz a própria cópia do React e o
  // `renderToString` de fora vê `useState` como null ("invalid hook call").
  external: ["react", "react-dom", "react-dom/server", "server-only"],
  logLevel: "error",
});

const L = require(path.join(OUT, "bundle.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/** HTML → texto comparável. `{" "}` do JSX vira espaço; `#\n 1042` não. */
function strip(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

const render = (element) => renderToString(React.createElement(React.Fragment, null, element));

/* -------------------------------------------------------------------------- */
/* 1. Cupom no primeiro paint                                                 */
/* -------------------------------------------------------------------------- */

const doc = L.sampleDocument();
const ticketHtml = render(
  React.createElement(L.OrderTicket, { document: doc, width: "80" }),
);
const ticketText = strip(ticketHtml);

check("cupom sai no HTML", ticketHtml.length > 200, `${ticketHtml.length} bytes`);
check("HTML do cupom é <pre>", /^<pre/.test(ticketHtml), ticketHtml.slice(0, 20));
check("cupom tem data-paper", /data-paper="80"/.test(ticketHtml));
check("cupom traz o restaurante", /Famintos Burger/.test(ticketText));
check("cupom traz o número", /#1042/.test(ticketText), ticketText.slice(0, 120));
check("cupom traz a mesa", /Mesa 07/.test(ticketText));
check("cupom traz os itens", /X-Bacon/.test(ticketText) && /Coca-Cola/.test(ticketText));
check("cupom traz o total", /TOTAL/.test(ticketText) && /45,00/.test(ticketText));
check("cupom tem rótulo acessível", /aria-label="Cupom de impressão"/.test(ticketHtml));

const ticket58Html = render(
  React.createElement(L.OrderTicket, { document: doc, width: "58" }),
);
check("cupom de 58mm declara o papel", /data-paper="58"/.test(ticket58Html));
check(
  "as duas larguras geram conteúdo diferente",
  ticket58Html !== ticketHtml.replace('data-paper="80"', 'data-paper="58"'),
  "se fossem iguais, a largura escolhida não estaria sendo usada",
);

const kitchenTicket = strip(
  render(React.createElement(L.OrderTicket, { document: doc, width: "80", showPrices: false })),
);
check("versão de cozinha sai sem total", !kitchenTicket.includes("TOTAL"));
check("versão de cozinha mantém o pedido", kitchenTicket.includes("#1042"));

check(
  "as linhas do cupom no HTML não passam de 48 colunas",
  L.buildTicketLines(doc, { width: "80" }).every((line) => line.length <= 48),
);

/* -------------------------------------------------------------------------- */
/* 2. Documento com dados reais                                               */
/* -------------------------------------------------------------------------- */

const withNotes = L.sampleDocument({
  notes: "Entregar no fundo da loja",
  items: [
    {
      name: "X-Bacon",
      quantity: 1,
      unit_price: 20,
      subtotal: 20,
      notes: "sem cebola",
      options: [{ group_name: "Ponto", name: "Ao ponto", price_delta: 0, quantity: 1 }],
    },
  ],
  payments: [{ method: "pix", amount: 20, paid_at: "2026-11-21T21:05:00Z" }],
});
const notesText = strip(render(React.createElement(L.OrderTicket, { document: withNotes, width: "80" })));
check("observação do pedido no HTML", /fundo da loja/.test(notesText));
check("observação do item no HTML", /sem cebola/.test(notesText));
check("adicional no HTML", /Ao ponto/.test(notesText));
check("pagamento no HTML", /Pix/.test(notesText));

const noPayments = strip(render(React.createElement(L.OrderTicket, { document: doc, width: "80" })));
check(
  "sem pagamento, nenhuma forma aparece no HTML",
  !/Pix|Dinheiro|Cartão/.test(noPayments),
  "escrever 'não pago' no papel da cozinha seria inventar dado",
);

check("cupom de teste renderiza", L.buildTestLines("80", "Famintos").length > 10);
const testHtml = strip(
  render(
    React.createElement(L.ThermalTicket, {
      lines: L.buildTestLines("58", "Famintos"),
      width: "58",
    }),
  ),
);
check("teste mostra a régua", /\.\.\.\.\./.test(testHtml));
check("teste mostra as colunas", /32/.test(testHtml));

/* -------------------------------------------------------------------------- */
/* 3. Configuração no primeiro paint                                          */
/* -------------------------------------------------------------------------- */

const emptyConfig = L.config();
const configHtml = render(React.createElement(L.PrintConfigForm, { initialConfig: emptyConfig }));
const configText = strip(configHtml);

check("configuração renderiza no servidor", configHtml.length > 2000, `${configHtml.length} bytes`);
check("aviso do navegador no HTML", /O que o navegador consegue fazer/.test(configText));
check(
  "aviso de que a térmica é escolhida na janela",
  /escolhe a térmica nessa janela/i.test(configText),
);
check("seções expansíveis no HTML", /<details/.test(configHtml));
check("resumo do estado no HTML", /Como está hoje/.test(configText));
check("elemento manual vem marcado", /aria-checked="true"/.test(configHtml));
check("estado vazio de perfis no HTML", /Nenhum perfil configurado/.test(configText));
check(
  "modo atual aparece já no HTML (sem 'carregando')",
  /Manual/.test(configText),
);

const autoConfig = L.config({
  settings: {
    ...emptyConfig.settings,
    mode: "auto",
    default_paper_width: "58",
    copies: 2,
    footer_note: "Obrigado!",
  },
});
const autoText = strip(render(React.createElement(L.PrintConfigForm, { initialConfig: autoConfig })));
check("modo automático aparece no HTML", /Automática/.test(autoText));
check("aviso do bloqueio do navegador no HTML", /pode bloquear|confirmar a janela/i.test(autoText));
check("papel 58mm aparece no HTML", /58mm/.test(autoText));
check("rodapé salvo aparece no HTML", /Obrigado!/.test(autoText));

const closedConfig = L.config({ can_configure: false });
const closedText = strip(render(React.createElement(L.PrintConfigForm, { initialConfig: closedConfig })));
check("quem não configura vê o aviso no HTML", /Só administradores e gerentes/.test(closedText));
check(
  "interruptores saem desabilitados no HTML",
  /role="switch"[^>]*disabled/.test(configHtml.replace(/aria-checked/g, "aria-checked")) ||
    /disabled=""[^>]*role="switch"/.test(render(React.createElement(L.PrintConfigForm, { initialConfig: closedConfig }))),
  "o HTML já precisa nascer travado — esperar o JS deixaria o clique disponível",
);

const withProfile = L.config({
  profiles: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Cozinha",
      slug: "cozinha",
      kind: "kitchen",
      paper_width: "58",
      copies: 1,
      is_active: true,
      sort_order: 0,
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Bar",
      slug: "bar",
      kind: "bar",
      paper_width: "80",
      copies: 1,
      is_active: false,
      sort_order: 1,
    },
  ],
});
const profileText = strip(render(React.createElement(L.PrintConfigForm, { initialConfig: withProfile })));
check("perfil aparece no HTML", /Cozinha/.test(profileText));
check("perfil inativo marcado no HTML", /off/.test(profileText));
check("papel do perfil no HTML", /58mm/.test(profileText));

const withPrinter = L.config({
  printers: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      profile_id: null,
      name: "Térmica Cozinha",
      provider: "browser",
      identifier: null,
      paper_width: "58",
      is_default: true,
      is_active: true,
      notes: null,
    },
  ],
});
const printerText = strip(render(React.createElement(L.PrintConfigForm, { initialConfig: withPrinter })));
check("impressora no HTML", /Térmica Cozinha/.test(printerText));
check("padrão marcado no HTML", /padrão/.test(printerText));

/* -------------------------------------------------------------------------- */
/* 4. Página de teste                                                         */
/* -------------------------------------------------------------------------- */

const testPanelHtml = render(
  React.createElement(L.PrintTestPanel, { paperWidth: "58", restaurantName: "Famintos" }),
);
const testPanelText = strip(testPanelHtml);
check("painel de teste no HTML", /Imprimir teste/.test(testPanelText));
check("explica o que conferir", /régua vai até o fim/i.test(testPanelText));
check("tem botão de imprimir teste", /Imprimir teste/.test(testPanelText));
/*
 * A cópia que sai no papel existe sempre no HTML (é ela que o botão imprime),
 * mas nasce escondida na tela: `hidden print:block`. O que não pode existir é a
 * prévia visível antes do toque — o teste antigo reprovava a cópia de impressão
 * junto com a prévia.
 */
check(
  "a área de impressão nasce escondida na tela",
  /class="[^"]*hidden[^"]*print:block/.test(testPanelHtml),
  "sem isso, o cupom de teste apareceria solto no meio da configuração",
);
check(
  "só existe uma área de cupom antes do toque",
  (testPanelHtml.match(/<pre/g) ?? []).length === 1,
  String((testPanelHtml.match(/<pre/g) ?? []).length),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\nprint-ssr: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
