/**
 * Harness de renderização — Etapa 24 (parte 3).
 *
 * Renderiza com `react-dom/server` o primeiro paint das quatro telas novas:
 * lista de clientes, ficha, configuração de pontos e consulta de saldo no
 * cardápio. Sem navegador — mas com o HTML real, que é onde aparecem os bugs
 * de celular.
 *
 * O que este harness protege, em ordem de gravidade:
 *
 *   1. **dado pessoal** — telefone só quando existe e sempre mascarado; nada de
 *      telefone de cliente em página pública;
 *   2. **regressão da Etapa 6** — o cardápio continua abrindo sem cadastro;
 *   3. **LGPD** — exclusão não aparece como ação de um toque, e o cadastro
 *      excluído não volta a receber pontos;
 *   4. **celular** — botão com altura de toque, sem `<table>`, sem texto que
 *      estoure;
 *   5. **promessa vazia** — nada de "vamos te avisar" quando não existe envio.
 *
 * Rodar: node .arena-test/loyalty-ui.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-loyalty-ui");
fs.rmSync(OUT, { recursive: true, force: true });

const STUBS = path.join(OUT, "stubs");
fs.mkdirSync(STUBS, { recursive: true });

fs.writeFileSync(
  path.join(STUBS, "next-link.js"),
  `const React = require("react");
   function Link({ href, children, ...props }) {
     return React.createElement("a", { href, ...props }, children);
   }
   module.exports = Link;
   module.exports.default = Link;`,
);
fs.writeFileSync(
  path.join(STUBS, "navigation.js"),
  `const noop = () => {};
   module.exports = {
     useRouter: () => ({ refresh: noop, push: noop, replace: noop, back: noop, prefetch: noop }),
     usePathname: () => "/app/clientes",
     useSearchParams: () => new URLSearchParams(),
     redirect: noop,
     notFound: noop,
   };`,
);
// Actions: devolvem sucesso. O harness testa o que aparece ANTES do clique.
fs.writeFileSync(
  path.join(STUBS, "actions.js"),
  `const ok = async () => ({ ok: true, message: "Feito." });
   module.exports = new Proxy({}, { get: () => ok });`,
);
// Supabase do navegador: a lista não pagina durante o render estático.
fs.writeFileSync(
  path.join(STUBS, "supabase.js"),
  `module.exports = { getBrowserClient: () => ({ rpc: async () => ({ data: [], error: null }) }) };`,
);
fs.writeFileSync(path.join(STUBS, "server-only.js"), "module.exports = {};");
/*
 * `Sheet` real usa `createPortal` e só monta no cliente — no render estático
 * sairia vazio, e o harness não veria nada da consulta de saldo. O stub mantém
 * o contrato (open, título, corpo, rodapé) e ignora o portal: o que se testa
 * aqui é o conteúdo, não a animação.
 */
fs.writeFileSync(
  path.join(STUBS, "sheet.js"),
  `const React = require("react");
   function Sheet({ open, title, description, children, footer }) {
     if (!open) return null;
     return React.createElement(
       "div",
       { role: "dialog", "aria-modal": "true", "aria-label": title },
       React.createElement("h2", null, title),
       description ? React.createElement("p", null, description) : null,
       React.createElement("div", null, children),
       footer ? React.createElement("div", null, footer) : null,
     );
   }
   module.exports = { Sheet };`,
);

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-loyalty-ui.tsx")],
  bundle: true,
  outfile: path.join(OUT, "loyalty-ui.js"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "next/link": path.join(STUBS, "next-link.js"),
    "next/image": path.join(STUBS, "next-link.js"),
    "next/navigation": path.join(STUBS, "navigation.js"),
    "@/actions/loyalty": path.join(STUBS, "actions.js"),
    "@/lib/supabase/client": path.join(STUBS, "supabase.js"),
    "@/components/ui/sheet": path.join(STUBS, "sheet.js"),
    "server-only": path.join(STUBS, "server-only.js"),
  },
  external: ["react", "react-dom", "lucide-react"],
  logLevel: "error",
});

const P = require(path.join(OUT, "loyalty-ui.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const text = (html) =>
  html
    // `<svg xmlns="http://www.w3.org/2000/svg">` traz dígitos que parecem
    // telefone cru. Ícone não é texto: sai antes de extrair o conteúdo.
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#x2F;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* ========================================================================== */
/* 1. Lista de clientes                                                      */
/* ========================================================================== */

{
  const html = P.renderList();
  const t = text(html);

  check("lista: gera HTML", html.length > 1000, String(html.length));
  check("lista: sem <table> (tela de celular)", !html.includes("<table"));
  check("lista: sem localhost", !/localhost|127\.0\.0\.1/.test(html));
  check("lista: mostra o nome do cliente", t.includes("Ana Paula"));
  /*
   * Número cru (só dígitos) nunca vai para a tela: quem lê é gente. E cliente
   * com nome não repete o telefone na lista — o número é a identificação de
   * quem ainda não tem nome.
   */
  check(
    "lista: sem número cru na tela",
    !html.includes("5585999998888") && !html.includes("558532321010"),
  );
  /*
   * O telefone formatado aparece uma vez só: na linha do cliente sem nome. Se
   * aparecesse duas, o cliente com nome estaria repetindo o número — ruído na
   * lista e exposição a mais.
   */
  check(
    "lista: telefone formatado aparece uma vez só",
    (t.match(/\(85\) 3232-1010/g) || []).length === 1 &&
      (t.match(/\(85\) 99999-8888/g) || []).length === 0,
  );
  check("lista: cliente sem nome identificado pelo telefone", t.includes("(85) 3232-1010"));
  check("lista: conta de pedidos no singular", t.includes("1 pedido") && !t.includes("1 pedidos"));
  check("lista: total gasto formatado em reais", t.includes("R$ 182,50"));
  check("lista: saldo de pontos aparece", t.includes("120 pts"));
  check("lista: cliente excluído marcado", t.includes("Excluído"));
  check("lista: excluído não mostra pontos", !/João Excluído[^]{0,200}pts/.test(t));
  check("lista: contagem total", t.includes("3 clientes"));
  check("lista: campo de busca com rótulo acessível", /aria-label="Buscar cliente/.test(html));
  check("lista: link para a ficha", /href="\/app\/clientes\/c1"/.test(html));
  check("lista: linha tem área de toque", /min-h-16/.test(html));
}

{
  const t = text(P.renderListEmpty());
  check("lista vazia: explica como o cliente entra", /informa nome ou WhatsApp/i.test(t));
  check("lista vazia: não manda 'carregar mais'", !/Carregar mais/.test(t));
  check(
    "lista vazia: não promete cadastro obrigatório",
    /Ninguém precisa se cadastrar/i.test(t) || /não precisa/i.test(t),
  );
}

{
  const t = text(P.renderListProgramOff());
  check("programa desligado: avisa na lista", t.includes("Pontos desativados"));
  check("programa desligado: não mostra saldo como se valesse", !/ pts/.test(t));
}

/* ========================================================================== */
/* 2. Ficha do cliente                                                       */
/* ========================================================================== */

{
  const html = P.renderDetail();
  const t = text(html);

  check("ficha: gera HTML", html.length > 2000, String(html.length));
  check("ficha: sem <table>", !html.includes("<table"));
  check("ficha: nome do cliente", t.includes("Ana Paula"));
  check("ficha: saldo em destaque", t.includes("120"));
  check("ficha: valor do saldo em reais", t.includes("R$ 6,00"));
  check("ficha: pedidos no histórico", t.includes("4"));
  check("ficha: total gasto", t.includes("R$ 182,50"));
  check("ficha: frequência por mês", t.includes("2/mês"));
  check("ficha: extrato com pontos do pedido", t.includes("Pontos do pedido"));
  check("ficha: extrato marca o resgate", t.includes("Pontos utilizados"));
  check("ficha: bônus de aniversário no extrato", t.includes("Bônus de aniversário"));
  check("ficha: delta positivo com sinal", t.includes("+30"));
  check("ficha: delta negativo com menos tipográfico", t.includes("−30"));
  check("ficha: motivo do lançamento aparece", t.includes("Resgate no balcão"));
  check("ficha: consentimento com versão", /Consentimento v1/.test(t));
  check("ficha: botão de ajuste", t.includes("Ajustar pontos"));
  check("ficha: botão de aniversário", t.includes("Bônus de aniversário"));
  check("ficha: exclusão existe", t.includes("Excluir dados do cliente"));
  /*
   * Exclusão é irreversível: o primeiro toque não pode apagar. Este botão só
   * abre a confirmação — nunca deve sair como ação direta.
   */
  check(
    "ficha: exclusão não apaga no primeiro toque",
    t.includes("Excluir dados do cliente") && !t.includes("Excluir mesmo assim"),
  );
  /*
   * O texto de consequência vive na confirmação de dois toques, que só aparece
   * depois do primeiro clique — no primeiro paint ele não pode estar lá. A
   * verificação do conteúdo é feita no arquivo, mais abaixo.
   */
  check(
    "ficha: não promete envio de mensagem",
    !/vamos (te )?avisar|enviaremos|disparar/i.test(t),
  );
  check("ficha: botões com altura de toque", (html.match(/min-h-1[01]/g) || []).length >= 3);
  check("ficha: telefone mascarado", t.includes("(85) 99999-8888") && !t.includes("5585999998888"));
}

{
  const t = text(P.renderDetailErased());
  check("excluído: marcado como dados excluídos", t.includes("Dados excluídos"));
  check("excluído: explica o que sobrou", /pedidos continuam no histórico/i.test(t));
  check("excluído: não oferece ajustar pontos", !t.includes("Ajustar pontos"));
  check("excluído: não oferece bônus", !t.includes("Bônus de aniversário"));
  check("excluído: não oferece excluir de novo", !t.includes("Excluir dados do cliente"));
  check("excluído: não mostra telefone", !t.includes("99999"));
  check("excluído: extrato vazio explicado", /Nenhum ponto ainda/i.test(t));
}

{
  const t = text(P.renderDetailProgramOff());
  check("programa desligado na ficha: avisa", /programa está desativado/i.test(t));
  check("programa desligado na ficha: saldo preservado", /saldo continua guardado/i.test(t));
}

/* ========================================================================== */
/* 3. Configuração do programa                                              */
/* ========================================================================== */

{
  const html = P.renderForm();
  const t = text(html);

  check("config: gera HTML", html.length > 1500);
  check("config: liga/desliga com role=switch", /role="switch"/.test(html));
  check("config: switch marcado quando ligado", /aria-checked="true"/.test(html));
  check("config: pontos por real", t.includes("Pontos por R$ 1 gasto"));
  check("config: bônus de cadastro", t.includes("Bônus no cadastro"));
  check("config: bônus de aniversário", t.includes("Bônus de aniversário"));
  check("config: valor do resgate", /Quanto vale 1 ponto no resgate/i.test(t));
  check("config: campo de mensagem", t.includes("Mensagem para o cliente"));
  check("config: prévia da regra", t.includes("Como aparece no cardápio"));
  check("config: prévia com os números", /1 ponto por R\$ 1 · 50 pontos no cadastro/.test(t));
  check("config: resgate explica que é no balcão", /feito pelo atendente no balcão/i.test(t));
  check("config: botão salvar", t.includes("Salvar programa"));
  check("config: campos numéricos abrem teclado numérico", (html.match(/inputMode="(numeric|decimal)"/g) || []).length >= 4);
  check("config: aviso de que desligar não apaga", !/zerar|resetar tudo/i.test(t));
}

{
  const html = P.renderFormEmpty();
  const t = text(html);
  check("config desligada: switch desmarcado", /aria-checked="false"/.test(html));
  check("config desligada: não promete pontos no cardápio", !/Como aparece no cardápio/.test(t));
}

{
  const t = text(P.renderForm({ canEdit: false }));
  check("sem permissão: explica quem pode alterar", /Apenas dono ou administrador/i.test(t));
  check("sem permissão: não mostra o botão de salvar", !t.includes("Salvar programa"));
  check("sem permissão: não mostra o switch", !/role="switch"/.test(P.renderForm({ canEdit: false })));
}

/* ========================================================================== */
/* 4. Consulta de saldo no cardápio                                          */
/* ========================================================================== */

{
  const html = P.renderPoints();
  const t = text(html);

  check("pontos: gera HTML", html.length > 500, String(html.length));
  check("pontos: título", t.includes("Meus pontos"));
  check("pontos: identifica a mesa", t.includes("Mesa 01"));
  check("pontos: campo de WhatsApp", /Seu WhatsApp/.test(t));
  check("pontos: teclado de telefone", /inputMode="tel"/.test(html));
  check("pontos: botão de consulta", t.includes("Ver meu saldo"));
  check("pontos: diz que não envia mensagem", /Não enviamos mensagem/i.test(t));
  check("pontos: mostra a regra do programa", t.includes("1 ponto por R$ 1"));
  /*
   * Sem saldo consultado ainda, nada de número inventado na tela.
   */
  check("pontos: não mostra saldo antes de consultar", !/pontos disponíveis/.test(t));
  check("pontos: botão em altura de toque", /min-h-12/.test(html));
}

{
  const html = P.renderPointsNoTable();
  check("pontos sem mesa: consulta desabilitada", /disabled/.test(html));
}

/* ========================================================================== */
/* 5. Guardas estruturais das telas                                          */
/* ========================================================================== */

{
  const files = [
    "src/app/app/clientes/page.tsx",
    "src/app/app/clientes/[id]/page.tsx",
    "src/app/app/clientes/fidelidade/page.tsx",
    "src/components/customers/customers-list.tsx",
    "src/components/customers/customer-detail.tsx",
    "src/components/customers/loyalty-settings-form.tsx",
    "src/components/public/my-points-sheet.tsx",
  ];

  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    check(`${file}: sem service_role`, !/service_role/i.test(src));
    check(`${file}: sem console.log esquecido`, !/console\.log\(/.test(src));
    /*
     * O cardápio público é cacheado e compartilhado entre clientes. Buscar
     * dados do cliente no navegador sem token da mesa (por telefone solto)
     * criaria uma porta de enumeração.
     */
    check(`${file}: consulta de cliente exige token de mesa`, !/customer_points[\s\S]{0,60}p_phone(?![\s\S]{0,120}p_token)/.test(src) || /tableToken/.test(src));
  }

  const sheetRaw = fs.readFileSync(path.join(ROOT, "src/components/public/my-points-sheet.tsx"), "utf8");
  // Ignora comentários: explicar por que não há extrato não é renderizar extrato.
  const sheet = sheetRaw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  check("pontos: limpa o telefone ao fechar", /setPhone\(""\)/.test(sheet));
  check("pontos: limpa o resultado ao fechar", /setResult\(null\)/.test(sheet));
  check(
    "pontos: só revela nome e saldo",
    !/extrato|entries|histórico/i.test(sheet),
  );

  const form = fs.readFileSync(path.join(ROOT, "src/components/customers/loyalty-settings-form.tsx"), "utf8");
  check("config: valida antes de enviar", /parsed\.ok === false/.test(form));
  check("config: usa a action, não o Supabase direto", /saveLoyaltySettings/.test(form) && !/createClient/.test(form));

  const detail = fs.readFileSync(path.join(ROOT, "src/components/customers/customer-detail.tsx"), "utf8");
  check(
    "ficha: confirmação explica o que a exclusão faz",
    /serão apagados de vez/i.test(detail) && /Não dá para desfazer/i.test(detail),
  );
  check(
    "ficha: confirmação diz que os pedidos continuam",
    /pedidos continuam no histórico/i.test(detail),
  );

  const list = fs.readFileSync(path.join(ROOT, "src/components/customers/customers-list.tsx"), "utf8");
  check("lista: busca com debounce", /setTimeout\([\s\S]{0,400}?,\s*350\)/.test(list));
  check("lista: descarta resposta fora de ordem", /requestId/.test(list));
  check("lista: deduplica por id ao paginar", /new Set\(current\.map/.test(list));
  check("lista: não baixa tudo para filtrar no cliente", !/limit:\s*5000/.test(list));
}

/* ========================================================================== */
/* 6. Navegação: entrada sem 7ª aba                                          */
/* ========================================================================== */

{
  const nav = fs.readFileSync(path.join(ROOT, "src/components/app/bottom-nav.tsx"), "utf8");
  const items = (nav.match(/href:\s*"\/app/g) || []).length;
  /*
   * Seis abas cabem em 320 px com o rótulo em `clamp`. A sétima empurraria o
   * rótulo para tamanho ilegível — por isso "Clientes" entra pelo painel.
   */
  check("navegação continua com 6 abas", items === 6, String(items));
  check("navegação não ganhou aba de clientes", !/\/app\/clientes/.test(nav));

  const dashboard = fs.readFileSync(path.join(ROOT, "src/app/app/page.tsx"), "utf8");
  check("painel tem atalho para clientes", /href="\/app\/clientes"/.test(dashboard));
  check("atalho aparece para qualquer membro", !/canManage[\s\S]{0,200}app\/clientes/.test(dashboard));
}

/* -------------------------------------------------------------------------- */
/* Resultado                                                                 */
/* -------------------------------------------------------------------------- */

const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (loyalty-ui.cjs)`);
process.exit(failed.length === 0 ? 0 : 1);
