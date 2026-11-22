/**
 * Harness da abstração `PrintProvider` — Etapa 18.
 *
 * Este é o arquivo que impede a mentira mais provável desta etapa: alguém, numa
 * próxima manutenção, "consertar" o provedor de navegador devolvendo
 * `confirmed: true` ou `status: "printed"`. Isso faria a tela dizer que o papel
 * saiu sem que ninguém tenha visto a bobina — e o restaurante descobriria no
 * meio do serviço.
 *
 * As três afirmações centrais:
 *
 *   1. `browser` nunca devolve `printed` nem `confirmed: true`;
 *   2. `browser` responde `supported: false` ao `connect` (não há sessão);
 *   3. os provedores futuros existem, devolvem `unsupported` e **não imprimem**.
 *
 * Rodar: node .arena-test/print-provider.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-print-provider");

fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/print-provider.ts")],
  bundle: true,
  outfile: path.join(OUT, "provider.cjs"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(ROOT, "src") },
  external: ["server-only"],
  logLevel: "error",
});

const M = require(path.join(OUT, "provider.cjs"));
const source = fs.readFileSync(path.join(ROOT, "src/lib/print-provider.ts"), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

function doc() {
  return {
    restaurant: {
      id: "r1",
      name: "Famintos",
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
      table_name: "Mesa 1",
      subtotal: 20,
      fees: 0,
      discount: 0,
      total: 20,
      notes: null,
      created_at: "2026-11-21T21:00:00Z",
      updated_at: "2026-11-21T21:00:00Z",
      items: [{ name: "X-Bacon", quantity: 1, unit_price: 20, subtotal: 20, notes: null, options: [] }],
      payments: [],
    },
  };
}

const request = () => ({
  document: doc(),
  width: "80",
  copies: 1,
  copyLabel: null,
  showPrices: true,
});

async function main() {
  /* ------------------------------------------------------- 1. browser */

  let executorCalls = 0;
  const browser = M.createPrintProvider("browser", () => {
    executorCalls += 1;
  });

  check("browser é o provedor de label 'Navegador'", browser.label === "Navegador", browser.label);
  check("browser está marcado como disponível", browser.available === true);
  check("browser tem kind 'browser'", browser.kind === "browser");

  const conn = await browser.connect({ printerName: "Térmica", identifier: null });
  check(
    "connect do navegador não finge conexão",
    conn.connected === false,
    "devolver connected:true faria a tela dizer 'impressora pronta' para quem nunca instalou driver",
  );
  check("connect explica o motivo", Boolean(conn.reason) && conn.reason.length > 20, conn.reason);
  check("connect é explicitamente não suportado", conn.supported === false);

  await browser.disconnect();
  check("disconnect não lança", true);

  const printed = await browser.printOrder(request());
  check("printOrder do navegador executa o executor injetado", executorCalls === 1, String(executorCalls));
  check("printOrder devolve ok", printed.ok === true);
  check(
    "printOrder NUNCA diz 'printed'",
    printed.status !== "printed",
    printed.status,
  );
  check("printOrder devolve 'requested'", printed.status === "requested", printed.status);
  check(
    "printOrder não confirma o papel",
    printed.confirmed === false,
    "o navegador não sabe se a bobina saiu; confirmed:true seria invenção",
  );
  check(
    "mensagem pede confirmação na janela do sistema",
    /janela do sistema/i.test(printed.message),
    printed.message,
  );

  const tested = await browser.testPrint(request());
  check("testPrint chama o executor", executorCalls === 2, String(executorCalls));
  check("testPrint também não confirma", tested.confirmed === false && tested.status === "requested");

  // Falha do executor vira mensagem, não exceção.
  const failing = M.createPrintProvider("browser", () => {
    throw new Error("boom");
  });
  const failedResult = await failing.printOrder(request());
  check("falha ao abrir a janela é tratada", failedResult.ok === false);
  check("falha devolve status failed", failedResult.status === "failed", failedResult.status);
  check("falha nunca confirma", failedResult.confirmed === false);

  /* ---------------------------------------------- 2. provedores futuros */

  const kinds = ["os", "web_print", "bridge", "service"];
  for (const kind of kinds) {
    const provider = M.createPrintProvider(kind);
    check(`${kind}: available = false`, provider.available === false);

    const result = await provider.printOrder(request());
    check(
      `${kind}: printOrder devolve unsupported`,
      result.status === "unsupported",
      result.status,
    );
    check(`${kind}: printOrder não imprime`, result.ok === false);
    check(`${kind}: printOrder não confirma`, result.confirmed === false);
    check(
      `${kind}: mensagem diz que não está disponível`,
      /não está disponível/i.test(result.message),
      result.message,
    );
    check(
      `${kind}: mensagem explica o que falta`,
      result.message.length > 40,
      result.message,
    );

    const testResult = await provider.testPrint(request());
    check(`${kind}: testPrint também devolve unsupported`, testResult.status === "unsupported");

    const connection = await provider.connect({});
    check(`${kind}: connect não abre sessão`, connection.connected === false);
    check(`${kind}: connect informa o motivo`, Boolean(connection.reason));
  }

  /* ---------------------------------------------------- 3. registro */

  const list = M.listPrintProviders();
  check("listPrintProviders devolve os cinco", list.length === 5, `${list.length}`);
  check("só um provedor disponível", list.filter((p) => p.available).length === 1);
  check(
    "o disponível é o navegador",
    list.find((p) => p.available)?.kind === "browser",
  );
  check(
    "todos têm dica em português",
    list.every((p) => typeof p.hint === "string" && p.hint.length > 20),
  );

  /* ------------------------------------------------------- 4. payload */

  const payload = M.jobPayload(request());
  check("payload tem texto", typeof payload.text === "string" && payload.text.length > 50);
  check("payload mantém a largura", payload.width === "80");
  check("payload mantém as cópias", payload.copies === 1);
  check("payload contém o número do pedido", payload.text.includes("#1042"));
  check(
    "payload não contém HTML nem tags",
    !/<[a-z/][^>]*>/i.test(payload.text),
    "o corpo é para serial/ESC-POS, não para HTML",
  );
  check(
    "payload cabe em 48 colunas",
    payload.text.split("\n").every((line) => line.length <= 48),
    payload.text.split("\n").filter((l) => l.length > 48).slice(0, 2).join(" | "),
  );

  /* ------------------------------------- 5. análise estática do fonte */

  /*
   * O comentário de cabeçalho cita `window.print()` como texto explicativo —
   * por isso a contagem é feita só nas linhas de código. Sem tirar os
   * comentários, o teste reprova o próprio documento.
   */
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
  check(
    "nenhum provedor chama window.print fora do executor injetado",
    (code.match(/window\.print\(\)/g) ?? []).length === 1,
    "só o executor padrão pode chamar window.print; provedores recebem o executor",
  );
  check(
    "não há fetch/rede no módulo de provedores",
    !/\bfetch\(|XMLHttpRequest|WebSocket/.test(source),
    "nenhum provedor desta etapa conversa com rede",
  );
  check(
    "não há promessa de impressão confirmada",
    !/confirmed:\s*true/.test(source),
    "nenhum caminho pode devolver confirmed:true nesta etapa",
  );
  check(
    "não há status 'printed' produzido por navegador",
    !/status:\s*"printed"/.test(source),
  );
  check(
    "interface declara os quatro métodos do escopo",
    ["connect(", "disconnect(", "testPrint(", "printOrder("].every((name) => source.includes(name)),
  );

  /* --------------------------------------------------------- resultado */

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\nprint-provider: ${passed}/${results.length} PASS`);
  if (failed.length) {
    console.log("\nFalhas:");
    for (const item of failed) {
      console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Harness quebrou:", error);
  process.exit(1);
});
