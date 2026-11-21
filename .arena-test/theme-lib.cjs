/**
 * Harness de lógica do tema — Etapa 9.
 *
 * Sem DOM: compila `src/lib/theme.ts` e `src/lib/theme-upload.ts` direto para
 * CommonJS e testa o que decide a aparência e a segurança do upload:
 * normalização de cor, contraste, presets, fallback, CSS vars e validação de
 * arquivo por assinatura.
 */
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-lib");

function build(entry, name) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    outfile: path.join(OUT, `${name}.js`),
    platform: "node",
    format: "cjs",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "error",
  });
  return require(path.join(OUT, `${name}.js`));
}

const T = build("src/lib/theme.ts", "theme");
const U = build("src/lib/theme-upload.ts", "theme-upload");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

/* ============================== 1. Cores ============================== */

check("hex: expande #abc para #aabbcc", T.normalizeHex("#abc") === "#aabbcc");
check("hex: aceita sem #", T.normalizeHex("FFC400") === "#ffc400");
check("hex: recusa valor inválido", T.normalizeHex("verde") === null);
check("hex: recusa 4 dígitos", T.normalizeHex("#abcd") === null);
check("hex: recusa vazio", T.normalizeHex("") === null);

check(
  "contraste: preto sobre branco é 21:1",
  Math.abs(T.contrastRatio("#000000", "#ffffff") - 21) < 0.05,
);
check(
  "contraste: mesma cor é 1:1",
  Math.abs(T.contrastRatio("#0f9250", "#0f9250") - 1) < 0.001,
);

check(
  "readableOn: fundo escuro → texto branco",
  T.readableOn("#14161c") === "#ffffff",
);
check(
  "readableOn: fundo claro → texto escuro",
  T.readableOn("#ffffff") === T.NEAR_BLACK,
);
check(
  "readableOn: amarelo (caso ruim) não escolhe branco",
  T.readableOn("#ffc400") === T.NEAR_BLACK,
);

check(
  "ensureContrast: cor ilegível é corrigida até 4.5:1",
  T.contrastRatio(T.ensureContrast("#f5f5f5", "#ffffff"), "#ffffff") >= 4.5,
  String(T.contrastRatio(T.ensureContrast("#f5f5f5", "#ffffff"), "#ffffff")),
);
check(
  "ensureContrast: cor que já passa é preservada",
  T.ensureContrast("#14161c", "#ffffff") === "#14161c",
);
check(
  "mix: meio a meio entre branco e preto",
  T.mix("#000000", "#ffffff", 0.5) === "#808080",
  T.mix("#000000", "#ffffff", 0.5),
);

/* ============================ 2. Presets ============================== */

check("presets: existem 6 temas prontos", T.THEME_PRESETS.length === 6);
check(
  "presets: nomes do escopo presentes",
  ["moderno", "elegante", "dark", "minimalista", "restaurante", "fastfood"].every((id) =>
    T.THEME_PRESETS.some((preset) => preset.id === id),
  ),
);
check(
  "presets: todos trazem todas as cores e estilos preenchidos",
  T.THEME_PRESETS.every(
    (preset) =>
      T.normalizeHex(preset.theme.primary_color) &&
      T.normalizeHex(preset.theme.secondary_color) &&
      T.normalizeHex(preset.theme.background_color) &&
      T.normalizeHex(preset.theme.text_color) &&
      T.normalizeHex(preset.theme.button_color) &&
      ["rounded", "soft", "flat"].includes(preset.theme.card_style) &&
      ["solid", "outline", "pill"].includes(preset.theme.button_style),
  ),
);

/* ======================= 3. Normalização / fallback ==================== */

const empty = T.normalizeTheme(null);
check(
  "fallback: sem tema usa o padrão completo",
  empty.primary_color === "#0f9250" &&
    empty.card_style === "rounded" &&
    empty.button_style === "solid" &&
    empty.preset === null &&
    empty.logo_url === null,
);
check(
  "fallback: objeto vazio também vira tema válido",
  T.normalizeTheme({}).primary_color === T.DEFAULT_THEME.primary_color,
);
check(
  "normalização: cor inválida no banco cai no padrão",
  T.normalizeTheme({ primary_color: "roxo" }).primary_color === T.DEFAULT_THEME.primary_color,
);
check(
  "normalização: card_style fora da lista cai no padrão",
  T.normalizeTheme({ card_style: "quadrado" }).card_style === "rounded",
);
check(
  "normalização: button_style fora da lista cai no padrão",
  T.normalizeTheme({ button_style: "piscando" }).button_style === "solid",
);
check(
  "normalização: preset desconhecido vira null",
  T.normalizeTheme({ preset: "neon" }).preset === null,
);
check(
  "normalização: hex minúsculo e curto são corrigidos",
  T.normalizeTheme({ primary_color: "#ABC" }).primary_color === "#aabbcc",
);
check(
  "segurança: javascript: em logo_url é descartado",
  T.normalizeTheme({ logo_url: "javascript:alert(1)" }).logo_url === null,
);
check(
  "segurança: data: em cover_url é descartado",
  T.normalizeTheme({ cover_url: "data:image/svg+xml,<svg/>" }).cover_url === null,
);
check(
  "segurança: URL https válida é mantida",
  T.normalizeTheme({ logo_url: "https://x.supabase.co/storage/v1/object/public/restaurant-assets/a/logo.webp" })
    .logo_url === "https://x.supabase.co/storage/v1/object/public/restaurant-assets/a/logo.webp",
);

check("hasCustomTheme: tema padrão puro = false", T.hasCustomTheme(T.DEFAULT_THEME) === false);
check(
  "hasCustomTheme: com preset = true",
  T.hasCustomTheme({ ...T.DEFAULT_THEME, preset: "dark" }) === true,
);

/* ============================ 4. Tokens / CSS ========================= */

const dark = T.normalizeTheme({ ...T.THEME_PRESETS[2].theme });
const darkTokens = T.themeTokens(dark);
check("tokens: tema dark é reconhecido como escuro", darkTokens.isDark === true);
check(
  "tokens: superfície do dark é mais clara que o fundo",
  T.relativeLuminance(darkTokens.surface) > T.relativeLuminance(darkTokens.background),
);
check(
  "tokens: texto do tema dark tem contraste >= 4.5",
  T.contrastRatio(darkTokens.text, darkTokens.background) >= 4.5,
  String(T.contrastRatio(darkTokens.text, darkTokens.background)),
);
check(
  "tokens: texto de botão contrasta com o botão",
  T.contrastRatio(darkTokens.buttonText, darkTokens.button) >= 4.5,
);

const brokenText = T.normalizeTheme({
  background_color: "#ffffff",
  text_color: "#f7f7f7", // praticamente invisível
});
check(
  "tokens: texto ilegível escolhido pelo dono é corrigido",
  T.contrastRatio(T.themeTokens(brokenText).text, "#ffffff") >= 4.5,
  String(T.contrastRatio(T.themeTokens(brokenText).text, "#ffffff")),
);

const vars = T.themeToCssVars(dark);
check(
  "css: gera todas as variáveis --mv-*",
  [
    "--mv-primary",
    "--mv-secondary",
    "--mv-bg",
    "--mv-surface",
    "--mv-text",
    "--mv-text-muted",
    "--mv-button",
    "--mv-button-text",
    "--mv-card-radius",
    "--mv-button-radius",
  ].every((key) => typeof vars[key] === "string"),
);
check(
  "css: variáveis batem com o tema",
  vars["--mv-primary"] === dark.primary_color && vars["--mv-bg"] === dark.background_color,
);
check(
  "css: nenhuma variável usa hex inválido",
  Object.values(vars).every((value) => !/^#[0-9a-f]{0,5}$/i.test(value) || value.length === 7),
);
check(
  "css: tema não vaza token de marca (brand-/ink-)",
  !Object.keys(vars).some((key) => key.includes("brand") || key.includes("ink")),
);
check(
  "estilos: card 'flat' zera sombra e tem raio menor",
  T.cardShadow("flat") === "none" && parseFloat(T.cardRadius("flat")) < parseFloat(T.cardRadius("rounded")),
);
check("estilos: botão 'pill' é totalmente arredondado", T.buttonRadius("pill") === "999px");
check(
  "cssText: produz regra com as variáveis",
  T.themeToCssText(dark).startsWith(":root{--mv-primary:") &&
    T.themeToCssText(dark).includes("--mv-bg:"),
);

/* ======================== 5. Validação de arquivo ===================== */

// Assinaturas reais
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
]);
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const svg = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

check("upload: reconhece PNG", U.sniffImageType(png) === "image/png");
check("upload: reconhece JPEG", U.sniffImageType(jpeg) === "image/jpeg");
check("upload: reconhece WEBP", U.sniffImageType(webp) === "image/webp");
check("upload: recusa executável (MZ)", U.sniffImageType(exe) === null);
check("upload: recusa SVG (vetor de script)", U.sniffImageType(svg) === null);
check("upload: arquivo curto é recusado", U.sniffImageType(new Uint8Array([0x89, 0x50])) === null);
check(
  "upload: aceita apenas png/jpeg/webp",
  U.ACCEPTED_MIME.length === 3 &&
    U.ACCEPTED_MIME.includes("image/png") &&
    U.ACCEPTED_MIME.includes("image/jpeg") &&
    U.ACCEPTED_MIME.includes("image/webp"),
);
check(
  "upload: limites de tamanho de saída coerentes",
  U.OUTPUT_SIZE.logo.width === 320 &&
    U.OUTPUT_SIZE.cover.width === 1600 &&
    U.OUTPUT_SIZE.cover.width / U.OUTPUT_SIZE.cover.height === 16 / 9,
);
check("upload: original acima de 8 MB é recusado", U.MAX_UPLOAD_BYTES === 8 * 1024 * 1024);

// fitWithin: recorte central cobrindo o alvo
const wide = U.fitWithin(1600, 900, 320, 320);
check(
  "recorte: imagem 16:9 vira quadrado cortando as laterais",
  wide.sh === 900 && wide.sw === 900 && wide.sx === 350 && wide.sy === 0,
  JSON.stringify(wide),
);
const tall = U.fitWithin(900, 1600, 1600, 900);
check(
  "recorte: imagem em pé vira 16:9 cortando topo/base",
  tall.sw === 900 && tall.sh === 506 && tall.sy === 547,
  JSON.stringify(tall),
);

// checkImageFile com File falsificado (Node não tem File antes do 20 — tem)
const fakeFile = (bytes, type, size) => ({
  size: size ?? bytes.length,
  type,
  slice: () => ({ arrayBuffer: async () => bytes.buffer }),
});

(async () => {
  const okPng = await U.checkImageFile(fakeFile(png, "image/png"));
  check("arquivo: PNG válido passa", okPng.ok === true && okPng.extension === "png");

  const badType = await U.checkImageFile(fakeFile(exe, "application/x-msdownload"));
  check("arquivo: .exe renomeado não passa pelo tipo", badType.ok === false);

  const lyingType = await U.checkImageFile(fakeFile(exe, "image/png"));
  check(
    "arquivo: .exe com tipo image/png é pego pela assinatura",
    lyingType.ok === false && /não parece ser uma imagem/.test(lyingType.error),
  );

  const tooBig = await U.checkImageFile(fakeFile(png, "image/png", 9 * 1024 * 1024));
  check("arquivo: acima do limite é recusado com mensagem", tooBig.ok === false);

  const empty = await U.checkImageFile(fakeFile(new Uint8Array(0), "image/png", 0));
  check("arquivo: vazio é recusado", empty.ok === false);

  const webpCheck = await U.checkImageFile(fakeFile(webp, "image/webp"));
  check("arquivo: WEBP válido passa com extensão webp", webpCheck.ok === true && webpCheck.extension === "webp");

  const jpegCheck = await U.checkImageFile(fakeFile(jpeg, "image/jpeg"));
  check("arquivo: JPEG vira extensão jpg", jpegCheck.ok === true && jpegCheck.extension === "jpg");

  check("arquivo: nome de upload versionado", U.uploadFileName("cover", "webp", "abc") === "cover-abc.webp");

  /* ------------------------------------------------------------ relatório */
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
