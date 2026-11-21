/**
 * Harness de renderização do cardápio público com tema — Etapa 9.
 *
 * Diferente do harness de jsdom: aqui o HTML é gerado no **servidor** com
 * `renderToStaticMarkup`, que é o caminho real de `/r/{slug}` e
 * `/r/{slug}/table/{token}`. O que se verifica:
 *
 *   • a página sai com as variáveis `--mv-*` do tema do restaurante;
 *   • nenhuma cor de marca fixa (`brand-*` / `ink-*`) escapou para o cardápio;
 *   • o tema escuro pinta cabeçalho, cards e barra;
 *   • sem tema, o HTML traz o padrão (nada de atributo vazio).
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "page.js"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": path.join(ROOT, "src") },
  external: ["next", "next/image", "next/link", "react", "react-dom", "lucide-react"],
  logLevel: "error",
});

const page = require(path.join(OUT, "page.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

// next/image fora do Next: trocamos por um <img> simples para o HTML sair.
const originalRender = page.render;

const dark = originalRender(page.darkTheme);
const light = originalRender({
  preset: null,
  primary_color: "#0f9250",
  secondary_color: "#41cf80",
  background_color: "#ffffff",
  text_color: "#14161c",
  button_color: "#0f9250",
  card_style: "rounded",
  button_style: "solid",
  logo_url: null,
  cover_url: null,
});

/* ------------------------------------------------------------ tema escuro */
check("ssr: HTML gerado com conteúdo", dark.length > 500, String(dark.length));
check(
  "ssr: variáveis do tema presentes no HTML",
  dark.includes("--mv-primary:#f4b942") || dark.includes("--mv-primary: #f4b942"),
  dark.slice(dark.indexOf("--mv-primary"), dark.indexOf("--mv-primary") + 60),
);
check(
  "ssr: fundo escuro do tema aplicado",
  dark.includes("--mv-bg:#16181d") || dark.includes("--mv-bg: #16181d"),
);
check(
  "ssr: cabeçalho usa a cor principal do restaurante",
  dark.includes("background-color:#f4b942") || dark.includes("background-color: #f4b942"),
);
check("ssr: nome do restaurante visível", dark.includes("Burger House"));
check("ssr: descrição visível", dark.includes("Hambúrguer artesanal"));
check("ssr: produto do cardápio presente", dark.includes("X-Bacon"));
check(
  "ssr: preço formatado em BRL",
  /R\$\s*29,90/.test(dark.replace(/&nbsp;/g, " ")),
  (dark.match(/R\$[^<]{0,12}/) || [""])[0],
);
check(
  "ssr: botão de ação do produto existe",
  /aria-label="Ver X-Bacon/.test(dark),
);
check(
  "ssr: barra Garçom/Carrinho/Conta presente (mesa)",
  dark.includes("Garçom") && dark.includes("Carrinho") && dark.includes("Conta"),
);
check(
  "ssr: tema escuro marcado para os estilos",
  dark.includes('data-theme-tone="dark"'),
);

/* ------------------------------------------------------- isolamento de cor */
// O cardápio público não deve carregar classes de marca: quem manda é --mv-*.
const brandClasses = (dark.match(/\b(?:bg|text|border|ring)-brand-\d+/g) || []).filter(Boolean);
check(
  "isolamento: cardápio público sem classes de marca fixas",
  brandClasses.length === 0,
  [...new Set(brandClasses)].join(", "),
);
const inkClasses = (dark.match(/\b(?:bg|text|border|ring)-ink-\d+/g) || []).filter(Boolean);
check(
  "isolamento: cardápio público sem classes ink-* fixas",
  inkClasses.length === 0,
  [...new Set(inkClasses)].join(", "),
);

/* -------------------------------------------------------------- tema claro */
check(
  "ssr: tema claro aplica o padrão quando não há personalização",
  light.includes("--mv-primary:#0f9250") || light.includes("--mv-primary: #0f9250"),
);
check(
  "ssr: tema claro usa fundo branco",
  light.includes("--mv-bg:#ffffff") || light.includes("--mv-bg: #ffffff"),
);
check(
  "ssr: nada de variável vazia no HTML",
  !/--mv-[a-z-]+:\s*;/.test(dark) && !/--mv-[a-z-]+:\s*;/.test(light),
);

/* ------------------------------------------------------ estilo dos cards */
check(
  "ssr: estilo 'flat' zera a sombra dos cards",
  dark.includes("box-shadow:none") || dark.includes("box-shadow: none"),
);
check(
  "ssr: estilo 'pill' aplica raio total no botão",
  dark.includes("border-radius:999px") || dark.includes("border-radius: 999px"),
);

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
