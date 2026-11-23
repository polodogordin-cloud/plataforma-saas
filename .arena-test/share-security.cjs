/**
 * Harness de segurança e SEO da divulgação — Etapa 23 (parte 2).
 *
 * A parte 1 (`share-lib.cjs`) cobre o texto e a arte. Aqui o alvo é o que não
 * aparece no preview do WhatsApp e, se errar, vaza dado ou quebra o link:
 *
 *   1. a migration: coluna, check de tamanho, guarda de dono, `anon` sem acesso;
 *   2. as actions: `restaurant_id` nunca vem do cliente, só a chamada é gravável;
 *   3. a tela `/app/divulgar`: link montado no servidor, 404 para tenant alheio;
 *   4. a rota do QR geral: slug vem do banco, não da query string;
 *   5. os metadados públicos: título, descrição, OG, imagem e canonical;
 *   6. honestidade: nenhuma publicação automática, nada de contador inventado.
 *
 * Rodar: node .arena-test/share-security.cjs
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
};

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const migration = read("supabase/migrations/0024_share_menu.sql");
const actions = read("src/actions/share.ts");
const dataLayer = read("src/lib/data/share.ts");
const page = read("src/app/app/divulgar/page.tsx");
const qrRoute = read("src/app/app/divulgar/qr/route.ts");
const ogRoute = read("src/app/r/[slug]/opengraph-image.tsx");
const publicMenu = read("src/app/r/[slug]/page.tsx");
const hub = read("src/components/share/share-hub.tsx");
const dashboard = read("src/app/app/page.tsx");

/* ========================================================================== */
/* 1. Migration                                                              */
/* ========================================================================== */

check("migration: existe", migration.length > 1000);
check(
  "migration: cria share_headline idempotente",
  /add column if not exists share_headline text/i.test(migration),
);
check(
  "migration: check de 160 caracteres",
  /restaurants_share_headline_length/.test(migration) && /char_length\(share_headline\) <= 160/.test(migration),
);
check(
  "migration: gravação exige is_restaurant_owner",
  /save_share_headline[\s\S]{0,800}?is_restaurant_owner/.test(migration),
);
check("migration: erro de permissão é 42501", /share_forbidden[\s\S]{0,80}42501/.test(migration));
check("migration: erro de tamanho é 22023", /share_headline_too_long[\s\S]{0,80}22023/.test(migration));
check(
  "migration: leitura devolve null para tenant alheio",
  /share_overview[\s\S]{0,600}?return null/.test(migration),
);
check("migration: leitura é stable", /share_overview[\s\S]{0,300}?stable/i.test(migration));
check(
  "migration: anon sem execute na gravação",
  /revoke all on function public\.save_share_headline\(uuid, text\) from public, anon/i.test(migration),
);
check(
  "migration: anon sem execute na leitura",
  /revoke all on function public\.share_overview\(uuid\) from public, anon/i.test(migration),
);
check(
  "migration: normaliza espaços no banco",
  /regexp_replace\(coalesce\(p_headline/.test(migration),
);
check(
  "migration: registra a versão",
  /20261123100000/.test(migration) && /stage23_share/.test(migration),
);
check(
  "migration: não cria tabela de rede social conectada",
  !/create table[^;]*social/i.test(migration),
);
check(
  "migration: não guarda contador de compartilhamento",
  !/share_count|shares_?count|clicks/i.test(migration),
);
check("migration: sem service_role", !/service_role/i.test(migration));

/* ========================================================================== */
/* 2. Actions                                                                */
/* ========================================================================== */

check("actions: usa 'use server'", /^"use server";/m.test(actions));
check("actions: resolve o restaurante pela sessão", /getActiveRestaurant\(\)/.test(actions));
check(
  "actions: envia o id do servidor para a RPC",
  /p_restaurant_id:\s*restaurant\.id/.test(actions),
);
check(
  "actions: não aceita restaurantId do cliente",
  !/saveShareHeadline\(\s*[^)]*restaurantId/.test(actions),
);
check("actions: exige dono/admin", /role !== "owner" && restaurant\.role !== "admin"/.test(actions));
check("actions: limpa a chamada antes de gravar", /sanitizeHeadline\(/.test(actions));
check("actions: trata forbidden", /share_forbidden/.test(actions));
check("actions: revalida a página pública", /revalidatePath\(`\/r\/\$\{restaurant\.slug\}`\)/.test(actions));
check("actions: espelha em settings para a prévia do link", /settings\.share_headline = headline/.test(actions));
check("actions: não sobrescreve as outras preferências de settings", /\.\.\.\(current\.settings/.test(actions));
// Comentário pode citar `service_role` para explicar que não é usada; o que não
// pode existir é a chave (ou o import do cliente administrativo).
check(
  "actions: sem cliente administrativo",
  !/createAdminClient|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/i.test(actions),
);

/* ========================================================================== */
/* 3. Camada de dados                                                        */
/* ========================================================================== */

check("dados: usa a RPC", /rpc\("share_overview"/.test(dataLayer));
check("dados: devolve null quando a RPC falha", /if \(error \|\| !data\) return null/.test(dataLayer));
check("dados: não faz select direto em orders", !/from\("orders"\)/.test(dataLayer));
check("dados: sem service_role", !/service_role/i.test(dataLayer));
check("dados: normaliza camelCase para a UI", /publicToken: table\.public_token/.test(dataLayer));

/* ========================================================================== */
/* 4. Tela de divulgação                                                     */
/* ========================================================================== */

check("página: exige sessão", /getActiveRestaurant\(\)/.test(page));
check("página: 404 quando o snapshot é nulo", /notFound\(\)/.test(page));
check("página: origem no servidor", /requireRequestOrigin\(\)/.test(page));
check("página: título em português", /title: "Divulgar meu cardápio"/.test(page));
check("dashboard: tem o atalho 'Divulgar meu cardápio'", /Divulgar meu cardápio/.test(dashboard) && /href="\/app\/divulgar"/.test(dashboard));

/* ========================================================================== */
/* 5. QR geral                                                               */
/* ========================================================================== */

check("qr: rota existe", qrRoute.length > 400);
check("qr: exige sessão", /getActiveRestaurant\(\)/.test(qrRoute));
check("qr: usa o slug do banco", /snapshot\.slug/.test(qrRoute));
check(
  "qr: não aceita slug nem url da query string",
  !/searchParams\.get\("slug"\)/.test(qrRoute) && !/searchParams\.get\("url"\)/.test(qrRoute),
);
check("qr: aponta para /r/{slug} e não para a mesa", /menuPath\(snapshot\.slug\)/.test(qrRoute) && !/tablePath/.test(qrRoute));
check("qr: entrega SVG e PNG", /qrToSvg/.test(qrRoute) && /qrToPng/.test(qrRoute));
check("qr: download como attachment", /Content-Disposition": `attachment/.test(qrRoute));
check("qr: 401 sem sessão", /status: 401/.test(qrRoute));
check("qr: sem service_role", !/service_role/i.test(qrRoute));

/* ========================================================================== */
/* 6. Metadados públicos (SEO / Open Graph)                                  */
/* ========================================================================== */

check("og: imagem gerada em /r/[slug]/opengraph-image", ogRoute.length > 500);
check(
  "og: 1200×630 (vem das constantes do modelo)",
  /SHARE_CARD_WIDTH/.test(ogRoute) && /SHARE_CARD_HEIGHT/.test(ogRoute) && /export const size/.test(ogRoute),
);
check("og: contentType png", /contentType = "image\/png"/.test(ogRoute));
check("og: 404 para cardápio inexistente", /notFound\(\)/.test(ogRoute));
// `headers()` só pode aparecer em comentário — chamada de verdade tornaria a
// rota dinâmica e mataria o ISR do cardápio.
check(
  "og: não chama headers() (mantém ISR)",
  !/await headers\(|headers\(\)\.get/.test(ogRoute) && !/from "next\/headers"/.test(ogRoute),
);
check("og: cache público", /Cache-Control": `public/.test(ogRoute));
check("og: logo com limite de tamanho", /300 \* 1024/.test(ogRoute));
check("og: valida tipo da logo", /image\/png/.test(ogRoute) && /image\/jpeg/.test(ogRoute));
check("og: sem service_role", !/service_role/i.test(ogRoute));

check("cardápio: title com nome do restaurante", /const title = `\$\{restaurant\.name\} · Cardápio`/.test(publicMenu));
check("cardápio: description montada", /buildDescription\(restaurant\)/.test(publicMenu));
check("cardápio: canonical", /alternates: \{ canonical: path \}/.test(publicMenu));
check("cardápio: og:type website", /type: "website"/.test(publicMenu));
check("cardápio: og:locale pt_BR", /locale: "pt_BR"/.test(publicMenu));
check("cardápio: og:url", /url: path/.test(publicMenu));
check("cardápio: og:image aponta para a arte gerada", /opengraph-image/.test(publicMenu));
check("cardápio: og:image declara dimensões", /width: 1200[\s\S]{0,40}height: 630/.test(publicMenu));
check("cardápio: twitter card grande", /card: "summary_large_image"/.test(publicMenu));
check("cardápio: usa a chamada editada na descrição", /readShareHeadline\(restaurant\.settings\)/.test(publicMenu));
check("cardápio: chamada inválida é ignorada", /typeof value !== "string"/.test(publicMenu));
check("cardápio: não expõe telefone nem plano no meta", !/customer_phone|subscription_status/.test(publicMenu.slice(0, 6000)));
check("cardápio: ISR preservado (generateStaticParams)", /generateStaticParams/.test(publicMenu));

/* Mesa: link compartilhável também precisa de prévia (Etapa 23). */
const tableMenu = read("src/app/r/[slug]/table/[token]/page.tsx");
check("mesa: gera metadados", /export async function generateMetadata/.test(tableMenu));
check("mesa: tem openGraph", /openGraph:/.test(tableMenu));
check("mesa: locale pt_BR", /locale: "pt_BR"/.test(tableMenu));
check("mesa: continua noindex", /robots: \{ index: false, follow: false \}/.test(tableMenu));
check("mesa: título com o nome do restaurante", /title: `\$\{restaurant\.name\} · Cardápio`/.test(tableMenu));
check("mesa: não duplica og:image (herda do segmento pai)", !/opengraph-image\?/.test(tableMenu));

/* ========================================================================== */
/* 7. Interface: o que ela promete                                           */
/* ========================================================================== */

check("UI: usa Web Share quando existe", /navigator\.share\(/.test(hub));
check("UI: detecta suporte no cliente", /supportsNativeShare\(navigator\)/.test(hub));
check("UI: cancelar não vira erro", /readShareOutcome\(shareError\) === "cancelled"/.test(hub));
check("UI: cai no copiar quando o share falha", /await copy\(message, "menu"\)/.test(hub));
check("UI: copia o link", /copy\(menuUrl, "menu"\)/.test(hub));
check("UI: botão Visualizar", /label="Visualizar"/.test(hub));
check("UI: botão WhatsApp", /openChannel\("whatsapp"\)/.test(hub));
check("UI: mensagem é a mesma função do servidor", /composeShareMessage\(/.test(hub));
check("UI: permite editar a chamada", /saveShareHeadline\(\{ headline \}\)/.test(hub));
check("UI: contador de caracteres", /MAX_HEADLINE_LENGTH/.test(hub));
check("UI: Instagram e TikTok avisados como copiar-e-colar", /Copiar e colar/.test(hub));
check("UI: explica que não publica sozinho", /não permitem publicar direto do navegador|Nada aqui publica sozinho/.test(hub));
check("UI: links geral, mesa e pedido", /"Geral"|label: "Geral"/.test(hub) && /label: "Mesa"/.test(hub) && /label: "Pedido"/.test(hub));
check("UI: link do pedido usa orderPath", /orderPath\(/.test(hub));
check("UI: link da mesa usa tablePath", /tablePath\(/.test(hub));
check("UI: QR geral na tela", /\/app\/divulgar\/qr"/.test(hub));
check("UI: baixar SVG e PNG", /downloadQr\("svg"\)/.test(hub) && /downloadQr\("png"\)/.test(hub));
check("UI: não usa window.location.origin para o link", !/window\.location\.origin/.test(hub));
check("UI: avisa quando o cardápio está desativado", /publicar o restaurante/.test(hub));
check("UI: sem service_role", !/service_role/i.test(hub));

/* ========================================================================== */
/* 8. Nada de publicação automática                                          */
/* ========================================================================== */

const newFiles = [
  "src/lib/share.ts",
  "src/lib/share-card.ts",
  "src/lib/data/share.ts",
  "src/actions/share.ts",
  "src/app/app/divulgar/page.tsx",
  "src/app/app/divulgar/qr/route.ts",
  "src/app/r/[slug]/opengraph-image.tsx",
  "src/components/share/share-hub.tsx",
];
const publishing = newFiles.filter((file) =>
  /api\.instagram\.com|graph\.facebook\.com|open\.tiktokapis\.com|api\.twitter\.com/i.test(read(file)),
);
check("sem chamada a API de rede social", publishing.length === 0, publishing.join(", "));

const secrets = newFiles.filter((file) =>
  /createAdminClient|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/i.test(read(file)),
);
check("sem chave de serviço nos arquivos novos", secrets.length === 0, secrets.join(", "));

check(
  "texto: nunca afirma publicar automaticamente",
  !/publicar automaticamente|postar automaticamente/i.test(hub + read("src/lib/share.ts")),
);

/* ========================================================================== */
/* Resultado                                                                 */
/* ========================================================================== */

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (share-security.cjs)`);
process.exit(failed.length ? 1 : 0);
