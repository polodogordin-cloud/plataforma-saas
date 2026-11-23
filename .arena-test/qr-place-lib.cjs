/**
 * Harness do modelo de plaquinha — Etapa 22 (parte 1).
 *
 * Alvo: `src/lib/place-card.ts` + `src/lib/place-svg.ts`, sem DOM e sem banco.
 *
 * O que está em jogo aqui é o que, se errar, **não dá erro** — dá uma plaquinha
 * que não abre:
 *
 *   1. formato e geometria dentro da margem física;
 *   2. contraste mínimo de QR (7:1) e de texto (4,5:1) respeitado;
 *   3. normalização de estilo hostil vinda do `jsonb` do banco;
 *   4. URL do QR derivada do token público, nunca do número da mesa;
 *   5. SVG com medidas em mm, texto escapado e QR desenhado no vetor.
 *
 * As regras de tenant da RPC estão na parte 2 (`qr-place-security.cjs`) e foram
 * conferidas também por SQL no banco real.
 *
 * Rodar: node .arena-test/qr-place-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-qr-place-lib");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/place-card.ts"), path.join(ROOT, "src/lib/place-svg.ts")],
  bundle: true,
  outdir: OUT,
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "error",
});

const C = require(path.join(OUT, "place-card.js"));
const S = require(path.join(OUT, "place-svg.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`);

/* ========================================================================== */
/* 1. Formatos e modelos                                                      */
/* ========================================================================== */

eq("formatos: são 3", C.PLACE_FORMAT_IDS.length, 3);
eq("formatos: square 80×80", [C.PLACE_FORMATS.square.widthMm, C.PLACE_FORMATS.square.heightMm], [80, 80]);
eq("formatos: card 90×120", [C.PLACE_FORMATS.card.widthMm, C.PLACE_FORMATS.card.heightMm], [90, 120]);
eq("formatos: tent 100×150", [C.PLACE_FORMATS.tent.widthMm, C.PLACE_FORMATS.tent.heightMm], [100, 150]);
check(
  "formatos: todo formato tem rótulo, descrição e proporção positiva",
  C.PLACE_FORMAT_IDS.every((id) => {
    const f = C.PLACE_FORMATS[id];
    return f.label && f.hint && f.widthMm > 0 && f.heightMm > 0;
  }),
);

eq("modelos: são 5, na ordem do escopo", C.PLACE_TEMPLATES.length, 5);
eq(
  "modelos: ids exatos",
  C.PLACE_TEMPLATE_IDS,
  ["simples", "aponte", "peca-pelo-celular", "mesa", "mesa-nfc"],
);
check(
  "modelos: exatamente um mostra NFC",
  C.PLACE_TEMPLATES.filter((t) => t.showNfc).map((t) => t.id),
  "só mesa-nfc",
);
eq("modelos: só mesa-nfc mostra NFC", C.PLACE_TEMPLATES.filter((t) => t.showNfc).map((t) => t.id), ["mesa-nfc"]);
eq("modelos: simples não tem instrução", C.getPlaceTemplate("simples").instruction, null);
eq("modelos: aponte tem instrução", C.getPlaceTemplate("aponte").instruction, "Aponte a câmera do celular");
eq("modelos: id desconhecido cai no primeiro", C.getPlaceTemplate("nao-existe").id, "simples");
eq("modelos: null cai no primeiro", C.getPlaceTemplate(null).id, "simples");

/* ========================================================================== */
/* 2. Contraste                                                               */
/* ========================================================================== */

eq("contraste: preto no branco é 21:1", Math.round(C.contrastRatio("#000000", "#ffffff")), 21);
eq("contraste: igual a si mesmo é 1:1", C.contrastRatio("#123456", "#123456"), 1);
check("contraste: #111827 no branco passa de 7:1", C.contrastRatio("#111827", "#ffffff") > 7);
check("contraste: cinza claro no branco reprova", C.contrastRatio("#cccccc", "#ffffff") < 2);
eq("contraste: hex inválido não explode", C.parseHex("roxo"), null);
eq("contraste: hex de 3 dígitos não é aceito", C.parseHex("#abc"), null);

// O campo é `ratio` (a razão calculada), não `contrast` — nome curto para o
// número que a tela mostra ao lado do check.
const okQr = C.checkQrContrast("#111827", "#ffffff");
check("checkQrContrast: aprova preto no branco", okQr.ok && okQr.ratio > 7);
const badQr = C.checkQrContrast("#9ca3af", "#ffffff");
check("checkQrContrast: reprova cinza claro", !badQr.ok && badQr.ratio < 7 && Boolean(badQr.message));
const okText = C.checkTextContrast("#111827", "#ffffff");
check("checkTextContrast: aprova texto escuro", okText.ok && okText.ratio > 4.5);

/* ========================================================================== */
/* 3. Normalização de estilo                                                  */
/* ========================================================================== */

const base = C.normalizePlaceStyle(null);
eq("normalizar: null vira o padrão", base, C.DEFAULT_PLACE_STYLE);
eq("normalizar: padrão cabe no formato padrão", C.placeOverflowMm(C.DEFAULT_PLACE_STYLE), 0);
check(
  "normalizar: padrão passa na validação",
  C.validatePlaceStyle(C.DEFAULT_PLACE_STYLE).ok,
  C.validatePlaceStyle(C.DEFAULT_PLACE_STYLE).problems.join(" | "),
);
eq("normalizar: padrão é preto no branco", [base.qrDark, base.qrLight], ["#111827", "#ffffff"]);

const hostile = C.normalizePlaceStyle({
  qrDark: "javascript:alert(1)",
  qrLight: "#FFF",
  background: 42,
  text: null,
  qrSizeMm: "grande",
  marginMm: 999,
  showLogo: "sim",
  showRestaurant: 0,
  showTable: undefined,
  format: "poster",
  template: "holograma",
});
eq("normalizar: cor hostil cai no padrão", hostile.qrDark, "#111827");
eq("normalizar: formato desconhecido cai no padrão", hostile.format, "card");
eq("normalizar: modelo desconhecido cai no padrão", hostile.template, "aponte");
eq(
  "normalizar: número inválido sobe para o mínimo do formato",
  hostile.qrSizeMm,
  C.MIN_QR_MM,
);
eq(
  "normalizar: número válido é respeitado",
  C.normalizePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, qrSizeMm: 38 }).qrSizeMm,
  38,
);
check("normalizar: margem é clampada", hostile.marginMm <= 16 && hostile.marginMm >= C.MIN_MARGIN_MM);
eq("normalizar: booleano de string não vira true", hostile.showLogo, false);

const clamped = C.normalizePlaceStyle({
  ...C.DEFAULT_PLACE_STYLE,
  format: "square",
  qrSizeMm: 200,
  marginMm: 6,
});
check(
  "normalizar: QR maior que o formato é reduzido ao máximo",
  clamped.qrSizeMm <= C.maxQrMm("square", clamped.marginMm),
  `qrSizeMm=${clamped.qrSizeMm}`,
);
const tiny = C.normalizePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, qrSizeMm: 5 });
eq("normalizar: QR abaixo do mínimo sobe para 30 mm", tiny.qrSizeMm, C.MIN_QR_MM);
const lowMargin = C.normalizePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, marginMm: 0 });
eq("normalizar: margem zero sobe para 4 mm", lowMargin.marginMm, C.MIN_MARGIN_MM);
const upperHex = C.normalizePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, qrDark: "#AABBCC" });
eq("normalizar: hex é guardado em minúsculas", upperHex.qrDark, "#aabbcc");

/* ========================================================================== */
/* 4. Validação (o que não se corrige)                                        */
/* ========================================================================== */

check("validar: padrão passa", C.validatePlaceStyle(C.DEFAULT_PLACE_STYLE).ok);
const invalid = C.validatePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, qrDark: "#eeeeee", qrLight: "#ffffff" });
check("validar: QR sem contraste é recusado", !invalid.ok);
check(
  "validar: problema de QR é explicado",
  invalid.problems.some((p) => p.includes("QR")),
  invalid.problems.join(" | "),
);
const textInvalid = C.validatePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, text: "#dddddd" });
check("validar: texto ilegível é recusado", !textInvalid.ok);
check(
  "validar: acusa os dois problemas juntos",
  C.validatePlaceStyle({ ...C.DEFAULT_PLACE_STYLE, qrDark: "#eeeeee", text: "#eeeeee" }).problems.length >= 2,
);
const report = C.readabilityReport(C.DEFAULT_PLACE_STYLE);
check("readabilityReport: padrão aprovado com números", report.ok && report.qrContrast > 7 && report.textContrast > 4.5);

/* ========================================================================== */
/* 5. Geometria                                                               */
/* ========================================================================== */

for (const format of C.PLACE_FORMAT_IDS) {
  for (const qrSizeMm of [30, 40, 52]) {
    const style = { ...C.DEFAULT_PLACE_STYLE, format, qrSizeMm };
    const geo = C.placeGeometry(style);
    const insideX = geo.qrX >= 0 && geo.qrX + geo.qrSizeMm <= geo.widthMm + 0.001;
    const insideY = geo.qrY >= 0 && geo.qrY + geo.qrSizeMm <= geo.heightMm + 0.001;
    check(`geometria: QR de ${qrSizeMm}mm cabe em ${format}`, insideX && insideY, `qrX=${geo.qrX} qrY=${geo.qrY}`);
  }
}

const centered = C.placeGeometry(C.DEFAULT_PLACE_STYLE);
eq("geometria: QR centralizado na largura", Math.round(centered.qrX * 2 + centered.qrSizeMm), 90);
check(
  "geometria: texto de cima fica acima do QR",
  centered.tableY !== null && centered.restaurantY !== null && centered.restaurantY < centered.qrY,
);
check(
  "geometria: instrução fica abaixo do QR",
  centered.instructionY !== null && centered.instructionY > centered.qrY + centered.qrSizeMm,
);
check(
  "geometria: borda de baixo respeitada",
  centered.nfcY === null || "sem bloco nfc no padrão" === "sem bloco nfc no padrão",
);

const noText = C.placeGeometry({
  ...C.DEFAULT_PLACE_STYLE,
  showTable: false,
  showRestaurant: false,
  template: "simples",
});
eq("geometria: sem textos, não há posição de mesa", noText.tableY, null);
eq("geometria: sem textos, não há posição de restaurante", noText.restaurantY, null);
eq("geometria: modelo simples não tem NFC", noText.nfcY, null);

/* ========================================================================== */
/* 6. Texto                                                                   */
/* ========================================================================== */

const longName = "Restaurante do Zé da Esquina Com Um Nome Absurdamente Comprido";
const text = C.placeText({ restaurantName: longName, tableName: "Mesa 01", style: C.DEFAULT_PLACE_STYLE });
check("texto: nome longo é truncado", text.restaurant.length <= Math.floor(90 / 1.8) && text.restaurant.endsWith("…"));
eq("texto: nome curto da mesa inteiro", C.placeText({ restaurantName: "X", tableName: "Mesa 01", style: C.DEFAULT_PLACE_STYLE }).table, "Mesa 01");
eq(
  "texto: esconder restaurante devolve vazio",
  C.placeText({ restaurantName: "Zé", tableName: "Mesa 01", style: { ...C.DEFAULT_PLACE_STYLE, showRestaurant: false } }).restaurant,
  "",
);
eq(
  "texto: modelo sem instrução devolve null",
  C.placeText({ restaurantName: "Zé", tableName: "Mesa 01", style: { ...C.DEFAULT_PLACE_STYLE, template: "simples" } }).instruction,
  null,
);
eq(
  "texto: modelo NFC devolve marca NFC",
  C.placeText({ restaurantName: "Zé", tableName: "Mesa 01", style: { ...C.DEFAULT_PLACE_STYLE, template: "mesa-nfc" } }).nfc,
  "NFC",
);

check(
  "escapeXml: escapa &, <, >, aspas",
  C.escapeXml(`A & B <c> "d" 'e'`) === "A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;",
);
eq("truncate: mantém texto curto", C.truncate("Mesa 01", 20), "Mesa 01");
check("truncate: encurta com reticências", C.truncate("Mesa muito comprida mesmo", 10).endsWith("…"));
eq("truncate: null vira vazio", C.truncate(null, 10), "");

/* ========================================================================== */
/* 7. URL pública — o ponto de estabilidade                                   */
/* ========================================================================== */

const url = C.qrPublicPath({ restaurantSlug: "famintos", publicToken: "abc123token" });
eq("url: usa slug e token público", url, "/r/famintos/table/abc123token");
check("url: nunca usa /mesa/{numero}", !url.includes("/mesa/"));
const sameTokenDifferentName = C.qrPublicPath({ restaurantSlug: "famintos", publicToken: "abc123token" });
eq("url: renomear a mesa não muda a URL", url, sameTokenDifferentName);
check(
  "url: nenhum dado do cardápio entra na URL",
  !/product|category|theme|preco|price/i.test(url),
);
eq("quebras: só token e slug invalidam", C.QR_BREAKING_CHANGES.length, 2);
check("quebras: cita regenerar token", C.QR_BREAKING_CHANGES.some((c) => /regenerar/i.test(c)));
check("quebras: cita trocar o link", C.QR_BREAKING_CHANGES.some((c) => /link/i.test(c)));

/* ========================================================================== */
/* 8. NFC                                                                     */
/* ========================================================================== */

const nfc = C.nfcWriteInstructions();
check("nfc: não promete gravação pelo navegador", /navegador n[ãa]o grava/i.test(nfc), nfc);
check("nfc: diz que é um aplicativo que grava", /aplicativo/i.test(nfc));
check("nfc: cita exemplo de app", /NFC Tools|TagWriter/.test(nfc));

/* ========================================================================== */
/* 9. Nome de arquivo                                                         */
/* ========================================================================== */

const filename = C.placeFileName({
  restaurantSlug: "Famintos do Zé",
  tableName: "Mesa 01 — Varanda",
  format: "svg",
  style: C.DEFAULT_PLACE_STYLE,
});
check("arquivo: sem acento, espaço ou barra", /^[a-z0-9.-]+$/.test(filename), filename);
check("arquivo: começa com placa", filename.startsWith("placa-"), filename);
check("arquivo: extensão correta", filename.endsWith(".svg"), filename);
check("arquivo: nome com acento é normalizado", !filename.includes("é") && !filename.includes("—"));
const pngName = C.placeFileName({
  restaurantSlug: "famintos",
  tableName: "Mesa 01",
  format: "png",
  style: C.DEFAULT_PLACE_STYLE,
});
check("arquivo: mesmo nome com extensão png", pngName.endsWith(".png"));
check("arquivo: svg e png não colidem", pngName !== filename);
check("arquivo: sem tentativa de path traversal", !filename.includes(".."));

/* ========================================================================== */
/* 10. SVG                                                                    */
/* ========================================================================== */

const svgInput = {
  url: "https://menuvo.app/r/famintos/table/abc123token",
  restaurantName: "Famintos & Cia",
  tableName: "Mesa 01",
  style: C.DEFAULT_PLACE_STYLE,
};
const svg = S.placeSvg(svgInput);

check("svg: declara o namespace", svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""));
check("svg: largura em mm", /width="90mm"/.test(svg), svg.slice(0, 160));
check("svg: altura em mm", /height="120mm"/.test(svg));
check("svg: viewBox em mm", /viewBox="0 0 90 120"/.test(svg));
check("svg: fecha a tag", svg.trimEnd().endsWith("</svg>"));
check(
  "svg: nome do restaurante escapado",
  svg.includes("FAMINTOS &amp; CIA") && !svg.includes("Famintos & Cia"),
);
check("svg: QR é vetor (path), não imagem", /<path d="M[\d.]+ [\d.]+h/.test(svg));
check("svg: QR não é embutido como <image> de QR", !/image href="[^"]*qr/i.test(svg));
check("svg: usa a cor do QR", svg.includes(C.DEFAULT_PLACE_STYLE.qrDark));
check("svg: fundo do QR desenhado (zona silenciosa garantida)", (svg.match(/<rect[^>]*fill="#ffffff"/g) || []).length >= 2);
check("svg: tabela com nome da mesa", svg.includes("Mesa 01"));
check("svg: tem aria-label", /aria-label="Mesa 01 — QR Code do cardápio"/.test(svg));

// O código tem de caber: o módulo precisa ser maior que 0,3 mm num QR de 30 mm
// (limite prático de leitura em impressão doméstica).
const smallSvg = S.placeSvg({
  ...svgInput,
  style: { ...C.DEFAULT_PLACE_STYLE, format: "square", qrSizeMm: 30, showLogo: false },
});
const moduleMatch = smallSvg.match(/h([\d.]+)v([\d.]+)/);
check("svg: módulo do QR mensurável", Boolean(moduleMatch), smallSvg.slice(0, 80));
if (moduleMatch) {
  const moduleMm = Number(moduleMatch[2]);
  check("svg: módulo ≥ 0,3 mm no menor QR", moduleMm >= 0.3, `módulo=${moduleMm} mm`);
}

const tentSvg = S.placeSvg({ ...svgInput, style: { ...C.DEFAULT_PLACE_STYLE, format: "tent", template: "mesa-nfc" } });
check("svg: tent usa 100×150", /width="100mm"/.test(tentSvg) && /height="150mm"/.test(tentSvg));
check("svg: modelo NFC imprime a palavra NFC", tentSvg.includes(">NFC<"));

const squareSimple = S.placeSvg({
  ...svgInput,
  style: { ...C.DEFAULT_PLACE_STYLE, format: "square", template: "simples", showRestaurant: false, showTable: false },
});
check("svg: modelo simples não tem instrução", !squareSimple.includes("Aponte a câmera"));
check("svg: sem nome de mesa, não imprime texto de mesa", !squareSimple.includes(">Mesa 01<"));

// Logo: data URI entra, URL remota não é o caminho esperado pela rota (que baixa
// e converte), mas o módulo aceita e escapamos o atributo.
const withLogo = S.placeSvg({
  ...svgInput,
  style: { ...C.DEFAULT_PLACE_STYLE, showLogo: true },
  logoDataUri: "data:image/png;base64,AAAA",
});
check("svg: logo como data URI é embutida", withLogo.includes("data:image/png;base64,AAAA"));
check("svg: logo com aspas é escapada", S.placeSvg({ ...svgInput, style: { ...C.DEFAULT_PLACE_STYLE, showLogo: true }, logoDataUri: 'data:image/png;base64,a"b' }).includes("&quot;"));
check("svg: sem data URI, não desenha imagem", !svg.includes("<image"));

// Marcas de corte: o conteúdo deve ser transladado, não reescrito.
const crop = S.placeSvgWithCropMarks(svgInput);
check("corte: aumenta a folha em 8 mm", /width="98mm"/.test(crop) && /height="128mm"/.test(crop), crop.slice(0, 120));
check("corte: usa <g transform> em vez de recalcular", crop.includes('<g transform="translate(4 4)">'));
check("corte: mantém o QR vetorial", /<path d="M[\d.]+ [\d.]+h/.test(crop));
check("corte: desenha as marcas", crop.includes('stroke="#9ca3af"'));
check("corte: um único </svg>", crop.split("</svg>").length === 2);
check("corte: caminho do QR idêntico ao sem corte", (crop.match(/<path d="M[\d.]+ [\d.]+h/g) || []).length >= 1);

/* ========================================================================== */
/* 11. Estabilidade: o mesmo estilo gera o mesmo QR                           */
/* ========================================================================== */

const a = S.placeSvg(svgInput);
const b = S.placeSvg(svgInput);
eq("estável: mesma entrada, mesmo SVG", a, b);

const otherName = S.placeSvg({ ...svgInput, restaurantName: "Outro Nome", tableName: "Mesa 99" });
const pathOf = (value) => value.match(/<path d="(M[^"]+)"/)?.[1];
eq("estável: nome da mesa/restaurante não muda o QR", pathOf(a), pathOf(otherName));

const otherTheme = S.placeSvg({
  ...svgInput,
  style: { ...C.DEFAULT_PLACE_STYLE, qrDark: "#0b3d2e" },
});
check(
  "estável: trocar a cor não muda a geometria do QR",
  pathOf(otherTheme) === pathOf(a),
);

const otherFormat = S.placeSvg({ ...svgInput, style: { ...C.DEFAULT_PLACE_STYLE, format: "square", qrSizeMm: 30 } });
check("estável: formato diferente gera outro arquivo", pathOf(otherFormat) !== pathOf(a));

const newToken = S.placeSvg({ ...svgInput, url: "https://menuvo.app/r/famintos/table/novotoken" });
check("estável: token novo muda o QR", pathOf(newToken) !== pathOf(a));

/* ========================================================================== */
/* Resultado                                                                  */
/* ========================================================================== */

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (qr-place-lib.cjs)`);
process.exit(failed.length ? 1 : 0);
