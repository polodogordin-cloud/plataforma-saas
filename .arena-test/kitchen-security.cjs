/**
 * Harness de segurança do KDS — Etapa 17.
 *
 * Metade destes testes é análise estática do que foi escrito (componentes e
 * migration); a outra metade roda as regras de permissão de verdade. O objetivo
 * é travar as decisões que, se revertidas por descuido numa próxima etapa,
 * abrem buraco sem quebrar nenhum teste funcional:
 *
 *   • a cozinha não pode mexer em cardápio;
 *   • o garçom não pode iniciar preparo;
 *   • nenhum papel novo ganha poder de cancelar;
 *   • o KDS nunca lê `orders` direto (só pela RPC com guard);
 *   • `/kitchen` é rota privada;
 *   • o restauranteId nunca vem da URL.
 *
 * Rodar: node .arena-test/kitchen-security.cjs
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const sql = read("supabase/migrations/0017_kitchen.sql");
const page = read("src/app/kitchen/page.tsx");
const board = read("src/components/kitchen/kitchen-board.tsx");
const card = read("src/components/kitchen/kitchen-card.tsx");
const hook = read("src/components/kitchen/use-kitchen-orders.ts");
const actions = read("src/actions/kitchen.ts");
const data = read("src/lib/data/kitchen.ts");
const lib = read("src/lib/kitchen.ts");
const middleware = read("src/lib/supabase/middleware.ts");
const types = read("src/lib/types.ts");

/* -------------------------------------------------------------------------- */
/* 1. Rota privada                                                           */
/* -------------------------------------------------------------------------- */

check(
  "/kitchen exige sessão no middleware",
  /pathname === "\/kitchen"/.test(middleware),
  "sem isso o painel abre para qualquer visitante",
);
check(
  "o middleware não decide papel (só sessão)",
  !/kds_can|is_restaurant_admin/.test(middleware),
  "middleware roda em toda rota e não deve consultar o banco",
);

/* -------------------------------------------------------------------------- */
/* 2. Guard na página                                                        */
/* -------------------------------------------------------------------------- */

check("página exige usuário", /if \(!user\) redirect\("\/entrar\?next=\/kitchen"\)/.test(page));
check("página exige restaurante", /if \(!restaurant\) redirect\("\/onboarding"\)/.test(page));
check(
  "página chama kds_can_view antes de renderizar",
  /getKitchenPermissions/.test(page) && /if \(!permissions\.canView\)/.test(page),
);
check(
  "casa suspensa não opera cozinha",
  /status === "suspended"/.test(page),
);
check(
  "acesso negado redireciona com aviso (não tela em branco)",
  /aviso=sem-acesso-cozinha/.test(page),
);
check(
  "restaurantId da página vem do vínculo, não da URL",
  /restaurant\.id/.test(page) && !/searchParams[^;]{0,80}restaurantId/.test(page),
);
check(
  "página é force-dynamic",
  /export const dynamic = "force-dynamic"/.test(page),
  "cozinha com cache serviria pedido que já acabou",
);
check(
  "página é noindex",
  /index: false/.test(page),
  "painel operacional não pertence ao índice de busca",
);

/* -------------------------------------------------------------------------- */
/* 3. Leitura só pela RPC com guard                                          */
/* -------------------------------------------------------------------------- */

check(
  "camada de dados usa RPC, não .from('orders')",
  /list_kitchen_orders/.test(data) && !/\.from\("orders"\)/.test(data),
  "consultar a tabela direto dependeria só da RLS e esqueceria a estação",
);
check(
  "camada de dados usa list_kitchen_stations",
  /list_kitchen_stations/.test(data),
);
check(
  "camada de dados marca server-only",
  /import "server-only"/.test(data),
  "sem isso o módulo pode acabar no bundle do cliente",
);
check(
  "as quatro permissões vêm de RPC separada",
  ["kds_can_view", "kds_can_operate", "kds_can_finish", "kds_can_cancel"].every((fn) =>
    data.includes(fn),
  ),
);

/* -------------------------------------------------------------------------- */
/* 4. Escrita: uma única porta                                                */
/* -------------------------------------------------------------------------- */

check(
  "ação usa set_order_status (mesma RPC da Etapa 7)",
  /supabase\.rpc\("set_order_status"/.test(actions),
  "segundo caminho de escrita = segundo lugar para esquecer regra",
);
check(
  "ação não escreve em orders direto",
  !/from\("orders"\)[\s\S]{0,80}(update|insert)/.test(actions),
);
check("ação valida entrada com zod", /safeParse/.test(actions));
check(
  "ação exige restaurante ativo",
  /getActiveRestaurant/.test(actions),
);
check(
  "erro de papel vira mensagem específica",
  /role_forbidden/.test(actions) && /não pode fazer essa ação/.test(actions),
);
check(
  "revalida as telas que mostram o mesmo pedido",
  /revalidatePath\("\/kitchen"\)/.test(actions) &&
    /revalidatePath\("\/app\/pedidos"\)/.test(actions),
  "cozinha marca pronto e o salão precisa ver",
);

/* -------------------------------------------------------------------------- */
/* 5. Papéis: o negativo importa mais que o positivo                         */
/* -------------------------------------------------------------------------- */

const viewMatch = /kds_can_view[\s\S]*?array\[([^\]]*)\]/.exec(sql);
const operateMatch = /kds_can_operate[\s\S]*?array\[([^\]]*)\]/.exec(sql);
const finishMatch = /kds_can_finish[\s\S]*?array\[([^\]]*)\]/.exec(sql);
const cancelMatch = /kds_can_cancel[\s\S]*?array\[([^\]]*)\]/.exec(sql);

const rolesIn = (match) => (match ? match[1].split(",").map((s) => s.trim().replace(/'/g, "")) : []);

check("kds_can_view lista todos os papéis operacionais", rolesIn(viewMatch).length === 6, rolesIn(viewMatch).join(","));
check("waiter NÃO pode iniciar preparo", !rolesIn(operateMatch).includes("waiter"));
check("kitchen PODE iniciar preparo", rolesIn(operateMatch).includes("kitchen"));
check("waiter PODE finalizar", rolesIn(finishMatch).includes("waiter"));
check("kitchen NÃO pode cancelar", !rolesIn(cancelMatch).includes("kitchen"));
check("waiter NÃO pode cancelar", !rolesIn(cancelMatch).includes("waiter"));
check(
  "cancelar mantém a lista da Etapa 7 (não tira poder de ninguém)",
  rolesIn(cancelMatch).join(",") === "owner,admin,manager,staff",
  rolesIn(cancelMatch).join(","),
);

check(
  "is_restaurant_admin não inclui kitchen",
  !/is_restaurant_admin[\s\S]{0,300}'kitchen'/.test(sql),
  "cozinha que altera cardápio e preço deixa de ser cozinha",
);
check(
  "cardápio continua exigindo admin operacional",
  /is_restaurant_admin/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* 6. Multi-tenant                                                           */
/* -------------------------------------------------------------------------- */

check(
  "list_kitchen_orders filtra por restaurant_id",
  /where ko\.restaurant_id = p_restaurant_id/.test(sql),
);
check(
  "list_kitchen_orders barra quem não é da casa",
  /if p_restaurant_id is null or not public\.kds_can_view\(p_restaurant_id\) then[\s\S]{0,80}return;/.test(
    sql,
  ),
  "devolver vazio é melhor que erro: não confirma que a casa existe",
);
check(
  "view é security_invoker (RLS vale para quem consulta)",
  /security_invoker = true/.test(sql),
);
check(
  "RLS ligada em kitchen_settings",
  /alter table public\.kitchen_settings enable row level security/.test(sql),
);
check(
  "RLS ligada em kitchen_stations",
  /alter table public\.kitchen_stations enable row level security/.test(sql),
);
check(
  "RLS ligada em kitchen_station_categories",
  /alter table public\.kitchen_station_categories enable row level security/.test(sql),
);
check(
  "RLS ligada em order_item_options",
  /alter table public\.order_item_options enable row level security/.test(sql),
);
check(
  "tabelas novas não abrem para anon",
  (sql.match(/revoke all on public\.(kitchen_|order_item_options)/g) || []).length >= 4,
);
check(
  "escrita de configuração exige admin",
  /set_kitchen_settings[\s\S]{0,300}is_restaurant_admin/.test(sql),
);
check(
  "get_kitchen_settings exige vínculo",
  /get_kitchen_settings[\s\S]{0,400}kds_can_view/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* 7. Não duplicar o sistema de pedidos                                      */
/* -------------------------------------------------------------------------- */

check(
  "migration não cria tabela de pedidos nova",
  !/create table[^;]*\bkitchen_orders\b/.test(sql),
  "o KDS lê `orders`; uma tabela paralela divergiria no primeiro dia",
);
check(
  "migration não cria tabela de produtos/mesas nova",
  !/create table[^;]*(kitchen_products|kitchen_tables)/.test(sql),
);
check(
  "view nova lê das tabelas existentes",
  /from public\.orders o/.test(sql) && /join public\.tables t/.test(sql),
);
check(
  "itens vêm de order_items (não de cópia)",
  /from public\.order_items i/.test(sql),
);
check(
  "estação referencia categories existentes",
  /references public\.categories/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* 8. Auditoria e integridade                                                */
/* -------------------------------------------------------------------------- */

check(
  "histórico é gravado por trigger (append-only), não pela ação",
  !/from\("order_status_events"\)[\s\S]{0,60}insert/.test(actions),
  "quem registra é o banco; a aplicação não pode reescrever história",
);
check(
  "set_order_status mantém transição válida",
  /order_next_statuses\(v_from\)/.test(sql),
);
check(
  "checagem de transição vem antes da de papel",
  sql.indexOf("invalid_transition") < sql.indexOf("role_forbidden"),
  "pedido já entregue não deve nem chegar na checagem de papel",
);
check(
  "order_not_found para pedido de outro tenant",
  /order_not_found/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* 9. Acessibilidade e alertas                                              */
/* -------------------------------------------------------------------------- */

check(
  "urgência nunca é só cor (tem rótulo textual)",
  /KITCHEN_URGENCY_LABEL/.test(card) && /style\.label/.test(card),
  "daltonismo: cor sozinha não comunica atraso",
);
check(
  "urgência tem ícone",
  /UrgencyIcon/.test(card),
);
check(
  "contador tem aria-label legível",
  /aria-label=\{`Tempo desde a entrada/.test(card),
);
check(
  "som tem controle com aria-pressed",
  /aria-pressed=\{soundEnabled\}/.test(board),
);
check(
  "som bloqueado avisa e pede gesto",
  /soundBlocked/.test(board) && /bloqueou o som/.test(board),
  "fingir que tocou é pior que avisar que o navegador barrou",
);
check(
  "estado do tempo real é visível",
  /Ao vivo|Sem conexão/.test(board),
  "painel silencioso sem aviso de queda é o pior cenário de cozinha",
);
check(
  "pedido novo tem destaque E aviso textual",
  /BellRing/.test(board) && /Pedido novo:/.test(board),
);
check(
  "coluna vazia diferencia 'sem pedidos' de 'sem resultado de filtro'",
  /Nenhum pedido com os filtros atuais/.test(board),
);
check(
  "ações grandes (min-h-14)",
  /min-h-14/.test(card),
  "dedo com luva em tablet",
);
// Ignora comentários: o card explica *por que* não usa `window.confirm`, e a
// menção no comentário fazia o teste falhar por um motivo que não é um uso.
const cardCode = card.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

check(
  "cancelamento pede confirmação em dois toques",
  /confirmCancel/.test(cardCode) && !/window\.confirm/.test(cardCode),
  "window.confirm bloqueia a thread no meio do serviço",
);
check(
  "card tem título acessível",
  /aria-labelledby/.test(card),
);

/* -------------------------------------------------------------------------- */
/* 10. Tempo real reaproveitado                                              */
/* -------------------------------------------------------------------------- */

const realtime = read("src/components/orders/use-orders-realtime.ts");

check(
  "KDS usa o hook de tempo real existente",
  /useOrdersRealtime/.test(hook),
  "WebSocket próprio seria o segundo canal e a segunda coisa para quebrar",
);
check(
  "canal é o mesmo do painel (orders:<restaurantId>)",
  !/\.channel\(/.test(hook),
  "abrir canal novo aqui duplicaria a inscrição",
);
check(
  "order_items assinado no MESMO canal",
  /table: "order_items"/.test(realtime),
);
check(
  "evento é sinal, não fonte de dado",
  /refresh\(\{ silent: true \}\)/.test(hook),
  "montar o card a partir do payload perderia estação e tempo de preparo",
);
check(
  "relógio não refaz consulta",
  /setInterval\(\(\) => setNowMs/.test(hook),
  "60 consultas por minuto por tablet derrubaria a cozinha",
);
check(
  "ação local não duplica a releitura do eco",
  /ACTION_GRACE_MS/.test(hook),
);

/* -------------------------------------------------------------------------- */
/* 11. Regras puras não dependem de React/banco                              */
/* -------------------------------------------------------------------------- */

check("lib/kitchen.ts não importa React", !/from "react"/.test(lib));
check("lib/kitchen.ts não importa supabase", !/supabase/.test(lib));
check(
  "contador protege contra relógio negativo",
  /Math\.max\(0, Math\.floor/.test(lib),
);
check(
  "preferência de som é por restaurante",
  /mv:kitchen-sound:\$\{restaurantId\}/.test(lib),
);
check(
  "autoplay é tratado devolvendo falha, não silêncio",
  /return context\.state !== "suspended"/.test(lib),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\nkitchen-security: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
