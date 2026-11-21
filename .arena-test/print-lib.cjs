/**
 * Harness das regras de impressão — Etapa 18.
 *
 * Compila `src/lib/printing.ts` (puro) e testa o que dá errado silenciosamente
 * num cupom térmico:
 *
 *   • linha mais larga que o papel (sai cortada, e ninguém vê até a bobina);
 *   • valor que "desaparece" porque o nome do item empurrou o preço;
 *   • palavra cortada no meio;
 *   • cobrança de "impresso" quando o navegador não sabe se imprimiu;
 *   • forma de pagamento inventada em pedido sem recebimento;
 *   • acento que vira duas colunas e desalinha a régua do teste.
 *
 * Rodar: node .arena-test/print-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-print-lib");

fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/printing.ts")],
  bundle: true,
  outfile: path.join(OUT, "printing.cjs"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(ROOT, "src") },
  external: ["server-only"],
  logLevel: "error",
});

const P = require(path.join(OUT, "printing.cjs"));
const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/0018_printing.sql"), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* -------------------------------------------------------------------------- */
/* 1. Especificação de papel                                                   */
/* -------------------------------------------------------------------------- */

check("58mm existe", P.PAPER_SPECS["58"] !== undefined);
check("80mm existe", P.PAPER_SPECS["80"] !== undefined);

check(
  "58mm imprime 32 colunas",
  P.PAPER_SPECS["58"].columns === 32,
  String(P.PAPER_SPECS["58"].columns),
);
check(
  "80mm imprime 48 colunas",
  P.PAPER_SPECS["80"].columns === 48,
  String(P.PAPER_SPECS["80"].columns),
);
check(
  "área útil de 58mm é 48mm (não 58)",
  P.PAPER_SPECS["58"].printableMm === 48,
  `${P.PAPER_SPECS["58"].printableMm} — usar o nominal faz a última coluna cair fora`,
);
check(
  "área útil de 80mm é 72mm (não 80)",
  P.PAPER_SPECS["80"].printableMm === 72,
  String(P.PAPER_SPECS["80"].printableMm),
);
check("spec inválida cai no padrão 80", P.paperSpec("999").width === "80");
check("normalizePaperWidth aceita 58", P.normalizePaperWidth("58") === "58");
check("normalizePaperWidth rejeita lixo", P.normalizePaperWidth("76") === "80");
check("normalizePaperWidth trata null", P.normalizePaperWidth(null) === "80");

/* -------------------------------------------------------------------------- */
/* 2. Quebra de linha                                                         */
/* -------------------------------------------------------------------------- */

check("texto vazio não gera linha", P.wrapText("", 32).length === 0);
check("só espaços não gera linha", P.wrapText("    ", 32).length === 0);

const short = P.wrapText("Coca-Cola", 32);
check("texto curto fica numa linha", short.length === 1 && short[0] === "Coca-Cola");

const long = P.wrapText(
  "X-Bacon duplo com cheddar, cebola caramelizada e molho especial da casa",
  32,
);
check("texto longo quebra em várias linhas", long.length > 1, `${long.length} linhas`);
check(
  "nenhuma linha passa de 32 colunas",
  long.every((line) => line.length <= 32),
  long.map((l) => l.length).join(","),
);
check(
  "nenhuma palavra é cortada no meio",
  long.every((line) => line.split(" ").every((word) => word.length <= 32)),
);

const huge =
  "SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious";
const hugeLines = P.wrapText(huge, 32);
check(
  "palavra maior que a linha é fatiada",
  hugeLines.length === Math.ceil(huge.length / 32),
  `${hugeLines.length} fatias para ${huge.length} caracteres em 32 colunas`,
);
check(
  "fatia não entra em laço nem perde caractere",
  hugeLines.join("").length === huge.length,
  `${hugeLines.join("").length} vs ${huge.length}`,
);

const multiple = P.wrapText("  muito    espaço   entre   palavras  ", 32);
check(
  "espaços repetidos são normalizados",
  multiple.length === 1 && multiple[0] === "muito espaço entre palavras",
  JSON.stringify(multiple),
);

/* -------------------------------------------------------------------------- */
/* 3. Alinhamento                                                             */
/* -------------------------------------------------------------------------- */

const just = P.justify("TOTAL", "R$ 45,00", 32);
check("justify ocupa exatamente a largura", just.length === 32, `${just.length}: "${just}"`);
check("justify alinha à esquerda", just.startsWith("TOTAL"));
check("justify alinha à direita", just.endsWith("R$ 45,00"));

const tight = P.justify("Um nome de item bastante comprido mesmo", "R$ 1.234,56", 32);
check("justify sem espaço quebra em vez de estourar", tight.split("\n").every((l) => l.length <= 32));
check("justify sem espaço mantém o valor", tight.endsWith("R$ 1.234,56"));

const centered = P.center("COZINHA", 32);
check("center devolve uma linha", centered.length === 1);
check("center não passa da largura", centered[0].length <= 32);
check("center começa com espaço", centered[0].startsWith(" "));
check(
  "center centraliza com recuo de meio caractere",
  // Papel térmico não tem margem direita útil: o recuo é só à esquerda, e o
  // que se exige é que a sobra de espaço seja ≤ 1 coluna.
  centered[0].length - "COZINHA".length === Math.floor((32 - "COZINHA".length) / 2),
  `"${centered[0]}"`,
);

check("separator tem a largura pedida", P.separator(32) === "-".repeat(32));
check("separator aceita outro caractere", P.separator(4, "=") === "====");

/* -------------------------------------------------------------------------- */
/* 4. Dinheiro e data                                                         */
/* -------------------------------------------------------------------------- */

const money = P.money(45);
check("money formata em real", money.includes("45,00"), money);
check("money trata NaN", P.money(Number.NaN).includes("0,00"), P.money(Number.NaN));
check("money trata negativo", P.money(-2.5).includes("2,50"), P.money(-2.5));

const dt = P.dateTimeInZone("2026-11-21T21:00:00Z", "America/Sao_Paulo");
check("data sai no fuso da casa (18:00)", dt.includes("18:00"), dt);
check("data tem dia e ano", dt.includes("21/11/2026"), dt);

/* -------------------------------------------------------------------------- */
/* 5. Documento                                                               */
/* -------------------------------------------------------------------------- */

function doc(overrides = {}) {
  return {
    restaurant: {
      id: "r1",
      name: "Famintos Burger",
      phone: null,
      address: "Rua A, 10",
      city: "Chorozinho",
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
      notes: null,
      created_at: "2026-11-21T21:00:00Z",
      updated_at: "2026-11-21T21:00:00Z",
      items: [
        {
          name: "X-Bacon",
          quantity: 2,
          unit_price: 20,
          subtotal: 40,
          notes: null,
          options: [],
        },
        {
          name: "Coca-Cola lata",
          quantity: 1,
          unit_price: 5,
          subtotal: 5,
          notes: null,
          options: [],
        },
      ],
      payments: [],
    },
    ...overrides,
  };
}

function lines80(overrides = {}, options = {}) {
  return P.buildTicketLines(doc(overrides), { width: "80", ...options });
}

const ticket = lines80();
const ticketText = ticket.join("\n");

check("cupom mostra o nome do restaurante", ticketText.includes("Famintos Burger"));
check("cupom mostra o número do pedido", ticketText.includes("#1042"), ticketText.split("\n")[2]);
check("cupom mostra a mesa", ticketText.includes("Mesa 07"));
check("cupom mostra data e hora", ticketText.includes("18:00"), ticketText);
check("cupom mostra os itens", ticketText.includes("X-Bacon") && ticketText.includes("Coca-Cola lata"));
check("cupom mostra a quantidade", ticketText.includes("2x X-Bacon"), ticketText.split("\n").find((l) => l.includes("X-Bacon")));
check("cupom mostra o total", ticketText.includes("TOTAL"));
check("cupom mostra o valor", ticketText.includes("45,00"));

check(
  "nenhuma linha do cupom de 80mm passa de 48 colunas",
  ticket.every((line) => line.length <= 48),
  ticket.filter((l) => l.length > 48).slice(0, 3).join(" | "),
);

const ticket58 = P.buildTicketLines(doc(), { width: "58" });
check(
  "nenhuma linha do cupom de 58mm passa de 32 colunas",
  ticket58.every((line) => line.length <= 32),
  ticket58.filter((l) => l.length > 32).slice(0, 3).join(" | "),
);
check(
  "cupom de 58mm continua tendo o número do pedido",
  ticket58.join("\n").includes("#1042"),
);
// Uma observação longa é onde a diferença de largura aparece de verdade: no
// cupom curto as duas larguras coincidem porque os itens cabem inteiros.
const wideNote = "Entregar no fundo da loja, sem talheres, com guardanapo extra e duas caixinhas";
const note58 = P.buildTicketLines(
  doc({ order: { ...doc().order, notes: wideNote } }),
  { width: "58" },
);
const note80 = P.buildTicketLines(
  doc({ order: { ...doc().order, notes: wideNote } }),
  { width: "80" },
);
check(
  "observação longa ocupa mais linhas em 58mm que em 80mm",
  note58.length > note80.length,
  `${note58.length} vs ${note80.length}`,
);

/* Pagamento: só quando real. */
check(
  "pedido sem pagamento não imprime forma de pagamento",
  !ticketText.includes("Dinheiro") && !ticketText.includes("Pix"),
  "a cozinha não deve ler 'não pago' num pedido que ninguém registrou",
);

const paidTicket = lines80({
  order: {
    ...doc().order,
    payments: [{ method: "pix", amount: 45, paid_at: "2026-11-21T21:05:00Z" }],
  },
}).join("\n");
check("pagamento registrado aparece no cupom", paidTicket.includes("Pix"), paidTicket);

const halfPaid = lines80({
  order: {
    ...doc().order,
    payments: [
      { method: "cash", amount: 20, paid_at: "2026-11-21T21:05:00Z" },
      { method: "card", amount: 25, paid_at: "2026-11-21T21:06:00Z" },
    ],
  },
}).join("\n");
check("pagamento misto imprime as duas formas", halfPaid.includes("Dinheiro") && halfPaid.includes("Cartão"));

const zeroPaid = lines80({
  order: {
    ...doc().order,
    payments: [{ method: "pix", amount: 0, paid_at: "2026-11-21T21:05:00Z" }],
  },
}).join("\n");
check("pagamento de valor zero é ignorado", !zeroPaid.includes("Pix"));

/* Observações. */
const withNotes = lines80({
  order: {
    ...doc().order,
    notes: "Entregar no fundo da loja, sem talheres",
    items: [
      {
        name: "X-Bacon",
        quantity: 1,
        unit_price: 20,
        subtotal: 20,
        notes: "sem cebola e bem passado",
        options: [{ group_name: "Ponto", name: "Ao ponto", price_delta: 0, quantity: 1 }],
      },
    ],
  },
}).join("\n");

check("observação do pedido aparece", withNotes.includes("OBSERVACAO DO PEDIDO"));
check("texto da observação aparece", withNotes.includes("sem talheres"));
check("observação do item aparece", withNotes.includes("OBS: sem cebola"));
check("adicional aparece no cupom", withNotes.includes("+ Ao ponto"));

/* Preço desligado (cozinha). */
const kitchen = lines80({}, { showPrices: false }).join("\n");
check("sem preços: não mostra TOTAL", !kitchen.includes("TOTAL"));
check("sem preços: não mostra valor do item", !kitchen.includes("40,00"));
check("sem preços: ainda mostra os itens", kitchen.includes("X-Bacon"));

/* Nome enorme não estoura. */
const longName = lines80({
  order: {
    ...doc().order,
    items: [
      {
        name: "Hambúrguer artesanal de costela desfiada com queijo brie e cebola crispy",
        quantity: 1,
        unit_price: 39.9,
        subtotal: 39.9,
        notes: null,
        options: [],
      },
    ],
  },
});
check(
  "item com nome enorme fica dentro da largura",
  longName.every((line) => line.length <= 48),
  longName.filter((l) => l.length > 48).join(" | "),
);

/* Vias. */
check("via principal não imprime rótulo", !ticketText.includes("2ª via"));
check(
  "cópia imprime o rótulo da via",
  lines80({}, { copyLabel: "Cozinha" }).join("\n").includes("Cozinha"),
);

/* Rodapé. */
const withFooter = lines80({
  settings: { ...doc().settings, footer_note: "Obrigado pela preferência!" },
}).join("\n");
check("rodapé aparece no fim do cupom", withFooter.includes("Obrigado pela preferência!"));

/* Cupom de teste. */
const test58 = P.buildTestLines("58", "Famintos");
const test80 = P.buildTestLines("80", "Famintos");
check("teste tem cabeçalho", test58.join("\n").includes("TESTE DE IMPRESSAO"));
check("teste informa a largura", test58.join("\n").includes("58mm"));
check("teste informa as colunas", test58.join("\n").includes("32"));
check(
  "teste não passa de 32 colunas em 58mm",
  test58.every((line) => line.length <= 32),
  test58.filter((l) => l.length > 32).join(" | "),
);
check(
  "teste não passa de 48 colunas em 80mm",
  test80.every((line) => line.length <= 48),
  test80.filter((l) => l.length > 48).join(" | "),
);
check("teste tem régua", /^[.\d]+$/.test(test58.find((l) => l.startsWith(".")) ?? ""));
check("teste tem linha de borda", test58.some((l) => l.startsWith("|") && l.endsWith("|")));
check(
  "linha de borda ocupa a largura toda",
  test58.find((l) => l.startsWith("|"))?.length === 32,
  String(test58.find((l) => l.startsWith("|"))?.length),
);
check("teste mostra alinhamento à direita", test58.some((l) => l.startsWith("Esquerda") && l.endsWith("Direita")));

check(
  "ticketText junta as linhas com quebra",
  P.ticketText(doc(), { width: "80" }).split("\n").length === ticket.length,
);

/* -------------------------------------------------------------------------- */
/* 6. Honestidade do status                                                   */
/* -------------------------------------------------------------------------- */

check(
  "navegador nunca resolve como 'printed'",
  P.resolveJobStatus("browser") === "requested",
  P.resolveJobStatus("browser"),
);
check("bridge (não implementado) resolve como unsupported", P.resolveJobStatus("bridge") === "unsupported");
check("web_print resolve como unsupported", P.resolveJobStatus("web_print") === "unsupported");
check("service resolve como unsupported", P.resolveJobStatus("service") === "unsupported");
check("os resolve como unsupported", P.resolveJobStatus("os") === "unsupported");
check("browser está disponível", P.providerIsAvailable("browser") === true);
check("bridge não está disponível", P.providerIsAvailable("bridge") === false);
check("jobStatusLabel traduz", P.jobStatusLabel("requested") === "Solicitada");

/* -------------------------------------------------------------------------- */
/* 7. Cópias e limites                                                        */
/* -------------------------------------------------------------------------- */

check("copies 0 vira 1", P.normalizeCopies(0) === 1);
check("copies 9 vira 3", P.normalizeCopies(9) === 3);
check("copies 2 fica 2", P.normalizeCopies(2) === 2);
check("copies '2' (string) vira 2", P.normalizeCopies("2") === 2);
check("copies NaN vira 1", P.normalizeCopies("abc") === 1);
check("FOOTER_NOTE_MAX é 120", P.FOOTER_NOTE_MAX === 120);

/* -------------------------------------------------------------------------- */
/* 8. Migration — o que o harness não pode deixar regredir                    */
/* -------------------------------------------------------------------------- */

check("settings é uma linha por restaurante", /restaurant_id\s+uuid primary key/.test(sql));
check("print_settings liga ao restaurante", /references public\.restaurants \(id\) on delete cascade/.test(sql));
check("quatro tipos de perfil", /'kitchen', 'counter', 'bar', 'cashier'/.test(sql));
check("cinco provedores declarados", /'browser', 'os', 'web_print', 'bridge', 'service'/.test(sql));
check("paper width é 58/80", /print_paper_width as enum \('58', '80'\)/.test(sql));
check("RLS habilitado em print_settings", /alter table public\.print_settings enable row level security/.test(sql));
check("RLS habilitado em print_profiles", /alter table public\.print_profiles enable row level security/.test(sql));
check("RLS habilitado em printers", /alter table public\.printers enable row level security/.test(sql));
check("RLS habilitado em print_jobs", /alter table public\.print_jobs enable row level security/.test(sql));
check(
  "print_jobs não tem policy de insert/delete",
  !/create policy[^;]*print_jobs[^;]*for (insert|delete|all)/i.test(sql),
  "histórico de impressão é escrito só por RPC",
);
check(
  "uma impressora padrão por casa",
  /create unique index if not exists printers_one_default_idx[\s\S]*?where is_default/.test(sql),
);
check(
  "configurar exige is_restaurant_admin",
  /create or replace function public\.print_can_configure[\s\S]*?is_restaurant_admin/.test(sql),
);
check(
  "imprimir inclui o papel kitchen",
  /create or replace function public\.print_can_view[\s\S]*?'kitchen'/.test(sql),
);
check(
  "get_print_order lê pagamentos reais",
  /get_print_order[\s\S]*?from public\.order_payments/.test(sql),
);
check(
  "get_print_order filtra status paid",
  /order_payments pay[\s\S]*?pay\.status = 'paid'/.test(sql),
);
check(
  "get_print_order lê adicionais",
  /get_print_order[\s\S]*?order_item_options/.test(sql),
);
check(
  "log_print_job confere o vínculo do pedido",
  /log_print_job[\s\S]*?public\.print_can_view\(o\.restaurant_id\)/.test(sql),
);
check(
  "log_print_job ignora impressora de outro tenant",
  /where pr\.id = p_printer_id and pr\.restaurant_id = v_restaurant/.test(sql),
);
check(
  "perfil só aceita impressora da mesma casa",
  /profile_not_found[\s\S]*?pp\.restaurant_id = p_restaurant_id/.test(sql),
);
check(
  "seed cria os quatro perfis do escopo",
  /seed_default_print_profiles[\s\S]*?'Cozinha'[\s\S]*?'Balcão'[\s\S]*?'Bar'[\s\S]*?'Caixa'/.test(sql),
);
check(
  "seed é idempotente por slug",
  /on conflict \(restaurant_id, slug\) do nothing/.test(sql),
);
check(
  "nenhuma tabela de impressão duplica pedidos",
  !/create table[^;]*print[^;]*order_id uuid not null references public\.orders/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\nprint-lib: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
