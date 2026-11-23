/**
 * Harness de segurança e de integração — Etapa 26 (parte 2).
 *
 * A pergunta aqui é **"o sino abre alguma porta que o banco não fecha?"**.
 *
 * As portas vigiadas, em ordem de gravidade:
 *
 *   1. **notificação forjada** — se a tela pudesse emitir, um usuário avisaria
 *      o outro com texto arbitrário (phishing dentro do próprio painel);
 *   2. **caixa do colega** — ler a notificação de outro membro da mesma casa;
 *   3. **id forjado apagando o sino** — foi bug real desta etapa, medido:
 *      `p_id` nulo marcava tudo, e um id invisível chegava como nulo;
 *   4. **preferência como autorização** — desligar o sino não pode desligar o
 *      fato (pedido, chamada);
 *   5. **`service_role`** em arquivo novo;
 *   6. **regressão do pedido** — o caminho sem cupom, corrigido nesta etapa;
 *   7. **promessa de canal** — push/e-mail/WhatsApp/SMS sem implementação.
 *
 * Rodar: node .arena-test/notification-security.cjs
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

const MIGRATION = "supabase/migrations/0027_notifications.sql";
const mig = read(MIGRATION);
const migCode = codeOnly(mig);

/* -------------------------------------------------------------------------- */
/* 0. Arquivos                                                              */
/* -------------------------------------------------------------------------- */

for (const file of [
  MIGRATION,
  "src/lib/notifications.ts",
  "src/lib/data/notifications.ts",
  "src/actions/notifications.ts",
  "src/app/api/notifications/route.ts",
  "src/app/app/notificacoes/page.tsx",
  "src/components/notifications/notification-bell.tsx",
  "src/components/notifications/notification-preferences-form.tsx",
  "src/components/notifications/use-notifications.ts",
  "src/components/notifications/bell-slot.tsx",
]) {
  check(`existe ${file}`, exists(file));
}

/* -------------------------------------------------------------------------- */
/* 1. Emissão é só do banco                                                 */
/* -------------------------------------------------------------------------- */

{
  const action = codeOnly(read("src/actions/notifications.ts"));
  const route = codeOnly(read("src/app/api/notifications/route.ts"));
  const hook = codeOnly(read("src/components/notifications/use-notifications.ts"));

  for (const [label, source] of [
    ["action", action],
    ["rota", route],
    ["hook", hook],
  ]) {
    check(`${label}: não cria notificação`, !/rpc\(\s*["'](create_notification|notify_)/.test(source));
    check(`${label}: não insere em notifications`, !/\.from\(\s*["']notifications["']\s*\)\s*\.insert/.test(source));
    check(`${label}: não chama notify_restaurant_staff`, !/notify_restaurant_staff/.test(source));
  }

  // `notify_restaurant_staff` não é concedida a cliente: notificação é
  // consequência de um fato, não algo que a tela pede.
  check(
    "notify_restaurant_staff sem execute nem para authenticated",
    /revoke all on function public\.notify_restaurant_staff\([\s\S]{0,200}\) from public, anon, authenticated;/.test(mig),
  );
  check(
    "notify_restaurant_staff nunca é concedida",
    !/grant execute on function public\.notify_restaurant_staff/.test(mig),
  );
  check(
    "notify_platform_admins não é chamável por anon",
    /revoke all on function public\.notify_platform_admins\([\s\S]{0,120}\) from public, anon;/.test(mig),
  );
  check(
    "notify_platform_admins exige admin quando há sessão",
    /if v_caller is not null and not public\.is_platform_admin\(\) then\s*\n\s*raise exception 'notification_forbidden'/.test(mig),
  );
  check(
    "emissão de pedido novo é só interna",
    /revoke all on function public\.notifications_emit_order_created\(uuid\) from public, anon, authenticated;/.test(mig),
  );

  // A rota exige sessão, mesmo a RPC já filtrando.
  check("rota devolve 401 sem sessão", /status: 401/.test(route) && /auth\.getUser\(\)/.test(route));
  check("rota não cacheia", /no-store/.test(route));
}

/* -------------------------------------------------------------------------- */
/* 2. Caixa de cada um                                                      */
/* -------------------------------------------------------------------------- */

{
  check(
    "RLS ligada em notifications",
    /alter table public\.notifications enable row level security/.test(mig),
  );
  check(
    "contagem filtra por auth.uid()",
    /where n\.read_at is null[\s\S]{0,300}n\.user_id = auth\.uid\(\)/.test(mig),
  );
  check(
    "lista filtra por auth.uid()",
    /n\.user_id = auth\.uid\(\) and \(n\.restaurant_id is null or public\.is_restaurant_member\(n\.restaurant_id\)\)/.test(mig),
  );
  check(
    "notificação global é visível só para admin da plataforma",
    /n\.user_id is null and public\.is_platform_admin\(\)/.test(mig),
  );
  check(
    "RLS de select repete a regra",
    /create policy notifications_select_own[\s\S]{0,400}user_id = auth\.uid\(\)/.test(mig),
  );
  check(
    "policy de update tem with check (não deixa mover para outro dono)",
    /create policy notifications_update_own[\s\S]{0,900}with check/.test(mig),
  );
  check(
    "sem policy de insert para cliente",
    !/create policy notifications_insert/.test(mig),
  );
  check(
    "sem policy de delete para cliente",
    !/create policy notifications_delete/.test(mig),
  );
  check(
    "authenticated não insere na tabela",
    /revoke insert, update, delete, truncate on public\.notifications from authenticated/.test(mig),
  );
  check(
    "authenticated só atualiza read_at",
    /grant update \(read_at\) on public\.notifications to authenticated/.test(mig),
  );
  check("anon sem acesso à tabela", /revoke all on public\.notifications from anon/.test(mig));
}

/* -------------------------------------------------------------------------- */
/* 3. Marcar como lida — o bug medido                                        */
/* -------------------------------------------------------------------------- */

{
  /*
   * O bug: uma única função aceitava `p_id nulo = todas`. Um id que não
   * resolve — notificação de outra casa, escondida pela RLS — chegava como
   * NULL e a chamada limpava o sino inteiro. Medido no banco antes de corrigir.
   */
  check(
    "marcar uma exige id",
    /create or replace function public\.mark_notification_read\(p_id uuid\)[\s\S]{0,600}if p_id is null then\s*\n\s*raise exception 'notification_id_required'/.test(mig),
  );
  check(
    "marcar todas tem função própria",
    /create or replace function public\.mark_all_notifications_read\(\)/.test(mig),
  );
  check(
    "marcar todas não toca notificação global",
    /create or replace function public\.mark_all_notifications_read\(\)[\s\S]{0,700}and n\.user_id = auth\.uid\(\)\s*\n\s*returning 1/.test(mig),
  );
  check(
    "marcar uma confere o dono no where",
    /where n\.id = p_id[\s\S]{0,200}n\.user_id = auth\.uid\(\)/.test(mig),
  );

  const action = read("src/actions/notifications.ts");
  check("action usa a versão que exige id", /mark_notification_read/.test(action));
  check("action usa a versão de todas separada", /mark_all_notifications_read/.test(action));
  // A action antiga (`p_id` opcional) não pode ter sobrado em lugar nenhum.
  check(
    "nenhum chamador passa id nulo para marcar lidas",
    !/mark_notification_read",\s*\{\s*p_id:\s*null/.test(action),
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Preferência não é autorização                                         */
/* -------------------------------------------------------------------------- */

{
  check(
    "preferência filtra na emissão",
    /and not coalesce\(\s*\n?\s*\(\s*\n?\s*select np\.disabled \? p_type::text/.test(mig),
  );
  check(
    "preferência desconhecida derruba a gravação",
    /raise exception 'unknown_notification_type' using errcode = '22023', detail = v_key/.test(mig),
  );
  check(
    "salvar preferência exige vínculo com a casa",
    /create or replace function public\.save_notification_preferences\([\s\S]{0,700}if not public\.is_restaurant_member\(p_restaurant_id\)/.test(mig),
  );
  check(
    "preferência chaveia por usuário",
    /create table if not exists public\.notification_preferences \(\s*\n\s*user_id\s+uuid not null/.test(mig),
  );
  check(
    "preferência tem RLS",
    /alter table public\.notification_preferences enable row level security/.test(mig),
  );
  check(
    "policy de preferência é só do próprio usuário",
    /create policy notification_preferences_own[\s\S]{0,200}using \(user_id = auth\.uid\(\)\)[\s\S]{0,120}with check \(user_id = auth\.uid\(\)\)/.test(mig),
  );

  /*
   * Desligar o sino não pode desligar o pedido. Os gatilhos só *leem* o fato já
   * gravado e repassam para `notify_restaurant_staff`, que é quem consulta a
   * preferência — e só para decidir a linha do sino. Nenhum gatilho tem
   * `if ... preference ... then return`, nem escreve na tabela de preferências.
   */
  const triggers = mig.slice(
    mig.indexOf("-- 6. Gatilhos: pedido"),
    mig.indexOf("-- 13. RPCs da tela"),
  );
  check(
    "nenhum gatilho escreve preferência",
    !/insert into public\.notification_preferences|update public\.notification_preferences/.test(triggers),
  );
  check(
    "nenhum gatilho aborta o fato por preferência",
    !/(raise|return null)[\s\S]{0,200}notification_preferences/.test(triggers),
  );
  check(
    "gatilhos só tocam preferência via emissão",
    (triggers.match(/notification_preferences/g) || []).length === 0,
  );

  const form = read("src/components/notifications/notification-preferences-form.tsx");
  check("formulário não salva a cada toque", !/onChange=\{\(\) => \{\s*void save/.test(form));
}

/* -------------------------------------------------------------------------- */
/* 5. service_role                                                          */
/* -------------------------------------------------------------------------- */

{
  const offenders = walk("src").filter((rel) =>
    /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|service_role_key/i.test(read(rel)),
  );
  check("nenhum arquivo novo usa service_role", offenders.length === 0, offenders.join(", "));
}

/* -------------------------------------------------------------------------- */
/* 6. Regressão: o pedido sem cupom (bug da Etapa 25)                        */
/* -------------------------------------------------------------------------- */

{
  /*
   * Este é o defeito mais caro encontrado nesta etapa, e ele **não é desta
   * etapa**: um `case` que lia um `record` não atribuído derrubava todo pedido
   * sem cupom com 55000. O harness trava a correção para ela não se perder numa
   * reescrita futura de `create_order`.
   */
  const createOrder = mig.slice(
    mig.indexOf("create or replace function public.create_order("),
    mig.indexOf("comment on function public.create_order"),
  );

  check("create_order foi reintroduzida na migration", createOrder.length > 2000);
  check(
    "snapshot do cupom sai em variáveis, não em case",
    /v_coupon_id\s*:= null;/.test(createOrder) && /if v_discount > 0 then/.test(createOrder),
  );
  check(
    "não há case lendo v_coupon no update",
    !/coupon_id\s*=\s*case when v_discount/.test(createOrder),
  );
  check(
    "assinatura de 7 argumentos preservada",
    /p_coupon_code\s+text default null/.test(createOrder),
  );
  check(
    "aviso de pedido novo sai depois dos totais",
    createOrder.indexOf("notifications_emit_order_created") >
      createOrder.indexOf("update public.orders set"),
  );
  check(
    "falha do aviso não derruba o pedido",
    /begin\s*\n\s*perform public\.notifications_emit_order_created\(v_order_id\);\s*\n\s*exception when others then\s*\n\s*null;/.test(
      createOrder,
    ),
  );
  check(
    "trigger de pedido não escuta INSERT (evita total 0)",
    /after update of status on public\.orders/.test(mig) &&
      !/after insert or update of status on public\.orders/.test(mig),
  );
  check(
    "trigger de status roda só na mudança de status",
    /if tg_op <> 'UPDATE' or new\.status = old\.status then\s*\n\s*return new;/.test(mig),
  );

  // O app continua mandando só o código do cupom (Etapa 25), não desconto.
  check(
    "app não passou a enviar valores de desconto",
    !/p_discount|p_total|p_subtotal/.test(codeOnly(read("src/actions/orders.ts"))),
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Autoria: quem causou recebe lido, não é excluído                      */
/* -------------------------------------------------------------------------- */

{
  check(
    "emissão marca read_at do autor",
    /case when d\.ja_lida then now\(\) else null end/.test(mig),
  );
  check(
    "emissão não descarta o autor",
    !/ru\.user_id <> p_actor_user/.test(mig),
  );
  const emit = mig.slice(mig.indexOf("create or replace function public.notify_restaurant_staff("));
  check(
    "comentário explica a decisão",
    /Excluir deixaria a casa de um único usuário/.test(mig) || /casa de um único usuário/.test(mig),
  );
  void emit;
}

/* -------------------------------------------------------------------------- */
/* 8. Escopo por papel                                                      */
/* -------------------------------------------------------------------------- */

{
  check(
    "cozinha só recebe aviso de pedido",
    /when ru\.role = 'kitchen' then p_type in \('order_created', 'order_cancelled', 'order_ready'\)/.test(mig),
  );
  check(
    "garçom só recebe salão e pronto",
    /when ru\.role = 'waiter' then p_type in \('table_waiter_called', 'table_bill_requested', 'order_ready'\)/.test(mig),
  );
  check(
    "assinatura avisa só quem administra",
    /array\['owner', 'admin', 'manager'\]::public\.restaurant_member_role\[\]/.test(mig),
  );
  check(
    "emissão ignora membro inativo",
    /and ru\.status = 'active'/.test(mig),
  );
}

/* -------------------------------------------------------------------------- */
/* 9. Sem canal falso                                                       */
/* -------------------------------------------------------------------------- */

{
  for (const forbidden of ["web-push", "webpush", "nodemailer", "sendgrid", "twilio", "firebase", "onesignal"]) {
    const hits = walk("src").filter((rel) => new RegExp(forbidden, "i").test(read(rel)));
    check(`sem integração de envio (${forbidden})`, hits.length === 0, hits.join(", "));
  }

  check("sem fila de envio", !/notification_outbox|notification_queue/.test(migCode));
  check("sem cron", !/pg_cron|cron\.schedule/.test(migCode));
  check("sem coluna de status de envio", !/notifications[\s\S]{0,400}\b(sent_at|delivered_at|failed_at)\b/.test(mig));
  check("sem coluna de canal", !/notifications[\s\S]{0,300}\bchannel\b/.test(mig.slice(mig.indexOf("create table if not exists public.notifications"), mig.indexOf("alter table public.notifications enable"))));

  const lib = read("src/lib/notifications.ts");
  check("canais listados como planejados", /state: "planned"/.test(lib));
  check("só o painel está pronto", /id: "in_app", label: "No painel", state: "ready"/.test(lib));

  const page = read("src/app/app/notificacoes/page.tsx");
  check("tela avisa que não há envio externo", /ainda não existem/.test(page));
  check("tela mostra Em breve nos canais", /Em breve/.test(page));
}

/* -------------------------------------------------------------------------- */
/* 10. Tempo real, sem polling                                              */
/* -------------------------------------------------------------------------- */

{
  const hook = read("src/components/notifications/use-notifications.ts");

  check("assina postgres_changes", /"postgres_changes"/.test(hook));
  check("filtra pelo destinatário", /filter: `user_id=eq\.\$\{userId\}`/.test(hook));
  check("remove o canal ao desmontar", /removeChannel\(channel\)/.test(hook));
  check("reconexão relê a lista", /if \(!firstSubscribe\) void refresh\(\)/.test(hook));
  check("sem setInterval de polling", !/setInterval/.test(hook));
  check("sem setTimeout em laço", !/setTimeout\([\s\S]{0,80}refresh/.test(hook));

  check(
    "tabela está na publicação de tempo real",
    /alter publication supabase_realtime add table public\.notifications/.test(mig),
  );
  check(
    "replica identity full para o evento trazer a linha",
    /alter table public\.notifications replica identity full/.test(mig),
  );
  check("canal por usuário", /notificationsRealtimeChannel = \(userId: string\)/.test(read("src/lib/realtime.ts")));

  // O evento de outra pessoa não pode chegar nem a ser entregue.
  check("canal nomeado pelo usuário", /`notifications:\$\{userId\}`/.test(read("src/lib/realtime.ts")));
}

/* -------------------------------------------------------------------------- */
/* 11. Integração com o que já existia                                       */
/* -------------------------------------------------------------------------- */

{
  for (const [label, table] of [
    ["pedido", "orders"],
    ["solicitação de mesa", "table_requests"],
    ["pagamento do pedido", "order_payments"],
    ["cliente", "customers"],
    ["pagamento de plano", "payment_requests"],
  ]) {
    check(`gatilho em ${table}`, new RegExp(`on public\\.${table}\\b`).test(mig));
  }

  check("gatilho de cliente só no INSERT", /after insert on public\.customers/.test(mig));
  check(
    "gatilho de pagamento do pedido ignora pending",
    /if new\.status not in \('paid', 'refunded'\) then/.test(mig),
  );
  check(
    "revisão de assinatura/cupom exige vínculo",
    /run_notification_review\([\s\S]{0,900}if p_restaurant_id is null or not public\.is_restaurant_member\(p_restaurant_id\)/.test(mig),
  );
  check(
    "revisão é idempotente por dia",
    (mig.match(/n\.created_at > date_trunc\('day', now\(\)\)/g) || []).length >= 3,
  );

  const layout = read("src/app/app/layout.tsx");
  check("painel roda a revisão do dia", /runNotificationReview\(restaurant\.id\)/.test(layout));
  check("revisão não bloqueia o painel", /Promise\.all/.test(layout));
  check("sino no layout do painel", /NotificationBellProvider/.test(layout));
  check("sino também no painel master", /NotificationBellProvider/.test(read("src/app/admin/layout.tsx")));

  const header = read("src/components/app/app-header.tsx");
  check("sino ligado por padrão no cabeçalho", /bell = true/.test(header));
  check("slot não desenha sem provider", /if \(!value\?\.userId\) return null/.test(read("src/components/notifications/bell-slot.tsx")));

  const nav = read("src/components/app/bottom-nav.tsx");
  const tabs = (nav.match(/href: "\/app/g) || []).length;
  check("menu inferior continua com 6 abas", tabs === 6, `abas=${tabs}`);
  check("sino não virou sétima aba", !/notificac/i.test(nav));
}

/* -------------------------------------------------------------------------- */
/* 12. Deep links                                                           */
/* -------------------------------------------------------------------------- */

{
  const page = read("src/app/app/pedidos/page.tsx");
  check("página aceita ?pedido=", /pedido\?: string/.test(page));
  check("página valida formato do uuid", /\/\^\[0-9a-f-\]\{36\}\$\/i/.test(page));
  check("página repassa o foco ao painel", /focusOrderId=\{focusOrderId\}/.test(page));
  check("página aceita ?aba=salao", /aba === "salao"/.test(page));

  const panel = read("src/components/orders/orders-panel.tsx");
  check("painel abre o detalhe do pedido focado", /setDetail\(found\)/.test(panel));
  check("painel não repete a abertura", /focusedRef\.current === focusOrderId/.test(panel));
  check("painel rola até o salão", /scrollIntoView/.test(panel));
}

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (notification-security.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
