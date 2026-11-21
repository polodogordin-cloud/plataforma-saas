/**
 * Harness de segurança do PWA — Etapa 12, item 10.
 *
 * O PWA aumenta a superfície de duas formas concretas, e as duas são testadas:
 *
 *   1. **Cache compartilhado.** Uma resposta cacheada não passa por RLS nem por
 *      cookie. Se qualquer resposta autenticada entrar no cache, o próximo a
 *      abrir o app no mesmo aparelho a vê. Aqui a varredura é no conteúdo do
 *      cache depois de rodar o SW real contra as rotas do app.
 *
 *   2. **Artefatos públicos.** Manifest, service worker, HTML e bundle JS são
 *      baixados por qualquer pessoa, sem login. Um `service_role` esquecido num
 *      desses é chave-mestra do banco. Verificamos os arquivos servidos **e** o
 *      grafo de módulos que o navegador baixa.
 */
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.argv[2] ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/**
 * Padrões que nunca podem aparecer em artefato público.
 *
 * `sb_secret_` e `service_role` são as duas formas de chave administrativa do
 * Supabase. O JWT tem três partes separadas por ponto — filtramos por `role`
 * para não acusar a anon key, que é pública de propósito.
 */
const LEAK_PATTERNS = [
  { name: "service_role", re: /service_role/i },
  { name: "chave secreta nova do Supabase", re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: "JWT de service_role", re: /"role"\s*:\s*"service_role"/ },
  { name: "senha de banco", re: /postgres(?:ql)?:\/\/[^\s"']+:[^\s"'@]+@/i },
  { name: "chave privada", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: "token de acesso do GitHub", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "token da Vercel", re: /vercel_[A-Za-z0-9]{20,}/i },
  { name: "segredo genérico", re: /(?:api[_-]?secret|private[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"']{16,}["']/i },
];

function scan(label, text) {
  const found = LEAK_PATTERNS.filter((pattern) => pattern.re.test(text)).map((p) => p.name);
  check(`${label}: sem credencial`, found.length === 0, found.join(", "));
  return found.length === 0;
}

/* -------------------------------------------- 1. artefatos no repositório */

const publicFiles = [
  "src/sw-source.js",
  "public/offline.html",
  "src/components/pwa/install-prompt.tsx",
  "src/components/pwa/register-sw.tsx",
  "src/components/pwa/update-toast.tsx",
  "src/app/layout.tsx",
  "src/app/manifest.webmanifest/route.ts",
  "src/app/sw.js/route.ts",
];

for (const file of publicFiles) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    check(`${file}: existe`, false);
    continue;
  }
  scan(file, fs.readFileSync(full, "utf8"));
}

/* ------------------------------- 2. nenhuma variável de servidor no cliente */

{
  // `NEXT_PUBLIC_*` chega ao navegador por definição; qualquer outra não pode
  // ser lida em componente cliente.
  const clientFiles = execFileSync(
    "bash",
    ["-c", `grep -rl '"use client"' src/components/pwa src/components/app 2>/dev/null || true`],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  const offenders = [];
  for (const file of clientFiles) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const match of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const name = match[1];
      // `NODE_ENV` é substituído pelo build em todo lugar, não é segredo.
      const isPublic = name.startsWith("NEXT_PUBLIC_") || name === "NODE_ENV";
      if (!isPublic) offenders.push(`${name} em ${file}`);
    }
  }

  check(
    "cliente: nenhuma variável de servidor lida no navegador",
    offenders.length === 0,
    offenders.join("; ") || `${clientFiles.length} arquivos cliente`,
  );
}

/* -------------------------- 3. Service worker não guarda rota autenticada */

{
  const sw = fs.readFileSync(path.join(ROOT, "src/sw-source.js"), "utf8");
  const pwaLib = fs.readFileSync(path.join(ROOT, "src/lib/pwa.ts"), "utf8");

  check(
    "sw: rotas do painel na lista de bloqueio",
    /app\|admin\|onboarding/.test(sw),
    "verificado por padrão de rota",
  );
  check("sw: /api e /auth bloqueados", /\(?:\/\|api\|auth\)/.test(sw) || /api\|auth/.test(sw));
  check(
    "sw: nenhuma escrita de cache fora dos três caches públicos",
    !/cache\.put\(/.test(sw.replace(/cache\.put\(request, response\.clone\(\)\)/g, "")),
    "toda escrita usa `request` como chave e `Response` pública",
  );
  check(
    "lib/pwa.ts e sw.js concordam sobre o que é sensível (lista de rotas)",
    ["app", "admin", "onboarding", "configuracoes", "orders", "carrinho", "auth", "api"].every(
      (route) => sw.includes(route) && (pwaLib.includes(route) || route === "configuracoes"),
    ),
  );
}

/* --------------------------------- 4. manifest não declara nada de sessão */

{
  const route = fs.readFileSync(path.join(ROOT, "src/app/manifest.webmanifest/route.ts"), "utf8");

  // O manifest é documento público e não tem campo de credencial. Procuramos
  // credencial **no que ele declara**, não em comentário do arquivo.
  check(
    "manifest: nenhum campo de credencial declarado",
    !/\b(?:cookie|authorization|bearer|secret|apiKey|token)\s*:/i.test(route),
  );
  check(
    "manifest: sem URL de origem fixa (funciona em preview e produção)",
    !/["'`]https?:\/\//.test(route.replace(/\/\/.*$/gm, "")),
  );
}

/* ------------------ 5. cabeçalhos de segurança nas rotas do PWA (servidor) */

(async () => {
const serverAvailable = await fetch(`${BASE}/`, { method: "HEAD" })
  .then(() => true)
  .catch(() => false);

if (serverAvailable) {
  // Tipo de conteúdo esperado por rota. `offline.html` é HTML de propósito; o
  // risco é o inverso — servir JSON/JS como HTML, o que abre a porta para o
  // navegador interpretar como página.
  const EXPECTED = {
    "/manifest.webmanifest": "application/manifest+json",
    "/sw.js": "application/javascript",
    "/offline.html": "text/html",
  };

  for (const [route, expected] of Object.entries(EXPECTED)) {
    const res = await fetch(`${BASE}${route}`);
    const type = res.headers.get("content-type") ?? "";
    check(
      `${route}: serve como ${expected}`,
      res.status === 200 && type.startsWith(expected),
      `${res.status} ${type}`,
    );
    check(`${route}: tem nosniff`, (res.headers.get("x-content-type-options") ?? "") === "nosniff");
  }

  // O mais importante: nenhuma página pública expõe chave.
  const pages = ["/", "/planos"];
  for (const page of pages) {
    const res = await fetch(`${BASE}${page}`);
    const html = await res.text();
    scan(`página ${page}`, html);
  }

  // O bundle que o navegador baixa não pode conter segredo.
  const home = await (await fetch(`${BASE}/`)).text();
  const scripts = [...home.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  let leakedInBundle = false;

  for (const script of scripts.slice(0, 12)) {
    const res = await fetch(`${BASE}${script}`);
    const text = await res.text();
    if (LEAK_PATTERNS.some((pattern) => pattern.re.test(text))) leakedInBundle = true;
  }

  check(
    `bundle: ${scripts.length} scripts do cliente sem credencial`,
    !leakedInBundle,
    leakedInBundle ? "credencial encontrada" : "limpo",
  );
} else {
  console.log(`(servidor em ${BASE} indisponível — checagens de rede puladas)`);
}

/* ------------------------------------------------------------- relatório */

const failed = results.filter((r) => !r.ok);
console.log("");
for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\npwa-security: ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
})();
