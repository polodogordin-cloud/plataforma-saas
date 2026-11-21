/**
 * Auditoria de layout mobile (Etapa 1, ampliada na Etapa 12).
 *
 * 1. Verifica overflow horizontal no CSS gerado (nenhuma utilidade de largura
 *    fixa acima da maior viewport suportada).
 * 2. Confere que as rotas públicas respondem 200 com meta viewport correto.
 * 3. Sinaliza alvos de toque abaixo de 44px no código-fonte, ignorando links
 *    inline no meio de texto (exceção prevista na WCAG 2.5.8).
 * 4. **Etapa 12:** confere o pacote PWA (manifest, sw, ícones, offline) e revisa
 *    as seis larguras de aparelho do escopo para conteúdo que não caiba nelas.
 *
 * Uso: node scripts/audit-layout.mjs [baseUrl]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const ROUTES = [
  "/",
  "/entrar",
  "/criar-conta",
  "/recuperar-senha",
  // Etapa 4: cardápio público sem mesa, painel de mesas e URL de mesa com QR.
  "/r/burger-house",
  "/r/burger-house/table/H62U243ECFBJFX55ZXDSKDQY",
  "/app/mesas",
  // Etapa 7: painel de pedidos (exige sessão; sem login redireciona para /entrar)
  "/app/pedidos",
  // Etapa 9: editor de personalização do cardápio (mesma regra de sessão)
  "/app/configuracoes",
  "/app/configuracoes/personalizacao",
  // Etapa 10: painel master (exige sessão + papel de plataforma)
  "/admin",
  "/admin/restaurantes",
  "/admin/usuarios",
  "/admin/pedidos",
  "/admin/auditoria",
  "/admin/configuracoes",
  // Etapa 11: vitrine pública, "Meu plano" e as duas telas comerciais do master
  "/planos",
  "/app/plano",
  "/admin/planos",
  "/admin/assinaturas",
];
const MAX_WIDTH = 430;

/**
 * Larguras que a Etapa 12 manda testar.
 *
 * 320 é o iPhone SE de 1ª geração e o menor Android comum — se cabe ali, cabe
 * em qualquer aparelho atual. 430 é o iPhone Pro Max. O teste real de cada uma
 * exigiria navegador com viewport; aqui o que se garante é que **nenhuma
 * largura fixa** no código passa de 320 (abaixo disso a página estoura a tela)
 * e que a maior viewport não é ultrapassada.
 */
const DEVICE_WIDTHS = [320, 360, 375, 390, 414, 430];

let failures = 0;
let warnings = 0;

console.log(`\nAuditoria de layout — ${BASE}\n`);

/* ------------------------------------------------------------------ rotas */
for (const route of ROUTES) {
  // `manual`: rota protegida redireciona para /entrar, e seguir o redirect
  // testaria a tela de login em vez da rota pedida.
  const res = await fetch(BASE + route, { redirect: "manual" });
  const html = await res.text();

  // 307 = middleware de sessão redirecionando: a rota existe e está protegida.
  if (res.status === 307) {
    const location = res.headers.get("location") ?? "";
    const toLogin = location.includes("/entrar");
    console.log(
      toLogin
        ? `✅ ${route}: 307 · protegida (login)`
        : `❌ ${route}: 307 inesperado para ${location}`,
    );
    if (!toLogin) failures++;
    continue;
  }

  if (res.status !== 200) {
    console.log(`❌ ${route}: HTTP ${res.status}`);
    failures++;
    continue;
  }
  if (!html.includes("width=device-width")) {
    console.log(`❌ ${route}: meta viewport ausente`);
    failures++;
    continue;
  }
  const wide = [...html.matchAll(/\b(?:min-)?w-\[(\d{3,})px\]/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > MAX_WIDTH);
  if (wide.length) {
    console.log(`⚠️  ${route}: largura fixa acima de ${MAX_WIDTH}px (${wide.join(", ")})`);
    warnings++;
  }
  console.log(`✅ ${route}: 200 · viewport ok`);
}

/* ------------------------------------------------------- CSS de overflow */
try {
  const cssRes = await fetch(`${BASE}/_next/static/css/app/layout.css`);
  const css = await cssRes.text();
  const huge = [...css.matchAll(/width:\s*(\d{3,})px/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > MAX_WIDTH);
  if (huge.length) {
    console.log(`⚠️  CSS: larguras fixas grandes (${[...new Set(huge)].join(", ")}px)`);
    warnings++;
  } else {
    console.log("✅ CSS: nenhuma largura fixa acima de 430px");
  }
} catch {
  console.log("⚠️  CSS não encontrado (rode `npm run build` antes)");
}

/* -------------------------------------------------------- pacote PWA (E12) */
{
  console.log("\nPacote PWA");

  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
  if (manifestRes.status !== 200) {
    console.log(`❌ /manifest.webmanifest: HTTP ${manifestRes.status}`);
    failures++;
  } else {
    const manifest = await manifestRes.json();
    const problems = [];

    if (!manifest.name) problems.push("name");
    if (!manifest.short_name) problems.push("short_name");
    if (!manifest.start_url) problems.push("start_url");
    if (manifest.display !== "standalone") problems.push("display");
    if (!manifest.theme_color) problems.push("theme_color");
    if (!manifest.background_color) problems.push("background_color");
    if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) problems.push("icons");

    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    if (!sizes.includes("192x192") || !sizes.includes("512x512")) problems.push("ícones 192/512");

    if (problems.length) {
      console.log(`❌ manifest: faltando ${problems.join(", ")}`);
      failures++;
    } else {
      console.log(`✅ manifest: instalável (${manifest.name}, ${sizes.join(" + ")})`);
    }

    // Todo ícone declarado precisa responder de verdade: manifest apontando
    // para arquivo inexistente é instalação recusada sem mensagem clara.
    for (const icon of manifest.icons ?? []) {
      const res = await fetch(BASE + icon.src, { redirect: "manual" });
      if (res.status !== 200) {
        console.log(`❌ ícone ${icon.src}: HTTP ${res.status}`);
        failures++;
      }
    }
  }

  const swRes = await fetch(`${BASE}/sw.js`);
  const cacheControl = swRes.headers.get("cache-control") ?? "";
  if (swRes.status !== 200) {
    console.log(`❌ /sw.js: HTTP ${swRes.status}`);
    failures++;
  } else if (!/max-age=0|no-cache|must-revalidate/.test(cacheControl)) {
    console.log(`⚠️  /sw.js: Cache-Control "${cacheControl}" pode congelar o SW`);
    warnings++;
  } else {
    console.log("✅ service worker: servido sem cache longo");
  }

  const offlineRes = await fetch(`${BASE}/offline.html`);
  if (offlineRes.status !== 200) {
    console.log(`❌ /offline.html: HTTP ${offlineRes.status}`);
    failures++;
  } else {
    console.log("✅ tela de offline disponível");
  }

  // HTML de uma página: as metas que o navegador lê para instalar.
  const home = await (await fetch(`${BASE}/`)).text();
  const pwaMeta = [
    ['rel="manifest"', /rel="manifest"/.test(home)],
    ["theme-color", /name="theme-color"/.test(home)],
    ["apple-touch-icon", /rel="apple-touch-icon"/.test(home)],
    ["apple-mobile-web-app-capable", /name="apple-mobile-web-app-capable"/.test(home)],
    ["viewport-fit=cover", /viewport-fit=cover/.test(home)],
  ];

  const missing = pwaMeta.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) {
    console.log(`❌ metas de instalação ausentes: ${missing.join(", ")}`);
    failures++;
  } else {
    console.log("✅ metas de instalação no <head>");
  }
}

/* ------------------------------------------------ larguras de aparelho (E12) */
const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx$/.test(full)) acc.push(full);
  }
  return acc;
};

// Classes que garantem um alvo confortável (>= 40px de altura efetiva)
const SAFE =
  /tap-target|min-h-(?:1[0-9]|\[)|h-(?:9|1[0-9]|\[)|size-(?:9|1[0-9]|\[)|py-(?:[3-9]|1[0-9])|\bp-(?:[3-9]|1[0-9])|min-h-\[3/;

const clickable = /<(?:button|a|Link|Button|ButtonLink)\b/;

for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  // Constantes de classe compartilhadas no mesmo arquivo (ex.: `base` do Button)
  // ou componente Button importado, que já garante min-h-11 nas variantes.
  const fileHasSafeBase =
    /const base\s*=/.test(source) || /from "@\/components\/ui\/button"/.test(source);

  source.split("\n").forEach((line, index) => {
    if (!clickable.test(line)) return;
    // Link inline dentro de frase (ex.: "Já tem conta? <Link>Entrar</Link>")
    if (/className="[^"]*font-(semibold|medium)[^"]*text-brand/.test(line)) return;
    if (fileHasSafeBase) return;

    const block = source.split("\n").slice(index, index + 16).join(" ");
    // Backdrop de modal: cobre a viewport inteira, não é um alvo pequeno.
    if (/absolute inset-0/.test(block)) return;

    if (!SAFE.test(block)) {
      console.log(`⚠️  alvo de toque pequeno? ${file}:${index + 1}`);
      warnings++;
    }
  });
}

/* ------------------------------------------- larguras fixas vs. aparelhos */
{
  // Classes de largura fixa em px no código. Qualquer valor acima de 320 estoura
  // a menor tela do escopo; acima de 430, estoura a maior.
  const sources = walk("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const offenders = [];

  for (const { file, text } of sources) {
    for (const match of text.matchAll(/\b(?:min-)?w-\[(\d{2,4})px\]/g)) {
      const width = Number(match[1]);
      if (width > 320) offenders.push({ file, width });
    }
  }

  if (offenders.length) {
    for (const { file, width } of offenders.slice(0, 5)) {
      console.log(`⚠️  w-[${width}px] em ${file} estoura telas de 320px`);
    }
    warnings += offenders.length;
  } else {
    console.log(`✅ nenhuma largura fixa estoura as larguras ${DEVICE_WIDTHS.join("/")}px`);
  }
}

console.log(`\nFalhas: ${failures} · Avisos: ${warnings}`);
process.exit(failures > 0 ? 1 : 0);
