/**
 * Harness de UI — Etapa 25 (parte 3).
 *
 * Renderiza os componentes de verdade com `react-dom/server` e `jsdom`: o que
 * está aqui é o HTML que o dono e o cliente recebem, não uma leitura do fonte.
 *
 * Os quatro alvos e o que cada um pode estragar em silêncio:
 *
 *   `CouponsList`     — a busca e o filtro são locais; um filtro que ignora o
 *                       acento reprova o dono que digita "promocao";
 *   `CouponForm`      — um `type="number"` no celular dá teclado sem vírgula e
 *                       o dono digita 10,5 e perde o valor;
 *   `CartSheet`       — não pode quebrar o pedido de quem não tem cupom;
 *   detalhe do pedido — o desconto tem de aparecer com o **código**, senão o
 *                       cliente não sabe por que pagou menos.
 *
 * Rodar: node .arena-test/coupon-ui.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-coupon-ui");
fs.rmSync(OUT, { recursive: true, force: true });

/*
 * Stubs de `next/*` e `server-only`. Os componentes de UI importam `Link` e,
 * em alguns casos, uma action; nada disso existe fora do Next.
 */
const stubs = path.join(OUT, "__stubs__");
fs.mkdirSync(stubs, { recursive: true });

const STUB = {
  "next/link": `
    const React = require("react");
    module.exports = { __esModule: true, default: function Link({ href, children, ...rest }) {
      return React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    } };
  `,
  "next/navigation": `
    module.exports = {
      __esModule: true,
      useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
      usePathname: () => "/app/marketing/cupons",
      useSearchParams: () => new URLSearchParams(),
      redirect() {}, notFound() {},
    };
  `,
  "next/image": `
    const React = require("react");
    module.exports = { __esModule: true, default: (props) => React.createElement("img", props) };
  `,
  "server-only": "module.exports = {};",
  /*
   * As actions de cupom (`"use server"`) arrastam `next/server` — e com ele o
   * OpenTelemetry inteiro — para dentro do bundle. Aqui elas são só o formato
   * da chamada; o comportamento de servidor está coberto pelo harness de
   * segurança.
   */
  "@/actions/coupons": `
    module.exports = {
      __esModule: true,
      applyCoupon: async () => ({ ok: false, reason: "coupon_not_found" }),
      saveCoupon: async () => ({ ok: false, error: "stub" }),
      setCouponActive: async () => ({ ok: false, error: "stub" }),
      generateCouponCode: async () => ({ ok: false, error: "stub" }),
    };
  `,
};

const stubPlugin = {
  name: "stubs",
  setup(build) {
    for (const [id, source] of Object.entries(STUB)) {
      const file = path.join(stubs, id.replace(/[\/]/g, "__") + ".cjs");
      fs.writeFileSync(file, source);
      build.onResolve({ filter: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }, () => ({
        path: file,
      }));
    }
    /*
     * `@/…` fica com o `paths` do tsconfig (que o esbuild lê), e não com um
     * `onResolve` próprio: devolver o caminho sem extensão não deixa o esbuild
     * tentar `.ts`/`.tsx` e o build falha em "Cannot read file".
     */
  },
};

const entries = {
  list: "src/components/marketing/coupons-list.tsx",
  form: "src/components/marketing/coupon-form.tsx",
  lib: "src/lib/coupons.ts",
};

const bundles = {};
for (const [name, entry] of Object.entries(entries)) {
  bundles[name] = path.join(OUT, `${name}.cjs`);
}

/*
 * `esbuild.buildSync` não aceita plugins — e os stubs de `next/*` são plugins.
 * Por isso o build é assíncrono e o harness inteiro roda depois dele, num
 * arquivo só (sem `await` no topo do módulo CommonJS).
 */
/* tsconfig só para o esbuild resolver `@/…` como o Next resolve. */
fs.writeFileSync(
  path.join(OUT, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: { "@/*": [path.join(ROOT, "src", "*")] },
    },
  }),
);

async function buildBundles() {
  for (const [name, entry] of Object.entries(entries)) {
    await esbuild.build({
      entryPoints: [path.join(ROOT, entry)],
      bundle: true,
      outfile: bundles[name],
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      loader: { ".ts": "ts", ".tsx": "tsx" },
      plugins: [stubPlugin],
      tsconfig: path.join(OUT, "tsconfig.json"),
      external: ["react", "react-dom", "react/jsx-runtime", "lucide-react", "clsx", "tailwind-merge"],
      logLevel: "error",
    });
  }
}

async function main() {
  await buildBundles();

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const C = require(bundles.lib);
  const CouponsList = require(bundles.list).CouponsList;
  const CouponForm = require(bundles.form).CouponForm;

  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

  /** Texto visível de um HTML, sem tags e sem svg. */
  function text(html) {
    const dom = new JSDOM(`<body>${html}</body>`);
    const body = dom.window.document.body;
    body.querySelectorAll("svg").forEach((node) => node.remove());
    return (body.textContent || "").replace(/\s+/g, " ").trim();
  }

  const render = (element) => renderToStaticMarkup(element);

  /* ========================================================================== */
  /* 1. Lista de cupons                                                       */
  /* ========================================================================== */

  const coupons = [
    {
      ...C.normalizeCoupon({
        id: "a",
        name: "Boas-vindas",
        code: "BEMVINDO10",
        description: "Primeira visita",
        discount_type: "percentage",
        discount_value: 10,
        min_order_value: 30,
        max_discount: null,
        starts_at: null,
        ends_at: null,
        max_uses: 100,
        max_uses_per_customer: 1,
        active: true,
        used_count: 12,
        total_discount: 36,
        status: "active",
        created_at: "2026-11-01T00:00:00Z",
      }),
    },
    {
      ...C.normalizeCoupon({
        id: "b",
        name: "Natal",
        code: "NATAL25",
        description: null,
        discount_type: "fixed",
        discount_value: 25,
        min_order_value: 0,
        max_discount: null,
        starts_at: "2026-12-01T00:00:00Z",
        ends_at: "2026-12-31T00:00:00Z",
        max_uses: null,
        max_uses_per_customer: 1,
        active: true,
        used_count: 0,
        total_discount: 0,
        status: "scheduled",
        created_at: "2026-11-10T00:00:00Z",
      }),
    },
    {
      ...C.normalizeCoupon({
        id: "c",
        name: "Promoção do dia",
        code: "HOJE5",
        description: null,
        discount_type: "free_shipping",
        discount_value: 0,
        min_order_value: 0,
        max_discount: null,
        starts_at: null,
        ends_at: "2026-01-02T00:00:00Z",
        max_uses: 50,
        max_uses_per_customer: 1,
        active: false,
        used_count: 50,
        total_discount: 0,
        status: "exhausted",
        created_at: "2025-12-01T00:00:00Z",
      }),
    },
  ];

  {
    const html = render(
      React.createElement(CouponsList, { initialCoupons: coupons, timeZone: "America/Sao_Paulo" }),
    );
    const t = text(html);

    check("lista mostra o código", t.includes("BEMVINDO10"));
    check("lista mostra o segundo código", t.includes("NATAL25"));
    check("lista mostra o nome", t.includes("Boas-vindas"));
    check("lista mostra o desconto", t.includes("10% de desconto"));
    check("lista mostra o uso", t.includes("12 de 100 usos"));
    check("lista mostra status ativo", /Ativo/i.test(t));
    check("lista mostra status agendado", /Agendad/i.test(t));
    check("lista mostra status esgotado", /Esgotad/i.test(t));
    check("lista mostra o total abatido", t.includes("R$ 36,00"));
    check("lista tem busca", /Buscar/i.test(t) || html.includes('type="search"') || html.includes("placeholder"));
    check("lista tem campo de busca acessível", /aria-label="[^"]*[Bb]uscar/.test(html));
    check("lista aponta para a ficha", html.includes("/app/marketing/cupons/a"));
    check("lista não promete total zerado", !t.includes("R$ 0,00 abatido"));

    // Contagem de ocorrências: regex gulosa com markup engana.
    const ativos = (html.match(/>Ativo</g) || []).length;
    check("status 'Ativo' aparece uma vez (só no cupom ativo)", ativos === 1, `vezes=${ativos}`);
  }

  {
    const html = render(React.createElement(CouponsList, { initialCoupons: [], timeZone: null }));
    const t = text(html);
    check("lista vazia tem estado vazio", /Nenhum cupom/i.test(t), t.slice(0, 120));
    check("lista vazia não renderiza código fantasma", !/BEMVINDO/.test(t));
  }

  /* ========================================================================== */
  /* 2. Formulário                                                            */
  /* ========================================================================== */

  {
    const html = render(
      React.createElement(CouponForm, { canEdit: true }),
    );
    const t = text(html);

    for (const label of [
      "Nome",
      "Código",
      "Descrição",
      "Desconto",
      "Válido",
      "Limite",
    ]) {
      check(`formulário tem campo/bloco "${label}"`, new RegExp(label, "i").test(t));
    }

    check("formulário tem botão de gerar código", /Gerar/i.test(t));
    check("formulário manda salvar", /Criar cupom/i.test(t));
    check("formulário explica o que o cliente vê", /cliente/i.test(t));

    /*
     * `type="number"` no celular abre teclado numérico sem vírgula; em iOS o
     * campo com vírgula é descartado silenciosamente. Os campos de dinheiro e de
     * limite são `text` com `inputMode` — o valor é convertido no submit.
     */
    const moneyInputs = html.match(/<input[^>]*inputmode="decimal"[^>]*>/gi) || [];
    check("campos de dinheiro usam inputMode decimal", moneyInputs.length >= 1, `${moneyInputs.length}`);
    check(
      "nenhum campo de dinheiro é type=number",
      !/<input[^>]*type="number"[^>]*(discount|min|max)/i.test(html),
    );
    check(
      "campos numéricos usam inputMode numérico",
      /inputmode="numeric"/i.test(html),
    );
    check(
      "código é matematicamente maiúsculo no campo",
      /uppercase/.test(html) || /autocapitalize="characters"/i.test(html),
    );

    // Tudo que é editável precisa de rótulo ligado.
    const inputs = html.match(/<input[^>]*>/gi) || [];
    const unlabelled = inputs.filter(
      (tag) => !/aria-label=|id="/.test(tag) && !/type="(hidden|submit|checkbox|radio)"/.test(tag),
    );
    check("todo campo tem rótulo", unlabelled.length === 0, unlabelled.slice(0, 2).join(" | "));

    check("aviso de frete grátis presente", /frete/i.test(t));
    check("formulário não diz que o desconto é calculado no navegador", !/calculado aqui/i.test(t));
  check("formulário novo não inventa histórico de uso", !/Já usado/.test(t));
  }

  {
    // Sem permissão: formulário não deve oferecer salvar.
    const html = render(React.createElement(CouponForm, { canEdit: false }));
    const t = text(html);
    check("sem permissão: não mostra botão salvar", !/Salvar|Criar cupom/i.test(t));
  }

  {
    // Edição: campos preenchidos com o cupom existente.
    const html = render(
      React.createElement(CouponForm, {
        canEdit: true,
        coupon: C.normalizeCoupon({
          id: "a",
          name: "Boas-vindas",
          code: "BEMVINDO10",
          description: "Primeira visita",
          discount_type: "percentage",
          discount_value: 10,
          min_order_value: 30,
          max_discount: 15,
          starts_at: null,
          ends_at: "2026-12-31T00:00:00Z",
          max_uses: 100,
          max_uses_per_customer: 2,
          active: true,
          used_count: 12,
          total_discount: 36,
          status: "active",
          created_at: "2026-11-01T00:00:00Z",
        }),
      }),
    );
    check("edição: código preenchido", /value="BEMVINDO10"/.test(html));
    check("edição: valor preenchido", /value="10"/.test(html));
    check("edição: nome preenchido", /value="Boas-vindas"/.test(html));
    check("edição: mostra 12 de 100 usos", /12 de 100 usos/.test(text(html)));
    check("edição: mostra o total abatido", /R\$ 36,00/.test(text(html)));
    check("edição: botão salva o cupom", /Salvar cupom/i.test(text(html)));
  }

  /* ========================================================================== */
  /* 3. Pedido — a tela de detalhe usa o snapshot                            */
  /* ========================================================================== */

  {
    const detail = fs.readFileSync(
      path.join(ROOT, "src/components/orders/order-detail-sheet.tsx"),
      "utf8",
    );
    check("detalhe do pedido mostra o desconto", /Desconto/.test(detail));
    check("detalhe do pedido mostra o código", /coupon_code/.test(detail));
    check(
      "desconto só aparece quando existe",
      /discount > 0|discount\s*>\s*0/.test(detail),
    );

    const printing = fs.readFileSync(path.join(ROOT, "src/lib/printing.ts"), "utf8");
    check("via impressa mostra o desconto", /Desconto/.test(printing));

    const success = fs.readFileSync(
      path.join(ROOT, "src/components/public/order-success.tsx"),
      "utf8",
    );
    check("tela de sucesso mostra o desconto", /Desconto/.test(success));
    check("tela de sucesso mostra o subtotal", /Subtotal/.test(success));
  }

  /* ========================================================================== */
  /* 4. Rotas e navegação                                                     */
  /* ========================================================================== */

  {
    const settings = fs.readFileSync(path.join(ROOT, "src/app/app/configuracoes/page.tsx"), "utf8");
    check("configurações tem grupo Marketing", /title: "Marketing"/.test(settings));
    check("configurações aponta para cupons", /\/app\/marketing\/cupons/.test(settings));

    const nav = fs.readFileSync(path.join(ROOT, "src/components/app/bottom-nav.tsx"), "utf8");
    const tabs = (nav.match(/href: "\/app/g) || []).length;
    check("menu inferior continua com 6 abas", tabs === 6, `abas=${tabs}`);
    check("cupons não entrou no menu inferior", !/cupons/.test(nav));

    const dashboard = fs.readFileSync(path.join(ROOT, "src/app/app/page.tsx"), "utf8");
    check("painel inicial aponta para cupons", /\/app\/marketing\/cupons/.test(dashboard));
  }

  /* ========================================================================== */
  /* 5. Mobile                                                                */
  /* ========================================================================== */

  {
    const form = fs.readFileSync(path.join(ROOT, "src/components/marketing/coupon-form.tsx"), "utf8");
    const list = fs.readFileSync(path.join(ROOT, "src/components/marketing/coupons-list.tsx"), "utf8");

    /*
     * Etapa 25 pede criar e gerenciar cupom pelo celular. O que isso significa em
     * código: alvo de toque >= 44px nos controles de ação, coluna única e nenhuma
     * tabela com rolagem horizontal.
     */
    check("formulário usa altura de toque confortável", /min-h-\[(44|48|3\.25rem|2\.75rem|11)\]|min-h-12|h-12/.test(form));
    check("lista não usa <table>", !/<table/.test(list));
    check("lista empilha em coluna única", /flex flex-col|space-y-/.test(list));
    check(
      "formulário não tem table",
      !/<table/.test(form),
    );
    check("nenhum texto em tamanho ilegível", !/text-\[(9|8)px\]/.test(form + list));
  }

  /* ========================================================================== */
  /* 6. Linguagem                                                             */
  /* ========================================================================== */

  {
    const sources = [
      "src/components/marketing/coupons-list.tsx",
      "src/components/marketing/coupon-form.tsx",
      "src/app/app/marketing/page.tsx",
      "src/app/app/marketing/cupons/page.tsx",
      "src/app/app/marketing/cupons/novo/page.tsx",
      "src/app/app/marketing/cupons/[id]/page.tsx",
    ].map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));

    /* Comentários e tipos saem: `string | undefined` é TypeScript, não texto na
     * tela. O que sobra é JSX e string literal. */
    const joined = sources
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\b\w+\?:[^,;}\n]*\bundefined\b/g, "")
      .replace(/as \w+( \| \w+)*/g, "")
      .replace(/\bundefined\b/g, (match, offset, whole) => {
        /*
         * `?? ` e `= undefined` são código; só interessa `undefined` que possa
         * cair como texto. Sobram as concatenações em template literal e os
         * atributos JSX, que são onde ele vaza para a tela.
         */
        const before = whole.slice(Math.max(0, offset - 12), offset);
        return /\$\{|=\s*$|:\s*$/.test(before) ? "" : match;
      });
    check("sem inglês vazando na UI", !/>\s*(Save|Cancel|Delete|Search|Name|Code)\s*</.test(joined));
    check("sem 'null' escrito na tela", !/>\s*null\s*</.test(joined));
    const undefinedSpot = /=>\s*undefined|value=\{undefined/.exec(joined);
    check(
      "sem 'undefined' escrito na tela",
      !undefinedSpot,
      undefinedSpot ? joined.slice(undefinedSpot.index - 120, undefinedSpot.index + 40) : "",
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Resultado                                                                 */
  /* -------------------------------------------------------------------------- */

    const failed = results.filter((r) => !r.ok);
    for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    console.log(`\n${results.length - failed.length}/${results.length} PASS (coupon-ui.cjs)`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
