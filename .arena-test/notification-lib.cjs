/**
 * Harness do modelo de notificação — Etapa 26 (parte 1).
 *
 * Alvo: `src/lib/notifications.ts`, sem DOM e sem banco.
 *
 * O que aqui, se errar, **não** dá erro — dá aviso que ninguém vê:
 *
 *   1. tipos: um tipo emitido pelo banco sem rótulo/ícone na tela vira
 *      `undefined` no card;
 *   2. destino: um toque que leva para 404 ou para a tela errada faz a pessoa
 *      achar que o sistema quebrou;
 *   3. contador: `9+` e o rótulo acessível precisam concordar;
 *   4. tempo relativo: "Há 0 min" e "Há -1 min" são piores que nada.
 *
 * ─── A lista de tipos vem do banco ─────────────────────────────────────────
 *
 * `ENUM_FROM_DATABASE` é o resultado de
 *   `select string_agg(enumlabel, ',' order by enumsortorder)
 *      from pg_enum join pg_type ... where typname = 'notification_type'`
 * no projeto Supabase real, executado em 2026-11-23. É o teste de paridade
 * entre o enum e a lista do TypeScript: tipo novo no banco sem entrada aqui
 * quebra este harness, e não a tela de produção.
 *
 * Rodar: node .arena-test/notification-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-notification-lib");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/notifications.ts")],
  bundle: true,
  outfile: path.join(OUT, "notifications.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  logLevel: "error",
});

const N = require(path.join(OUT, "notifications.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`);

/* ========================================================================== */
/* 1. Tipos — paridade com o enum do banco                                   */
/* ========================================================================== */

const ENUM_FROM_DATABASE = [
  "order_created",
  "order_cancelled",
  "order_ready",
  "order_delivered",
  "table_waiter_called",
  "table_bill_requested",
  "payment_received",
  "payment_failed",
  "subscription_expiring",
  "subscription_expired",
  "customer_created",
  "coupon_expiring",
];

eq("lista de tipos == enum do banco", [...N.NOTIFICATION_TYPES], ENUM_FROM_DATABASE);
eq(
  "entidades == enum notification_entity",
  [...N.NOTIFICATION_ENTITIES],
  ["order", "table_request", "payment", "subscription", "customer", "coupon"],
);

for (const type of ENUM_FROM_DATABASE) {
  check(`rótulo para ${type}`, typeof N.NOTIFICATION_TYPE_LABEL[type] === "string" && N.NOTIFICATION_TYPE_LABEL[type].length > 0);
  check(`ícone para ${type}`, typeof N.NOTIFICATION_ICON_KEY[type] === "string");
  check(`tom para ${type}`, ["brand", "success", "warning", "danger"].includes(N.NOTIFICATION_TONE[type]));
}

check(
  "todo tom tem classe de ícone mapeada na tela",
  Object.values(N.NOTIFICATION_TONE).every((tone) =>
    new RegExp(`\\b${tone}:`).test(fs.readFileSync(path.join(ROOT, "src/components/notifications/notification-bell.tsx"), "utf8")),
  ),
);

/* ========================================================================== */
/* 2. Destino do toque                                                       */
/* ========================================================================== */

const href = (entity, id = "11111111-1111-1111-1111-111111111111", scope = "restaurant") =>
  N.notificationHref({ entity_type: entity, entity_id: id, restaurant_id: "r", is_global: scope === "platform" }, scope);

eq("pedido abre o pedido", href("order"), "/app/pedidos?pedido=11111111-1111-1111-1111-111111111111");
eq("solicitação abre o salão", href("table_request"), "/app/pedidos?aba=salao");
eq("assinatura abre o plano", href("subscription"), "/app/plano");
eq("cliente abre a ficha", href("customer"), "/app/clientes/11111111-1111-1111-1111-111111111111");
eq("cupom abre os cupons", href("coupon"), "/app/marketing/cupons");
eq("pagamento do dono abre o plano", href("payment"), "/app/plano");
eq("global abre a fila do master", href("payment", "x", "platform"), "/admin/pagamentos");
eq("sem entidade não navega", href(null), null);
eq("entidade sem id não navega", N.notificationHref({ entity_type: "order", entity_id: null, restaurant_id: "r" }), null);

/*
 * O destino precisa existir de verdade. Um `href` para rota inexistente é pior
 * que nenhum link: a pessoa toca, vê 404 e conclui que o sistema quebrou.
 */
const ROUTES = ["app/pedidos", "app/plano", "app/clientes", "app/clientes/[id]", "app/marketing/cupons", "admin/pagamentos"];
for (const route of ROUTES) {
  check(`rota /${route} existe`, fs.existsSync(path.join(ROOT, "src/app", route, "page.tsx")));
}

/* ========================================================================== */
/* 3. Contador                                                               */
/* ========================================================================== */

eq("badge vazio em zero", N.badgeText(0), "");
eq("badge 1", N.badgeText(1), "1");
eq("badge 9", N.badgeText(9), "9");
eq("badge 10 vira 9+", N.badgeText(10), "9+");
eq("badge 99 vira 9+", N.badgeText(99), "9+");
eq("badge negativo vazio", N.badgeText(-3), "");

eq("rótulo sem nada", N.bellLabel(0), "Notificações");
eq("rótulo no singular", N.bellLabel(1), "Notificações, 1 não lida");
eq("rótulo no plural", N.bellLabel(4), "Notificações, 4 não lidas");

eq("conta não lidas", N.countUnread([{ read_at: null }, { read_at: "x" }, { read_at: null }]), 2);
eq("lista vazia", N.countUnread([]), 0);

/* ========================================================================== */
/* 4. Tempo relativo                                                         */
/* ========================================================================== */

const NOW = new Date("2026-11-23T15:00:00Z").getTime();
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();

eq("agora", N.relativeNotificationTime(at(0), NOW), "Agora");
/*
 * Trinta segundos atrás **é** "Agora" — a função arredonda para o minuto mais
 * próximo, e é o comportamento certo: "Há 1 min" para algo de meio minuto faz
 * a pessoa procurar o que aconteceu antes do que aconteceu.
 */
eq("30s atrás arredonda para 1 min", N.relativeNotificationTime(at(0.5), NOW), "Há 1 min");
eq("minuto e meio vira 2 min", N.relativeNotificationTime(at(1.5), NOW), "Há 2 min");
eq("1 minuto", N.relativeNotificationTime(at(1), NOW), "Há 1 min");
eq("45 minutos", N.relativeNotificationTime(at(45), NOW), "Há 45 min");
eq("1 hora", N.relativeNotificationTime(at(60), NOW), "Há 1 h");
eq("23 horas", N.relativeNotificationTime(at(23 * 60), NOW), "Há 23 h");
eq("ontem", N.relativeNotificationTime(at(25 * 60), NOW), "Ontem");
eq("3 dias", N.relativeNotificationTime(at(3 * 24 * 60), NOW), "Há 3 dias");
check("mais de uma semana vira data", /^\d{2}\/\d{2}$/.test(N.relativeNotificationTime(at(10 * 24 * 60), NOW)));
check("data inválida não quebra", N.relativeNotificationTime("nao-e-data", NOW) === "Agora");
check("nunca negativo", !N.relativeNotificationTime(at(-5), NOW).includes("-"));

check("hora absoluta formatada", /^\d{2}\/\d{2},? \d{2}:\d{2}$/.test(N.notificationClock("2026-11-23T15:04:00Z", "America/Sao_Paulo")));
check("hora com data inválida devolve vazio", N.notificationClock("x") === "");

/* ========================================================================== */
/* 5. Normalização da linha                                                  */
/* ========================================================================== */

{
  const row = N.normalizeNotification({
    id: "a1",
    restaurant_id: "r1",
    type: "order_created",
    title: "Novo pedido #12",
    message: "Mesa 3 fez um pedido de R$ 20,00.",
    entity_type: "order",
    entity_id: "o1",
    read_at: null,
    created_at: "2026-11-23T15:00:00Z",
    is_global: false,
  });

  eq("id como texto", row.id, "a1");
  eq("tipo preservado", row.type, "order_created");
  eq("entidade preservada", row.entity_type, "order");
  eq("não lida", row.read_at, null);
  eq("não global", row.is_global, false);
}

{
  // Tipo desconhecido (banco mais novo que o deploy) não pode virar `undefined`.
  const row = N.normalizeNotification({ id: "a2", type: "tipo_do_futuro", title: "x", message: "y" });
  check("tipo desconhecido cai num conhecido", N.NOTIFICATION_TYPES.includes(row.type));
  check("título preservado mesmo com tipo desconhecido", row.title === "x");
}

{
  const row = N.normalizeNotification({
    id: "a3",
    type: "order_created",
    title: "t",
    message: "m",
    entity_type: "entidade_inexistente",
    entity_id: "z",
  });
  eq("entidade desconhecida vira nula", row.entity_type, null);
  eq("id de entidade descartado junto", row.entity_id, null);
}

{
  const row = N.normalizeNotification({ id: "a4", type: "order_created" });
  check("linha sem título ganha um", row.title.length > 0);
  eq("mensagem ausente vira vazia", row.message, "");
  check("data ausente vira algo válido", !Number.isNaN(new Date(row.created_at).getTime()));
}

{
  const row = N.normalizeNotification({
    id: "a5",
    type: "payment_received",
    title: "t",
    message: "m",
    entity_type: "payment",
    entity_id: "p1",
    is_global: true,
  });
  check("global preservado", row.is_global === true);
  eq("global sem casa", row.restaurant_id, null);
}

/* ========================================================================== */
/* 6. Agrupamento de preferências                                            */
/* ========================================================================== */

/* O catálogo de verdade vem do banco (`my_notification_preferences`); aqui se
 * confere só o agrupador, com uma amostra do formato que ele devolve. */
const sampleCatalog = [
  { type: "order_created", label: "Novo pedido", group: "Pedidos" },
  { type: "order_ready", label: "Pedido pronto", group: "Pedidos" },
  { type: "table_waiter_called", label: "Garçom chamado", group: "Salão" },
  { type: "payment_received", label: "Pagamento confirmado", group: "Pagamentos" },
  { type: "coupon_expiring", label: "Cupom expirando", group: "Marketing" },
];

{
  const groups = N.groupPreferences(sampleCatalog);
  eq("agrupa em 4 grupos", groups.length, 4);
  eq("primeiro grupo é Pedidos", groups[0].group, "Pedidos");
  eq("Pedidos tem 2 itens", groups[0].items.length, 2);
  check("ordem segue PREFERENCE_GROUP_ORDER", groups.map((g) => g.group).join(",") === "Pedidos,Salão,Pagamentos,Marketing");
}

{
  // Ordem de chegada não pode ditar a ordem da tela: salvar e recarregar não
  // pode reembaralhar os switches.
  const shuffled = [...sampleCatalog].reverse();
  eq("ordem independe da entrada", N.groupPreferences(shuffled).map((g) => g.group), N.groupPreferences(sampleCatalog).map((g) => g.group));
}

eq("catálogo vazio não quebra", N.groupPreferences([]), []);
check(
  "grupo fora da lista canônica é descartado, não vira seção solta",
  N.groupPreferences([{ type: "order_created", label: "x", group: "Grupo_Desconhecido" }]).length === 0,
);

/* ========================================================================== */
/* 7. Canais: preparado e não entregue                                        */
/* ========================================================================== */

{
  const ids = N.NOTIFICATION_CHANNELS.map((c) => c.id);
  eq("canal in-app existe", ids.includes("in_app"), true);
  for (const planned of ["web_push", "email", "whatsapp", "sms"]) {
    check(`canal ${planned} listado`, ids.includes(planned));
    check(
      `canal ${planned} marcado como planejado`,
      N.NOTIFICATION_CHANNELS.find((c) => c.id === planned).state === "planned",
    );
  }
  check(
    "só o canal do painel está pronto",
    N.NOTIFICATION_CHANNELS.filter((c) => c.state === "ready").map((c) => c.id).join(",") === "in_app",
  );
}

/* ========================================================================== */
/* 8. Guardas estruturais                                                    */
/* ========================================================================== */

const src = fs.readFileSync(path.join(ROOT, "src/lib/notifications.ts"), "utf8");
/* O comentário de abertura cita `server-only` para explicar o que a lib não
 * faz; a checagem olha import/require, não a prosa. */
check("lib neutra: sem import de server-only", !/^\s*import\s+["']server-only/m.test(src));
check("lib neutra: sem next/*", !/from ["']next\//.test(src));
check("lib neutra: sem supabase", !/supabase/i.test(src));
check("lib neutra: sem ação de servidor", !/["']use server["']/.test(src));

const action = fs.readFileSync(path.join(ROOT, "src/actions/notifications.ts"), "utf8");
check("action não cria notificação", !/rpc\(["'](create_notification|notify_)/.test(action));
check("action usa as RPCs de leitura/marcação", /mark_notification_read/.test(action) && /mark_all_notifications_read/.test(action));
check("action não recebe restaurantId do cliente nas marcações", !/restaurantId.*markNotificationRead/.test(action));

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (notification-lib.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
