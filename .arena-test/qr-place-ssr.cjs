/**
 * Harness de renderização da plaquinha — Etapa 22 (parte 3).
 *
 * Renderiza `PlacePreview` (o mesmo componente que o dono vê no editor) no
 * servidor e confere o que sai no HTML:
 *
 *   • o SVG tem exatamente a proporção física do formato (mm no viewBox);
 *   • o nome da mesa e do restaurante aparecem — e escapados;
 *   • o QR ocupa a área prevista pela geometria, sem vazar da placa;
 *   • o texto de instrução e a marca NFC mudam com o modelo escolhido;
 *   • nenhuma combinação de modelo × formato gera `<table>` (a tela é de
 *     celular) nem SVG sem `aria-label`.
 *
 * A prévia não é um QR real (de propósito), então o teste não tenta decodificá-
 * la: o arquivo de verdade é gerado no servidor por `place-svg.ts`, coberto em
 * `qr-place-lib.cjs`.
 *
 * Rodar: node .arena-test/qr-place-ssr.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-qr-place-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

const STUBS = path.join(OUT, "stubs");
fs.mkdirSync(STUBS, { recursive: true });

fs.writeFileSync(
  path.join(STUBS, "next-link.js"),
  `const React = require("react");
   function Link({ href, children, ...props }) {
     return React.createElement("a", { href, ...props }, children);
   }
   module.exports = Link;
   module.exports.default = Link;`,
);
// Actions e roteador só existem em handlers de evento; o bundle precisa
// resolvê-los para compilar.
fs.writeFileSync(
  path.join(STUBS, "actions.js"),
  `const noop = async () => ({ ok: true });
   module.exports = new Proxy({}, { get: () => noop });`,
);
fs.writeFileSync(path.join(STUBS, "server-only.js"), "module.exports = {};");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-qr-place-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "qr-place-ssr.js"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "next/link": path.join(STUBS, "next-link.js"),
    "next/image": path.join(STUBS, "next-link.js"),
    "next/navigation": path.join(STUBS, "actions.js"),
    "@/actions/qr-places": path.join(STUBS, "actions.js"),
    "server-only": path.join(STUBS, "server-only.js"),
  },
  external: ["react", "react-dom", "lucide-react"],
  logLevel: "error",
});

const P = require(path.join(OUT, "qr-place-ssr.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const text = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const attr = (html, name) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

/* ========================================================================== */
/* 1. Estrutura do SVG                                                       */
/* ========================================================================== */

{
  const html = P.renderPreview();
  const t = text(html);

  check("preview: gera HTML", html.length > 500, String(html.length));
  // O componente devolve um wrapper com largura máxima (o ResizeObserver mede
  // esse elemento); o SVG é o primeiro filho.
  check("preview: contém um <svg>", html.includes("<svg") && html.indexOf("<svg") < html.indexOf("<rect") - 1);
  check("preview: tem role=img", attr(html, "role") === "img");
  check("preview: tem aria-label descritivo", /aria-label="Prévia da plaquinha no modelo/.test(html));

  // O padrão é `card` (90×120 mm). O viewBox precisa estar em mm — é o que
  // garante que a prévia e o arquivo impresso tenham a mesma proporção.
  check("preview: viewBox em mm do formato padrão", html.includes('viewBox="0 0 90 120"'), attr(html, "viewBox"));
  check("preview: largura proporcional ao formato", Number(attr(html, "width")) > 90);
  check(
    "preview: proporção largura/altura é 3/4",
    Math.abs(Number(attr(html, "width")) / Number(attr(html, "height")) - 90 / 120) < 0.01,
    `${attr(html, "width")}×${attr(html, "height")}`,
  );

  check("preview: mostra o nome da mesa", t.includes("Mesa 01"), t.slice(0, 160));
  check("preview: mostra o restaurante em caixa alta", t.includes("FAMINTOS & CIA"));
  check("preview: escapa o & do nome", html.includes("FAMINTOS &amp; CIA"));
  check("preview: mostra a instrução do modelo padrão", t.includes("Aponte a câmera do celular"));
  check("preview: não mostra NFC no modelo padrão", !t.includes("NFC"));
  check("preview: não usa tabela", !html.includes("<table"));
  check("preview: não usa imagem remota de QR", !/href="https?:[^"]*qr/i.test(html));
}

/* ========================================================================== */
/* 2. Modelos                                                               */
/* ========================================================================== */

{
  for (const template of P.templates) {
    const html = P.renderPreview({ template: template.id });
    const t = text(html);

    check(`modelo ${template.id}: renderiza`, html.includes("<svg"));
    check(`modelo ${template.id}: aria-label cita o modelo`, html.includes(`modelo ${template.label}`));
    if (template.instruction) {
      check(`modelo ${template.id}: imprime a instrução`, t.includes(template.instruction));
    }
    if (template.showNfc) {
      check(`modelo ${template.id}: imprime a marca NFC`, t.includes("NFC"));
    } else {
      check(`modelo ${template.id}: sem marca NFC`, !t.includes("NFC"));
    }
  }
}

/* ========================================================================== */
/* 3. Formatos                                                              */
/* ========================================================================== */

{
  const expected = { square: [80, 80], card: [90, 120], tent: [100, 150] };

  for (const format of P.formats) {
    const html = P.renderPreview({ format });
    const [width, height] = expected[format];

    check(
      `formato ${format}: viewBox ${width}×${height}`,
      html.includes(`viewBox="0 0 ${width} ${height}"`),
      attr(html, "viewBox"),
    );
    check(
      `formato ${format}: proporção preservada`,
      Math.abs(Number(attr(html, "width")) / Number(attr(html, "height")) - width / height) < 0.02,
      `${attr(html, "width")}×${attr(html, "height")}`,
    );
    check(`formato ${format}: o QR aparece`, html.includes('fill="#111827"'));
  }
}

/* ========================================================================== */
/* 4. Densidade e conteúdo                                                  */
/* ========================================================================== */

{
  const simple = P.renderPreview({ template: "simples", showRestaurant: false, showTable: false });
  const st = text(simple);
  check("simples sem nomes: não imprime a mesa", !st.includes("Mesa 01"), st.slice(0, 120));
  check("simples sem nomes: não imprime o restaurante", !st.includes("FAMINTOS"));
  check("simples: continua desenhando o QR", (simple.match(/<rect/g) || []).length > 5);

  const withLogo = P.renderPreviewWithLogo();
  check("logo: aparece como <image>", withLogo.includes("<image"));
  check("logo: usa a URL recebida", withLogo.includes("https://exemplo.test/logo.png"));
  check("logo: mesa longa aparece truncada com reticências ou inteira", text(withLogo).includes("Mesa 07"));

  const hidden = P.renderPreview({ showLogo: true });
  check("logo: sem URL, não desenha imagem", !hidden.includes("<image"));

  const colored = P.renderPreview({ qrDark: "#0b3d2e", background: "#f5f1e6", text: "#0b3d2e" });
  check("cores: aplica a cor do QR", colored.includes("#0b3d2e"));
  check("cores: aplica o fundo da placa", colored.includes("#f5f1e6"));
}

/* ========================================================================== */
/* 5. Tamanho do QR dentro da placa                                         */
/* ========================================================================== */

{
  // O retângulo de fundo do QR é o único com `fill` branco e coordenadas
  // explícitas; conferimos que ele cabe na placa para todos os formatos.
  const sizes = { square: 30, card: 44, tent: 60 };

  for (const [format, qrSizeMm] of Object.entries(sizes)) {
    const html = P.renderPreview({ format, qrSizeMm });
    const match = html.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#ffffff"/);
    check(`qr ${format}: retângulo do QR presente`, Boolean(match), html.slice(0, 200));
    if (match) {
      const [, x, y, width] = match;
      const dims = { square: [80, 80], card: [90, 120], tent: [100, 150] }[format];
      check(
        `qr ${format}: cabe na largura`,
        Number(x) >= 0 && Number(x) + Number(width) <= dims[0] + 0.01,
        `x=${x} w=${width}`,
      );
      check(
        `qr ${format}: cabe na altura`,
        Number(y) >= 0 && Number(y) + Number(width) <= dims[1] + 0.01,
        `y=${y}`,
      );
    }
  }
}

/* ========================================================================== */
/* 6. O que a prévia NÃO promete                                            */
/* ========================================================================== */

{
  const html = P.renderPreview();
  const t = text(html);

  // A prévia é ilustrativa por decisão de projeto: um QR falso queFuncionasse na
  // tela acabaria impresso por alguém.
  check("prévia: não contém URL do cardápio", !/\/r\/[a-z0-9-]+\/table\//i.test(html));
  check("prévia: não afirma estar pronta para impressão", !t.includes("pronto para imprimir"));
  check("prévia: não menciona gravação de TAG", !/gravar|gravação/i.test(t));
}

/* ========================================================================== */
/* Resultado                                                                 */
/* ========================================================================== */

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (qr-place-ssr.cjs)`);
process.exit(failed.length ? 1 : 0);
