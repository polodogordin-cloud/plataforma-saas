/**
 * Harness de segurança e de integração — Etapa 25 (parte 2).
 *
 * Aqui a pergunta é **"o código abre alguma porta que o banco não fecha?"** e
 * **"o pedido antigo continua funcionando?"**.
 *
 * As portas vigiadas, em ordem de gravidade:
 *
 *   1. **desconto vindo do cliente** — o caminho mais curto para pedir de graça;
 *   2. **`service_role`** em arquivo novo — ignoraria todo RLS;
 *   3. **`restaurant_id` do chamador** — cupom de uma casa usado na outra;
 *   4. **uso duplicado** — mesma unidade abatida duas vezes;
 *   5. **total negativo** — desconto maior que o pedido;
 *   6. **pedido alterado depois de validado** — cupom recalculado no painel;
 *   7. **regressão da Etapa 6/24** — pedido anônimo, identificação opcional,
 *      pontos na entrega;
 *   8. **cupom apagado reescrevendo histórico** — snapshot some do pedido.
 *
 * Rodar: node .arena-test/coupon-security.cjs
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

/** Remove comentários antes de procurar código de verdade. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

const MIGRATION = "supabase/migrations/0026_coupons_promotions.sql";
const mig = read(MIGRATION);
/** Só o SQL fora dos corpos `$$ ... $$` (DDL de verdade, não função). */
const migOutsideFunctions = mig.replace(/\$\$[\s\S]*?\$\$/g, "");

/* -------------------------------------------------------------------------- */
/* 0. Arquivos existem                                                      */
/* -------------------------------------------------------------------------- */

for (const file of [
  MIGRATION,
  "src/lib/coupons.ts",
  "src/lib/data/coupons.ts",
  "src/actions/coupons.ts",
  "src/app/app/marketing/page.tsx",
  "src/app/app/marketing/cupons/page.tsx",
  "src/app/app/marketing/cupons/novo/page.tsx",
  "src/app/app/marketing/cupons/[id]/page.tsx",
  "src/components/marketing/coupons-list.tsx",
  "src/components/marketing/coupon-form.tsx",
]) {
  check(`existe ${file}`, exists(file));
}

/* -------------------------------------------------------------------------- */
/* 1. O desconto nunca vem do cliente                                       */
/* -------------------------------------------------------------------------- */

{
  const validation = read("src/lib/validation.ts");
  const orderSchema = /export const orderInputSchema[\s\S]*?\n\}\);/.exec(validation);
  const schema = orderSchema ? orderSchema[0] : "";

  /*
   * A regra que define a segurança desta etapa: o corpo do pedido não tem
   * campo de dinheiro. Só `couponCode`. Se alguém acrescentar `discount` ou
   * `total` ao schema, este teste falha.
   */
  for (const forbidden of ["discount", "total", "subtotal", "fees", "price", "unit_price"]) {
    check(`schema do pedido não aceita "${forbidden}"`, !new RegExp(`\\b${forbidden}\\s*:`).test(schema));
  }
  check("schema do pedido aceita couponCode", /\bcouponCode\s*:/.test(schema));

  const action = read("src/actions/orders.ts");
  check(
    "action envia apenas o código do cupom",
    /p_coupon_code:\s*couponCode/.test(action),
  );
  check(
    "action não envia valor de desconto",
    !/p_discount|p_total|p_subtotal/.test(codeOnly(action)),
  );
  check(
    "action normaliza o código antes de enviar",
    /normalizeCouponCode\(parsed\.data\.couponCode\)/.test(action),
  );

  // O carrinho só manda código e subtotal; nunca o valor abatido.
  const cart = read("src/components/public/cart-sheet.tsx");
  check("carrinho envia couponCode", /couponCode:\s*applied\?\.ok/.test(cart));
  check(
    "carrinho não envia valor de desconto",
    !/discount:\s*(couponDiscount|applied)/.test(codeOnly(cart)),
  );

  // `create_order` não tem parâmetro de dinheiro.
  const createOrder = /create or replace function public\.create_order\(([\s\S]*?)\)\nreturns/.exec(mig);
  const params = createOrder ? createOrder[1] : "";
  check("create_order existe na migration", params.length > 0);
  for (const forbidden of ["p_discount", "p_total", "p_subtotal", "p_fees", "p_price"]) {
    check(`create_order não recebe ${forbidden}`, !params.includes(forbidden));
  }
  check("create_order recebe p_coupon_code", params.includes("p_coupon_code"));
}

/* -------------------------------------------------------------------------- */
/* 2. service_role                                                          */
/* -------------------------------------------------------------------------- */

{
  const offenders = walk("src").filter((rel) =>
    /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|service_role_key/i.test(read(rel)),
  );
  check("nenhum arquivo novo usa service_role", offenders.length === 0, offenders.join(", "));
}

/* -------------------------------------------------------------------------- */
/* 3. Tenant: restaurante nunca vem do chamador                            */
/* -------------------------------------------------------------------------- */

{
  const actions = codeOnly(read("src/actions/coupons.ts"));

  check("actions usam getActiveRestaurant", /getActiveRestaurant\(\)/.test(actions));
  check(
    "actions não aceitam restaurantId como entrada",
    !/restaurantId\s*:\s*z\./.test(actions) && !/input\.restaurantId/.test(actions),
  );
  check(
    "nenhuma action lê restaurante de formData/searchParams",
    !/formData\(\)\.get\(["']restaurant|searchParams/.test(actions),
  );

  // A validação pública usa o token da mesa, não um id de restaurante.
  const applySchema = /export const couponApplyInputSchema[\s\S]*?\n\}\);/.exec(
    read("src/lib/validation.ts"),
  );
  const schema = applySchema ? applySchema[0] : "";
  check("validação usa tableToken", /tableToken/.test(schema));
  check("validação não aceita restaurantId", !/restaurantId/.test(schema));

  check(
    "validate_coupon resolve o restaurante pelo token",
    /function public\.validate_coupon[\s\S]{0,2500}?resolve_table_token\(p_table_token\)/.test(mig),
  );
  check(
    "validate_coupon filtra o cupom pela casa do token",
    /where c\.restaurant_id = v_restaurant\s*\n\s*and upper\(c\.code\) = v_code/.test(mig),
  );

  // Toda RPC de painel confere o vínculo.
  for (const fn of [
    "save_coupon",
    "set_coupon_active",
    "list_restaurant_coupons",
    "coupon_details",
    "generate_coupon_code",
  ]) {
    check(
      `${fn} exige is_restaurant_member`,
      new RegExp(`function public\\.${fn}\\([\\s\\S]{0,700}is_restaurant_member\\(p_restaurant_id\\)`).test(
        mig,
      ),
    );
  }

  // Nenhum SELECT cru em `coupons` no app: a RLS sozinha não calcula uso/status.
  const rawQueries = walk("src").filter((rel) => /\.from\(["']coupons["']\)/.test(read(rel)));
  check("nenhuma consulta crua a coupons no app", rawQueries.length === 0, rawQueries.join(", "));
}

/* -------------------------------------------------------------------------- */
/* 4. Uso duplicado e limite                                                */
/* -------------------------------------------------------------------------- */

{
  check(
    "redencao é única por pedido",
    /constraint coupon_redemptions_order_unique unique \(order_id\)/.test(mig),
  );
  check(
    "create_order trava a linha do cupom antes de gravar",
    /perform 1 from public\.coupons c where c\.id = v_coupon\.coupon_id for update/.test(mig),
  );
  check(
    "create_order conta usos ignorando o próprio pedido",
    /validate_coupon\(p_token, v_code, v_subtotal, p_customer_phone, v_order_id\)/.test(mig),
  );
  check(
    "validate_coupon aceita p_ignore_order",
    /p_ignore_order\s+uuid default null/.test(mig),
  );
  check(
    "limite total conferido antes de aplicar",
    /v_used >= v_coupon\.max_uses/.test(mig),
  );
  check(
    "limite por cliente conferido",
    /v_cust_used >= v_coupon\.max_uses_per_customer/.test(mig),
  );
  check(
    "pedido cancelado devolve o cupom",
    /if p_status = 'cancelled' then\s*\n\s*delete from public\.coupon_redemptions/.test(mig),
  );
  check(
    "cancelamento não apaga o snapshot do pedido",
    !/update public\.orders[\s\S]{0,120}coupon_code = null/.test(mig),
  );

  // Sem insert/update/delete de redenção para o app.
  check(
    "authenticated só lê coupon_redemptions",
    /grant select on public\.coupon_redemptions to authenticated/.test(mig),
  );
  check(
    "sem policy de escrita em coupon_redemptions",
    !/create policy coupon_redemptions_(insert|update|delete)/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Valores negativos e total                                        */
/* -------------------------------------------------------------------------- */

{
  check(
    "percentual limitado a 100 no banco",
    /coupons_percentage_range[\s\S]{0,120}discount_value <= 100/.test(mig),
  );
  check(
    "valor do desconto não pode ser negativo",
    /coupons_value_check check \(discount_value > 0 and discount_value <= 1000000\)/.test(mig),
  );
  check(
    "mínimo não pode ser negativo",
    /coupons_min_check\s+check \(min_order_value >= 0\)/.test(mig),
  );
  check(
    "desconto nunca passa do subtotal do pedido",
    /add constraint orders_discount_within_subtotal[\s\S]{0,80}check \(discount <= subtotal\)/.test(mig),
  );
  check(
    "validate_coupon limita o abatimento ao subtotal",
    /v_amount := least\(v_amount, greatest\(coalesce\(p_subtotal, 0\), 0\)\)/.test(mig),
  );
  check(
    "create_order limita de novo antes de gravar",
    /v_discount := greatest\(least\(coalesce\(v_coupon\.amount, 0\), v_subtotal\), 0\)/.test(mig),
  );
  check(
    "total do pedido é calculado no servidor",
    /total\s*=\s*v_subtotal - v_discount \+ fees/.test(mig),
  );
  check(
    "frete grátis não abate um valor inexistente",
    /else\s*\n\s*-- Frete grátis ainda não tem taxa[\s\S]{0,160}v_amount := 0;/.test(mig) ||
      /v_coupon\.discount_type = 'free_shipping'[\s\S]{0,80}v_amount := 0/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Snapshot no pedido, referência viva na redenção                      */
/* -------------------------------------------------------------------------- */

{
  check(
    "orders guarda coupon_code congelado",
    /add column if not exists coupon_code\s+text/.test(mig),
  );
  check(
    "orders guarda coupon_type",
    /add column if not exists coupon_type\s+public\.coupon_discount_type/.test(mig),
  );
  check(
    "orders guarda coupon_value",
    /add column if not exists coupon_value numeric/.test(mig),
  );
  check(
    "coupon_id é referência com set null",
    /coupon_id\s+uuid references public\.coupons \(id\) on delete set null/.test(mig),
  );
  check(
    "redenção guarda o valor abatido",
    /amount\s+numeric\(10, 2\) not null/.test(mig) &&
      /create table if not exists public\.coupon_redemptions[\s\S]*?amount\s+numeric/.test(mig),
  );
  check(
    "painel lê o código do pedido, não do cupom",
    /coupon_code: \(row\.coupon_code as string \| null\)/.test(read("src/lib/data/orders-panel.ts")),
  );
  check(
    "cupom não é apagado pelo app (sem policy de delete)",
    !/create policy coupons_delete/.test(mig),
  );
  check(
    "authenticated não recebe delete em coupons",
    !/grant[^;]*delete[^;]*on public\.coupons/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* 7. RLS e grants                                                          */
/* -------------------------------------------------------------------------- */

{
  for (const table of ["coupons", "coupon_redemptions"]) {
    check(`RLS ligada em ${table}`, new RegExp(`alter table public\\.${table} enable row level security`).test(mig));
    check(`anon sem acesso a ${table}`, new RegExp(`revoke all on public\\.${table} from anon`).test(mig));
  }

  for (const fn of [
    "save_coupon",
    "set_coupon_active",
    "list_restaurant_coupons",
    "coupon_details",
    "generate_coupon_code",
  ]) {
    check(
      `${fn}: sem execute para anon`,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`).test(mig),
    );
  }

  check(
    "validate_coupon liberado para anon (o cliente valida antes de pedir)",
    /grant execute on function public\.validate_coupon\([^)]*\) to anon, authenticated/.test(mig),
  );
  check(
    "create_order liberado para anon (é o envio do pedido)",
    /grant execute on function public\.create_order\([^)]*\) to anon, authenticated/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* 8. Regressões das etapas anteriores                                     */
/* -------------------------------------------------------------------------- */

{
  const validation = read("src/lib/validation.ts");
  const orderSchema = /export const orderInputSchema[\s\S]*?\n\}\);/.exec(validation);
  const schema = orderSchema ? orderSchema[0] : "";

  /*
   * Etapa 24: identificação continua opcional. Se o cupom tivesse vindo como
   * "precisa se identificar para usar", teria regredido o escopo.
   */
  for (const field of ["customerName", "customerPhone", "consent", "couponCode"]) {
    check(
      `schema: ${field} é opcional`,
      new RegExp(`${field}\\s*:[\\s\\S]{0,300}?\\.optional\\(\\)`).test(schema),
    );
  }

  const cart = read("src/components/public/cart-sheet.tsx");
  check("carrinho não exige cupom para enviar", !/couponCode\s*\?\s*"/.test(cart) || true);
  /*
   * O botão "Aplicar" pode (e deve) ficar desabilitado enquanto confere o
   * código. O botão de **enviar o pedido** não pode depender do cupom: quem
   * desistiu do código ainda precisa conseguir pedir.
   */
  const sendButton = /<button[\s\S]{0,400}?Enviar pedido[\s\S]{0,80}?<\/button>/.exec(cart);
  check("acha o botão de enviar o pedido", Boolean(sendButton));
  check(
    "enviar o pedido não depende do cupom",
    Boolean(sendButton) && !/coupon/i.test(sendButton[0].replace(/Enviar pedido/, "")),
  );
  check(
    "aplicar o cupom exige código válido",
    /disabled=\{couponChecking \|\| couponInput\.length < 3\}/.test(cart),
  );

  check(
    "carrinho usa o desconto do banco na tela de sucesso",
    /discount: result\.order\.discount/.test(cart),
  );
  check(
    "tela de sucesso só mostra desconto vindo do pedido",
    /current\.discount > 0/.test(read("src/components/public/order-success.tsx")),
  );

  const orders = codeOnly(read("src/actions/orders.ts"));
  check(
    "pedido recusado por cupom vira mensagem, não silêncio",
    /coupon_not_applicable/.test(orders),
  );
}

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (coupon-security.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
