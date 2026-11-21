/**
 * Harness de lógica do PWA — Etapa 12.
 *
 * Duas famílias de checagens:
 *
 *   1. **Contrato** (manifest, ícones, instalação): os valores que o navegador
 *      lê para decidir se instala. Errar aqui falha silenciosamente — o Chrome
 *      simplesmente não mostra o botão de instalar.
 *
 *   2. **Segurança do cache**: a regra mais importante da etapa. O service
 *      worker é escrito à mão (`src/sw-source.js`, JS puro) e não pode importar
 *      o módulo TS; então as duas listas são comparadas aqui. Se alguém
 *      acrescentar uma rota sensível num lado só, este teste falha.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-pwa");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/pwa.ts")],
  bundle: true,
  outfile: path.join(OUT, "pwa.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  logLevel: "error",
});

const P = require(path.join(OUT, "pwa.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const swSource = read("src/sw-source.js");
const manifestSource = read("src/app/manifest.webmanifest/route.ts");
const layoutSource = read("src/app/layout.tsx");

/* ============================== manifest ============================== */

check("manifest: nome completo definido", P.APP_FULL_NAME === "Menuvo · Cardápios digitais", P.APP_FULL_NAME);
check("manifest: nome curto definido", P.APP_NAME === "Menuvo");
check("manifest: start_url aponta para o painel", P.START_URL === "/app");
check("manifest: escopo raiz", P.SCOPE === "/");
check("manifest: display standalone", P.DISPLAY === "standalone");
check("manifest: idioma pt-BR", P.APP_LANG === "pt-BR");
check("manifest: cor do tema é a da marca", P.THEME_COLOR === "#0f9250", P.THEME_COLOR);
check("manifest: fundo claro para o splash", P.BACKGROUND_COLOR === "#ffffff");

// Os valores precisam estar no código gerado, não só no módulo: um manifest
// escrito à mão pode divergir; aqui ele é construído a partir desta fonte.
for (const [label, value] of [
  ["start_url", P.START_URL],
  ["display", P.DISPLAY],
  ["theme_color", P.THEME_COLOR],
  ["background_color", P.BACKGROUND_COLOR],
  ["scope", P.SCOPE],
]) {
  check(`manifest: ${label} sai do módulo compartilhado`, manifestSource.includes(label));
}
check("manifest: rota responde GET", /export function GET/.test(manifestSource));
check(
  "manifest: content-type correto",
  manifestSource.includes("application/manifest+json"),
);

/* ================================ ícones ================================ */

check("ícones: 192 e 512 declarados", P.ICON_SIZES.includes(192) && P.ICON_SIZES.includes(512));

const anyIcons = P.ICONS.filter((icon) => icon.purpose === "any");
const maskable = P.ICONS.filter((icon) => icon.purpose === "maskable");

check(
  "ícones: PNG nos dois tamanhos para instalação",
  anyIcons.length === 2 && anyIcons.every((icon) => icon.type === "image/png"),
  anyIcons.map((i) => i.sizes).join(","),
);
check(
  "ícones: maskable separado nos dois tamanhos",
  maskable.length === 2,
  maskable.map((i) => i.sizes).join(","),
);
check(
  "ícones: tamanho do arquivo bate com o declarado",
  anyIcons.every((icon) => {
    const file = path.join(ROOT, "public", icon.src);
    return fs.existsSync(file);
  }),
);

// Lê o IHDR do PNG para conferir que o arquivo tem mesmo o tamanho anunciado.
// Um manifest que promete 512 e entrega 192 não é erro que aparece na tela — o
// Chrome recusa a instalação e o console mostra um aviso fácil de passar.
function pngSize(file) {
  const buf = fs.readFileSync(path.join(ROOT, "public", file));
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { isPng, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

for (const icon of P.ICONS) {
  const { isPng, width, height } = pngSize(icon.src);
  const expected = Number(icon.sizes.split("x")[0]);
  check(
    `ícone: ${icon.src} é PNG ${icon.sizes}`,
    isPng && width === expected && height === expected,
    `${width}x${height}`,
  );
}

const apple = pngSize(P.APPLE_TOUCH_ICON);
check("ícone: apple-touch-icon 180x180 existe", apple.width === 180 && apple.height === 180);
check(
  "ícone: referenciado no layout (iOS não lê o manifest)",
  layoutSource.includes("apple-touch-icon"),
);
check(
  "ícone: nenhum ícone quebrado ou ausente",
  P.ICONS.every((icon) => fs.existsSync(path.join(ROOT, "public", icon.src))),
);

/* ============================== instalação ============================== */

check(
  "plataforma: detecta iPhone",
  P.detectPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }) === "ios",
);
check(
  "plataforma: detecta iPad disfarçado de Mac",
  P.detectPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 }) === "ios",
);
check(
  "plataforma: detecta Android",
  P.detectPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" }) === "android",
);
check(
  "plataforma: desktop não recebe convite",
  P.detectPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }) === "desktop",
);

const base = { dismissAt: null, now: 1_700_000_000_000, visits: 2, platform: "android", standalone: false };

check("instalação: oferece na segunda visita", P.shouldOfferInstall(base));
check("instalação: não oferece na primeira visita", !P.shouldOfferInstall({ ...base, visits: 1 }));
check("instalação: não oferece quando já está instalado", !P.shouldOfferInstall({ ...base, standalone: true }));
check("instalação: não oferece no desktop", !P.shouldOfferInstall({ ...base, platform: "desktop" }));
check(
  "instalação: respeita a dispensa por 30 dias",
  !P.shouldOfferInstall({ ...base, dismissAt: base.now - 5 * 24 * 60 * 60 * 1000 }),
);
check(
  "instalação: volta a oferecer depois de 30 dias",
  P.shouldOfferInstall({ ...base, dismissAt: base.now - 31 * 24 * 60 * 60 * 1000 }),
);
check(
  "instalação: iPhone também recebe convite (com instrução própria)",
  P.shouldOfferInstall({ ...base, platform: "ios" }),
);
check("instalação: texto do escopo presente", P.INSTALL_COPY.title === "Instale o app para acessar mais rápido.", P.INSTALL_COPY.title);
check(
  "instalação: instrução do iPhone cita Compartilhar e Tela de Início",
  /Compartilhar/.test(P.INSTALL_COPY.iosBody) && /Tela de Início/.test(P.INSTALL_COPY.iosBody),
);
check("instalação: permite dispensar", Boolean(P.INSTALL_COPY.dismiss));

/* ============================ cache: regras ============================ */

const ruleFor = (url) => P.resolveCacheRule(url);

check(
  "cache: painel nunca é cacheado",
  ruleFor("/app/pedidos")?.strategy === "network-only",
  ruleFor("/app/pedidos")?.id,
);
check(
  "cache: admin nunca é cacheado",
  ruleFor("/admin/assinaturas")?.strategy === "network-only",
);
check(
  "cache: login nunca é cacheado",
  ruleFor("/auth/callback")?.strategy === "network-only",
);
check(
  "cache: API nunca é cacheada",
  ruleFor("/api/webhook")?.strategy === "network-only",
);
check(
  "cache: Supabase nunca é cacheado",
  ruleFor("https://fjrvjnhnvjkpowxzxiez.supabase.co/rest/v1/orders")?.strategy === "network-only",
);
check(
  "cache: estáticos do Next são cache-first",
  ruleFor("/_next/static/chunks/main.js")?.strategy === "cache-first",
);
check(
  "cache: fotos de produto são cache-first",
  ruleFor("https://x.supabase.co/storage/v1/object/public/products/a.jpg")?.strategy === "cache-first",
);
check(
  "cache: cardápio público é rede-primeiro",
  ruleFor("/r/famintos")?.strategy === "network-first",
);
check(
  "cache: mesa por QR também é rede-primeiro",
  ruleFor("/r/famintos/table/H62U243ECFBJFX55ZXDSKDQY")?.strategy === "network-first",
);

/* ==================== cache: nada sensível, em dois lugares ==================== */

const SENSITIVE = [
  "/api/orders",
  "/auth/callback",
  "/app/pedidos",
  "/app/cardapio",
  "/admin/restaurantes",
  "/onboarding",
  "/app/configuracoes",
  "https://abc.supabase.co/rest/v1/orders",
  "/r/famintos/order",
  "/carrinho",
];

const SAFE = [
  "/_next/static/chunks/app.js",
  "/icons/icon-192.png",
  "/r/famintos",
  "/planos",
  "/",
];

const failures = [];

for (const url of SENSITIVE) {
  if (!P.isSensitiveRequest(new URL(url, "https://menuvo.app"))) {
    failures.push(`TS deixou passar ${url}`);
  }
}
for (const url of SAFE) {
  if (P.isSensitiveRequest(new URL(url, "https://menuvo.app"))) {
    failures.push(`TS marcou como sensível ${url}`);
  }
}

check(
  "cache: módulo TS classifica 15 URLs corretamente",
  failures.length === 0,
  failures.join(" · "),
);

// O fonte em `src/sw-source.js` precisa concordar com o módulo TS. O SW roda
// sozinho (não pode importar TS), então a concordância é verificada por
// comportamento: extraímos a função do arquivo e a executamos.
// `isSensitive` usa `isSupabaseImage` (foto pública pode ser cacheada), então as
// duas funções vão juntas para o sandbox.
const sensitiveFnSource = swSource.slice(
  swSource.indexOf("function isSensitive(url)"),
  swSource.indexOf("function isStaticAsset"),
);
const imageFnSource = swSource.slice(
  swSource.indexOf("function isSupabaseImage(url)"),
  swSource.indexOf("/* ---", swSource.indexOf("function isSupabaseImage(url)")),
);
const swSensitive = new Function(
  `${sensitiveFnSource}\n${imageFnSource}\nreturn isSensitive;`,
)();

const swFailures = [];
for (const url of SENSITIVE) {
  if (!swSensitive(new URL(url, "https://menuvo.app"))) swFailures.push(`SW deixou passar ${url}`);
}
for (const url of SAFE) {
  if (swSensitive(new URL(url, "https://menuvo.app"))) swFailures.push(`SW marcou como sensível ${url}`);
}

check(
  "cache: service worker concorda com o módulo TS",
  swFailures.length === 0,
  swFailures.join(" · "),
);

check(
  "cache: SW ignora tudo que não é GET",
  /request\.method !== "GET"\) return/.test(swSource),
);
check(
  "cache: SW apaga caches de versões antigas no activate",
  /caches\.delete/.test(swSource) && /activate/.test(swSource),
);
check("cache: SW tem teto de entradas (celular tem pouco espaço)", /LIMITS/.test(swSource) && /trim\(/.test(swSource));
check(
  "cache: SW não quebra a instalação por um arquivo faltando",
  /\.catch\(\(\) => undefined\)/.test(swSource),
);

/* =========================== segurança geral =========================== */

// Nada de credencial no que é público por definição.
const publicFiles = {
  "src/sw-source.js": swSource,
  "src/lib/pwa.ts": read("src/lib/pwa.ts"),
  "src/app/manifest.webmanifest/route.ts": manifestSource,
};

for (const [file, source] of Object.entries(publicFiles)) {
  const leaks = [
    /SUPABASE_SERVICE_ROLE/i,
    /service_role/i,
    /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/, // formato de JWT
    /password\s*[:=]/i,
  ].filter((pattern) => pattern.test(source));

  check(`segurança: sem credencial em ${file}`, leaks.length === 0, String(leaks.length));
}

check(
  "segurança: service worker registrado só em produção",
  /NODE_ENV !== "production"/.test(read("src/components/pwa/register-sw.tsx")),
);
check(
  "segurança: SW servido com no-cache (senão correção nunca chega)",
  /must-revalidate/.test(read("next.config.ts")),
);

/* ============================== relatório ============================== */

const passed = results.filter((r) => r.ok).length;
console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\npwa-lib: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
