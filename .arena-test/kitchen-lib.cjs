/**
 * Harness de regras do painel de cozinha — Etapa 17.
 *
 * Compila `src/lib/kitchen.ts` com esbuild e testa as funções puras, mais a
 * análise estática da migration `0017`. São as regras que erram em silêncio:
 *
 *   • contador que reinicia quando alguém toca no pedido;
 *   • pedido na coluna errada (pending caindo em "em preparo");
 *   • botão oferecido numa transição que o banco vai recusar;
 *   • "atrasado" em pedido já entregue — ruído que treina a ignorar o alerta;
 *   • contador negativo em tablet com relógio desregulado;
 *   • som tocando na primeira carga, assustando sem motivo.
 *
 * Rodar: node .arena-test/kitchen-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-kitchen-lib");

fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/kitchen.ts")],
  bundle: true,
  outfile: path.join(OUT, "kitchen.cjs"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(ROOT, "src") },
  external: ["server-only"],
  logLevel: "error",
});

const K = require(path.join(OUT, "kitchen.cjs"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const T0 = new Date("2026-11-21T20:00:00Z").getTime();
const at = (minutes) => T0 + minutes * 60_000;

const settings = { late_after_minutes: 15, warn_after_minutes: 10 };

function order(overrides = {}) {
  return {
    id: "o1",
    restaurant_id: "r1",
    table_id: "t1",
    table_name: "Mesa 1",
    order_number: 1001,
    status: "pending",
    channel: "dine_in",
    total: 45,
    notes: null,
    created_at: new Date(T0).toISOString(),
    updated_at: new Date(T0).toISOString(),
    preparing_since: null,
    items: [],
    item_count: 1,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Contador                                                               */
/* -------------------------------------------------------------------------- */

check("00:00 com zero segundos", K.formatElapsed(0) === "00:00", K.formatElapsed(0));
check("00:05", K.formatElapsed(5) === "00:05", K.formatElapsed(5));
check("00:12", K.formatElapsed(12) === "00:12", K.formatElapsed(12));
check("00:27", K.formatElapsed(27) === "00:27", K.formatElapsed(27));
check("01:00 em 60s", K.formatElapsed(60) === "01:00", K.formatElapsed(60));
check("09:59 com padding", K.formatElapsed(599) === "09:59", K.formatElapsed(599));
check("10:00", K.formatElapsed(600) === "10:00", K.formatElapsed(600));
check("59:59 no limite", K.formatElapsed(3599) === "59:59", K.formatElapsed(3599));
check(
  "passa de 1h sem estourar a largura",
  K.formatElapsed(3600) === "1h00",
  K.formatElapsed(3600),
);
check("1h05", K.formatElapsed(3900) === "1h05", K.formatElapsed(3900));
check("2h30", K.formatElapsed(9000) === "2h30", K.formatElapsed(9000));
check("negativo vira zero", K.formatElapsed(-30) === "00:00", K.formatElapsed(-30));

check("secondsSince conta certo", K.secondsSince(order(), at(2)) === 120, String(K.secondsSince(order(), at(2))));
check(
  "relógio adiantado não produz negativo",
  K.secondsSince(order(), T0 - 60_000) === 0,
  String(K.secondsSince(order(), T0 - 60_000)),
);
check(
  "data inválida não vira NaN",
  K.secondsSince(order({ created_at: "não é data" }), at(1)) === 0,
);
check("elapsedMinutes arredonda para baixo", K.elapsedMinutes(new Date(T0).toISOString(), at(5) + 59_000) === 5);

/* -------------------------------------------------------------------------- */
/* 2. Tempo de preparo — a diferença entre "não começou" e "0 min"           */
/* -------------------------------------------------------------------------- */

check(
  "pedido não iniciado devolve null (não zero)",
  K.orderPreparationMinutes(order(), at(5)) === null,
  "usar 0 faria o card dizer 'em preparo há 0 min' num pedido que nem começou",
);
check(
  "em preparo há 5 min",
  K.orderPreparationMinutes(order({ preparing_since: new Date(at(-5)).toISOString() }), at(0)) === 5,
);
check(
  "contador de preparo não zera ao tocar no pedido",
  // O `updated_at` muda a cada ação; `preparing_since` não. Este é o bug clássico.
  K.orderPreparationMinutes(
    order({
      preparing_since: new Date(at(-20)).toISOString(),
      updated_at: new Date(at(0)).toISOString(),
    }),
    at(0),
  ) === 20,
  "se usasse updated_at, o contador reiniciaria a cada toque",
);

/* -------------------------------------------------------------------------- */
/* 3. Urgência                                                               */
/* -------------------------------------------------------------------------- */

check("novo é 'ok'", K.orderUrgency(order(), at(0), settings) === "ok");
check("9 min é 'ok'", K.orderUrgency(order(), at(9), settings) === "ok");
check("10 min é 'warn'", K.orderUrgency(order(), at(10), settings) === "warn");
check("14 min ainda 'warn'", K.orderUrgency(order(), at(14), settings) === "warn");
check("15 min é 'late'", K.orderUrgency(order(), at(15), settings) === "late");
check("60 min continua 'late'", K.orderUrgency(order(), at(60), settings) === "late");

check(
  "entregue nunca é atrasado",
  K.orderUrgency(order({ status: "delivered" }), at(120), settings) === "ok",
  "vermelho em pedido entregue treina a equipe a ignorar o alerta",
);
check(
  "cancelado nunca é atrasado",
  K.orderUrgency(order({ status: "cancelled" }), at(120), settings) === "ok",
);

check(
  "pronto ainda pode atrasar (esperando alguém levar)",
  K.orderUrgency(order({ status: "ready" }), at(30), settings) === "late",
  "o pedido esfriando na bancada é problema de cozinha também",
);

check(
  "limite configurável: 5 min",
  K.orderUrgency(order(), at(5), { late_after_minutes: 5, warn_after_minutes: 3 }) === "late",
);
check(
  "limite de 0 warn não existe: 1 min já é warn",
  K.orderUrgency(order(), at(1), { late_after_minutes: 30, warn_after_minutes: 1 }) === "warn",
);

/* -------------------------------------------------------------------------- */
/* 4. Agrupamento em colunas                                                 */
/* -------------------------------------------------------------------------- */

const mixed = [
  order({ id: "a", order_number: 1, status: "pending", created_at: new Date(at(0)).toISOString() }),
  order({ id: "b", order_number: 2, status: "confirmed", created_at: new Date(at(1)).toISOString() }),
  order({ id: "c", order_number: 3, status: "preparing", created_at: new Date(at(2)).toISOString() }),
  order({ id: "d", order_number: 4, status: "ready", created_at: new Date(at(3)).toISOString() }),
  order({ id: "e", order_number: 5, status: "delivered", created_at: new Date(at(4)).toISOString() }),
  order({ id: "f", order_number: 6, status: "cancelled", created_at: new Date(at(5)).toISOString() }),
];

const grouped = K.groupByColumn(mixed);

check("pending e confirmed caem juntos em 'new'", grouped.new.length === 2, `${grouped.new.length}`);
check("preparing tem um", grouped.preparing.length === 1);
check("ready tem um", grouped.ready.length === 1);
check(
  "delivered e cancelled caem em 'done'",
  grouped.done.length === 2,
  `${grouped.done.length}`,
);
check(
  "nenhum pedido se perde",
  grouped.new.length + grouped.preparing.length + grouped.ready.length + grouped.done.length ===
    mixed.length,
);
check(
  "ordem em 'new' é do mais antigo para o mais novo",
  grouped.new.map((o) => o.order_number).join(",") === "1,2",
  grouped.new.map((o) => o.order_number).join(","),
);
check(
  "finalizados em ordem inversa (o que acabou de sair primeiro)",
  grouped.done.map((o) => o.order_number).join(",") === "6,5",
  grouped.done.map((o) => o.order_number).join(","),
);
check("lista vazia não quebra", K.groupByColumn([]).new.length === 0);

/* -------------------------------------------------------------------------- */
/* 5. Ações por status e por papel                                           */
/* -------------------------------------------------------------------------- */

check(
  "pending oferece aceitar e cancelar",
  K.availableActions("pending").join(",") === "accept,cancel",
  K.availableActions("pending").join(","),
);
check(
  "confirmed oferece iniciar preparo",
  K.availableActions("confirmed").join(",") === "start,cancel",
);
check("preparing oferece pronto", K.availableActions("preparing").join(",") === "ready,cancel");
check("ready oferece finalizar", K.availableActions("ready").join(",") === "finish,cancel");
check("delivered não oferece nada", K.availableActions("delivered").length === 0);
check("cancelled não oferece nada", K.availableActions("cancelled").length === 0);

const kitchenRole = { canOperate: true, canFinish: true, canCancel: false };
const waiterRole = { canOperate: false, canFinish: true, canCancel: false };

check(
  "cozinha não vê cancelar",
  !K.permittedActions("preparing", kitchenRole).includes("cancel"),
  K.permittedActions("preparing", kitchenRole).join(","),
);
check(
  "cozinha continua vendo 'pronto'",
  K.permittedActions("preparing", kitchenRole).includes("ready"),
);
check(
  "garçom não vê 'iniciar preparo'",
  !K.permittedActions("confirmed", waiterRole).includes("start"),
  K.permittedActions("confirmed", waiterRole).join(","),
);
check(
  "garçom vê 'finalizar' no pronto",
  K.permittedActions("ready", waiterRole).includes("finish"),
);
check(
  "papel sem nada não recebe botão",
  K.permittedActions("ready", { canOperate: false, canFinish: false, canCancel: false }).length === 0,
);

check("alvo de aceitar é confirmed", K.actionTarget("accept") === "confirmed");
check("alvo de pronto é ready", K.actionTarget("ready") === "ready");
check("alvo de finalizar é delivered", K.actionTarget("finish") === "delivered");
check("alvo de cancelar é cancelled", K.actionTarget("cancel") === "cancelled");

/* -------------------------------------------------------------------------- */
/* 6. Filtros de tempo                                                       */
/* -------------------------------------------------------------------------- */

const recent = order({ id: "r", created_at: new Date(at(-3)).toISOString() });
const old = order({ id: "o", created_at: new Date(at(-40)).toISOString() });
const justLate = order({ id: "l", created_at: new Date(at(-16)).toISOString() });

check(
  "sem filtro, todos aparecem",
  K.applyTimeFilters([recent, old], { nowMs: T0, lateOnly: false, recentOnly: false, settings })
    .length === 2,
);
check(
  "atrasados: só passou do limite",
  K.applyTimeFilters([recent, old, justLate], {
    nowMs: T0,
    lateOnly: true,
    recentOnly: false,
    settings,
  })
    .map((o) => o.id)
    .join(",") === "o,l",
);
check(
  "recentes: só os últimos 15 min",
  K.applyTimeFilters([recent, old, justLate], {
    nowMs: T0,
    lateOnly: false,
    recentOnly: true,
    settings,
  })
    .map((o) => o.id)
    .join(",") === "r",
);
check(
  "os dois ligados é a interseção (vazia aqui)",
  K.applyTimeFilters([recent, old, justLate], {
    nowMs: T0,
    lateOnly: true,
    recentOnly: true,
    settings,
  }).length === 0,
  "atrasado e recente são quase disjuntos por definição",
);
check(
  "pedido entregue não entra em 'atrasados'",
  K.applyTimeFilters([order({ status: "delivered", created_at: new Date(at(-90)).toISOString() })], {
    nowMs: T0,
    lateOnly: true,
    recentOnly: false,
    settings,
  }).length === 0,
);

/* -------------------------------------------------------------------------- */
/* 7. Mesas                                                                  */
/* -------------------------------------------------------------------------- */

const tables = K.uniqueTables([
  order({ table_id: "t1", table_name: "Mesa 10" }),
  order({ table_id: "t2", table_name: "Mesa 2" }),
  order({ table_id: "t1", table_name: "Mesa 10" }),
  order({ table_id: "t3", table_name: "Balcão" }),
]);
check("mesas sem repetição", tables.length === 3, JSON.stringify(tables));
check(
  "ordem natural: Mesa 2 antes de Mesa 10",
  tables.map((t) => t.name).join(",") === "Balcão,Mesa 2,Mesa 10",
  tables.map((t) => t.name).join(","),
);

/* -------------------------------------------------------------------------- */
/* 8. Pedido novo (som e destaque)                                           */
/* -------------------------------------------------------------------------- */

const lista = [
  order({ id: "a", order_number: 1001, status: "pending" }),
  order({ id: "b", order_number: 1002, status: "preparing" }),
];

check(
  "primeira carga não grita 'novo'",
  K.newArrivals(lista, null).length === 0,
  "tocar som ao abrir a tela assusta sem indicar qual pedido",
);
check(
  "número maior que o visto é novo",
  K.newArrivals([...lista, order({ id: "c", order_number: 1003 })], 1002)
    .map((o) => o.order_number)
    .join(",") === "1003",
);
check(
  "número maior mas já em preparo não é 'novo'",
  K.newArrivals([order({ id: "c", order_number: 1003, status: "preparing" })], 1002).length === 0,
);
check(
  "número igual ao visto não é novo",
  K.newArrivals([order({ id: "b", order_number: 1002 })], 1002).length === 0,
);
check("maior número da lista", K.highestOrderNumber(lista) === 1002);
check("lista vazia não tem maior número", K.highestOrderNumber([]) === null);

/* -------------------------------------------------------------------------- */
/* 9. Preferência de som                                                     */
/* -------------------------------------------------------------------------- */

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  },
};

check(
  "chave inclui o restaurante",
  K.soundPreferenceKey("r1") !== K.soundPreferenceKey("r2"),
  "o mesmo tablet pode servir duas casas",
);
check(
  "default é ligado",
  K.readSoundPreference("r1") === true,
  "cozinha silenciosa na primeira abertura é o pior default",
);
K.writeSoundPreference("r1", false);
check("grava e lê desligado", K.readSoundPreference("r1") === false);
K.writeSoundPreference("r1", true);
check("grava e lê ligado", K.readSoundPreference("r1") === true);

// localStorage que lança (modo privado, cota cheia)
globalThis.window.localStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};
check("storage quebrado não derruba a leitura", K.readSoundPreference("r1") === true);
check("storage quebrado não derruba a escrita", (() => {
  K.writeSoundPreference("r1", false);
  return true;
})());

/* -------------------------------------------------------------------------- */
/* 10. Migration 0017 — as garantias que só existem no SQL                   */
/* -------------------------------------------------------------------------- */

const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/0017_kitchen.sql"), "utf8");

check("cria os papéis kitchen e waiter", /add value if not exists 'kitchen'/.test(sql) && /add value if not exists 'waiter'/.test(sql));
check(
  "kitchen NÃO entra em is_restaurant_admin",
  !/kds_can_view[\s\S]{0,400}array\['owner', 'admin', 'manager', 'staff'\]/.test(sql) ||
    !/is_restaurant_admin[\s\S]{0,200}'kitchen'/.test(sql),
  "cozinha que mexe em cardápio não é cozinha",
);
check(
  "waiter fica fora de kds_can_operate",
  /kds_can_operate[\s\S]{0,400}array\['owner', 'admin', 'manager', 'kitchen', 'staff'\]/.test(sql),
  "garçom não decide quando a cozinha começou",
);
check(
  "waiter entra em kds_can_finish",
  /kds_can_finish[\s\S]{0,400}'waiter'/.test(sql),
  "quem leva à mesa é quem registra a entrega",
);
check(
  "kitchen fica fora de kds_can_cancel",
  /kds_can_cancel[\s\S]{0,300}array\['owner', 'admin', 'manager', 'staff'\]/.test(sql),
  "cancelar mexe em dinheiro",
);
check("set_order_status valida papel", /role_forbidden/.test(sql));
check(
  "set_order_status decide pelo status de destino",
  /case p_status\s+when 'cancelled' then public\.kds_can_cancel/.test(sql),
);
check("transição inválida é checada antes do papel", sql.indexOf("invalid_transition") < sql.indexOf("role_forbidden"));
check("revoke de public nas RPCs do KDS", /revoke all on function public\.list_kitchen_orders/.test(sql));
check("sem grant para anon no KDS", !/grant execute on function public\.list_kitchen_orders[^;]*to anon/.test(sql));
check("toda leitura filtra por restaurant_id", /where ko\.restaurant_id = p_restaurant_id/.test(sql));
check("RLS ligada nas tabelas novas", (sql.match(/enable row level security/g) || []).length >= 4);
check(
  "estação liga por categoria, não duplica produto",
  /kitchen_station_categories/.test(sql) && /category_id\s+uuid not null references public\.categories/.test(sql),
);
check(
  "view não duplica pedido: lê de orders",
  /from public\.orders o/.test(sql),
);
check(
  "preparing_since vem do histórico, não de updated_at",
  /to_status = 'preparing'/.test(sql) && !/updated_at as preparing_since/.test(sql),
);
check("order_items entra na publicação realtime", /add table public\.order_items/.test(sql));
check(
  "price_delta aceita negativo (opção que desconta)",
  !/price_delta[^,)]*check \(price_delta >= 0\)/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\nkitchen-lib: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
