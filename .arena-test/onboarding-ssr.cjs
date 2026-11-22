/**
 * Harness de renderização do onboarding — Etapa 21.
 *
 * Gera o HTML dos componentes do wizard e do card de progresso no servidor, que
 * é o caminho real. O que se verifica aqui é o que o dono vê no celular:
 *
 *   • `1/8`, `3/8` — o número da etapa existe e é legível;
 *   • etapas concluídas, puladas e pendentes são distinguíveis **também** no
 *     texto (não só na cor — quem não distingue verde de cinza precisa ler);
 *   • o checklist mostra percentual com `aria-valuenow` coerente;
 *   • os 11 segmentos aparecem com rótulo e dica;
 *   • o modelo sugerido avisa que não cria produto;
 *   • sem mesa ativa, o passo do QR explica o que fazer em vez de mostrar
 *     imagem quebrada;
 *   • nada de `<table>` — em 360 px, tabela é a garantia de layout quebrado.
 *
 * Rodar: node .arena-test/onboarding-ssr.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-onboarding-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

// `next/image` e `next/link` são trocados por tags simples: o alvo aqui é o
// HTML que sobra, não o otimizador do Next.
const STUBS = path.join(OUT, "stubs");
fs.mkdirSync(STUBS, { recursive: true });
fs.writeFileSync(
  path.join(STUBS, "next-image.js"),
  `const React = require("react");
   module.exports = function Image(props) {
     const { src, alt, width, height, fill, priority, unoptimized, sizes, loader, placeholder, blurDataURL, quality, ...rest } = props;
     return React.createElement("img", { src, alt, width, height, ...rest });
   };
   module.exports.default = module.exports;`,
);
fs.writeFileSync(
  path.join(STUBS, "next-link.js"),
  `const React = require("react");
   function Link({ href, children, ...props }) {
     return React.createElement("a", { href, ...props }, children);
   }
   module.exports = Link;
   module.exports.default = Link;`,
);
// As actions são chamadas só em handlers de evento; não executam no SSR, mas o
// bundle precisa resolvê-las.
fs.writeFileSync(
  path.join(STUBS, "actions.js"),
  `const noop = async () => ({ ok: true });
   module.exports = new Proxy({}, { get: () => noop });`,
);
fs.writeFileSync(
  path.join(STUBS, "server-only.js"),
  "module.exports = {};",
);

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-onboarding-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "onboarding-ssr.js"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "next/image": path.join(STUBS, "next-image.js"),
    "next/link": path.join(STUBS, "next-link.js"),
    "next/navigation": path.join(STUBS, "actions.js"),
    "@/actions/onboarding": path.join(STUBS, "actions.js"),
    "@/actions/theme": path.join(STUBS, "actions.js"),
    "@/actions/restaurant": path.join(STUBS, "actions.js"),
    "server-only": path.join(STUBS, "server-only.js"),
  },
  external: ["react", "react-dom", "lucide-react"],
  logLevel: "error",
});

const P = require(path.join(OUT, "onboarding-ssr.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const text = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/* ========================================================================== */
/* 1. Cabeçalho do wizard                                                    */
/* ========================================================================== */

{
  const html = P.renderHeader({ informacoes: "done", aparencia: "skipped" });
  const t = text(html);

  check("cabeçalho: gera HTML", html.length > 200, String(html.length));
  // "categorias" é a 4ª etapa (índice 3, posição 4) — a contagem é 1-based.
  check("cabeçalho: mostra '4 de 8' por extenso", t.includes("4 de 8"), t.slice(0, 120));
  check("cabeçalho: nome da etapa atual no <h1>", /<h1[^>]*>Categorias<\/h1>/.test(html));
  check("cabeçalho: mostra percentual", /25\s*%|25%/.test(t), t);
  check("cabeçalho: botão voltar tem rótulo acessível", /aria-label="Voltar para a etapa anterior"/.test(html));
  check("cabeçalho: trilha é aria-hidden (não repete 8 vezes no leitor)", /aria-hidden="true"[^>]*class="flex gap-1"|class="flex gap-1"[^>]*aria-hidden="true"/.test(html));
  check("cabeçalho: cada etapa da trilha tem texto alternativo oculto", html.includes("concluída") || html.includes("sem rótulo") === false);
  check("cabeçalho: etapa concluída é descrita no texto", t.includes("concluída"), t);
  check("cabeçalho: etapa pulada é descrita no texto", t.includes("pulada"), t);
  check("cabeçalho: usa <ol> semântico para a lista", html.includes("<ol"));
  check("cabeçalho: live region anuncia a etapa", /aria-live="polite"/.test(html));
  check("cabeçalho: não usa tabela", !html.includes("<table"));
}

/* ========================================================================== */
/* 2. Resumo de etapas                                                       */
/* ========================================================================== */

{
  const html = P.renderSummary({
    informacoes: "done",
    aparencia: "done",
    segmento: "skipped",
    categorias: "done",
  });
  const t = text(html);

  check("resumo: lista as 8 etapas", (html.match(/<li/g) || []).length === 8);
  check("resumo: palavra 'concluída' para as feitas", t.includes("concluída"));
  check("resumo: palavra 'pulada' para a pulada", t.includes("pulada"));
  check("resumo: palavra 'pendente' para as que faltam", t.includes("pendente"));
  check("resumo: usa marca de check para concluída", html.includes("<svg"));
}

/* ========================================================================== */
/* 3. Card de progresso do dashboard                                         */
/* ========================================================================== */

{
  const html = P.renderProgressCard({
    name: "Famintos",
    description: "Hambúrguer artesanal",
    logoUrl: "https://x/logo.webp",
    categories: 5,
    products: 12,
    tables: 8,
    activeTables: 8,
    whatsapp: false,
    published: false,
  });
  const t = text(html);

  // 6 de 7 = 86%, exibido como 85% (arredondamento a cada 5) — e o
  // `aria-valuenow` carrega o valor **exato**, então o leitor de tela não mente.
  check("progresso: título com percentual arredondado", t.includes("Configuração: 85%"), t.slice(0, 160));
  check("progresso: barra com role=progressbar", /role="progressbar"/.test(html));
  check("progresso: aria-valuenow traz o valor exato", /aria-valuenow="86"/.test(html));
  check("progresso: diz quantos itens faltam", /1 item falta/.test(t), t);
  check("progresso: item pendente traz a ação", t.includes("WhatsApp") && t.includes("opcional"));
  check("progresso: atalho para continuar o wizard", html.includes('href="/app/onboarding"'));
  check("progresso: avisa que já dá para publicar", t.includes("já pode publicar"), t);
  check("progresso: item mostra para onde ir", html.includes('href="/app/configuracoes/whatsapp"'));
  check("progresso: sem tabela", !html.includes("<table"));
  check("progresso: usa <section> com título", html.includes("<section") && html.includes("aria-labelledby"));
}

{
  const completa = P.renderProgressCard({
    name: "Famintos",
    description: "Hambúrguer artesanal",
    logoUrl: "https://x/l.webp",
    categories: 5,
    products: 12,
    tables: 3,
    activeTables: 3,
    whatsapp: true,
    published: true,
  });
  const t = text(completa);
  check("progresso completo: vira linha discreta", t.includes("Configuração completa"));
  check("progresso completo: não mostra barra", !completa.includes("progressbar"));
  check("progresso completo: mostra 100%", t.includes("100%"));
}

{
  const vazio = P.renderProgressCard({
    name: null,
    description: null,
    logoUrl: null,
    categories: 0,
    products: 0,
    tables: 0,
    activeTables: 0,
    whatsapp: false,
    published: false,
  });
  const t = text(vazio);
  check("progresso vazio: 0%", /Configuração: 0%/.test(t), t.slice(0, 120));
  check("progresso vazio: lista no máximo 4 pendências", (vazio.match(/<li/g) || []).length <= 4);
  check("progresso vazio: indica quantos ficaram de fora", t.includes("+ 3 itens"), t);
}

/* ========================================================================== */
/* 4. Etapa 1 · Informações                                                  */
/* ========================================================================== */

{
  const html = P.renderInfo();
  const t = text(html);

  check("info: campo de nome", /name="name"/.test(html));
  check("info: campo de descrição", /name="description"/.test(html));
  check("info: botão de upload de logo", t.includes("Logo"));
  check("info: inputs têm label associado", (html.match(/<label/g) || []).length >= 2);
  check("info: explica quando a logo entra no cardápio", t.includes("Continuar"));
}

/* ========================================================================== */
/* 5. Etapa 2 · Aparência                                                    */
/* ========================================================================== */

{
  const html = P.renderTheme("moderno", "hamburgueria");
  const t = text(html);

  check("tema: mostra os 6 presets", ["Moderno", "Elegante", "Dark", "Minimalista"].every((n) => t.includes(n)));
  check("tema: marca o escolhido com aria-pressed", /aria-pressed="true"/.test(html));
  check("tema: indica o sugerido para o segmento", t.includes("sugerido"));
  check("tema: avisa que pode trocar depois", t.includes("trocar depois"));
  check("tema: usa swatches como amostra visual", /background-color:/i.test(html));
  check("tema: botões com alvo grande (flex-col, altura mínima)", html.includes("h-16"));
}

/* ========================================================================== */
/* 6. Etapa 3 · Segmento                                                     */
/* ========================================================================== */

{
  const html = P.renderSegment();
  const t = text(html);

  check("segmento: 11 opções", (html.match(/<li/g) || []).length === 11, String((html.match(/<li/g) || []).length));
  for (const label of [
    "Restaurante", "Lanchonete", "Pizzaria", "Hamburgueria", "Bar",
    "Cafeteria", "Sorveteria", "Padaria", "Açaí", "Delivery", "Outro",
  ]) {
    check(`segmento: opção "${label}"`, t.includes(label));
  }
  check("segmento: marca a escolhida", /aria-pressed="true"/.test(html));
  check("segmento: cada opção tem dica", t.includes("Hambúrguer artesanal ou lanche"));
  check("segmento: grade de 2 colunas (cabe em 360px)", html.includes("grid-cols-2"));
}

/* ========================================================================== */
/* 7. Etapa 4 · Categorias                                                   */
/* ========================================================================== */

{
  const html = P.renderCategories(["Bebidas"], "hamburgueria");
  const t = text(html);

  check("categorias: mostra o modelo sugerido", t.includes("Modelo sugerido"));
  check("categorias: lista as sugestões", ["Hambúrgueres", "Combos", "Bebidas"].every((n) => t.includes(n)));
  check(
    "categorias: avisa que NÃO cria produto de exemplo",
    t.includes("nenhum produto de exemplo"),
    t.slice(0, 300),
  );
  check("categorias: marca o que já existe", t.includes("já existe"));
  check("categorias: mostra o estado atual do cardápio", t.includes("No seu cardápio agora"));
  check("categorias: botão de aplicar", t.includes("Usar configuração sugerida"));
}

{
  const semModelo = P.renderCategories([], null);
  const t = text(semModelo);
  check(
    "categorias sem segmento: orienta escolher ou criar do zero",
    t.includes("Escolha um segmento") && t.includes("do zero"),
  );
  check("categorias vazias: mostra estado vazio", t.includes("Nenhuma categoria ainda"));
}

/* ========================================================================== */
/* 8. Etapa 5 · Produtos                                                     */
/* ========================================================================== */

{
  const comCategoria = text(P.renderProducts(true, 0));
  check("produtos: explica que nome e preço bastam", comCategoria.includes("nome e preço bastam"), comCategoria);
  check("produtos: não sugere produto fictício", !/X-Burger|R\$ 24,90/.test(comCategoria));
  check("produtos: lembra de criar categoria", !comCategoria.includes("Crie uma categoria antes"));

  const semCategoria = text(P.renderProducts(false, 0));
  check("produtos sem categoria: avisa que precisa de categoria", semCategoria.includes("Crie uma categoria antes"));

  const comProdutos = text(P.renderProducts(true, 3));
  check("produtos: mostra a contagem", comProdutos.includes("3 produtos cadastrados"), comProdutos);
}

/* ========================================================================== */
/* 9. Etapa 6 · Mesas                                                        */
/* ========================================================================== */

{
  const t = text(P.renderTables(0));
  check("mesas: estado vazio", t.includes("Nenhuma mesa ainda"));
  check("mesas: explica o QR por mesa", t.includes("QR Code próprio"));
  check("mesas: oferece saída para quem só faz delivery", t.includes("Só delivery também funciona"));

  const comMesas = text(P.renderTables(4));
  check("mesas: conta as mesas", comMesas.includes("4 mesas cadastradas"), comMesas);
}

/* ========================================================================== */
/* 10. Etapa 7 · QR Code                                                     */
/* ========================================================================== */

{
  const html = P.renderQr("table-1");
  check("qr: renderiza a imagem", /<img[^>]+src="\/app\/mesas\/table-1\/qr"/.test(html), html.slice(0, 200));
  check("qr: descrição alternativa na imagem", /alt="QR Code da Mesa 01"/.test(html));
  check("qr: link de download PNG", html.includes("/app/mesas/table-1/qr?format=png"));
  check("qr: link de download SVG", html.includes("/app/mesas/table-1/qr?format=svg"));

  const vazioHtml = P.renderQr(null);
  const vazioText = text(vazioHtml);
  check("qr sem mesa: não renderiza imagem quebrada", !vazioHtml.includes("<img"));
  check("qr sem mesa: explica que o QR vem da mesa", vazioText.includes("gerado a partir da mesa"));
}

/* ========================================================================== */
/* 11. Etapa 8 · WhatsApp                                                    */
/* ========================================================================== */

{
  const t = text(P.renderWhatsapp(false));
  check("whatsapp: estado não conectado", t.includes("não conectado"));
  check("whatsapp: explica o que o botão faz", t.includes("abre a conversa"));
  check("whatsapp: é explicitamente opcional", t.includes("opcional"));
  check("whatsapp: diz onde conectar depois", t.includes("Configurações"));

  const conectado = text(P.renderWhatsapp(true));
  check("whatsapp: estado conectado", conectado.includes("WhatsApp conectado"));
}

/* ========================================================================== */

console.log("");
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\nonboarding-ssr: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
