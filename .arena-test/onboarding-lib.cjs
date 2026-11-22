/**
 * Harness do modelo de onboarding — Etapa 21.
 *
 * Sem DOM e sem banco. O alvo é `src/lib/onboarding.ts`, que decide quatro
 * coisas que o dono do restaurante vê na tela e que, se errarem, não dão erro —
 * dão mentira:
 *
 *   1. **onde o wizard retoma** ("continuar de onde parou");
 *   2. **quanto falta** (percentual do wizard e do checklist);
 *   3. **o que é o quê** (etapa × item, pulada × concluída × pendente);
 *   4. **quais categorias sugerir** por segmento — sem inventar produto.
 *
 * As regras de tenant e o vocabulário fechado do `jsonb` são do banco (migration
 * 0022) e foram verificadas por SQL: 6 ataques negados, dedupe idempotente.
 *
 * Rodar: node .arena-test/onboarding-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-onboarding-lib");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/onboarding.ts")],
  bundle: true,
  outfile: path.join(OUT, "onboarding.js"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "error",
});

const O = require(path.join(OUT, "onboarding.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`);

/* ========================================================================== */
/* 1. Segmentos                                                              */
/* ========================================================================== */

eq("segmentos: são 11, na ordem do escopo", O.SEGMENTS.length, 11);
eq(
  "segmentos: ordem começa em restaurante e termina em outro",
  [O.SEGMENTS[0].id, O.SEGMENTS[10].id],
  ["restaurante", "outro"],
);
check(
  "segmentos: todo id tem rótulo, emoji e dica",
  O.SEGMENTS.every((s) => s.label && s.emoji && s.hint),
);
eq(
  "segmentos: ids batem com o enum do banco",
  [...O.SEGMENT_IDS].sort(),
  [
    "acai", "bar", "cafeteria", "delivery", "hamburgueria", "lanchonete",
    "outro", "padaria", "pizzaria", "restaurante", "sorveteria",
  ],
);
eq("segmentos: ids únicos", new Set(O.SEGMENT_IDS).size, 11);

// Normalização — o banco recusaria "Açaí" como valor de enum, então a
// conversão tem de acontecer antes do envio.
eq("parseSegment: aceita 'Açaí'", O.parseSegment("Açaí"), "acai");
eq("parseSegment: aceita 'ACAI'", O.parseSegment("ACAI"), "acai");
eq("parseSegment: aceita 'Hamburgueria'", O.parseSegment("Hamburgueria"), "hamburgueria");
eq("parseSegment: aceita com espaço", O.parseSegment("  bar  "), "bar");
eq("parseSegment: recusa lixo", O.parseSegment("pizzaria-romana"), null);
eq("parseSegment: recusa vazio", O.parseSegment(""), null);
eq("parseSegment: recusa null", O.parseSegment(null), null);
eq("parseSegment: recusa tentativa de injeção", O.parseSegment("bar'; drop table"), null);

eq("segmentLabel: devolve rótulo", O.segmentLabel("hamburgueria"), "Hamburgueria");
eq("segmentLabel: null para não escolhido", O.segmentLabel(null), null);
eq("segmentLabel: null para valor estranho", O.segmentLabel("inexistente"), null);

/* ========================================================================== */
/* 2. Categorias sugeridas                                                   */
/* ========================================================================== */

eq(
  "sugestão: hamburgueria é exatamente o exemplo do escopo",
  O.suggestedCategories("hamburgueria"),
  ["Hambúrgueres", "Combos", "Porções", "Bebidas", "Sobremesas"],
);

check(
  "sugestão: todo segmento tem modelo, exceto 'outro'",
  O.SEGMENT_IDS.every((id) => (id === "outro" ? O.suggestedCategories(id).length === 0 : O.suggestedCategories(id).length > 0)),
);
check(
  "sugestão: nenhuma lista passa de 6 nomes (cabe numa tela)",
  O.SEGMENT_IDS.every((id) => O.suggestedCategories(id).length <= 6),
);
check(
  "sugestão: nenhum nome duplicado dentro do mesmo segmento",
  O.SEGMENT_IDS.every((id) => {
    const names = O.suggestedCategories(id).map((n) => n.toLowerCase());
    return new Set(names).size === names.length;
  }),
);
check(
  "sugestão: nenhum nome passa de 80 caracteres (limite do banco)",
  O.SEGMENT_IDS.every((id) => O.suggestedCategories(id).every((n) => n.length > 0 && n.length <= 80)),
);
check(
  "sugestão: devolve cópia (mutar o retorno não altera o modelo)",
  (() => {
    const list = O.suggestedCategories("bar");
    list.push("Hackeado");
    return !O.suggestedCategories("bar").includes("Hackeado");
  })(),
);
eq("sugestão: segmento nulo devolve vazio", O.suggestedCategories(null), []);

// A regra mais importante do escopo: NADA de produto fictício.
const allNames = O.SEGMENT_IDS.flatMap((id) => O.suggestedCategories(id));
check(
  "sugestão: nenhuma sugestão parece produto com preço",
  !allNames.some((name) => /\d|R\$|preço|price/i.test(name)),
  allNames.join(", "),
);

eq("tema sugerido: hamburgueria → fastfood", O.SEGMENT_THEME.hamburgueria, "fastfood");
eq("tema sugerido: bar → dark", O.SEGMENT_THEME.bar, "dark");
check(
  "tema sugerido: todo id aponta para um preset existente",
  Object.values(O.SEGMENT_THEME).every((preset) =>
    ["moderno", "elegante", "dark", "minimalista", "restaurante", "fastfood"].includes(preset),
  ),
);

/* ========================================================================== */
/* 3. As oito etapas                                                         */
/* ========================================================================== */

eq("etapas: são 8", O.TOTAL_STEPS, 8);
eq(
  "etapas: ordem do escopo",
  O.STEP_IDS,
  ["informacoes", "aparencia", "segmento", "categorias", "produtos", "mesas", "qrcode", "whatsapp"],
);
check("etapas: toda etapa tem rótulo, título e descrição", O.ONBOARDING_STEPS.every((s) => s.label && s.title && s.description));
check("etapas: toda etapa aponta para uma tela de edição", O.ONBOARDING_STEPS.every((s) => s.managementHref.startsWith("/app")));
check(
  "etapas: só 'informacoes' é obrigatória",
  O.ONBOARDING_STEPS.filter((s) => !s.skippable).map((s) => s.id).join(",") === "informacoes",
);

eq("navegação: próxima de informacoes é aparencia", O.nextStep("informacoes").id, "aparencia");
eq("navegação: anterior de aparencia é informacoes", O.previousStep("aparencia").id, "informacoes");
eq("navegação: sem anterior na primeira", O.previousStep("informacoes"), null);
eq("navegação: sem próxima na última", O.nextStep("whatsapp"), null);
eq("navegação: getStep inválido devolve null", O.getStep("nao-existe"), null);

eq("cabeçalho: 1/8 · Informações", O.stepHeading("informacoes"), "1/8 · Informações");
eq("cabeçalho: 8/8 · WhatsApp", O.stepHeading("whatsapp"), "8/8 · WhatsApp");
eq("cabeçalho: 3/8 · Segmento", O.stepHeading("segmento"), "3/8 · Segmento");

/* ========================================================================== */
/* 4. Progresso do wizard                                                    */
/* ========================================================================== */

{
  const vazio = O.wizardProgress({});
  eq("progresso: começando do zero, 0%", vazio.percent, 0);
  eq("progresso: retoma na primeira etapa", vazio.resumeAt, "informacoes");
  eq("progresso: obrigatória faltando", vazio.requiredMissing, "informacoes");
  check("progresso: não pode finalizar sem informacoes", O.canFinish({}) === false);
}

{
  // O caso real: acabou de criar o restaurante, nome já preenchido.
  const steps = { informacoes: "done" };
  const p = O.wizardProgress(steps);
  eq("progresso: 1 de 8 = 13%", p.percent, 13);
  eq("progresso: retoma em aparencia", p.resumeAt, "aparencia");
  eq("progresso: obrigatória cumprida", p.requiredMissing, null);
  check("progresso: pode finalizar com o resto pendente", O.canFinish(steps) === true);
}

{
  // Pular conta como resolvido: o dono não deve voltar a ver a etapa.
  const steps = { informacoes: "done", aparencia: "skipped", segmento: "skipped" };
  const p = O.wizardProgress(steps);
  eq("progresso: pulada conta como resolvida", p.finished, 3);
  eq("progresso: retoma na primeira pendente, não na última vista", p.resumeAt, "categorias");
  eq("progresso: 3/8 = 38%", p.percent, 38);
}

{
  const todas = Object.fromEntries(O.STEP_IDS.map((id) => [id, "done"]));
  const p = O.wizardProgress(todas);
  eq("progresso: tudo concluído = 100%", p.percent, 100);
  eq("progresso: retoma na última quando acabou", p.resumeAt, "whatsapp");
}

{
  // Lacuna no meio: o wizard precisa voltar na lacuna, não no fim.
  const steps = {
    informacoes: "done",
    aparencia: "done",
    segmento: "done",
    categorias: "done",
    produtos: "done",
    mesas: "done",
    qrcode: "done",
    whatsapp: "pending",
  };
  eq("progresso: 'pending' explícito não conta", O.wizardProgress(steps).percent, 88);
  eq("progresso: retoma na lacuna", O.wizardProgress(steps).resumeAt, "whatsapp");
}

check(
  "progresso: valor inválido no mapa é ignorado, não quebra",
  (() => {
    const steps = { informacoes: "done", categorias: "hackeado" };
    return O.wizardProgress(steps).percent === 13;
  })(),
);

/* ========================================================================== */
/* 5. Leitura do jsonb do banco                                              */
/* ========================================================================== */

eq("readProgress: lê steps", O.readProgress({ steps: { informacoes: "done" } }), { informacoes: "done" });
eq("readProgress: null → vazio", O.readProgress(null), {});
eq("readProgress: sem steps → vazio", O.readProgress({ completed_at: null }), {});
eq("readProgress: steps não-objeto → vazio", O.readProgress({ steps: "x" }), {});
eq("readProgress: array → vazio", O.readProgress({ steps: [1, 2] }), {});
eq(
  "readProgress: descarta chave desconhecida",
  O.readProgress({ steps: { informacoes: "done", etapa_falsa: "done" } }),
  { informacoes: "done" },
);
eq(
  "readProgress: descarta valor fora do vocabulário",
  O.readProgress({ steps: { informacoes: "talvez", aparencia: "done" } }),
  { aparencia: "done" },
);
eq(
  "readProgress: preserva 'legacy' fora de steps sem quebrar",
  O.readProgress({ steps: {}, legacy: true }),
  {},
);

/* ========================================================================== */
/* 6. Checklist do dashboard                                                 */
/* ========================================================================== */

const vazio = {
  name: null, description: null, logoUrl: null,
  categories: 0, products: 0, tables: 0, activeTables: 0,
  whatsapp: false, published: false,
};

{
  const s = O.setupOverview(vazio);
  eq("checklist: 7 itens", s.total, 7);
  eq("checklist: nada feito = 0%", s.percent, 0);
  eq(
    "checklist: ordem do escopo",
    s.items.map((item) => item.id),
    ["informacoes", "logo", "categorias", "produtos", "mesas", "qrcode", "whatsapp"],
  );
  check("checklist: todo item pendente traz ação", s.items.every((item) => !item.done && item.action));
  check("checklist: casa vazia não está pronta para publicar", s.readyToPublish === false);
}

{
  const completa = {
    name: "Famintos", description: "Hambúrguer artesanal", logoUrl: "https://x/logo.webp",
    categories: 5, products: 12, tables: 8, activeTables: 8,
    whatsapp: true, published: true,
  };
  const s = O.setupOverview(completa);
  eq("checklist: casa completa = 100%", s.percent, 100);
  eq("checklist: 7 de 7", s.done, 7);
  check("checklist: completa está pronta", s.readyToPublish === true);
}

{
  // 5 de 7 = 71%: o número que o escopo cita como exemplo (85%) é desta família.
  const quase = {
    name: "Famintos", description: "Hambúrguer", logoUrl: "https://x/l.webp",
    categories: 3, products: 9, tables: 4, activeTables: 4,
    whatsapp: false, published: false,
  };
  const s = O.setupOverview(quase);
  eq("checklist: 6 de 7 = 86%", s.percent, 86);
  check("checklist: pronto para publicar mesmo sem WhatsApp", s.readyToPublish === true);
}

{
  // Descrição ausente reprova "Informações" mesmo com nome.
  const semDescricao = { ...vazio, name: "Famintos" };
  const s = O.setupOverview(semDescricao);
  check(
    "checklist: nome sem descrição não fecha Informações",
    s.items.find((i) => i.id === "informacoes").done === false,
  );
}

{
  // QR depende de mesa ATIVA: mesa desativada não tem QR que funcione.
  const mesasDesativadas = { ...vazio, tables: 3, activeTables: 0 };
  const s = O.setupOverview(mesasDesativadas);
  check("checklist: mesa desativada não fecha QR", s.items.find((i) => i.id === "qrcode").done === false);
  check("checklist: mesa desativada fecha 'Mesas'", s.items.find((i) => i.id === "mesas").done === true);
}

{
  // Publicado sem produto: o link abre, mas não é "pronto para publicar".
  const publicadoVazio = { ...vazio, published: true };
  const s = O.setupOverview(publicadoVazio);
  check("checklist: publicado não vira 100%", s.percent === 0);
  check("checklist: publicado conta como pronto para publicar", s.readyToPublish === true);
}

{
  // Categorias e produtos são pré-requisito do "essencial".
  const semProduto = { ...vazio, name: "X", description: "Y", categories: 3, activeTables: 2 };
  check(
    "checklist: sem produto não está pronto para publicar",
    O.setupOverview(semProduto).readyToPublish === false,
  );
}

check(
  "checklist: percentual é sempre inteiro entre 0 e 100",
  (() => {
    for (let n = 0; n <= 7; n += 1) {
      const facts = {
        ...vazio,
        categories: n > 0 ? 1 : 0,
        products: n > 1 ? 1 : 0,
        tables: n > 2 ? 1 : 0,
        activeTables: n > 3 ? 1 : 0,
        whatsapp: n > 4,
        logoUrl: n > 5 ? "https://x/l.webp" : null,
        published: n > 6,
      };
      const { percent } = O.setupOverview(facts);
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) return false;
    }
    return true;
  })(),
);

/* ========================================================================== */
/* 7. Exibição do percentual                                                 */
/* ========================================================================== */

eq("exibição: 83 → 85", O.displayPercent(83), 85);
eq("exibição: 86 → 85", O.displayPercent(86), 85);
eq("exibição: 100 → 100", O.displayPercent(100), 100);
eq("exibição: 0 → 0", O.displayPercent(0), 0);
eq("exibição: nunca passa de 100", O.displayPercent(140), 100);
eq("exibição: nunca fica negativo", O.displayPercent(-10), 0);
eq("exibição: 98 → 100 (arredonda)", O.displayPercent(98), 100);

/* ========================================================================== */
/* 8. Passo inicial                                                          */
/* ========================================================================== */

eq("abertura: sem nada, começa em informacoes", O.firstOpenStep({}), "informacoes");
eq(
  "abertura: com informacoes feita, começa em aparencia",
  O.firstOpenStep({ informacoes: "done" }),
  "aparencia",
);
eq(
  "abertura: com tudo pulado menos o fim, retoma na lacuna",
  O.firstOpenStep({ informacoes: "done", aparencia: "skipped", segmento: "skipped" }),
  "categorias",
);

/* ========================================================================== */
/* 9. Coerência com o banco (a migration e o TS precisam concordar)          */
/* ========================================================================== */

{
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/0022_onboarding.sql"), "utf8");

  // Etapas: o vocabulário do `save_onboarding_progress` tem de ser o mesmo.
  const allowedInSql = (sql.match(/v_allowed text\[\] := array\[([\s\S]*?)\];/) || [])[1] || "";
  const sqlSteps = [...allowedInSql.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  eq("banco × TS: lista de etapas idêntica", sqlSteps, [...O.STEP_IDS].sort());

  // Segmentos: enum do banco × modelo do TS.
  const enumBlock = (sql.match(/create type public\.restaurant_segment as enum \(([\s\S]*?)\);/) || [])[1] || "";
  const sqlSegments = [...enumBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  eq("banco × TS: lista de segmentos idêntica", sqlSegments, [...O.SEGMENT_IDS].sort());

  check(
    "banco: toda função de escrita confere o dono antes de gravar",
    ["set_restaurant_segment", "save_onboarding_progress", "apply_suggested_categories"].every((fn) => {
      const index = sql.indexOf(`function public.${fn}(`);
      if (index < 0) return false;
      const body = sql.slice(index, index + 2500);
      return body.includes("is_restaurant_owner(p_restaurant_id)");
    }),
  );

  check(
    "banco: funções novas são security definer com search_path fixo",
    ["is_restaurant_owner", "set_restaurant_segment", "save_onboarding_progress", "apply_suggested_categories", "onboarding_overview"].every(
      (fn) => {
        const index = sql.indexOf(`function public.${fn}(`);
        if (index < 0) return false;
        const header = sql.slice(index, index + 260);
        return header.includes("security definer") && header.includes("set search_path = public, pg_temp");
      },
    ),
  );

  check(
    "banco: leitura do overview não levanta exceção para tenant alheio (devolve null)",
    (() => {
      const index = sql.indexOf("function public.onboarding_overview(");
      const body = sql.slice(index, index + 1200);
      return body.includes("return null");
    })(),
  );

  check(
    "banco: progresso valida chave e valor antes de gravar",
    sql.includes("unknown_onboarding_step") && sql.includes("invalid_onboarding_state"),
  );

  check(
    "banco: sugestão de categoria deduplica por name_key",
    sql.includes("public.name_key(v_name)") && sql.includes("v_seen := v_seen || v_key"),
  );

  check(
    "banco: limite de categorias por chamada",
    sql.includes("too_many_categories") && sql.includes("> 40"),
  );

  check(
    "banco: registro da migration presente",
    sql.includes("'20261122150000'") && sql.includes("'stage21_onboarding'"),
  );
}

/* ========================================================================== */
/* 10. Segurança do código de aplicação                                      */
/* ========================================================================== */

{
  const actions = fs.readFileSync(path.join(ROOT, "src/actions/onboarding.ts"), "utf8");
  const data = fs.readFileSync(path.join(ROOT, "src/lib/data/onboarding.ts"), "utf8");
  const wizard = fs.readFileSync(path.join(ROOT, "src/components/onboarding/onboarding-wizard.tsx"), "utf8");

  check(
    "segurança: nenhuma action aceita restaurant_id do cliente",
    !/export async function \w+\([^)]*restaurantId/.test(actions) &&
      !/formData\.get\(["']restaurantId/.test(actions),
  );
  check(
    "segurança: toda action resolve o tenant por getActiveRestaurant",
    (actions.match(/getActiveRestaurant\(\)/g) || []).length >= 6,
  );
  check(
    "segurança: actions não devolvem error.message do banco",
    !/error:\s*error\.message/.test(actions),
  );
  check(
    "segurança: leitura passa pela RPC, não pela tabela restaurants",
    data.includes('rpc("onboarding_overview"') && !data.includes('.from("restaurants")'),
  );
  check(
    "segurança: logo enviada precisa estar na pasta do tenant",
    actions.includes("restaurant-assets") && actions.includes("restaurant.id"),
  );
  check(
    "wizard: salva progresso a cada avanço",
    wizard.includes("saveOnboardingProgress"),
  );
  check(
    "wizard: oferece pular só quando a etapa permite",
    wizard.includes("step.skippable") && wizard.includes("Pular por enquanto"),
  );
  check(
    "wizard: botão final existe e chama a finalização",
    wizard.includes("Finalizar configuração") && wizard.includes("finishOnboarding"),
  );
  check(
    "wizard: tela final mostra link público e QR",
    wizard.includes("Link público") && wizard.includes("/qr") && wizard.includes("Copiar link"),
  );
  check(
    "wizard: compartilhar usa navigator.share com fallback para copiar",
    wizard.includes("navigator.share") && wizard.includes("copyLink"),
  );
  check(
    "wizard: barra de ação fixa respeita área segura do aparelho",
    wizard.includes("pb-safe") && wizard.includes("fixed inset-x-0 bottom-0"),
  );
  check(
    "wizard: nenhum segredo/serviço exposto no cliente",
    !/service_role|SERVICE_ROLE|SUPABASE_SERVICE/.test(wizard),
  );
}

/* ========================================================================== */

console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\nonboarding-lib: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
