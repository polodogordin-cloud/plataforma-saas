/**
 * Harness de auditoria estática de segurança — Etapa 20, itens 1–7 e 12.
 *
 * Isto **não** substitui o teste no banco (RLS, grants, append-only — cobertos
 * pela suíte SQL registrada em `docs/AMBIENTES.md`). Aqui a pergunta é outra e
 * complementar: *o código da aplicação dá alguma porta dos fundos que o banco
 * não fecha?*
 *
 * As sete portas que este arquivo vigia:
 *
 *   1. chave `service_role` no bundle do app (ignora todo RLS);
 *   2. `restaurant_id` vindo da URL/form e usado como se fosse confiável;
 *   3. consulta sem filtro de tenant em tabela de dados de cliente;
 *   4. segredo em `NEXT_PUBLIC_*` (vai para o navegador);
 *   5. campo financeiro/sensível exposto em rota pública;
 *   6. ausência de validação de entrada em Server Action que grava;
 *   7. erro que repassa mensagem do driver para a tela.
 *
 * Rodar: node .arena-test/tenant-audit.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const files = walk(path.join(ROOT, "src")).map((full) => ({
  rel: path.relative(ROOT, full),
  src: fs.readFileSync(full, "utf8"),
}));

const at = (prefix) => files.filter((f) => f.rel.startsWith(prefix));

/* -------------------------------------------------------------------------- */
/* 1. service_role no app                                                    */
/* -------------------------------------------------------------------------- */

{
  const offenders = files.filter(({ src }) => /SUPABASE_SERVICE_ROLE|service_role_key/i.test(src));
  check(
    "nenhum arquivo em src/ usa a chave service_role",
    offenders.length === 0,
    offenders.map((f) => f.rel).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Segredo em variável NEXT_PUBLIC_*                                      */
/* -------------------------------------------------------------------------- */

{
  // Nomes que jamais podem ser públicos. A lista cobre o que existe hoje e o
  // que aparece em integração (webhook/pagamento/cron).
  const PUBLIC_FORBIDDEN = /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|PRIVATE|TOKEN|PASSWORD|WEBHOOK)/;
  const offenders = files.filter(({ src }) => PUBLIC_FORBIDDEN.test(src));
  check(
    "nenhum segredo nomeado como NEXT_PUBLIC_*",
    offenders.length === 0,
    offenders.map((f) => f.rel).join(", "),
  );

  // E o inverso: variável secreta de verdade não pode ser lida em componente
  // client (só existe no servidor; o navegador a veria como undefined).
  const clientFiles = files.filter(({ src }) => /^"use client"/.test(src.trim()));
  // `NODE_ENV` é embutido no bundle pelo compilador (substituído por literal),
  // então é o único `process.env` legítimo num componente client.
  const leaked = clientFiles.filter(({ src }) => /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV)/.test(src));
  check(
    "componente client não lê process.env que não seja NEXT_PUBLIC_",
    leaked.length === 0,
    leaked.map((f) => f.rel).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Tenant vindo do cliente                                                */
/* -------------------------------------------------------------------------- */

{
  /*
   * Regra do projeto: quem decide o tenant é `getActiveRestaurant()` (sessão no
   * servidor). Um `restaurantId` que chega por `FormData`/`searchParams` pode
   * ser exigido apenas como afirmação, nunca como fonte — e o banco ainda
   * confere. O que este teste pega é o padrão perigoso:
   *
   *     formData.get("restaurantId")  →  usado direto numa consulta
   *
   * Server Actions administrativas (dono da plataforma) legitimamente recebem
   * o alvo por formulário — é o objeto da ação mudar o plano de outra casa. Por
   * isso o teste é sobre os módulos de dados usados na área do restaurante.
   */
  const dataFiles = at("src/lib/data/");
  const offenders = dataFiles.filter(
    ({ rel, src }) =>
      /formData\.get\(["']restaurantId/.test(src) ||
      (/searchParams/.test(src) && /restaurantId/.test(src)),
  );
  check(
    "módulos de dados do restaurante não leem restaurantId do cliente",
    offenders.length === 0,
    offenders.map((f) => f.rel).join(", "),
  );

  const restaurants = files.find((f) => f.rel === "src/lib/data/restaurants.ts");
  check(
    "o tenant ativo vem de getActiveRestaurant() (sessão no servidor)",
    Boolean(restaurants) && /export async function getActiveRestaurant/.test(restaurants.src),
  );

  const actions = at("src/actions/");
  const dangerous = actions.filter(
    ({ src }) => /p_restaurant_id:\s*(?:formData|data)\.get\?/.test(src),
  );
  check(
    "nenhuma action passa um restaurantId cru de FormData para RPC",
    dangerous.length === 0,
    dangerous.map((f) => f.rel).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Upload: três camadas                                                   */
/* -------------------------------------------------------------------------- */

{
  const upload = files.find((f) => f.rel === "src/lib/theme-upload.ts");
  check("existe módulo de upload", Boolean(upload));
  if (upload) {
    const { src } = upload;
    check("upload: valida MIME declarado", /ACCEPTED_MIME/.test(src));
    check("upload: valida assinatura do arquivo (magic bytes)", /sniffImageType/.test(src));
    check("upload: tem limite de tamanho", /MAX_UPLOAD_BYTES/.test(src));
    check("upload: redimensiona antes de subir", /OUTPUT_SIZE|canvas|createImageBitmap/.test(src));
    // O caminho no bucket é montado no servidor a partir de `kind`/`version`
    // (nunca do `file.name` do usuário) — é isso que impede path traversal e
    // sobrescrita de arquivo de outro tenant.
    check(
      "upload: nome do arquivo é montado internamente (não vem do usuário)",
      /export function uploadFileName/.test(src) && !/file\.name/.test(src),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Auditoria: registra sem guardar segredo                                 */
/* -------------------------------------------------------------------------- */

{
  const audit = files.find((f) => f.rel === "src/lib/admin-audit.ts");
  check("existe módulo de auditoria", Boolean(audit));
  if (audit) {
    const { src } = audit;
    const FORBIDDEN_FIELDS = /(password|senha|token|secret|api[_-]?key|authorization|cookie)/i;
    // A palavra pode aparecer em comentário/allowlist; o que não pode é ser
    // enviada como campo. Olhamos as chaves de objeto do payload.
    const payloadKeys = [...src.matchAll(/^\s{2,}([a-zA-Z_]+):/gm)].map((m) => m[1]);
    const bad = payloadKeys.filter((key) => FORBIDDEN_FIELDS.test(key));
    check("auditoria: nenhuma chave de payload é segredo", bad.length === 0, bad.join(", "));
  }

  const migration = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/0021_security_hardening.sql"),
    "utf8",
  );
  check(
    "auditoria: tabela é append-only no banco (trigger de UPDATE)",
    /admin_audit_log_no_update/.test(migration),
  );
  check(
    "auditoria: DELETE revogado",
    /revoke[^;]*\bdelete\b[^;]*on public\.admin_audit_log/i.test(migration),
  );
  check(
    "auditoria: cliente não pode forjar evento (log_admin_action fechado)",
    /revoke[^;]*log_admin_action[^;]*from[^;]*authenticated/i.test(migration),
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Server Actions que gravam validam entrada                              */
/* -------------------------------------------------------------------------- */

{
  /*
   * Toda action `"use server"` que grava precisa validar antes de chamar o
   * banco. O sinal de validação no projeto é um schema Zod importado de
   * `@/lib/validation` (`.safeParse`/`.parse`) ou um parser explícito do mesmo
   * módulo. Action de `signOut`/`redirect` puro não grava e é isenta.
   */
  const WRITES = /\.from\([^)]*\)\s*\.(insert|update|delete|upsert)|\.rpc\(/;
  const VALIDATES = /safeParse|\.parse\(|Schema\b/;
  const offenders = [];

  for (const { rel, src } of at("src/actions/")) {
    if (!/^"use server"/.test(src.trim())) continue;
    if (!WRITES.test(src)) continue;
    if (!VALIDATES.test(src)) offenders.push(rel);
  }

  check(
    "toda action que grava valida a entrada com schema",
    offenders.length === 0,
    offenders.join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Mensagem de erro não repassa driver                                    */
/* -------------------------------------------------------------------------- */

{
  /*
   * `error.message` do Supabase cita tabela, constraint, função e às vezes
   * host. Ele pode ir para o **log**, nunca para o `ActionState` que a tela
   * mostra. O padrão de vazamento é `message: error.message`.
   */
  /*
   * Inspecionar `error.message` para **decidir** a frase (ex.:
   * `error.message.includes("invalid login")` → mensagem fixa em português) é
   * correto. O vazamento é atribuir a mensagem crua ao campo `message` do
   * estado devolvido. Por isso a linha que contém `.includes(`/`.toLowerCase()`
   * é descartada antes do teste.
   */
  const offenders = at("src/actions/").filter(({ src }) =>
    src
      .split("\n")
      .filter((line) => !/\.includes\(|\.toLowerCase\(|\.startsWith\(/.test(line))
      .some((line) => /message:\s*(?:[a-zA-Z]+\.)?(?:error|err)\.message/.test(line)),
  );
  check(
    "actions não devolvem error.message do banco para a tela",
    offenders.length === 0,
    offenders.map((f) => f.rel).join(", "),
  );

  const consoleLeaks = files.filter(
    ({ src }) =>
      /console\.(log|error|warn)\([^)]*NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(src) ||
      (/console\.(log|error|warn)/.test(src) && /SUPABASE_SERVICE/.test(src)),
  );
  check(
    "nenhum console.* imprime chave do Supabase",
    consoleLeaks.length === 0,
    consoleLeaks.map((f) => f.rel).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 8. Dados financeiros fora da rota pública                                 */
/* -------------------------------------------------------------------------- */

{
  const publicArea = files.filter(
    ({ rel }) => rel.startsWith("src/app/r/") || rel.startsWith("src/components/public/"),
  );
  const FINANCE = /(card_number|cardNumber|cvv|pix_key|pixKey|bank_account|cpf_cnpj|recipient_document)/;
  const offenders = publicArea.filter(({ src }) => FINANCE.test(src));
  check(
    "cardápio público não toca em dado financeiro do restaurante",
    offenders.length === 0,
    offenders.map((f) => f.rel).join(", "),
  );

  // O cardápio público só deve consultar as views/funções públicas, não
  // tabelas administrativas.
  const PRIVATE_TABLES = /\.from\(\s*["'](restaurant_payments|admin_audit_log|subscriptions|payments|plans)["']/;
  const tables = publicArea.filter(({ src }) => PRIVATE_TABLES.test(src));
  check(
    "cardápio público não consulta tabela administrativa/financeira",
    tables.length === 0,
    tables.map((f) => f.rel).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 9. RBAC: papéis definidos em um lugar só                                  */
/* -------------------------------------------------------------------------- */

{
  const types = files.find((f) => f.rel === "src/lib/types.ts");
  check("papéis estão tipados em src/lib/types.ts", Boolean(types) && /PlatformRole|RestaurantRole/.test(types.src));

  /*
   * Nenhum módulo pode decidir permissão por conta própria comparando strings
   * de papel do usuário: quem responde é o banco (`has_restaurant_role`,
   * `is_platform_admin`, RLS). Consultar as funções é o esperado; reimplementar
   * a regra em TypeScript é o defeito.
   */
  /*
   * A distinção importa: usar `role === "kitchen"` para **escolher qual aba
   * mostrar** ou a cor do badge é apresentação — o dado sensível continua
   * barrado pela RLS. O que não pode existir é a camada de **dados** decidir se
   * entrega ou não a linha comparando papel em TypeScript: aí a regra fica em
   * dois lugares e um deles vai divergir.
   */
  const REIMPLEMENTS = /org_role\s*===|\.role\s*===\s*["'](owner|manager|kitchen|waiter|admin)["']/;
  const offenders = [...at("src/lib/data/"), ...at("src/actions/")].filter(({ src }) =>
    REIMPLEMENTS.test(src),
  );
  check(
    "camada de dados/ações não reimplementa autorização por string de papel",
    offenders.length === 0,
    offenders.map((f) => f.rel).join(", "),
  );

  const usesDbHelpers = at("src/lib/data/").filter(({ src }) =>
    /is_platform_admin|has_restaurant_role|admin_forbidden|is_restaurant_member/.test(src),
  );
  check(
    "camada de dados consulta os helpers de papel do banco",
    usesDbHelpers.length >= 1,
    usesDbHelpers.map((f) => f.rel).join(", "),
  );
}

/* -------------------------------------------------------------------------- */
/* 10. Rate limit nas ações de autenticação                                  */
/* -------------------------------------------------------------------------- */

{
  const auth = files.find((f) => f.rel === "src/actions/auth.ts");
  check("login consome um balde de rate limit", Boolean(auth) && /consumeAuthAttempt/.test(auth.src));
  check(
    "cadastro consome um balde de rate limit",
    Boolean(auth) && /RATE_LIMITS\.signUp/.test(auth.src),
  );
  check(
    "recuperação de senha consome um balde de rate limit",
    Boolean(auth) && /RATE_LIMITS\.recover/.test(auth.src),
  );
  check(
    "origem de link de e-mail não confia no header Origin",
    Boolean(auth) && !/headerList\.get\("origin"\)/.test(auth.src),
  );
}

/* -------------------------------------------------------------------------- */

console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\ntenant-audit: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
