/**
 * Harness de renderização da divulgação — Etapa 23 (parte 3).
 *
 * Renderiza `ShareHub` no servidor — o primeiro paint que o dono vê no celular.
 *
 *   • o link público aparece inteiro e sem `https://`;
 *   • as ações do escopo existem com rótulo visível (não só ícone);
 *   • a mensagem já sai montada com nome, chamada e link;
 *   • Instagram/TikTok aparecem como "copiar e colar";
 *   • cardápio despublicado avisa em vez de prometer link quebrado;
 *   • sem mesa/pedido, a seção de links explica em vez de mostrar select vazio;
 *   • nada de `<table>` (é tela de celular) nem de link em `localhost`.
 *
 * Rodar: node .arena-test/share-ssr.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-share-ssr");
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
     usePathname: () => "/app/divulgar",
     useSearchParams: () => new URLSearchParams(),
     redirect: noop,
     notFound: noop,
   };`,
);
fs.writeFileSync(
  path.join(STUBS, "actions.js"),
  `const noop = async () => ({ ok: true, headline: null });
   module.exports = new Proxy({}, { get: () => noop });`,
);
fs.writeFileSync(path.join(STUBS, "server-only.js"), "module.exports = {};");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-share-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "share-ssr.js"),
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
    "@/actions/share": path.join(STUBS, "actions.js"),
    "server-only": path.join(STUBS, "server-only.js"),
  },
  external: ["react", "react-dom", "lucide-react"],
  logLevel: "error",
});

const P = require(path.join(OUT, "share-ssr.js"));

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
/* 1. Estrutura geral                                                        */
/* ========================================================================== */

{
  const html = P.renderHub();
  const t = text(html);

  check("render: gera HTML", html.length > 2000, String(html.length));
  check("render: só uma <main>? não usa tabela", !html.includes("<table"));
  check("render: sem link para localhost", !/localhost|127\.0\.0\.1/.test(html));
  check("render: sem preconnect a domínio inventado", !/preconnect/.test(html));

  check("render: mostra o link público", t.includes("menuvo.app/r/famintos"));
  // O campo do link mostra o endereço sem esquema (cabe no celular); a mensagem
  // do WhatsApp leva a URL absoluta, porque lá ela precisa ser clicável.
  check(
    "render: campo do link sem https://, mensagem com URL absoluta",
    t.includes("menuvo.app/r/famintos") && t.includes("https://menuvo.app/r/famintos"),
  );
  check("render: cabeçalho 'Seu cardápio público'", t.includes("Seu cardápio público"));
  check("render: nome do restaurante na mensagem", t.includes("Famintos & Cia"));
  check("render: chamada salva na mensagem", t.includes("Peça sem fila pelo celular"));
  check("render: URL do cardápio na mensagem", t.includes("https://menuvo.app/r/famintos"));

  // Ações do escopo, com rótulo de texto.
  check("ações: WhatsApp", t.includes("WhatsApp"));
  check("ações: Copiar link", t.includes("Copiar link"));
  check("ações: Visualizar", t.includes("Visualizar"));
  check("ações: QR Code do cardápio", t.includes("QR Code do cardápio"));
  check("ações: Baixar SVG", t.includes("Baixar SVG"));
  check("ações: Baixar PNG", t.includes("Baixar PNG"));
  check("ações: seção de canais", t.includes("Outros canais"));
  check("ações: seção de links", t.includes("Links"));

  // `navigator.share` não existe no SSR: o botão "Compartilhar" aparece só depois
  // da hidratação, para não piscar e sumir. A presença dele é verificada em
  // `share-security.cjs`, que lê a fonte.
  check("render: não promete o botão nativo no HTML do servidor", !t.includes("Compartilhar agora"));

  check("canais: Instagram presente", t.includes("Instagram"));
  check("canais: Facebook presente", t.includes("Facebook"));
  check("canais: TikTok presente", t.includes("TikTok"));
  check("canais: Google presente", t.includes("Google"));
  check("canais: Instagram marcado como copiar e colar", /Instagram[^A-Za-z]*Copiar e colar/.test(t) || t.includes("Copiar e colar"));
  check("canais: aviso de que nada publica sozinho", /Nada aqui publica sozinho/.test(t));

  check("mensagem: botão Copiar mensagem", t.includes("Copiar mensagem"));
  check("mensagem: botão Enviar no WhatsApp", t.includes("Enviar no WhatsApp"));
  check("bio: sugestão para o Instagram", t.includes("Texto para a bio do Instagram"));
  check(
    "bio: contém nome e link",
    /Famintos & Cia\s*Cardápio digital[^]*https:\/\/menuvo\.app\/r\/famintos/.test(t),
  );
}

/* ========================================================================== */
/* 2. QR principal                                                           */
/* ========================================================================== */

{
  const html = P.renderHub();
  check("qr: imagem aponta para a rota do QR geral", html.includes('src="/app/divulgar/qr"'));
  check("qr: alt descreve o restaurante", /alt="QR Code do cardápio de Famintos &amp; Cia"/.test(html));
  check(
    "qr: aponta o usuário para os QR de mesa quando precisar",
    html.includes("/app/mesas/qrcodes"),
  );
  check("qr: dimensões declaradas (sem salto de layout)", /width="96"/.test(html) && /height="96"/.test(html));
}

/* ========================================================================== */
/* 3. Links (geral, mesa, pedido)                                            */
/* ========================================================================== */

{
  const html = P.renderHub();
  const t = text(html);

  check("links: aba Geral", t.includes("Geral"));
  check("links: aba Mesa", t.includes("Mesa"));
  check("links: aba Pedido", t.includes("Pedido"));
  // A aba ativa é "Geral" no primeiro render: o link mostrado é o do cardápio.
  check("links: mostra o link geral por padrão", t.includes("menuvo.app/r/famintos"));
  check("links: ação Abrir", t.includes("Abrir"));
  check("links: explica o que é o link da mesa", t.includes("identifica a mesa no pedido"));
}

/* ========================================================================== */
/* 4. Cardápio despublicado                                                  */
/* ========================================================================== */

{
  const t = text(P.renderUnpublished());
  check("despublicado: avisa", t.includes("desativado"));
  check("despublicado: diz o que fazer", /publicar o restaurante/.test(t));
  check("despublicado: não promete link funcionando", !t.includes("Link copiado"));
  // A tela continua útil: o dono pode preparar a mensagem antes de publicar.
  check("despublicado: ainda mostra a mensagem", t.includes("Copiar mensagem"));
}

/* ========================================================================== */
/* 5. Sem mesas / sem pedidos                                                */
/* ========================================================================== */

{
  const t = text(P.renderNoTables());
  check(
    "sem mesas: explica em vez de select vazio",
    t.includes("Nenhuma mesa cadastrada") || t.includes("Nenhum pedido ainda"),
  );
  check("sem mesas: não mostra 'undefined'", !t.includes("undefined"));
  check("sem mesas: link geral continua disponível", t.includes("menuvo.app/r/famintos"));
}

/* ========================================================================== */
/* 6. Leitura sem permissão de edição                                        */
/* ========================================================================== */

{
  const html = P.renderReadOnly();
  const t = text(html);
  check("somente leitura: não oferece editar mensagem", !t.includes("Editar"));
  check("somente leitura: continua podendo compartilhar", t.includes("WhatsApp") && t.includes("Copiar link"));
  check("somente leitura: QR continua baixável", t.includes("Baixar PNG"));
}

/* ========================================================================== */
/* 7. Sem quebra de acessibilidade                                           */
/* ========================================================================== */

{
  const html = P.renderHub();

  // Botões de canal precisam de texto, não só ícone: quem usa leitor de tela
  // precisa ouvir "Instagram", não "botão".
  const buttons = html.match(/<button[^>]*>([\s\S]*?)<\/button>/g) || [];
  const iconOnly = buttons.filter((button) => {
    const inner = button.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return inner.length === 0 && !/aria-label=/.test(button);
  });
  check("a11y: nenhum botão só com ícone sem aria-label", iconOnly.length === 0, iconOnly.slice(0, 2).join(" | "));

  const images = html.match(/<img[^>]*>/g) || [];
  check("a11y: toda imagem tem alt", images.every((tag) => /alt="/.test(tag)));
}

/* ========================================================================== */
/* Resultado                                                                 */
/* ========================================================================== */

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (share-ssr.cjs)`);
process.exit(failed.length ? 1 : 0);
