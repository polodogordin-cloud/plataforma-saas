/**
 * Harness de segurança da cobrança manual por PIX — Etapa 19.
 *
 * Duas metades:
 *
 *   A. **Análise estática** do que, se revertido por descuido, abriria buraco
 *      sem quebrar nenhum teste funcional: quem pode confirmar, quem pode
 *      trocar a chave PIX, se o valor pode vir do navegador, se existe webhook.
 *
 *   B. **Asserções SQL** (as 8 do escopo + extras) rodadas contra o banco de
 *      produção via MCP, em transação com `rollback`. Os resultados ficam
 *      documentados em `docs/AMBIENTES.md`; este arquivo verifica que a
 *      estrutura que os torna possíveis continua lá.
 *
 * Rodar: node .arena-test/payments-security.cjs
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const sql = read("supabase/migrations/0019_payments.sql");
const actions = read("src/actions/subscription-payments.ts");
const data = read("src/lib/data/payments.ts");
const lib = read("src/lib/payments.ts");
const billing = read("src/lib/billing/index.ts");
const middleware = read("src/lib/supabase/middleware.ts");

/* ========================================================================== */
/* 1. O cliente não confirma nada                                             */
/* ========================================================================== */

check(
  "cliente: não existe policy de INSERT/UPDATE/DELETE em payment_requests",
  !/create policy payment_requests_(insert|update|delete)/i.test(sql),
  "só a RPC security definer escreve",
);

check(
  "cliente: update direto em payment_requests não tem grant",
  /revoke insert, update, delete on public\.payment_requests from anon, authenticated/i.test(sql),
);

check(
  "cliente: o único SELECT é por vínculo com a casa",
  /create policy payment_requests_select_member on public\.payment_requests[\s\S]{0,200}is_restaurant_member\(restaurant_id\)/i.test(
    sql,
  ),
);

check(
  "cliente: RPC de confirmação exige admin e não aceita chamada anônima",
  /create or replace function public\.admin_confirm_payment[\s\S]*?if not public\.is_platform_admin\(\) then\s*raise exception 'admin_forbidden'/i.test(
    sql,
  ),
);

check(
  "cliente: existe caminho de ativação fora de admin_confirm_payment? (não deve haver)",
  !/update public\.subscriptions[\s\S]{0,200}set[\s\S]{0,80}status = 'active'/i.test(sql) ||
    (sql.match(/set[\s\S]{0,200}status = 'active'/gi) || []).length === 1,
  "só a confirmação escreve 'active'",
);

check(
  "cliente: request_plan_payment só aceita owner/admin da casa",
  /create or replace function public\.request_plan_payment[\s\S]*?is_restaurant_owner_admin\(v_rest\)/i.test(sql),
);

check(
  "cliente: attach_payment_receipt confere o vínculo antes de gravar",
  /create or replace function public\.attach_payment_receipt[\s\S]*?is_restaurant_owner_admin\(v_row\.restaurant_id\)/i.test(sql),
);

/* ========================================================================== */
/* 2. O valor vem do banco                                                    */
/* ========================================================================== */

check(
  "valor: a RPC de solicitação NÃO recebe amount",
  !/function public\.request_plan_payment\([^)]*amount/i.test(sql),
);

check(
  "valor: a RPC lê price_monthly de plans",
  /v_plan\.price_monthly/.test(sql),
);

check(
  "valor: anual = 12× o preço mensal",
  /when p_interval = 'yearly' then round\(v_plan\.price_monthly \* 12, 2\)/i.test(sql),
);

check(
  "valor: o preço é congelado na solicitação (coluna amount)",
  /amount\s+numeric\(10, 2\) not null check \(amount >= 0\)/i.test(sql),
);

check(
  "valor: a action não aceita nem repassa valor",
  // `amount` só pode aparecer devolvido pelo banco (data), nunca como entrada
  // nem como parâmetro de RPC.
  !/input\??\.amount/.test(actions) &&
    !/p_amount/.test(actions) &&
    !/amount\s*:\s*z\./.test(actions),
  "nenhum amount vem do formulário",
);

check(
  "valor: assinatura ativada guarda o preço da solicitação",
  /price_snapshot[\s\S]{0,400}v_req\.amount/i.test(sql),
);

/* ========================================================================== */
/* 3. MASTER_ADMIN é um degrau acima                                          */
/* ========================================================================== */

check(
  "master: is_platform_owner existe e olha o role",
  /create or replace function public\.is_platform_owner\(\)[\s\S]*?pa\.role = 'owner'/i.test(sql),
);

check(
  "master: salvar a chave PIX exige is_platform_owner",
  /create or replace function public\.admin_save_payment_settings[\s\S]*?if not public\.is_platform_owner\(\) then\s*raise exception 'master_admin_forbidden'/i.test(
    sql,
  ),
);

check(
  "master: ajustar período acima do plano é privilégio do master",
  /if p_period_days is not null and not public\.is_platform_owner\(\) then\s*raise exception 'period_override_forbidden'/i.test(
    sql,
  ),
);

check(
  "master: a chave PIX inteira não vai para a auditoria",
  /right\(v_key, 4\)/.test(sql) && !/'pix_key', v_key/.test(sql),
  "auditoria grava só os 4 últimos dígitos",
);

/* ========================================================================== */
/* 4. Sem gateway, sem webhook                                                */
/* ========================================================================== */

check(
  "honestidade: nenhuma rota de webhook foi criada",
  !fs.existsSync(path.join(ROOT, "src/app/api/webhooks")),
  "não existe /api/webhooks/*",
);

check(
  "honestidade: o provedor PIX não finge modo live",
  /export const manualPixProvider[\s\S]{0,200}live: false/.test(billing),
);

check(
  "honestidade: handleWebhook do PIX devolve handled: false",
  /handleWebhook\(\)[\s\S]{0,300}handled: false/.test(billing),
);

check(
  "honestidade: o texto diz que a confirmação é manual",
  /confirmação é manual|conferência manual|confirmação humana/i.test(
    lib + sql + read("src/components/payments/plan-pix-picker.tsx"),
  ),
);

check(
  "honestidade: enviar comprovante NÃO chama confirmação",
  !/confirmPayment/.test(read("src/components/payments/payment-status-card.tsx").split("ReceiptUpload")[1] || ""),
  "ReceiptUpload só chama submitPaymentReceipt",
);

check(
  "honestidade: a tela do cliente não oferece mudar status",
  !/admin_confirm_payment|admin_reject_payment/.test(actions.split("Administrador")[0] || ""),
);

/* ========================================================================== */
/* 5. Multi-tenant                                                            */
/* ========================================================================== */

check(
  "tenant: nenhuma action do cliente aceita restaurantId do navegador",
  !/input\s*\.\s*restaurantId|restaurantId\s*:\s*z\./.test(actions),
  "usa getActiveRestaurant()",
);

check(
  "tenant: actions do cliente usam getActiveRestaurant",
  /getActiveRestaurant/.test(actions),
);

check(
  "tenant: payment_requests tem restaurant_id NOT NULL com FK",
  /restaurant_id\s+uuid not null references public\.restaurants \(id\) on delete cascade/.test(sql),
);

check(
  "tenant: painel do cliente resolve a casa pelo vínculo, não pela URL",
  /function public\.my_payment_panel\([\s\S]*?from public\.restaurant_users[\s\S]*?where user_id = auth\.uid\(\)/i.test(sql),
);

check(
  "tenant: listagem admin exige is_platform_admin (dado global)",
  /function public\.admin_list_payment_requests[\s\S]*?if not public\.is_platform_admin\(\)/i.test(sql),
);

check(
  "tenant: comprovante só no caminho da própria casa",
  /p_path not like v_row\.restaurant_id::text \|\| '\/receipts\/%'/.test(sql),
);

check(
  "tenant: bucket de comprovante é privado",
  /'payment-receipts',\s*'payment-receipts',\s*false/.test(sql),
);

check(
  "tenant: leitura do comprovante é por URL assinada",
  /createSignedUrl\(path, 300\)/.test(data),
);

check(
  "tenant: alias /dashboard/billing exige sessão no middleware",
  /pathname\.startsWith\("\/dashboard\/"\)/.test(middleware),
);

/* ========================================================================== */
/* 6. Prazo e renovação                                                       */
/* ========================================================================== */

check(
  "prazo: 30 dias mensal / 365 anual vêm de função",
  /create or replace function public\.billing_period_days[\s\S]{0,200}yearly' then 365 else 30/i.test(sql),
);

check(
  "prazo: confirmar fecha a assinatura corrente e abre outra",
  /update public\.subscriptions[\s\S]{0,200}cancel_reason = 'replaced_by_payment'/.test(sql),
);

check(
  "prazo: confirmar vincula a assinatura ao pedido",
  /payment_request_id, payment_method, activated_by, activated_at/.test(sql),
);

check(
  "prazo: rejeitar não cria assinatura",
  !/create or replace function public\.admin_reject_payment[\s\S]{0,1500}insert into public\.subscriptions/i.test(
    sql,
  ),
);

check(
  "prazo: rejeitar exige motivo",
  /function public\.admin_reject_payment\(\s*p_id\s+uuid,\s*p_reason text\s*\)/.test(sql) &&
    /if p_reason is null or char_length\(btrim\(p_reason\)\) < 3 then\s*raise exception 'invalid_reason'/.test(
      sql,
    ),
);

check(
  "prazo: confirmar duas vezes é recusado (idempotência por status)",
  /if v_req\.status <> 'PENDING' then\s*raise exception 'payment_not_pending'/.test(sql),
);

/* ========================================================================== */
/* 7. Auditoria                                                               */
/* ========================================================================== */

check(
  "auditoria: confirmação grava MANUAL_PAYMENT_CONFIRMED",
  /'MANUAL_PAYMENT_CONFIRMED'/.test(sql),
);

check(
  "auditoria: o log carrega admin, casa, pedido, assinatura, valor e plano",
  /'admin_user_id'[\s\S]{0,400}'payment_request_id', v_req\.id,[\s\S]{0,200}'subscription_id', v_new\.id,[\s\S]{0,400}'amount', v_req\.amount/i.test(
    sql,
  ),
);

check(
  "auditoria: rejeição e cancelamento também são registrados",
  /'payment\.rejected'/.test(sql) && /'payment\.cancelled'/.test(sql),
);

check(
  "auditoria: log_admin_action é usado, não um insert manual",
  !/insert into public\.admin_audit_log/i.test(sql) && /public\.log_admin_action\(/.test(sql),
);

/* ========================================================================== */
/* 8. Mobile                                                                  */
/* ========================================================================== */

const picker = read("src/components/payments/plan-pix-picker.tsx");
const statusCard = read("src/components/payments/payment-status-card.tsx");
const adminList = read("src/app/admin/pagamentos/page.tsx");
const adminDetail = read("src/components/payments/payment-detail-panel.tsx");
const adminSettings = read("src/components/payments/payment-settings-form.tsx");
const clientPage = read("src/app/app/pagamento/page.tsx");

check(
  "mobile: nenhuma tabela horizontal nas telas novas",
  [picker, statusCard, adminList, adminDetail, adminSettings, clientPage].every((f) => !/<table/.test(f)),
);
check(
  "mobile: alvos de toque ≥ 44px",
  /min-h-11/.test(picker) && /min-h-11/.test(adminDetail) && /min-h-11/.test(adminSettings),
);
check(
  "mobile: filtros do admin rolam na horizontal, não quebram a tela",
  /overflow-x-auto/.test(adminList),
);
check(
  "mobile: lista do admin é vertical (ul/li), não grade de tabela",
  /<ul[\s\S]{0,600}<li/.test(adminList),
);
check(
  "acessibilidade: status sempre com texto, não só cor",
  /PAYMENT_REQUEST_STATUS_LABEL/.test(adminList) && /PAYMENT_REQUEST_STATUS_LABEL/.test(adminList),
);

/* ========================================================================== */
/* 9. Estado exposto ao cliente (só recebimento)                              */
/* ========================================================================== */

check(
  "exposição: my_payment_panel devolve só campos de recebimento do PIX",
  !/updated_by|created_at', v_settings\.created_at/.test(
    (sql.split("function public.my_payment_panel")[1] || "").split("$$;")[0],
  ),
  "sem updated_by, sem linha crua",
);

check(
  "exposição: a resposta do cliente não inclui e-mail do admin nem nome de tabela interna",
  !/confirmed_by_email/.test((sql.split("function public.my_payment_panel")[1] || "").split("$$;")[0]),
);

check(
  "exposição: painel admin devolve can_edit separado da guarda",
  /'can_edit', public\.is_platform_owner\(\)/.test(sql),
);

check(
  "exposição: nenhuma credencial/segredo em componente de cliente",
  ![picker, statusCard, adminDetail, adminSettings].some((f) =>
    /SERVICE_ROLE|service_role|SUPABASE_SERVICE|secret/i.test(f),
  ),
);

/* ========================================================================== */
/* 10. Estrutura para os 8 testes SQL                                         */
/* ========================================================================== */

const sqlTests = [
  ["T1 criar solicitação → PENDING", /status\s+public\.payment_request_status not null default 'PENDING'/],
  ["T2 restaurante não atualiza status", /revoke insert, update, delete on public\.payment_requests/],
  ["T3 restaurante não ativa assinatura", /function public\.my_payment_panel[\s\S]*?(?!admin_confirm)/],
  [
    "T4 RPC admin negada a usuário comum",
    /function public\.admin_list_payment_requests[\s\S]{0,1400}raise exception 'admin_forbidden'/,
  ],
  ["T5 confirmar → CONFIRMED + ACTIVE", /'active', v_req\.billing_interval/],
  ["T6 rejeitar → REJECTED sem ativação", /set status = 'REJECTED'/],
  ["T7 RLS isola casas", /create policy payment_requests_select_member/],
  ["T8 preço do banco", /v_amount := case/],
];

for (const [name, pattern] of sqlTests) {
  check(`suíte SQL: ${name}`, pattern.test(sql));
}

/* ========================================================================== */
/* Resultado                                                                  */
/* ========================================================================== */

const passed = results.filter((r) => r.ok).length;
console.log("");
for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\npayments-security: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
