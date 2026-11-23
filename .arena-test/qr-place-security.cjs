/**
 * Harness de segurança do gerador de plaquinhas — Etapa 22 (parte 2).
 *
 * A parte 1 (`qr-place-lib.cjs`) cobre as regras de legibilidade. Aqui o alvo é
 * o que não aparece na tela e, se errar, vaza dado entre restaurantes:
 *
 *   1. a RPC confere o dono e não deixa `anon` executar;
 *   2. nenhuma Server Action aceita `restaurant_id` do cliente;
 *   3. a rota de arquivo resolve o tenant pela sessão e responde 404 para mesa
 *      alheia;
 *   4. a URL do QR é montada no servidor — nunca com o que o navegador manda;
 *   5. nenhuma promessa de gravação de TAG NFC pelo navegador;
 *   6. sem `service_role` em lugar nenhum.
 *
 * São checagens de fonte (leitura do arquivo), não de execução: o
 * comportamento em si foi verificado no banco real, com `set local role
 * authenticated` e o `sub` de um dono — outros 5 cenários negados.
 *
 * Rodar: node .arena-test/qr-place-security.cjs
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

const migration = read("supabase/migrations/0023_qr_place_settings.sql");
const actions = read("src/actions/qr-places.ts");
const dataLayer = read("src/lib/data/qr-place.ts");
const route = read("src/app/app/mesas/[id]/qr/place/route.ts");
const page = read("src/app/app/mesas/qrcodes/page.tsx");
const manager = read("src/components/tables/qr-codes-manager.tsx");
const editor = read("src/components/tables/place-editor.tsx");
const card = read("src/lib/place-card.ts");

/* ========================================================================== */
/* 1. Migration                                                              */
/* ========================================================================== */

check("migration: arquivo existe", migration.length > 0);
check("migration: cria a coluna qr_place_style", /add column if not exists qr_place_style jsonb/i.test(migration));
check(
  "migration: coluna tem check de forma (objeto ou null)",
  /qr_place_style_shape/.test(migration) && /jsonb_typeof\(qr_place_style\) = 'object'/.test(migration),
);
check("migration: RPC de leitura é stable", /qr_place_overview[\s\S]{0,400}?stable/i.test(migration));
check(
  "migration: leitura confere is_restaurant_owner",
  /qr_place_overview[\s\S]{0,900}?is_restaurant_owner/.test(migration),
);
check(
  "migration: gravação confere is_restaurant_owner",
  /save_qr_place_style[\s\S]{0,900}?is_restaurant_owner/.test(migration),
);
check("migration: recusa payload não-objeto", /invalid_qr_style/.test(migration) && /22023/.test(migration));
check("migration: limita o tamanho do jsonb", /4096|qr_style_too_large/.test(migration));
check(
  "migration: revoga execução de anon e public",
  /revoke all on function public\.save_qr_place_style\(uuid, jsonb\) from public, anon/i.test(migration),
);
check(
  "migration: revoga leitura de anon",
  /revoke all on function public\.qr_place_overview\(uuid\) from public, anon/i.test(migration),
);
check(
  "migration: concede execução a authenticated",
  /grant execute on function public\.save_qr_place_style\(uuid, jsonb\) to authenticated/i.test(migration),
);
check(
  "migration: registra a versão em schema_migrations",
  /20261122160000/.test(migration) && /stage22_qr_places/.test(migration),
);
check(
  "migration: não usa security invoker em RPC que lê outra tabela",
  !/security invoker/i.test(migration),
);
check("migration: não toca em dados de mesas", !/update public\.tables/i.test(migration));

/* ========================================================================== */
/* 2. Server Actions                                                         */
/* ========================================================================== */

check("actions: usa 'use server'", /^"use server";/m.test(actions));
check(
  "actions: resolve o restaurante pela sessão",
  /getActiveRestaurant\(\)/.test(actions),
);
check(
  "actions: NÃO aceita restaurant_id como parâmetro de entrada",
  !/savePlaceStyle\(\s*[^)]*restaurantId/.test(actions) && !/p_restaurant_id:\s*(input|parsed|data)\./.test(actions),
);
check(
  "actions: envia o id vindo do servidor para a RPC",
  /p_restaurant_id:\s*guard\.restaurant\.id/.test(actions),
);
check(
  "actions: valida o estilo antes de gravar",
  /validatePlaceStyle\(style\)/.test(actions),
);
check(
  "actions: normaliza antes de gravar",
  /normalizePlaceStyle\(/.test(actions),
);
check(
  "actions: exige papel owner/admin",
  /role !== "owner" && restaurant\.role !== "admin"/.test(actions),
);
check(
  "actions: regenerar confere se a mesa é do restaurante",
  /snapshot\.tables\.find/.test(actions),
);
check(
  "actions: não grava a URL do QR no banco",
  !/save_qr_place_style[\s\S]{0,300}url/i.test(actions) || !/p_style:[^}]*url/i.test(actions),
);
check(
  "actions: trata forbidden do banco",
  /qr_style_forbidden/.test(actions),
);
check("actions: sem service_role", !/service_role|SERVICE_ROLE/.test(actions));

/* ========================================================================== */
/* 3. Camada de dados                                                        */
/* ========================================================================== */

check("dados: usa a RPC, não consulta direta a tables", /rpc\("qr_place_overview"/.test(dataLayer));
check("dados: não faz select em public.tables", !/from\("tables"\)/.test(dataLayer));
check("dados: devolve null quando a RPC falha", /if \(error \|\| !data\) return null/.test(dataLayer));
check(
  "dados: normaliza a arte salva no caminho de leitura",
  /normalizePlaceStyle\(/.test(dataLayer),
);
check(
  "dados: rota de arquivo procura a mesa no snapshot do tenant",
  /snapshot\.tables\.find/.test(dataLayer),
);
check("dados: sem service_role", !/service_role|SERVICE_ROLE/.test(dataLayer));

/* ========================================================================== */
/* 4. Rota de arquivo                                                        */
/* ========================================================================== */

check("rota: existe", route.length > 0);
check("rota: usa dynamic force-dynamic", /export const dynamic = "force-dynamic"/.test(route));
check("rota: autoriza pelo snapshot do tenant", /resolvePlaceFileContext/.test(route));
check("rota: 404 para mesa não encontrada", /status: 404/.test(route));
check(
  "rota: recusa arte ilegível com 422",
  /readabilityReport\(effectiveStyle\)/.test(route) && /status: 422/.test(route),
);
check(
  "rota: monta a URL com o token público",
  /qrPublicPath\(\{[\s\S]{0,160}publicToken/.test(route),
);
check(
  "rota: origem vem do ambiente/header confiável",
  /resolveSiteOrigin/.test(route),
);
check("rota: não confia na origem do parâmetro", !/searchParams\.get\("origin"\)/.test(route));
check(
  "rota: não aceita destino arbitrário do QR",
  !/params\.get\("url"\)/.test(route) && !/params\.get\("to"\)/.test(route),
);
check(
  "rota: SVG declarado como attachment",
  /Content-Disposition": `attachment/.test(route),
);
check("rota: cache privado", /Cache-Control": "private/.test(route));
check(
  "rota: PNG rasterizado a 300 DPI",
  /DPI = 300/.test(route) && /density: DPI/.test(route),
);
check(
  "rota: recusa formato desconhecido",
  /Formato não suportado/.test(route) && /supported: \["svg", "png"\]/.test(route),
);
check(
  "rota: não promete PDF",
  !/application\/pdf/.test(route),
);
check("rota: sem service_role", !/service_role|SERVICE_ROLE/.test(route));
check(
  "rota: limita o tamanho da logo embutida",
  /400 \* 1024/.test(route),
);
check(
  "rota: valida o tipo da logo baixada",
  /image\/png.*image\/jpeg.*image\/webp/.test(route.replace(/\n/g, " ")),
);

/* ========================================================================== */
/* 5. Página e UI                                                            */
/* ========================================================================== */

check("página: checa sessão antes de tudo", /getActiveRestaurant\(\)/.test(page));
check("página: 404 quando o snapshot é nulo", /notFound\(\)/.test(page));
check(
  "página: origem resolvida no servidor",
  /requireRequestOrigin\(\)/.test(page),
);
check("página: metadados em português", /title: "QR Codes das mesas"/.test(page));

check(
  "UI: monta a URL com o origin do servidor",
  /origin\}?\$\{?qrPublicPath|`\$\{origin\}\$\{qrPublicPath/.test(manager),
);
check(
  "UI: não usa window.location.origin para o link",
  !/window\.location\.origin/.test(manager) && !/location\.href\s*=\s*[`'"]https?\$\{/.test(manager),
);
check("UI: oferece as 4 ações exigidas", ["Baixar SVG", "Baixar PNG", "Copiar link", "Compartilhar"].every((label) => manager.includes(label)));
check("UI: botão Testar abre o endereço público", /Testar QR Code/.test(manager));
check("UI: Regenerar pede confirmação", /ConfirmSheet/.test(manager) && /Regenerar/.test(manager));
check(
  "UI: aviso de que regenerar invalida o impresso",
  /plaquinha[\s\S]{0,80}impressa|impressa[\s\S]{0,80}plaquinha/i.test(manager),
);
check("UI: mostra a URL para NFC", /URL para NFC/.test(manager));
check(
  "UI: não afirma gravar TAG pelo navegador",
  /navegador não grava/i.test(editor) || /navegador não grava/i.test(manager),
);
check("UI: explica o que não quebra o QR", /não muda o código já impresso|não afeta\s*\n?\s*o código|não<\/strong> afeta/.test(manager) || /não muda o código já impresso/.test(manager));
check("UI: mostra o contraste calculado", /contrastRatio|ratio\.toFixed/.test(editor));
check("UI: desabilita download com arte ilegível", /disabled=\{!report\.ok/.test(editor));
check("UI: preview com as mesmas regras (placeGeometry)", /placeGeometry\(style\)/.test(editor));
check("UI: preview em mm", /viewBox=\{`0 0 \$\{format\.widthMm\}/.test(editor));
check("UI: imagem do QR usa a rota existente", /\/app\/mesas\/\$\{table\.id\}\/qr`/.test(manager));
check("UI: página de mesas tem o atalho", /\/app\/mesas\/qrcodes/.test(read("src/app/app/mesas/page.tsx")));

/* ========================================================================== */
/* 6. Honestidade do NFC e do PDF                                            */
/* ========================================================================== */

check("texto: não promete NFC pelo navegador", !/grave a TAG pelo navegador|navegador grava/i.test(card) || /navegador n[ãa]o grava/i.test(card));
check("texto: instrução de NFC cita app de gravação", /aplicativo de grava/.test(card));
check("texto: NFC usa a mesma URL do QR (sem segunda fonte)", /É \*\*exatamente\*\* a mesma URL do QR/.test(card));

/* ========================================================================== */
/* 7. Nada de service_role no projeto novo                                   */
/* ========================================================================== */

const newFiles = [
  "src/lib/place-card.ts",
  "src/lib/place-svg.ts",
  "src/lib/data/qr-place.ts",
  "src/actions/qr-places.ts",
  "src/app/app/mesas/qrcodes/page.tsx",
  "src/app/app/mesas/[id]/qr/place/route.ts",
  "src/components/tables/qr-codes-manager.tsx",
  "src/components/tables/place-editor.tsx",
];
const withServiceRole = newFiles.filter((file) => /service_role/i.test(read(file)));
check("service_role: ausente nos 8 arquivos novos", withServiceRole.length === 0, withServiceRole.join(", "));

/* ========================================================================== */
/* Resultado                                                                 */
/* ========================================================================== */

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (qr-place-security.cjs)`);
process.exit(failed.length ? 1 : 0);
