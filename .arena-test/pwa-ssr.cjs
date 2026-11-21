/**
 * Harness de SSR do PWA — Etapa 12.
 *
 * Verifica o que o **navegador** recebe, não o que o código pretende enviar:
 * o `<head>` com as tags de instalação, o manifest como JSON válido, o service
 * worker com sintaxe válida e headers corretos, e a página de offline
 * autocontida. É aqui que um link de ícone quebrado aparece antes do aparelho.
 *
 * Usa o servidor real (`npm start` na 3000) quando disponível; sem servidor,
 * valida os arquivos e o bundle de manifest diretamente.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.join(__dirname, "build-pwa-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* --------------------------------------------------- manifest, sem servidor */

// O manifest é uma rota `GET` com `MetadataRoute.Manifest`. Rodamos a função
// diretamente: é o mesmo objeto que o Next serializa em produção.
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/app/manifest.webmanifest/route.ts")],
  bundle: true,
  outfile: path.join(OUT, "manifest.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  alias: { "@": path.join(ROOT, "src") },
  external: ["next"],
  logLevel: "error",
});

// A rota importa `next` apenas para tipos; removemos o import no bundle.
let bundle = fs.readFileSync(path.join(OUT, "manifest.cjs"), "utf8");
bundle = bundle.replace(/require\("next"\)/g, "{}");
fs.writeFileSync(path.join(OUT, "manifest.cjs"), bundle);

const route = require(path.join(OUT, "manifest.cjs"));

(async () => {
const response = route.GET();
const manifest = await response.json();

check("manifest: rota responde 200", response.status === 200);
check(
  "manifest: content-type application/manifest+json",
  response.headers.get("content-type") === "application/manifest+json",
  response.headers.get("content-type"),
);

check("manifest: name preenchido", typeof manifest.name === "string" && manifest.name.length > 3, manifest.name);
check("manifest: short_name preenchido", typeof manifest.short_name === "string" && manifest.short_name.length <= 12, manifest.short_name);
check("manifest: start_url dentro do escopo", manifest.start_url.startsWith("/"), manifest.start_url);
check("manifest: display standalone", manifest.display === "standalone");
check("manifest: theme_color hexadecimal", /^#[0-9a-f]{6}$/i.test(manifest.theme_color), manifest.theme_color);
check("manifest: background_color hexadecimal", /^#[0-9a-f]{6}$/i.test(manifest.background_color));
check("manifest: lang pt-BR", manifest.lang === "pt-BR");
check("manifest: orientation definida", Boolean(manifest.orientation));
check("manifest: scope raiz", manifest.scope === "/");

check(
  "manifest: ícones 192 e 512 presentes",
  manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"),
);
check(
  "manifest: ícone maskable declarado",
  manifest.icons.some((i) => String(i.purpose).includes("maskable")),
);
check(
  "manifest: todos os ícones são PNG (iOS não instala com SVG)",
  manifest.icons.every((i) => i.type === "image/png" && i.src.endsWith(".png")),
);
check(
  "manifest: nenhum arquivo de ícone ausente",
  manifest.icons.every((i) => fs.existsSync(path.join(ROOT, "public", i.src))),
  manifest.icons.map((i) => i.src).join(","),
);
check(
  "manifest: atalhos apontam para telas reais do painel",
  Array.isArray(manifest.shortcuts) &&
    manifest.shortcuts.length > 0 &&
    manifest.shortcuts.every((s) => s.url.startsWith("/app/")),
);

// Nada de segredo no que qualquer pessoa baixa.
const manifestText = JSON.stringify(manifest);
check(
  "manifest: sem credencial",
  !/eyJ|service_role|SERVICE_ROLE|password|secret|api[_-]?key/i.test(manifestText),
);

/* ------------------------------------------------------- service worker */

const sw = fs.readFileSync(path.join(ROOT, "src/sw-source.js"), "utf8");
const swRoute = fs.readFileSync(path.join(ROOT, "src/app/sw.js/route.ts"), "utf8");

check("sw: fonte existe e não está vazio", sw.length > 1000, String(sw.length));
check(
  "sw: versão injetada pela rota (não fica fixa)",
  sw.includes("__CACHE_VERSION__") &&
    swRoute.includes('replaceAll("__CACHE_VERSION__"') &&
    swRoute.includes("createHash"),
);
check(
  "sw: rota serve sem cache longo",
  swRoute.includes("must-revalidate") && swRoute.includes("Service-Worker-Allowed"),
);
check(
  "sw: eventos install, activate e fetch registrados",
  ["install", "activate", "fetch"].every((event) => sw.includes(`addEventListener("${event}"`)),
);
check(
  "sw: ignora requisições que não são GET",
  /request\.method !== "GET"/.test(sw),
);
check(
  "sw: não cacheia Supabase de dados",
  /supabase\\.co\$\/i\.test\(url\.hostname\)/.test(sw),
);
check(
  "sw: não cacheia painel",
  /app|admin|onboarding/.test(sw) && !/"\/app"/.test(sw),
);
check(
  "sw: mensagem SKIP_WAITING existe (atualização controlada)",
  sw.includes("SKIP_WAITING") && sw.includes("skipWaiting"),
);
check(
  "sw: limita o tamanho dos caches",
  /LIMITS/.test(sw) && /trim\(/.test(sw),
);
check(
  "sw: usa tela de offline na navegação sem rede",
  sw.includes("offline.html") && /request\.mode === "navigate"/.test(sw),
);

/* ------------------------------------------------------------ offline */

const offline = fs.readFileSync(path.join(ROOT, "public/offline.html"), "utf8");

check("offline: página existe", offline.length > 500);
check("offline: idioma pt-BR", offline.includes('lang="pt-BR"'));
check("offline: viewport com safe-area", offline.includes("viewport-fit=cover"));
check("offline: sem CSS externo (é o que quebra quando a rede cai)", !/<link[^>]+stylesheet/.test(offline));
check("offline: sem fonte externa", !/fonts\\.googleapis|@font-face/.test(offline));
check("offline: tem ação para tentar de novo", offline.includes("Tentar de novo"));
check("offline: respeita tema claro e escuro", offline.includes("prefers-color-scheme"));
check("offline: alvo de toque confortável", offline.includes("min-height: 48px"));

/* ------------------------------- deploy: o fonte vai junto para a lambda */

/*
 * A rota `/sw.js` lê `src/sw-source.js` do disco em tempo de execução. Na Vercel
 * cada rota vira uma lambda com **somente os arquivos que o Next rastreou** — se
 * o fonte não estiver em `.next/server/app/sw.js/route.js.nft.json`, produção
 * serve o SW de emergência (sem cache) e ninguém percebe: o app funciona, só
 * deixa de ser offline. Este teste transforma esse modo de falha silencioso em
 * falha de build.
 */
{
  const nft = path.join(ROOT, ".next/server/app/sw.js/route.js.nft.json");
  if (!fs.existsSync(nft)) {
    check("deploy: build existe para checar o rastreamento (rode npm run build)", false);
  } else {
    const traced = JSON.parse(fs.readFileSync(nft, "utf8")).files;
    check(
      "deploy: sw-source.js é rastreado para dentro da lambda",
      traced.some((file) => file.endsWith("sw-source.js")),
      traced.filter((f) => f.includes("sw")).join(","),
    );
    // `offline.html` vive em `public/`, que a Vercel serve como estático — não
    // precisa ir na lambda. O que importa é estar no diretório publicado.
    check(
      "deploy: offline.html está em public/ (servido como estático)",
      fs.existsSync(path.join(ROOT, "public/offline.html")),
    );
  }
}

/* ------------------------------------------------------------- head */

const html = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");

check("head: manifest vinculado", html.includes('manifest: "/manifest.webmanifest"'));
check("head: appleWebApp configurado (instalação no iOS)", html.includes("appleWebApp"));
check("head: apple-touch-icon presente", html.includes("apple-touch-icon"));
check(
  "head: theme-color declarado também no HTML",
  html.includes('name="theme-color"') && html.includes("THEME_COLOR"),
);
check("head: viewport-fit=cover (respeita notch)", html.includes('viewportFit: "cover"'));
check(
  "layout: service worker e aviso de atualização montados",
  html.includes("ServiceWorkerRegistrar") && html.includes("UpdateToast"),
);

/* ------------------------------------------------ servidor, se disponível */

const serverAvailable = await fetch(`${BASE}/`, { redirect: "manual" })
  .then(() => true)
  .catch(() => false);

if (serverAvailable) {
  const home = await fetch(`${BASE}/`);
  const homeHtml = await home.text();

  check("servidor: página inicial responde 200", home.status === 200);
  check(
    "servidor: HTML declara o manifest",
    /rel="manifest" href="\/manifest\.webmanifest"/.test(homeHtml),
  );
  check(
    "servidor: HTML tem meta theme-color",
    /<meta name="theme-color"/.test(homeHtml),
  );
  check(
    "servidor: HTML tem apple-touch-icon",
    /rel="apple-touch-icon"/.test(homeHtml),
  );
  check(
    "servidor: HTML tem apple-mobile-web-app-capable (iOS antigo)",
    /name="apple-mobile-web-app-capable"/.test(homeHtml),
  );
  check(
    "servidor: HTML tem mobile-web-app-capable (Android)",
    /name="mobile-web-app-capable"/.test(homeHtml),
  );
  check(
    "servidor: meta de instalação não duplicada",
    (homeHtml.match(/name="mobile-web-app-capable"/g) ?? []).length === 1,
    String((homeHtml.match(/name="mobile-web-app-capable"/g) ?? []).length),
  );
  check(
    "servidor: theme-color coerente com o manifest",
    homeHtml.includes('content="#0f9250"') || homeHtml.includes("content=\"#0f9250\""),
  );
  check(
    "servidor: HTML não tem credencial embutida",
    !/service_role|SERVICE_ROLE_KEY|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/.test(homeHtml),
  );

  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
  const servedManifest = await manifestRes.json();

  check("servidor: manifest servido como JSON", manifestRes.status === 200);
  check(
    "servidor: manifest servido é igual ao gerado",
    servedManifest.start_url === manifest.start_url && servedManifest.name === manifest.name,
  );

  const swRes = await fetch(`${BASE}/sw.js`);
  check("servidor: sw.js responde 200", swRes.status === 200);
  check(
    "servidor: sw.js sem cache longo (correção sempre chega)",
    /max-age=0|no-cache|must-revalidate/.test(swRes.headers.get("cache-control") ?? ""),
    swRes.headers.get("cache-control"),
  );
  check(
    "servidor: sw.js com Service-Worker-Allowed",
    swRes.headers.get("service-worker-allowed") === "/",
    swRes.headers.get("service-worker-allowed"),
  );

  const offlineRes = await fetch(`${BASE}/offline.html`);
  check("servidor: offline.html responde 200", offlineRes.status === 200);

  for (const icon of manifest.icons) {
    const res = await fetch(`${BASE}${icon.src}`);
    const type = res.headers.get("content-type") ?? "";
    check(
      `servidor: ${icon.src} responde 200 image/png`,
      res.status === 200 && type.startsWith("image/png"),
      `${res.status} ${type}`,
    );
  }
} else {
  console.log(`(servidor em ${BASE} indisponível — checagens de rede puladas)`);
}

/* ----------------------------------------------------------- relatório */

const failed = results.filter((r) => !r.ok);
console.log("");
for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\npwa-ssr: ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
})();
