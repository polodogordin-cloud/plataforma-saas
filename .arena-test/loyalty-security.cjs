/**
 * Harness de segurança e de integração — Etapa 24 (parte 2).
 *
 * Aqui a pergunta é diferente da do `loyalty-lib.cjs`: não é "a conta está
 * certa?", é **"o código abre alguma porta que o banco não fecha?"** e **"o
 * fluxo antigo continua funcionando?"**.
 *
 * As portas vigiadas:
 *
 *   1. `service_role` em qualquer arquivo novo (ignoraria todo RLS);
 *   2. `restaurant_id` vindo da URL/formulário e usado como confiável;
 *   3. leitura de `customers` sem guarda de tenant;
 *   4. dado pessoal (telefone/e-mail) em view pública;
 *   5. identificação obrigatória no pedido — regressão da Etapa 6;
 *   6. `create_order` chamada sem consentimento;
 *   7. consentimento pré-marcado na UI (checkbox que já vem `true`);
 *   8. criação de cliente fora do fluxo de pedido (porta dos fundos da LGPD);
 *   9. exclusão que apaga a linha em vez de anonimizar;
 *  10. pontos creditados sem pedido entregue.
 *
 * Rodar: node .arena-test/loyalty-security.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}

const MIGRATION = "supabase/migrations/0025_loyalty_customers.sql";
const mig = read(MIGRATION);

/* -------------------------------------------------------------------------- */
/* 0. Arquivos existem                                                       */
/* -------------------------------------------------------------------------- */

for (const file of [
  MIGRATION,
  "src/lib/loyalty.ts",
  "src/lib/data/loyalty.ts",
  "src/lib/data/customers-client.ts",
  "src/actions/loyalty.ts",
  "src/app/app/clientes/page.tsx",
  "src/app/app/clientes/[id]/page.tsx",
  "src/app/app/clientes/fidelidade/page.tsx",
  "src/components/customers/customers-list.tsx",
  "src/components/customers/customer-detail.tsx",
  "src/components/customers/loyalty-settings-form.tsx",
  "src/components/public/my-points-sheet.tsx",
]) {
  check(`existe ${file}`, exists(file));
}

/* -------------------------------------------------------------------------- */
/* 1. service_role                                                           */
/* -------------------------------------------------------------------------- */

{
  const offenders = walk("src").filter((rel) => {
    const src = read(rel);
    // Só a menção em comentário é aceitável; o que importa é a chave/criação.
    return /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|service_role_key/i.test(src);
  });
  check("nenhum arquivo em src/ usa a chave service_role", offenders.length === 0, offenders.join(", "));
}

/* -------------------------------------------------------------------------- */
/* 2. restaurant_id vindo do cliente                                         */
/* -------------------------------------------------------------------------- */

{
  const actions = read("src/actions/loyalty.ts");

  check(
    "actions: restaurante vem de getActiveRestaurant",
    /getActiveRestaurant\(\)/.test(actions) && /restaurant\.id/.test(actions),
  );
  check(
    "actions: nenhuma assinatura aceita restaurantId do chamador",
    !/restaurantId\s*:\s*z\./.test(actions) && !/input\.restaurantId/.test(actions),
  );
  check(
    "actions: nenhuma referência a formData/URL para o restaurante",
    !/searchParams|formData\(\)\.get\(["']restaurant/.test(actions),
  );

  const clientsPage = read("src/app/app/clientes/page.tsx");
  check(
    "página: id do restaurante não vem da URL",
    !/searchParams/.test(clientsPage),
  );

  const detailPage = read("src/app/app/clientes/[id]/page.tsx");
  check(
    "ficha: customerId da URL é validado pela RPC com o restaurante da sessão",
    /getCustomerOverview\(restaurant\.id,\s*id\)/.test(detailPage),
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Leitura de customers só por RPC guardada                               */
/* -------------------------------------------------------------------------- */

{
  check(
    "RPC de lista confere is_restaurant_member",
    /function public\.list_restaurant_customers[\s\S]{0,900}is_restaurant_member\(p_restaurant_id\)/.test(mig),
  );
  check(
    "RPC de ficha confere is_restaurant_member",
    /function public\.customer_overview[\s\S]{0,600}is_restaurant_member\(p_restaurant_id\)/.test(mig),
  );
  check(
    "RPC de ficha filtra o cliente pela casa",
    /customer_overview[\s\S]{0,1600}c\.id = p_customer_id\s*\n\s*and c\.restaurant_id = p_restaurant_id/.test(mig),
  );

  // Nenhum `from("customers")` cru fora da RPC — o painel vai por RPC.
  const rawQueries = walk("src")
    .filter((rel) => /\.from\(["']customers["']\)/.test(read(rel)))
    .filter((rel) => !rel.includes("stubs"));
  check("nenhuma consulta crua a customers no app", rawQueries.length === 0, rawQueries.join(", "));
}

/* -------------------------------------------------------------------------- */
/* 4. Dado pessoal fora da view pública                                     */
/* -------------------------------------------------------------------------- */

{
  const publicView = /create or replace view public\.public_restaurants[\s\S]*?;/.exec(
    read("supabase/migrations/0003_public_menu.sql"),
  );
  const viewSql = publicView ? publicView[0] : "";
  check("view pública não expõe telefone de cliente", !/customer/i.test(viewSql));
  check("view pública não expõe customers", !/from public\.customers/i.test(viewSql));

  const publicFn = /function public\.customer_points[\s\S]*?\$\$;/.exec(mig);
  const publicSql = publicFn ? publicFn[0] : "";
  check("customer_points existe", publicSql.length > 0);
  check(
    "customer_points não devolve telefone",
    !/'phone'/.test(publicSql) && !/v_customer\.phone/.test(publicSql),
  );
  check(
    "customer_points não devolve extrato",
    !/loyalty_ledger l[\s\S]{0,80}jsonb_agg/.test(publicSql),
  );
  check(
    "customer_points exige token da mesa",
    /resolve_table_token\(p_token\)/.test(publicSql),
  );
  check(
    "customer_points exige telefone",
    /normalize_phone\(p_phone\)/.test(publicSql),
  );

  const publicLoyalty = /function public\.public_loyalty_settings[\s\S]*?\$\$;/.exec(mig);
  const loyaltySql = publicLoyalty ? publicLoyalty[0] : "";
  check("public_loyalty_settings existe", loyaltySql.length > 0);
  check(
    "public_loyalty_settings usa lista fechada de campos",
    /jsonb_build_object/.test(loyaltySql) && !/to_jsonb\(v_row\)/.test(loyaltySql),
  );
  check(
    "public_loyalty_settings não expõe cashback",
    !/'cashback_percent'/.test(loyaltySql),
  );
  check(
    "public_loyalty_settings só para casa publicada",
    /status = 'published'/.test(loyaltySql),
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Identificação opcional — não regredir a Etapa 6                        */
/* -------------------------------------------------------------------------- */

{
  const validation = read("src/lib/validation.ts");
  const orderSchema = /export const orderInputSchema[\s\S]*?\n\}\);/.exec(validation);
  const schemaSql = orderSchema ? orderSchema[0] : "";

  check("schema do pedido tem customerName", /customerName/.test(schemaSql));
  check("schema do pedido tem customerPhone", /customerPhone/.test(schemaSql));
  check("schema do pedido tem consent", /consent/.test(schemaSql));

  /*
   * A regra: os três campos de identificação são `.optional()` no schema. Se um
   * dia virarem obrigatórios, quem só quer comer não consegue mais pedir — que
   * é exatamente a regressão que o escopo proíbe.
   */
  for (const field of ["customerName", "customerPhone", "consent"]) {
    const fieldBlock = new RegExp(`${field}\\s*:[\\s\\S]{0,250}?\\.optional\\(\\)`).test(schemaSql);
    check(`schema: ${field} é opcional`, fieldBlock);
  }

  const ordersAction = read("src/actions/orders.ts");
  check(
    "action: identificação só é enviada com consentimento",
    /wantsIdentification\s*=\s*Boolean\(parsed\.data\.consent\)/.test(ordersAction),
  );
  check(
    "action: sem identificação o pedido segue anônimo",
    /p_consent:\s*wantsIdentification/.test(ordersAction) &&
      /p_customer_name:\s*customerName/.test(ordersAction) &&
      /customerName\s*=\s*wantsIdentification \?/.test(ordersAction),
  );
  check(
    "action: telefone validado antes de enviar",
    /isValidPhone\(parsed\.data\.customerPhone\)/.test(ordersAction),
  );

  // O cardápio continua abrindo sem identificação: nada de redirect/gate.
  const publicPage = read("src/app/r/[slug]/page.tsx");
  check(
    "cardápio público não exige cadastro",
    !/consent_required|identify|mustIdentify/.test(publicPage),
  );
}

/* -------------------------------------------------------------------------- */
/* 6. create_order: consentimento e nenhum preço do cliente                  */
/* -------------------------------------------------------------------------- */

{
  const fn = /create or replace function public\.create_order[\s\S]*?\n\$\$;/.exec(mig);
  const sql = fn ? fn[0] : "";
  check("create_order existe na migration", sql.length > 0);
  check(
    "create_order mantém só produto e quantidade como entrada de item",
    /product_id/.test(sql) && /quantity/.test(sql) && !/p_price|unit_price\s*:/.test(sql),
  );
  check(
    "create_order delega a identificação ao guarda de consentimento",
    /upsert_customer_for_order\(/.test(sql),
  );
  check(
    "create_order não confia no restaurante do cliente",
    /resolve_table_token\(p_token\)/.test(sql) && !/p_restaurant_id/.test(sql),
  );

  const upsert = /function public\.upsert_customer_for_order[\s\S]*?\$\$;/.exec(mig);
  const upsertSql = upsert ? upsert[0] : "";
  check("consentimento obrigatório no cadastro", /consent_required/.test(upsertSql));
  check(
    "consentimento checado antes de gravar",
    upsertSql.indexOf("consent_required") < upsertSql.indexOf("insert into public.customers"),
  );
  check(
    "upsert não é exposto ao anon",
    /revoke all on function public\.upsert_customer_for_order\(uuid, text, text, boolean\) from public, anon, authenticated/.test(
      mig,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Consentimento na UI não vem pré-marcado                                */
/* -------------------------------------------------------------------------- */

{
  const cart = read("src/components/public/cart-sheet.tsx");
  check("carrinho tem bloco de identificação", /Quero acumular pontos/.test(cart));
  check("consentimento começa false", /useState\(false\)/.test(cart) && /const \[consent, setConsent\] = useState\(false\)/.test(cart));
  check(
    "checkbox não tem defaultChecked/checked fixo em true",
    !/defaultChecked/.test(cart) && !/checked=\{true\}/.test(cart),
  );
  check(
    "envio recusa identificação sem aceite",
    /if \(!consent\) \{[\s\S]{0,160}setIdentifyError/.test(cart),
  );
  check(
    "bloco só aparece com programa ligado",
    /showIdentify = programEnabled && Boolean\(programText\)/.test(cart),
  );
  check(
    "cardápio sem programa não mostra o bloco",
    /loyalty\?: LoyaltySettings \| null/.test(read("src/components/public/public-menu.tsx")),
  );
}

/* -------------------------------------------------------------------------- */
/* 8. Sem criação de cliente fora do pedido                                  */
/* -------------------------------------------------------------------------- */

{
  const actions = read("src/actions/loyalty.ts");
  check("actions não criam cliente", !/insert\s+into|from\(["']customers["']\)\.insert/.test(actions));
  // Só menção em comentário é aceitável: a chamada de verdade criaria cliente
  // sem pedido e sem consentimento.
  const actionCode = actions
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
    .join("\n");
  check(
    "actions não chamam upsert_customer_for_order",
    !/upsert_customer_for_order/.test(actionCode),
  );
  const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  check(
    "actions de clientes: lista fechada",
    JSON.stringify(exported.sort()) ===
      JSON.stringify(
        [
          "adjustCustomerPoints",
          "awardBirthdayBonus",
          "eraseCustomer",
          "readMyPoints",
          "saveLoyaltySettings",
          "updateCustomer",
        ].sort(),
      ),
    exported.join(", "),
  );
  check(
    "actions validam consentimento só na leitura pública",
    !/p_consent/.test(actions),
  );
}

/* -------------------------------------------------------------------------- */
/* 9. Exclusão é anonimização, não DELETE                                    */
/* -------------------------------------------------------------------------- */

{
  const fn = /function public\.erase_customer[\s\S]*?\$\$;/.exec(mig);
  const sql = fn ? fn[0] : "";
  check("erase_customer existe", sql.length > 0);
  check("erase apaga nome", /name = null/.test(sql));
  check("erase apaga telefone", /phone = null/.test(sql));
  check("erase apaga telefone normalizado", /phone_normalized = null/.test(sql));
  check("erase apaga e-mail", /email = null/.test(sql));
  check("erase marca erased_at", /erased_at = now\(\)/.test(sql));
  check("erase revoga consentimento", /consent_revoked_at = now\(\)/.test(sql));
  check("erase não faz delete de customers", !/delete from public\.customers/.test(sql));
  check(
    "erase limpa a cópia do nome no pedido",
    /update public\.orders[\s\S]{0,120}customer_name = null/.test(sql),
  );
  check(
    "erase é idempotente",
    /if v_row\.erased_at is not null then\s*\n\s*return false/.test(sql),
  );

  // Sem policy de DELETE em customers: nem o painel nem o PostgREST apagam linha.
  check(
    "customers não tem policy de delete",
    !/create policy customers_delete/.test(mig),
  );
  check(
    "authenticated não recebe delete em customers",
    !/grant[^;]*delete[^;]*on public\.customers/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* 10. Pontos: só de pedido entregue, idempotente                            */
/* -------------------------------------------------------------------------- */

{
  const award = /function public\.loyalty_award_order[\s\S]*?\$\$;/.exec(mig);
  const sql = award ? award[0] : "";
  check("loyalty_award_order existe", sql.length > 0);
  check(
    "só credita pedido entregue",
    /v_order\.status <> 'delivered'/.test(sql),
  );
  check("só credita com cliente identificado", /v_order\.customer_id is null/.test(sql));
  check(
    "idempotente por order_id",
    /where l\.order_id = p_order_id and l\.kind = 'earn'/.test(sql),
  );
  check(
    "usa piso, não arredondamento",
    /floor\(v_order\.total \* v_settings\.points_per_currency\)/.test(sql),
  );
  check(
    "não credita com programa desligado",
    /not v_settings\.enabled/.test(sql),
  );
  check(
    "índice único garante um earn por pedido",
    /create unique index if not exists loyalty_ledger_order_earn_unique[\s\S]{0,120}kind = 'earn'/.test(
      mig,
    ),
  );

  const setStatus = /create or replace function public\.set_order_status[\s\S]*?\n\$\$;/.exec(mig);
  const statusSql = setStatus ? setStatus[0] : "";
  check("set_order_status credita na entrega", /p_status = 'delivered'[\s\S]{0,80}loyalty_award_order/.test(statusSql));
  check(
    "set_order_status mantém a guarda de membro",
    /is_restaurant_member\(o\.restaurant_id\)/.test(statusSql),
  );
}

/* -------------------------------------------------------------------------- */
/* 11. Extrato append-only                                                   */
/* -------------------------------------------------------------------------- */

{
  check(
    "ledger barra UPDATE por trigger",
    /create trigger loyalty_ledger_no_update\s*\n\s*before update on public\.loyalty_ledger/.test(mig),
  );
  /*
   * O trigger NÃO pode barrar DELETE: o cascade de restaurants/customers
   * precisa funcionar. Isto foi um bug real — apagar um restaurante falhava.
   */
  check(
    "trigger do ledger não barra DELETE (cascade precisa passar)",
    !/before update or delete on public\.loyalty_ledger/.test(mig),
  );
  check(
    "authenticated não tem insert/update/delete no ledger",
    /revoke insert, update, delete on public\.loyalty_ledger from authenticated/.test(mig),
  );
  /*
   * `points_balance` é legítimo como coluna de SAÍDA de RPC (o painel precisa
   * de um nome para o número). O que não pode existir é `points_balance` como
   * coluna **gravável** em `customers` — aí o saldo passaria a ter duas fontes.
   */
  check(
    "saldo não é coluna de customers",
    !/create table if not exists public\.customers \([\s\S]*?\n\);/.test(mig) ||
      !/create table if not exists public\.customers \([\s\S]*?points_balance[\s\S]*?\n\);/.test(mig),
  );
  check(
    "saldo calculado por sum(delta) nas leituras",
    (mig.match(/sum\(l\.delta\)/g) || []).length >= 3,
  );
}

/* -------------------------------------------------------------------------- */
/* 12. RLS e grants                                                          */
/* -------------------------------------------------------------------------- */

{
  for (const table of ["customers", "loyalty_settings", "loyalty_ledger"]) {
    check(`RLS ligada em ${table}`, new RegExp(`alter table public\\.${table} enable row level security`).test(mig));
    check(`anon sem acesso a ${table}`, new RegExp(`revoke all on public\\.${table} from anon`).test(mig));
  }
  check(
    "policy de customers usa is_restaurant_member",
    /create policy customers_select_member[\s\S]{0,140}is_restaurant_member\(restaurant_id\)/.test(mig),
  );
  check(
    "policy de settings exige is_restaurant_admin para escrever",
    /create policy loyalty_settings_write_owner[\s\S]{0,200}is_restaurant_admin\(restaurant_id\)/.test(mig),
  );
  check(
    "RPCs de configuração exigem dono/admin",
    /function public\.save_loyalty_settings[\s\S]{0,600}is_restaurant_owner\(p_restaurant_id\)/.test(mig),
  );
  check(
    "erase exige membro da casa",
    /function public\.erase_customer[\s\S]{0,300}is_restaurant_member\(p_restaurant_id\)/.test(mig),
  );
  check(
    "award_birthday exige membro",
    /function public\.award_birthday_bonus[\s\S]{0,600}is_restaurant_member\(p_restaurant_id\)/.test(mig),
  );

  // Toda RPC de painel revoga o default e concede só a authenticated.
  for (const fn of [
    "list_restaurant_customers",
    "customer_overview",
    "save_loyalty_settings",
    "award_birthday_bonus",
    "adjust_customer_points",
    "update_customer",
    "erase_customer",
  ]) {
    check(
      `${fn}: sem execute para anon`,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`).test(mig),
    );
    check(
      `${fn}: execute para authenticated`,
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`).test(mig),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 13. Sem disparo automático de mensagem                                    */
/* -------------------------------------------------------------------------- */

{
  /*
   * O escopo diz "não implementar disparo automático de mensagens sem
   * integração adequada". Uma tabela de outbox/fila sugeriria que existe
   * alguém enviando — e o dono confiaria nisso.
   */
  for (const forbidden of ["message_queue", "outbox", "whatsapp_outbox", "campaign_sends", "sms_queue"]) {
    check(`sem tabela de disparo (${forbidden})`, !new RegExp(`create table[^;]*${forbidden}`).test(mig));
  }
  check("sem cron de envio", !/pg_cron|schedule\s+.*whatsapp/i.test(mig));

  const ui = read("src/components/customers/customer-detail.tsx");
  check("painel não promete envio automático", !/enviar mensagem|disparar/i.test(ui));
}

/* -------------------------------------------------------------------------- */
/* 14. Sem dado fictício                                                     */
/* -------------------------------------------------------------------------- */

{
  /*
   * Migration não pode inserir cliente/pontos de exemplo: isso apareceria na
   * lista do dono como se fosse real. (Os testes de banco usam transaction com
   * rollback e foram limpos à mão.)
   */
  /*
   * Insert dentro de FUNÇÃO é o funcionamento normal (o cliente nasce no
   * pedido). O que não pode existir é insert no corpo da migration — fora de
   * `$$`, rodando uma vez na aplicação —, porque aí o dono abriria a lista e
   * veria dado de exemplo como se fosse real.
   */
  const outsideSql = mig.replace(/\$\$[\s\S]*?\$\$/g, "");
  check("migration não insere clientes", !/insert into public\.customers\s*\(/i.test(outsideSql));
  check("migration não insere pontos", !/insert into public\.loyalty_ledger\s*\(/i.test(outsideSql));
}

/* -------------------------------------------------------------------------- */
/* 15. O pedido antigo continua funcionando                                  */
/* -------------------------------------------------------------------------- */

{
  const ordersAction = read("src/actions/orders.ts");
  check(
    "createOrder ainda aceita carrinho e observação",
    /items: toOrderItems|items\.map/.test(ordersAction) && /p_notes/.test(ordersAction),
  );
  check(
    "assinatura antiga de create_order é substituída, não duplicada",
    /drop function if exists public\.create_order\(text, jsonb, text\)/.test(mig),
  );
  /*
   * Duas versões convivendo (3 e 6 argumentos) fariam o PostgREST escolher por
   * contagem de parâmetros nomeados — e a chamada antiga poderia cair na nova
   * com defaults, mas o `returns table` diferente quebraria o parser do cliente.
   */
  const createOrderDefs = mig.match(/create or replace function public\.create_order\(/g) || [];
  check("create_order definida uma vez só", createOrderDefs.length === 1);
  check(
    "get_table_order (Etapa 6) não foi tocada",
    !/create or replace function public\.get_table_order/.test(mig),
  );
  check(
    "resolve_table_token não foi tocada",
    !/create or replace function public\.resolve_table_token/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (loyalty-security.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
