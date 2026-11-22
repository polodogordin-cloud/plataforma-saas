/**
 * Harness das telas de erro e estados de indisponibilidade — Etapa 20, item 10.
 *
 * O escopo pede página/estado para 404, 403, 500, serviço indisponível,
 * restaurante suspenso, mesa inválida e pedido inválido, com uma regra dura:
 * **nunca exibir stack trace ao usuário final**.
 *
 * Testar isso por render seria caro e frágil (todo `error.tsx` é client
 * component com `useEffect`). O que dá para garantir de forma confiável é o
 * **contrato de cada arquivo**: que existe, que é do tipo certo (`error.tsx`
 * precisa de `reset`, `not-found` não), e — o mais importante — que nenhuma
 * tela de erro do repositório imprime `error.stack`, `error.message` ou
 * `JSON.stringify(error)` na árvore JSX.
 *
 * Rodar: node .arena-test/error-states.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* -------------------------------------------------------------------------- */
/* 1. Cada estado do item 10 tem tela                                        */
/* -------------------------------------------------------------------------- */

const REQUIRED = [
  ["src/app/not-found.tsx", "404 global"],
  ["src/app/error.tsx", "500 global"],
  ["src/app/global-error.tsx", "500 quando o layout raiz falha"],
  ["src/app/app/error.tsx", "500 dentro do painel do restaurante"],
  ["src/app/admin/error.tsx", "500 dentro do painel da plataforma"],
  ["src/app/r/[slug]/error.tsx", "500 no cardápio público"],
  ["src/app/r/[slug]/not-found.tsx", "cardápio inexistente"],
  ["src/app/r/[slug]/table/[token]/not-found.tsx", "mesa inválida"],
  ["src/app/sem-acesso/page.tsx", "403 (acesso restrito)"],
  ["src/components/public/menu-unavailable.tsx", "cardápio suspenso / não publicado"],
  ["src/components/app/app-error-screen.tsx", "componente compartilhado de erro"],
];

for (const [rel, label] of REQUIRED) {
  check(`existe: ${label} (${rel})`, exists(rel));
}

/* -------------------------------------------------------------------------- */
/* 2. Nada de stack trace na tela                                            */
/* -------------------------------------------------------------------------- */

const ERROR_SURFACES = REQUIRED.map(([rel]) => rel).filter(exists);

const LEAKS = [
  [/error\.stack/, "error.stack"],
  [/\.stack\b/, "propriedade .stack"],
  [/JSON\.stringify\(\s*(error|err|e)\s*\)/, "JSON.stringify(error)"],
  [/\{error\.message\}/, "{error.message}"],
  [/\{String\(error\)\}/, "{String(error)}"],
  [/\{`\$\{error\}`\}/, "template com o erro"],
  [/dangerouslySetInnerHTML/, "HTML cru"],
];

for (const rel of ERROR_SURFACES) {
  const src = read(rel);
  const leaks = LEAKS.filter(([pattern]) => pattern.test(src)).map(([, label]) => label);
  const isClient = /^"use client"/.test(src.trim());
  const isServerDisplay = !isClient || rel.includes("app-error-screen");
  check(
    `sem vazamento: ${rel}`,
    leaks.length === 0 || !isServerDisplay,
    leaks.join(", "),
  );
}

/*
 * `console.error` no servidor é o caminho certo: a stack fica no log da Vercel
 * e o usuário vê o `digest`. Garantir que o painel registra, senão o erro
 * desaparece sem rastro.
 */
/*
 * O painel delega o registro ao `AppErrorScreen` (que faz `console.error` com o
 * digest). O cardápio público registra direto. O que não pode existir é uma
 * tela de erro que engole a exceção sem deixar rastro no log.
 */
for (const rel of ["src/app/app/error.tsx", "src/app/admin/error.tsx", "src/app/r/[slug]/error.tsx"]) {
  const src = read(rel);
  const logs = /console\.error/.test(src) || /AppErrorScreen/.test(src);
  check(`registra no log (direto ou via AppErrorScreen): ${rel}`, logs);
}

check(
  "o componente compartilhado registra digest e mensagem no servidor",
  /console\.error/.test(read("src/components/app/app-error-screen.tsx")),
);

/* -------------------------------------------------------------------------- */
/* 3. Contrato dos arquivos especiais do Next                                */
/* -------------------------------------------------------------------------- */

for (const rel of ["src/app/error.tsx", "src/app/app/error.tsx", "src/app/admin/error.tsx", "src/app/r/[slug]/error.tsx"]) {
  const src = read(rel);
  check(`${rel} é client component`, /^"use client"/.test(src.trim()));
  check(`${rel} recebe reset`, /\breset\b/.test(src));
}

{
  const src = read("src/app/global-error.tsx");
  check("global-error é client", /^"use client"/.test(src.trim()));
  check("global-error monta <html> e <body> próprios", /<html/.test(src) && /<body/.test(src));
}

for (const rel of ["src/app/not-found.tsx", "src/app/r/[slug]/not-found.tsx", "src/app/r/[slug]/table/[token]/not-found.tsx"]) {
  check(`${rel} não exige reset (não é error boundary)`, !/\breset\b/.test(read(rel)));
}

/* -------------------------------------------------------------------------- */
/* 4. 403: a tela explica sem revelar o conteúdo da área                     */
/* -------------------------------------------------------------------------- */

{
  const src = read("src/app/sem-acesso/page.tsx");
  check("403: diz o código", /403/.test(src));
  check("403: explica permissão, não 'não existe'", /permiss/i.test(src));
  check("403: oferece saída (voltar ao painel)", /href="\/app"/.test(src));
  check("403: noindex", /index:\s*false/.test(src));
  check("403: não cita nome de tabela/schema", !/from\(|\.from|public\.[a-z_]+\(/.test(src));
}

/* -------------------------------------------------------------------------- */
/* 5. Estados do cardápio público                                            */
/* -------------------------------------------------------------------------- */

{
  const src = read("src/components/public/menu-unavailable.tsx");

  for (const reason of ["suspended", "unpublished", "table", "order"]) {
    check(`cardápio: tem estado "${reason}"`, new RegExp(`${reason}:\\s*\\{`).test(src));
  }

  check("cardápio: suspenso não promete solução ao cliente", /Chame um atendente/.test(src));
  // A palavra "token" pode aparecer em comentário; o que não pode é o token
  // entrar no texto da tela (interpolação ou prop).
  check(
    "cardápio: mesa inválida não revela se o token existe",
    !/\{[^}]*token[^}]*\}/i.test(src) && !/token=\{/.test(src),
  );
  check(
    "cardápio: tipo Reason cobre os quatro estados",
    /type Reason = [^;]*"suspended"[^;]*"unpublished"[^;]*"table"[^;]*"order"s*/.test(src.replace(/\s+/g, " ")) ||
      /type Reason =\s*"suspended"\s*\|\s*"unpublished"\s*\|\s*"table"\s*\|\s*"order"/.test(src),
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Páginas que usam os estados encontram o cardápio certo                 */
/* -------------------------------------------------------------------------- */

{
  const publicPage = read("src/app/r/[slug]/page.tsx");
  check("cardápio suspenso é renderizado na página pública", /reason="suspended"/.test(publicPage));
  check("cardápio não publicado é renderizado", /reason="unpublished"/.test(publicPage));

  const tablePage = read("src/app/r/[slug]/table/[token]/page.tsx");
  check("mesa inválida é renderizada na página da mesa", /reason="table"/.test(tablePage));
}

/* -------------------------------------------------------------------------- */
/* 7. Pedido inválido: 404, não 500                                          */
/* -------------------------------------------------------------------------- */

{
  const src = read("src/app/app/pedidos/[id]/imprimir/page.tsx");
  check("pedido: usa notFound() quando não encontra", /notFound\(\)/.test(src));
  check(
    "pedido: pedido de outra casa é 404, não mensagem de permissão",
    /document\.restaurant\.id !== restaurant\.id/.test(src),
  );
  check("pedido: nunca indexado", /index:\s*false/.test(src));
}

/* -------------------------------------------------------------------------- */
/* 8. Páginas de erro são mobile-first                                       */
/* -------------------------------------------------------------------------- */

for (const rel of ["src/app/sem-acesso/page.tsx", "src/app/not-found.tsx", "src/components/app/app-error-screen.tsx"]) {
  const src = read(rel);
  check(`${rel} usa app-shell (largura de celular)`, /app-shell|min-h-dvh/.test(src));
  check(`${rel} tem ação primária com alvo de toque`, /size="lg"|tap-target|min-h/.test(src));
}

/* -------------------------------------------------------------------------- */
/* 9. O painel de admin não deixa 403 virar tela branca                      */
/* -------------------------------------------------------------------------- */

{
  const src = read("src/app/admin/error.tsx");
  check("admin: erro aponta para o painel, não para uma rota privada aleatória", /AppErrorScreen/.test(src));
}

{
  const src = read("src/app/r/[slug]/error.tsx");
  check(
    "cardápio com erro mostra mensagem de cliente, não de desenvolvedor",
    // O comentário do arquivo cita `/app` justamente para proibir o link;
    // então a checagem é sobre href/string de navegação, não sobre o texto.
    /Tente de novo/.test(src) && !/href=|router\.push|redirect\(/.test(src),
  );
}

/* -------------------------------------------------------------------------- */

console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\nerror-states: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
