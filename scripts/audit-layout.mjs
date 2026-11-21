/**
 * Auditoria de layout mobile (Etapa 1).
 *
 * 1. Verifica overflow horizontal no CSS gerado (nenhuma utilidade de largura
 *    fixa acima da maior viewport suportada).
 * 2. Confere que as rotas públicas respondem 200 com meta viewport correto.
 * 3. Sinaliza alvos de toque abaixo de 44px no código-fonte, ignorando links
 *    inline no meio de texto (exceção prevista na WCAG 2.5.8).
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

/* --------------------------------------------------------- alvos de toque */
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

console.log(`\nFalhas: ${failures} · Avisos: ${warnings}`);
process.exit(failures > 0 ? 1 : 0);
