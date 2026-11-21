/**
 * Harness da lógica do WhatsApp — Etapa 13.
 *
 * Testa `src/lib/whatsapp.ts`, que é **código puro**: sem banco, sem React, sem
 * `server-only`. É a mesma função usada pelo cardápio público, pelo painel e
 * pela camada de provedor, então um erro aqui aparece nos três lugares.
 *
 * A parte que mais importa: o link. Um `wa.me` com número malformado abre o
 * WhatsApp na tela de escolher contato (parece bug do app) e uma mensagem com
 * caractere não codificado quebra a URL — nos dois casos o cliente desiste.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-whatsapp");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/whatsapp.ts")],
  bundle: true,
  outfile: path.join(OUT, "whatsapp.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "error",
});

const W = require(path.join(OUT, "whatsapp.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ------------------------------------------- 1. normalização de número */

const NORMALIZE = [
  // [entrada, esperado]
  ["(11) 99999-0000", "5511999990000"],
  ["11 99999 0000", "5511999990000"],
  ["11999990000", "5511999990000"],
  ["1199990000", "551199990000"], // fixo: 10 dígitos, DDD 11
  ["(11) 9999-0000", "551199990000"], // sem o nono dígito (número antigo)
  ["011 99999-0000", "5511999990000"], // zero de discagem não é DDD
  ["5511999990000", "5511999990000"], // já com DDI
  ["+55 (11) 99999-0000", "5511999990000"],
  ["+55 11 99999-0000", "5511999990000"],
  ["+351 912 345 678", "351912345678"], // o "+" manda
  ["+1 415 555 2671", "14155552671"],
  ["  (21) 98888-7777  ", "5521988887777"],
];

for (const [input, expected] of NORMALIZE) {
  check(`normaliza "${input}"`, W.normalizeWhatsappNumber(input) === expected, String(W.normalizeWhatsappNumber(input)));
}

const INVALID = [
  ["", "vazio"],
  ["   ", "só espaço"],
  [null, "null"],
  [undefined, "undefined"],
  ["1234", "curto demais"],
  ["abc", "sem dígito"],
  // Ramal não é recusa: o número principal é inequívoco, então ele é cortado.
  // (testado logo abaixo como normalização)
  ["000000000", "tudo zero"],
  ["1000000000", "DDD 10 não existe"],
  ["2000000000", "DDD 20 não existe"],
  ["3000000000", "DDD 30 não existe"],
  ["+55 10 99999-0000", "DDD 10 com DDI"],
  ["1234567890123456", "16 dígitos (acima do E.164)"],
];

for (const [input, label] of INVALID) {
  check(`recusa ${label}`, W.normalizeWhatsappNumber(input) === null, String(W.normalizeWhatsappNumber(input)));
}

// Ramal e anotação: o número principal continua valendo.
check(
  "descarta ramal colado",
  W.normalizeWhatsappNumber("(11) 99999-0000 ramal 22") === "5511999990000",
  String(W.normalizeWhatsappNumber("(11) 99999-0000 ramal 22")),
);
check(
  "descarta opção colada",
  W.normalizeWhatsappNumber("11 99999-0000 opção 2") === "5511999990000",
  String(W.normalizeWhatsappNumber("11 99999-0000 opção 2")),
);
check(
  "não confunde ramal com o número",
  W.normalizeWhatsappNumber("11 99999-0000 ramal 3333") === "5511999990000",
  String(W.normalizeWhatsappNumber("11 99999-0000 ramal 3333")),
);

check("isValidWhatsappNumber concorda com normalize", (() => {
  const cases = ["11999990000", "1234", "5511999990000", ""];
  return cases.every((value) => W.isValidWhatsappNumber(value) === (W.normalizeWhatsappNumber(value) !== null));
})());

/* ------------------------------------------------ 2. formatação amigável */

check("formata celular brasileiro", W.formatWhatsappNumber("5511999990000") === "(11) 99999-0000", W.formatWhatsappNumber("5511999990000"));
check("formata fixo brasileiro", W.formatWhatsappNumber("551199990000") === "(11) 9999-0000", W.formatWhatsappNumber("551199990000"));
check(
  "formata estrangeiro com +",
  W.formatWhatsappNumber("+351 912 345 678") === "+351912345678",
  W.formatWhatsappNumber("+351 912 345 678"),
);
check("formata a partir do texto cru", W.formatWhatsappNumber("(11) 99999-0000") === "(11) 99999-0000");
check("inválido formata como vazio", W.formatWhatsappNumber("1234") === "");
check("null formata como vazio", W.formatWhatsappNumber(null) === "");

/* ------------------------------------------------ 3. codificação do texto */

check(
  "codifica acentos",
  W.encodeWhatsappText("Olá, tudo bem?") === "Ol%C3%A1%2C%20tudo%20bem%3F",
  W.encodeWhatsappText("Olá, tudo bem?"),
);
check(
  "codifica '!' (quebraria o link em HTML)",
  W.encodeWhatsappText("Olá!") === "Ol%C3%A1%21",
  W.encodeWhatsappText("Olá!"),
);
check(
  "mensagem completa do escopo é codificada sem caractere cru",
  // O texto de exemplo do escopo, com os caracteres que o encodeURIComponent
  // deixaria passar — nenhum pode sobrar.
  !/[ '!()*]/.test(W.encodeWhatsappText("Olá! Gostaria de fazer um pedido.")),
  W.encodeWhatsappText("Olá! Gostaria de fazer um pedido."),
);
check(
  "codifica apóstrofo (nome de produto)",
  !W.encodeWhatsappText("Batata d'oro").includes("'"),
  W.encodeWhatsappText("Batata d'oro"),
);
check(
  "codifica parênteses e asteriscos",
  !/[!'()*]/.test(W.encodeWhatsappText("(teste) *x*!")),
  W.encodeWhatsappText("(teste) *x*!"),
);
check("codifica quebra de linha", W.encodeWhatsappText("a\nb") === "a%0Ab", W.encodeWhatsappText("a\nb"));
check("codifica emoji sem quebrar", W.encodeWhatsappText("🍔") === "%F0%9F%8D%94", W.encodeWhatsappText("🍔"));
check("o resultado é decodificável de volta", decodeURIComponent(W.encodeWhatsappText("Ação & Cia #1")) === "Ação & Cia #1");

/* ------------------------------------------------------------- 4. link */

{
  const link = W.buildWhatsappLink({ phone: "(11) 99999-0000", message: "Olá! Gostaria de fazer um pedido." });
  check("link usa wa.me", link.startsWith("https://wa.me/"), link);
  check("link tem o número normalizado", link.includes("/5511999990000"), link);
  check("link tem ?text=", link.includes("?text="), link);
  check("link não tem espaço cru", !link.includes(" "), link);
  check("link tem só um ?", (link.match(/\?/g) ?? []).length === 1);

  // Decodificar de volta prova que nada foi perdido.
  const encoded = link.split("?text=")[1];
  check("mensagem volta idêntica", decodeURIComponent(encoded) === "Olá! Gostaria de fazer um pedido.");

  check("sem número devolve null", W.buildWhatsappLink({ phone: null, message: "oi" }) === null);
  check("número inválido devolve null", W.buildWhatsappLink({ phone: "1234", message: "oi" }) === null);
  check(
    "sem mensagem gera link limpo (sem ?text=)",
    W.buildWhatsappLink({ phone: "11999990000", message: "" }) === "https://wa.me/5511999990000",
    W.buildWhatsappLink({ phone: "11999990000", message: "" }),
  );
  check(
    "mensagem só de espaço é ignorada",
    W.buildWhatsappLink({ phone: "1199999000", message: "   " }) === "https://wa.me/551199999000",
  );
}

/* -------------------------------------------------- 5. estado da config */

{
  check("config vazia é desligada", W.EMPTY_WHATSAPP_CONFIG.isActive === false);
  check("config vazia sem número", W.EMPTY_WHATSAPP_CONFIG.phone === null);
  check(
    "config vazia tem a mensagem padrão",
    W.EMPTY_WHATSAPP_CONFIG.message === "Olá! Gostaria de fazer um pedido.",
    W.EMPTY_WHATSAPP_CONFIG.message,
  );

  const active = W.normalizeWhatsappConfig({ phone: "11999990000", message: "Oi", is_active: true });
  check("normaliza linha ativa", active.isActive && active.phone === "5511999990000", JSON.stringify(active));

  const off = W.normalizeWhatsappConfig({ phone: "11999990000", message: "Oi", is_active: false });
  check("linha desligada continua desligada", off.isActive === false);

  // O caso importante: `is_active = true` sem número utilizável não pode
  // resultar em botão. Acontece com dado antigo, importação ou escrita direta.
  const activeWithoutPhone = W.normalizeWhatsappConfig({ phone: null, is_active: true });
  check("ativo sem número vira desligado", activeWithoutPhone.isActive === false, JSON.stringify(activeWithoutPhone));

  const activeInvalid = W.normalizeWhatsappConfig({ phone: "1234", is_active: true });
  check("ativo com número inválido vira desligado", activeInvalid.isActive === false);

  check("linha null cai no vazio", W.normalizeWhatsappConfig(null) === W.EMPTY_WHATSAPP_CONFIG);
  check(
    "mensagem branca cai na padrão",
    W.normalizeWhatsappConfig({ phone: "11999990000", message: "   ", is_active: true }).message ===
      W.DEFAULT_WHATSAPP_MESSAGE,
  );
  check(
    "mensagem longa é cortada no teto",
    W.normalizeWhatsappConfig({
      phone: "11999990000",
      message: "a".repeat(500),
      is_active: true,
    }).message.length === W.WHATSAPP_MESSAGE_MAX,
  );
}

/* --------------------------------------------- 6. visibilidade do botão */

check(
  "botão aparece quando ativo e com número",
  W.shouldShowWhatsappButton({ phone: "5511999990000", message: "x", isActive: true }) === true,
);
check(
  "botão some quando desligado",
  W.shouldShowWhatsappButton({ phone: "5511999990000", message: "x", isActive: false }) === false,
);
check(
  "botão some sem número",
  W.shouldShowWhatsappButton({ phone: null, message: "x", isActive: true }) === false,
);
check("botão some com config nula", W.shouldShowWhatsappButton(null) === false);
check("botão some com undefined", W.shouldShowWhatsappButton(undefined) === false);

/* --------------------------------------------------- 7. dinheiro na msg */

check("formata R$ 79,70", W.formatWhatsappMoney(79.7) === "R$ 79,70", W.formatWhatsappMoney(79.7));
check("formata milhar", W.formatWhatsappMoney(1234.5) === "R$ 1.234,50", W.formatWhatsappMoney(1234.5));
check("formata zero", W.formatWhatsappMoney(0) === "R$ 0,00", W.formatWhatsappMoney(0));
check("formata centavos", W.formatWhatsappMoney(0.05) === "R$ 0,05", W.formatWhatsappMoney(0.05));
check("formata valor grande", W.formatWhatsappMoney(1234567.89) === "R$ 1.234.567,89", W.formatWhatsappMoney(1234567.89));
check("formata negativo", W.formatWhatsappMoney(-10) === "-R$ 10,00", W.formatWhatsappMoney(-10));
check("NaN vira zero", W.formatWhatsappMoney(Number.NaN) === "R$ 0,00", W.formatWhatsappMoney(Number.NaN));
check(
  "não usa espaço não separável (quebra no WhatsApp)",
  !/[\u00a0\u202f]/.test(W.formatWhatsappMoney(1234.5)),
  JSON.stringify(W.formatWhatsappMoney(1234.5)),
);

/* ------------------------------------------------ 8. mensagem do pedido */

{
  // O exemplo exato do escopo.
  const message = W.buildOrderMessage({
    restaurantName: "Cantina da Praça",
    orderNumber: 1042,
    tableName: "Mesa 04",
    items: [
      { name: "X-Bacon", quantity: 2, subtotal: 59.8 },
      { name: "Batata", quantity: 1, subtotal: 19.9 },
    ],
    total: 79.7,
  });

  check("mensagem do pedido é gerada", typeof message === "string" && message.length > 0);
  check("mensagem tem o número do pedido", message.includes("#1042"), message);
  check("mensagem tem a mesa encurtada", message.includes("Mesa: 04"), message);
  check("mensagem tem quantidade × nome", message.includes("2x X-Bacon"), message);
  check("mensagem tem o segundo item", message.includes("1x Batata"), message);
  check("mensagem tem o total", message.includes("Total: R$ 79,70"), message);
  check("mensagem tem o restaurante", message.includes("Cantina da Praça"), message);
  check("mensagem não tem texto administrativo", !/plano|assinatura|admin|token/i.test(message), message);

  // O texto do escopo, linha por linha.
  const expected = [
    "Olá, gostaria de informações sobre o pedido #1042.",
    "",
    "Mesa: 04",
    "",
    "2x X-Bacon",
    "1x Batata",
    "",
    "Total: R$ 79,70",
    "",
    "— Cantina da Praça",
  ].join("\n");
  check("formato bate com o exemplo do escopo", message === expected, JSON.stringify(message));
}

{
  // Mesa com nome que não é "Mesa N" continua legível.
  const message = W.buildOrderMessage({
    restaurantName: "Bar",
    orderNumber: 7,
    tableName: "Balcão",
    items: [{ name: "Chopp", quantity: 1 }],
    total: 12,
  });
  check("mesa com nome livre é preservada", message.includes("Mesa: Balcão"), message);

  const noTable = W.buildOrderMessage({
    restaurantName: "Bar",
    orderNumber: 8,
    tableName: null,
    items: [{ name: "Chopp", quantity: 1 }],
    total: 12,
  });
  check("pedido sem mesa não escreve 'Mesa: null'", !noTable.includes("Mesa:"), noTable);
  check("pedido sem mesa ainda tem o número", noTable.includes("#8"));
}

{
  // Recusas.
  check(
    "pedido sem itens não gera mensagem",
    W.buildOrderMessage({ restaurantName: "X", orderNumber: 1, items: [], total: 0 }) === null,
  );
  check(
    "pedido só com itens inválidos não gera mensagem",
    W.buildOrderMessage({
      restaurantName: "X",
      orderNumber: 1,
      items: [
        { name: "", quantity: 1 },
        { name: "Ok", quantity: 0 },
        { name: "Ok2", quantity: -3 },
      ],
      total: 0,
    }) === null,
  );

  // Quantidade inválida no meio de itens válidos é descartada, não zerada.
  const mixed = W.buildOrderMessage({
    restaurantName: "X",
    orderNumber: 2,
    items: [
      { name: "Bom", quantity: 2 },
      { name: "Ruim", quantity: 0 },
      { name: "  Espaços  ", quantity: 1 },
    ],
    total: 10,
  });
  check("descarta item com quantidade zero", !mixed.includes("Ruim"), mixed);
  check("faz trim do nome do item", mixed.includes("1x Espaços"), mixed);
  check("mantém o item válido", mixed.includes("2x Bom"), mixed);

  // Quantidade fracionada não vira "2.5x".
  const fractional = W.buildOrderMessage({
    restaurantName: "X",
    orderNumber: 3,
    items: [{ name: "Item", quantity: 2.9 }],
    total: 10,
  });
  check("quantidade fracionada é truncada", fractional.includes("2x Item") && !fractional.includes("2.9"), fractional);
}

{
  // Teto de tamanho: pedido grande não gera URL absurda.
  const items = Array.from({ length: 40 }, (_, i) => ({
    name: `Produto com nome bem comprido número ${i}`,
    quantity: 2,
  }));
  const message = W.buildOrderMessage({
    restaurantName: "Casa Grande",
    orderNumber: 9,
    items,
    total: 999.9,
  });
  check(
    "mensagem longa respeita o teto",
    message.length <= W.WHATSAPP_ORDER_MESSAGE_MAX,
    `${message.length} > ${W.WHATSAPP_ORDER_MESSAGE_MAX}`,
  );
  check("mensagem longa termina com reticências", message.endsWith("…"), message.slice(-20));
}

/* ------------------------------------------ 9. link do pedido (preparado) */

{
  const link = W.buildOrderWhatsappLink({
    phone: "11999990000",
    order: {
      restaurantName: "Cantina",
      orderNumber: 1042,
      tableName: "Mesa 04",
      items: [{ name: "X-Bacon", quantity: 2 }],
      total: 79.7,
    },
  });

  check("link de pedido é gerado", typeof link === "string" && link.startsWith("https://wa.me/5511999990000?text="));
  const decoded = decodeURIComponent(link.split("?text=")[1]);
  check("link de pedido carrega a mensagem", decoded.includes("#1042") && decoded.includes("Total: R$ 79,70"));

  check(
    "link de pedido sem número é null",
    W.buildOrderWhatsappLink({ phone: "", order: { restaurantName: "X", orderNumber: 1, items: [], total: 0 } }) === null,
  );
}

/* -------------------------------------------- 10. segurança do módulo puro */

{
  const source = fs.readFileSync(path.join(ROOT, "src/lib/whatsapp.ts"), "utf8");

  // Este módulo vai para o navegador. Nada de segredo, nada de server-only.
  // A menção em comentário é o contrato explicado; o que não pode existir é o
  // `import` de verdade.
  check(
    "módulo puro não importa server-only",
    !/^\s*import\s+["']server-only["']/m.test(source),
  );
  check("módulo puro não lê process.env", !/process\.env/.test(source));
  check("módulo puro não tem requisição de rede", !/\bfetch\s*\(/.test(source));
  check(
    "módulo puro não menciona token/chave",
    !/api[_-]?key|bearer|access[_-]?token/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "")),
  );
  // A promessa central da etapa: nada é enviado.
  check(
    "módulo não chama API do WhatsApp Business",
    !/graph\.facebook\.com|whatsappbusiness|cloud\.api/i.test(source),
  );
}

/* ------------------------------------------------------------ relatório */

const failed = results.filter((r) => !r.ok);
console.log("");
for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\nwhatsapp-lib: ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
