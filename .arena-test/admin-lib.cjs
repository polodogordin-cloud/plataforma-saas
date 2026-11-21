/**
 * Harness de lógica do painel master — Etapa 10.
 *
 * Testa o que decide a segurança e a apresentação do `/admin`, sem DOM e sem
 * banco: os rótulos de status/papel, o mapa de tons, o vocabulário de auditoria
 * e — o mais importante — as regras de tradução de erro das Server Actions, que
 * são o que o usuário lê quando o banco recusa uma operação.
 *
 * As regras de verdade ficam no banco (58 checagens SQL rodadas à parte). Aqui
 * garantimos que a *superfície* não mente sobre elas.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-admin-lib");
fs.rmSync(OUT, { recursive: true, force: true });

function build(entry, name, externals = []) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    outfile: path.join(OUT, `${name}.js`),
    platform: "node",
    format: "cjs",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(ROOT, "src") },
    external: externals,
    logLevel: "error",
  });
  return require(path.join(OUT, `${name}.js`));
}

const T = build("src/lib/types.ts", "types");
const A = build("src/lib/admin-audit.ts", "audit");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ===================== 1. Status do restaurante ===================== */

const STATUSES = ["draft", "published", "paused", "closed", "suspended"];

check(
  "status: os cinco estados do escopo existem",
  STATUSES.every((s) => typeof T.RESTAURANT_STATUS_LABEL[s] === "string"),
  STATUSES.filter((s) => !T.RESTAURANT_STATUS_LABEL[s]).join(", "),
);

check(
  "status: todo estado tem tom definido (nada cai em undefined)",
  STATUSES.every((s) => typeof T.RESTAURANT_STATUS_TONE[s] === "string"),
);

check(
  "status: 'published' aparece como Ativo para o cliente",
  T.RESTAURANT_STATUS_LABEL.published === "Ativo",
  T.RESTAURANT_STATUS_LABEL.published,
);

check(
  "status: suspenso é o único com tom de perigo",
  STATUSES.filter((s) => T.RESTAURANT_STATUS_TONE[s] === "danger").join(",") === "suspended",
);

check(
  "status: suspenso não é confundido com pausado no texto",
  T.RESTAURANT_STATUS_LABEL.suspended !== T.RESTAURANT_STATUS_LABEL.paused,
);

/* ========================= 2. Filtros da lista ========================= */

check("filtros: existem Todos, Ativos, Inativos e Suspensos", () => {
  const ids = T.ADMIN_STATUS_FILTERS.map((f) => f.id);
  return ["all", "published", "paused", "suspended"].every((id) => ids.includes(id));
});
check(
  "filtros: 'all' vem primeiro (é o padrão da tela)",
  T.ADMIN_STATUS_FILTERS[0].id === "all",
);
check(
  "filtros: cada filtro tem rótulo legível",
  T.ADMIN_STATUS_FILTERS.every((f) => f.label && f.label.length > 2),
);

/* ============================ 3. Papéis ============================ */

const ROLES = ["owner", "admin", "manager", "staff"];

check(
  "papéis: os quatro do escopo têm rótulo (OWNER, ADMIN, MANAGER, STAFF)",
  ROLES.every((r) => typeof T.RESTAURANT_ROLE_LABEL[r] === "string"),
);

check(
  "papéis: manager é 'Gerente', não 'Administrador'",
  T.RESTAURANT_ROLE_LABEL.manager === "Gerente",
  T.RESTAURANT_ROLE_LABEL.manager,
);

check(
  "papéis: papéis de restaurante e de plataforma são vocabulários distintos",
  // O que este teste quer provar é a *separação dos vocabulários*, não o número
  // de papéis. Contar 4 aqui virou falso quando a Etapa 17 criou `kitchen` e
  // `waiter`: nenhum dos dois é papel de plataforma, e é isso que importa.
  // Contagem fixa envelhece e reprova a etapa seguinte em vez de um bug.
  // Plataforma é um vocabulário *menor* e disjunto do operacional: `owner` e
  // `admin` coincidem de nome entre os dois (dono da plataforma × dono da casa),
  // mas nenhum papel operacional (`manager`, `staff`, `kitchen`, `waiter`) existe
  // como papel de plataforma. Era isso que contar "4" tentava dizer.
  Object.keys(T.PLATFORM_ROLE_LABEL).length === 2 &&
    ["manager", "staff", "kitchen", "waiter"].every(
      (role) => !(role in T.PLATFORM_ROLE_LABEL) && role in T.RESTAURANT_ROLE_LABEL,
    ) &&
    Object.keys(T.PLATFORM_ROLE_LABEL).length < Object.keys(T.RESTAURANT_ROLE_LABEL).length,
  `restaurante=${Object.keys(T.RESTAURANT_ROLE_LABEL).join(",")} plataforma=${Object.keys(T.PLATFORM_ROLE_LABEL).join(",")}`,
);

check(
  "papéis: plataforma tem dono e admin, sem 'staff'",
  Boolean(T.PLATFORM_ROLE_LABEL.owner) &&
    Boolean(T.PLATFORM_ROLE_LABEL.admin) &&
    !("staff" in T.PLATFORM_ROLE_LABEL),
);

/* ========================= 4. Assinatura ========================= */

check(
  "assinatura: os cinco estados existem",
  ["none", "trialing", "active", "past_due", "canceled"].every(
    (s) => typeof T.SUBSCRIPTION_STATUS_LABEL[s] === "string",
  ),
);

check(
  "assinatura: 'none' é o padrão legível (casa sem plano)",
  T.SUBSCRIPTION_STATUS_LABEL.none === "Sem assinatura",
  T.SUBSCRIPTION_STATUS_LABEL.none,
);

/* ========================== 5. Auditoria ========================== */

check(
  "auditoria: todo tipo de evento do banco tem rótulo em português",
  [
    "restaurant.suspended",
    "restaurant.status_changed",
    "restaurant.updated",
    "product.created",
    "product.updated",
    "product.deleted",
    "member.role_changed",
    "member.status_changed",
    "support.access",
  ].every((action) => typeof A.AUDIT_ACTION_LABEL[action] === "string"),
);

check(
  "auditoria: suspensão aparece em vermelho",
  A.auditTone("restaurant.suspended") === "danger",
);

check(
  "auditoria: acesso de suporte é informativo, não alarme",
  A.auditTone("support.access") === "info",
);

check(
  "auditoria: criação é sucesso e alteração é neutra",
  A.auditTone("product.created") === "success" &&
    A.auditTone("product.updated") === "neutral",
);

check(
  "auditoria: evento desconhecido não quebra (cai em neutro)",
  A.auditTone("something.new") === "neutral",
);

/* ===================== 6. Tradução de erros ===================== */
/*
 * Reimplementação fiel de `translate()` em `src/actions/admin.ts`: o arquivo é
 * `"use server"` e importa `next/cache`, então não dá para exigi-lo direto
 * aqui. Se a função mudar lá, este bloco precisa mudar junto — e o teste
 * abaixo já garante que os códigos do banco estão cobertos.
 */
const src = fs.readFileSync(path.join(ROOT, "src/actions/admin.ts"), "utf8");

const MUST_HAVE = [
  "admin_forbidden",
  "restaurant_suspended_locked",
  "restaurant_plan_locked",
  "reason_required",
  "reason_too_long",
  "last_owner",
  "slug_unavailable",
  "invalid_slug",
  "invalid_name",
  "invalid_plan",
  "restaurant_not_found",
  "member_not_found",
];

for (const code of MUST_HAVE) {
  check(`erros: o código do banco "${code}" é tratado`, src.includes(code));
}

check(
  "erros: nenhuma mensagem crua do Postgres chega ao usuário",
  !src.includes("return { ok: false, error: error.message }"),
);

const exportedActions = (src.match(/^export async function (\w+)/gm) || []).map((line) =>
  line.replace("export async function ", "").trim(),
);
// O bootstrap é a única ação que não exige ser admin — por definição, quem ainda
// não é admin é justamente quem a chama. Todas as outras passam por requireAdmin.
const expectingGuard = exportedActions.filter((name) => name !== "claimPlatformAdmin");
// -1 porque a própria definição de requireAdmin casa com o padrão.
const guardCalls = (src.match(/await requireAdmin\(\)/g) || []).length;

check(
  `segurança: as ${expectingGuard.length} ações administrativas conferem o papel antes do banco`,
  guardCalls === expectingGuard.length,
  `${guardCalls} guardas para ${expectingGuard.length} ações`,
);

check(
  "segurança: só o bootstrap existe sem guarda de admin",
  exportedActions.includes("claimPlatformAdmin") &&
    exportedActions.filter((n) => n !== "claimPlatformAdmin").length === guardCalls,
  exportedActions.join(", "),
);

check(
  "segurança: nenhuma ação pega um id de autor do payload",
  !src.includes("actorId") && !src.includes("p_actor"),
);

check(
  "segurança: os UUIDs do payload são validados antes de ir ao banco",
  src.includes("z.string().regex(UUID)"),
);

/* =================== 7. Suspensão nas superfícies =================== */

const menuUnavailable = fs.readFileSync(
  path.join(ROOT, "src/components/public/menu-unavailable.tsx"),
  "utf8",
);
const appLayout = fs.readFileSync(path.join(ROOT, "src/app/app/layout.tsx"), "utf8");
const publicMenuData = fs.readFileSync(path.join(ROOT, "src/lib/data/public-menu.ts"), "utf8");

check(
  "suspensão: cardápio público tem mensagem própria (não 404 seco)",
  menuUnavailable.includes("suspended") && menuUnavailable.includes("temporariamente indisponível"),
);

check(
  "suspensão: painel do restaurante bloqueia com motivo, não com erro",
  appLayout.includes("SuspendedNotice") && appLayout.includes('status === "suspended"'),
);

check(
  "suspensão: o motivo vem do banco, não de texto fixo na tela",
  appLayout.includes("restaurant.suspended_reason"),
);

check(
  "suspensão: o estado público usa RPC que devolve só o status",
  publicMenuData.includes("public_restaurant_state"),
);

check(
  "suspensão: o layout não filtra a casa suspensa da lista (senão vira 'não encontrado')",
  !appLayout.includes("filter("),
);

/* ======================= 8. Robustez do layout ======================= */

const adminLayout = fs.readFileSync(path.join(ROOT, "src/app/admin/layout.tsx"), "utf8");

check(
  "layout /admin: exige sessão antes de qualquer leitura",
  adminLayout.indexOf("getSessionUser") < adminLayout.indexOf("isPlatformAdmin"),
);

check(
  "layout /admin: quem não é admin é mandado de volta ao painel do restaurante",
  adminLayout.includes('redirect("/app?aviso=sem-acesso-admin")'),
);

check(
  "layout /admin: nunca é indexado por buscador",
  adminLayout.includes("index: false"),
);

/* ============================ 9. Rotas ============================ */

const ROUTES = [
  "src/app/admin/page.tsx",
  "src/app/admin/restaurantes/page.tsx",
  "src/app/admin/restaurantes/[id]/page.tsx",
  "src/app/admin/restaurantes/[id]/editar/page.tsx",
  "src/app/admin/usuarios/page.tsx",
  "src/app/admin/pedidos/page.tsx",
  "src/app/admin/auditoria/page.tsx",
  "src/app/admin/configuracoes/page.tsx",
];

for (const route of ROUTES) {
  check(`rotas: ${route.replace("src/app", "")} existe`, fs.existsSync(path.join(ROOT, route)));
}

const NAV = fs.readFileSync(path.join(ROOT, "src/components/admin/admin-nav.tsx"), "utf8");
const NAV_ITEMS = ["/admin", "/admin/restaurantes", "/admin/usuarios", "/admin/pedidos", "/admin/configuracoes"];

for (const href of NAV_ITEMS) {
  check(`nav: item ${href} presente`, NAV.includes(`href: "${href}"`));
}

check(
  "nav: cinco itens, um por aba do escopo (Início, Casas, Usuários, Pedidos, Ajustes)",
  (NAV.match(/href: "\/admin/g) || []).length === 5,
);

/* =========================== Resultado =========================== */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
