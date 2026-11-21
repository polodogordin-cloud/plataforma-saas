/**
 * Harness de segurança da impressão — Etapa 18.
 *
 * Metade é análise estática (migration, actions, páginas); a outra metade são
 * asserções sobre as decisões que, se revertidas por descuido, abrem buraco sem
 * quebrar nenhum teste funcional:
 *
 *   • `restaurantId` nunca vem do navegador;
 *   • a rota de impressão não vira janela para pedido de outra casa;
 *   • `kitchen` pode imprimir mas não configurar;
 *   • nenhuma tabela nova duplica pedidos;
 *   • a tela não promete impressão que o navegador não faz.
 *
 * Rodar: node .arena-test/print-security.cjs
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const sql = read("supabase/migrations/0018_printing.sql");
const actions = read("src/actions/printing.ts");
const data = read("src/lib/data/printing.ts");
const lib = read("src/lib/printing.ts");
const provider = read("src/lib/print-provider.ts");
const previewPage = read("src/app/app/pedidos/[id]/imprimir/page.tsx");
const settingsPage = read("src/app/app/configuracoes/impressao/page.tsx");
const form = read("src/components/printing/print-config-form.tsx");
const previewScreen = read("src/components/printing/print-preview-screen.tsx");
const panel = read("src/components/orders/orders-panel.tsx");
const detail = read("src/components/orders/order-detail-sheet.tsx");
const kitchenCard = read("src/components/kitchen/kitchen-card.tsx");
const globals = read("src/app/globals.css");
const types = read("src/lib/types.ts");

/* -------------------------------------------------------------------------- */
/* 1. Multi-tenant                                                            */
/* -------------------------------------------------------------------------- */

check(
  "nenhuma action aceita restaurantId",
  !/input\s*\.\s*restaurantId|restaurantId\s*:\s*z\./.test(actions),
  "o restaurante vem de getActiveRestaurant, nunca do corpo da requisição",
);
check(
  "actions usam getActiveRestaurant",
  /getActiveRestaurant/.test(actions),
);
check(
  "todas as tabelas novas têm restaurant_id",
  ["print_settings", "print_profiles", "printers", "print_jobs"].every((table) =>
    new RegExp(`create table if not exists public\\.${table}[\\s\\S]*?restaurant_id uuid not null`).test(sql) ||
    new RegExp(`create table if not exists public\\.${table}[\\s\\S]*?restaurant_id\\s+uuid primary key`).test(sql),
  ),
);
check(
  "todas as tabelas novas referenciam restaurants",
  (sql.match(/references public\.restaurants \(id\) on delete cascade/g) ?? []).length >= 4,
);
check(
  "RLS ligado em todas as tabelas novas",
  (sql.match(/alter table public\.(print_settings|print_profiles|printers|print_jobs) enable row level security/g) ?? [])
    .length === 4,
);
check(
  "anon não lê nenhuma tabela de impressão",
  (sql.match(/revoke all on public\.(print_settings|print_profiles|printers|print_jobs) from anon/g) ?? []).length === 4,
);
check(
  "página confere o tenant do documento",
  /document\.restaurant\.id !== restaurant\.id/.test(previewPage),
  "sem isso, URL digitada à mão abriria cupom de outra casa",
);
check(
  "página devolve 404 para outro tenant",
  /notFound\(\)/.test(previewPage),
);
check(
  "fetchPrintOrder confere o restaurante",
  /document\.restaurant\.id !== restaurant\.id/.test(actions),
);
check(
  "log_print_job não aceita restaurante arbitrário",
  !/p_restaurant_id/.test(sql.split("create or replace function public.log_print_job")[1] ?? ""),
  "o restaurante sai do pedido, não de um parâmetro",
);
check(
  "impressora só aceita perfil da mesma casa",
  /if p_profile_id is not null and not exists[\s\S]*?pp\.restaurant_id = p_restaurant_id/.test(sql),
);
check(
  "log filtra perfil e impressora pelo tenant",
  /where pp\.id = p_profile_id and pp\.restaurant_id = v_restaurant/.test(sql) &&
    /where pr\.id = p_printer_id and pr\.restaurant_id = v_restaurant/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* 2. Autorização                                                             */
/* -------------------------------------------------------------------------- */

check(
  "configurar exige admin operacional",
  /print_can_configure[\s\S]*?is_restaurant_admin/.test(sql),
);
check(
  "salvar configuração checa permissão",
  /save_print_settings[\s\S]*?if not public\.print_can_configure/.test(sql),
);
check(
  "salvar perfil checa permissão",
  /save_print_profile[\s\S]*?if not public\.print_can_configure/.test(sql),
);
check(
  "salvar impressora checa permissão",
  /save_printer[\s\S]*?if not public\.print_can_configure/.test(sql),
);
check(
  "apagar perfil checa permissão",
  /delete_print_profile[\s\S]*?if not public\.print_can_configure/.test(sql),
);
check(
  "apagar impressora checa permissão",
  /delete_printer[\s\S]*?if not public\.print_can_configure/.test(sql),
);
check(
  "seed checa permissão",
  /seed_default_print_profiles[\s\S]*?if not public\.print_can_configure/.test(sql),
);
check(
  "leitura do pedido checa print_can_view",
  /get_print_order[\s\S]*?public\.print_can_view\(o\.restaurant_id\)/.test(sql),
);
check(
  "leitura da config checa print_can_view",
  /get_print_config[\s\S]*?not public\.print_can_view/.test(sql),
);
check(
  "kitchen aparece em print_can_view",
  /print_can_view[\s\S]*?'kitchen'/.test(sql),
  "quem cozinha é quem mais precisa do papel na bancada",
);
/*
 * Recorte do corpo da função, não do arquivo: procurar no arquivo inteiro pega
 * o `print_can_view` logo abaixo (que tem 'kitchen' de propósito) e reprova o
 * teste por engano.
 */
const configureBody = (sql.split("create or replace function public.print_can_configure")[1] ?? "").split("$$;")[0] ?? "";
check(
  "kitchen NÃO aparece em print_can_configure",
  configureBody.length > 0 && !/'kitchen'/.test(configureBody),
  configureBody.includes("kitchen") ? "corpo contém 'kitchen'" : "",
);
check(
  "policies de escrita usam print_can_configure",
  (sql.match(/using \(public\.print_can_configure\(restaurant_id\)\)/g) ?? []).length >= 3,
);
check(
  "policies de leitura usam print_can_view",
  (sql.match(/using \(public\.print_can_view\(restaurant_id\)\)/g) ?? []).length >= 4,
);
check(
  "print_jobs não tem policy de insert",
  !/create policy[^;]*print_jobs[^;]*for insert/i.test(sql),
);
check(
  "funções revogadas de public",
  (sql.match(/revoke all on function public\.(get_print_config|save_print_settings|save_print_profile|delete_print_profile|save_printer|delete_printer|get_print_order|log_print_job|seed_default_print_profiles)/g) ?? [])
    .length === 9,
  "grant herdado de public é o furo clássico",
);
check(
  "RPCs concedidas só a authenticated",
  !/grant execute on function public\.(get_print_config|save_printer)[^;]*to (anon|public)/.test(sql),
);

/* -------------------------------------------------------------------------- */
/* 3. Sem duplicação do sistema de pedidos                                    */
/* -------------------------------------------------------------------------- */

check(
  "nenhuma tabela de impressão guarda itens de pedido",
  !/create table[^;]*print[^;]*\bproduct_name_snapshot\b/.test(sql),
);
check(
  "documento do pedido vem de orders/order_items",
  /get_print_order[\s\S]*?from public\.order_items i/.test(sql),
);
check(
  "pagamentos vêm do livro da Etapa 16",
  /get_print_order[\s\S]*?from public\.order_payments/.test(sql),
);
check(
  "adicionais vêm de order_item_options (Etapa 17)",
  /get_print_order[\s\S]*?from public\.order_item_options oio/.test(sql),
);
check(
  "data layer não consulta orders direto",
  !/\.from\("orders"\)/.test(data),
);
check(
  "data layer usa RPC",
  /rpc\("get_print_config"/.test(data) && /rpc\("get_print_order"/.test(data),
);

/* -------------------------------------------------------------------------- */
/* 4. Honestidade da interface                                                */
/* -------------------------------------------------------------------------- */

check(
  "a tela avisa que o navegador não confirma a impressão",
  /navegador não (confirma|sabe)/i.test(form) || /não conversa com a impressora/i.test(previewScreen),
);
check(
  "a tela avisa que a térmica é escolhida na janela do sistema",
  /escolha a impressora térmica nessa janela/i.test(form) ||
    /Escolha a impressora térmica/i.test(previewScreen),
);
check(
  "modo automático avisa do bloqueio do navegador",
  /pode bloquear/i.test(form) || /bloqueou a janela de impressão/i.test(panel),
);
check(
  "provedores futuros aparecem marcados como não disponíveis",
  /PRINT_PROVIDER_SUPPORT\[provider\] === "planned"/.test(form),
);
check(
  "provedor indisponível devolve unsupported e não imprime",
  /class UnavailablePrintProvider[\s\S]*?status: "unsupported"/.test(provider),
);
check(
  "navegador devolve requested, nunca printed",
  /status: resolveJobStatus\("browser"\)/.test(provider),
);
check(
  "nada devolve confirmed: true",
  !/confirmed:\s*true/.test(provider),
);
check(
  "status 'printed' descrito como confirmação do provedor",
  /printed: "Confirmada pelo provedor"/.test(types),
);
check(
  "o log registra a solicitação, não a confirmação",
  /print_jobs is[\s\S]*?Solicitações de impressão/.test(sql),
);
check(
  "impressão automática não é chamada no servidor",
  !/window\.print/.test(panel) && /window\.open/.test(panel),
  "popup silencioso seria bloqueado e imprimiria na impressora errada",
);
check(
  "tela de impressão recusa imprimir sozinha em ?auto=1",
  !/window\.print\(\)/.test(previewPage),
);

/* -------------------------------------------------------------------------- */
/* 5. Fluxo de pedidos preservado                                             */
/* -------------------------------------------------------------------------- */

check(
  "impressão no detalhe do pedido",
  /imprimir/.test(detail) && /Imprimir pedido/.test(detail),
);
check(
  "imprimir disponível também no KDS",
  /imprimir/.test(kitchenCard),
);
check(
  "botão de imprimir abre em guia nova",
  /target="_blank"/.test(detail) && /noopener noreferrer/.test(detail),
);
check(
  "nenhuma chamada de status foi alterada no painel",
  /setOrderStatus/.test(panel) && !/set_order_status/.test(panel),
);
check(
  "painel continua recebendo autoPrint por padrão desligado",
  /autoPrint = false/.test(panel),
);
check(
  "autoPrint só dispara no aceite",
  /autoPrint && result\.status === "confirmed"/.test(panel),
);
check(
  "configuração de impressão é lida no painel",
  /getPrintConfig/.test(read("src/app/app/pedidos/page.tsx")),
);
check(
  "falha de log não bloqueia a impressão",
  /void logPrintJob/.test(previewScreen),
);

/* -------------------------------------------------------------------------- */
/* 6. Impressão de verdade (CSS e rota)                                       */
/* -------------------------------------------------------------------------- */

check(
  "existe raiz de impressão térmica dedicada",
  /\.thermal-sheet/.test(globals) && /\.thermal-ticket/.test(globals),
);
check(
  "papel térmico não centraliza como o cartão de QR",
  /body:has\(\.thermal-sheet\)/.test(globals),
  "o @page fixo de A4 estragaria o cupom",
);
check(
  "largura impressa é a área útil (48/72mm), não a bobina",
  /width: 48mm/.test(globals) && /width: 72mm/.test(globals),
);
check(
  "controles marcados como no-print",
  /\.no-print/.test(globals) && /className="no-print/.test(previewScreen),
);
check(
  "@page é ajustado à largura escolhida",
  /@page \{ size: \$\{width === "58" \? "58mm" : "80mm"\} auto/.test(provider) ||
    /size: \$\{width === "58"/.test(read("src/components/printing/print-preview.tsx")),
);
check(
  "fonte do cupom é monoespaçada",
  /font-family: ui-monospace/.test(globals),
);
check(
  "rota de impressão é dinâmica e não indexada",
  /dynamic = "force-dynamic"/.test(previewPage) && /index: false/.test(previewPage),
);
check(
  "página de configuração valida o papel",
  /ROLE_CAPABILITIES/.test(settingsPage),
);
check(
  "tela de impressão mostra prévia",
  /OrderTicket/.test(previewScreen),
);
check(
  "tela de teste existe na configuração",
  /Imprimir teste/.test(read("src/components/printing/print-test-panel.tsx")),
);

/* -------------------------------------------------------------------------- */
/* 7. Mobile                                                                  */
/* -------------------------------------------------------------------------- */

check(
  "configuração usa seções expansíveis",
  /<details/.test(read("src/components/printing/print-settings-section.tsx")) &&
    /CollapsibleSection/.test(form),
);
check(
  "alvos de toque com no mínimo 44px",
  /min-h-11/.test(form) && /min-h-12/.test(form),
);
check(
  "nenhuma tabela horizontal na configuração",
  !/<table/.test(form),
);
check(
  "barra de ação fixa com safe-area no celular",
  /env\(safe-area-inset-bottom\)/.test(previewScreen),
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log(`\nprint-security: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
