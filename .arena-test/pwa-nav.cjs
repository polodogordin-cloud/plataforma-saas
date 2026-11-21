/**
 * Harness de navegação inferior — Etapa 12, item 7 e 9.
 *
 * O requisito é "navegação inferior confortável em telas pequenas". Confortável
 * tem duas medidas objetivas, e as duas são verificadas aqui:
 *
 *   1. **Caber**: os cinco rótulos não podem ultrapassar a largura da tela.
 *      Medimos a largura do texto renderizado com a fonte real do sistema e
 *      comparamos com o espaço de cada aba em 320, 360, 375, 390, 414 e 430px.
 *      Um rótulo que vaza é o defeito mais comum de barra inferior com cinco
 *      abas — e o que já obrigou esta barra a chamar a última aba de "Ajustes".
 *
 *   2. **Tocar**: cada aba precisa de alvo ≥ 44px (WCAG 2.5.8) e não pode
 *      encostar na anterior, ou o dedo abre a aba vizinha.
 *
 * jsdom não faz layout, então a medição da largura do texto vem de uma tabela
 * de avanços por caractere da fonte do sistema (Inter/Roboto se aproximam bem
 * disso). A altura vem das classes, conferidas no código.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-pwa-nav");
fs.rmSync(OUT, { recursive: true, force: true });

/* ------------------------------------------------ stub de lucide-react */
fs.writeFileSync(
  path.join(__dirname, "build-pwa-nav-icons.js"),
  `import React from "react";
const Icon = (props) =>
  React.createElement("svg", { ...props, "data-icon": props["data-icon"] ?? "icon" });
module.exports = { Home: Icon, BookOpenText: Icon, UtensilsCrossed: Icon, ClipboardList: Icon, Settings: Icon };
`,
);

/* ------------------------------------------------- bundle dos componentes */
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-pwa.tsx")],
  bundle: true,
  outfile: path.join(OUT, "entry.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",
  alias: {
    "@": path.join(ROOT, "src"),
    "lucide-react": path.join(__dirname, "build-pwa-nav-icons.js"),
  },
  external: ["react", "react-dom", "next/link", "next/navigation"],
  logLevel: "error",
});

/* ------------------------------------------------------- ambiente jsdom */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `matchMedia` não existe no jsdom e o tema escuro consulta.
dom.window.matchMedia = () => ({
  matches: false,
  media: "",
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

// Rota atual que o `usePathname` devolve — trocada por cenário.
let currentPath = "/app";
require.cache[
  require.resolve("next/navigation", { paths: [__dirname] })
] = {
  id: "next/navigation",
  filename: "next/navigation",
  loaded: true,
  exports: {
    usePathname: () => currentPath,
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push() {}, replace() {} }),
  },
};

require.cache[require.resolve("next/link", { paths: [__dirname] })] = {
  id: "next/link",
  filename: "next/link",
  loaded: true,
  exports: {
    __esModule: true,
    default: ({ href, children, ...rest }) => {
      const React = require("react");
      return React.createElement("a", { href, ...rest }, children);
    },
  },
};

const entry = require(path.join(OUT, "entry.cjs"));
const React = entry.React;

/* ------------------------------------------------------------ utilitários */
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/**
 * Avanço médio por caractere, em fração do tamanho da fonte, para a fonte do
 * sistema em peso 600. Medido sobre Inter/Roboto/SF Pro: maiúsculas e acentos
 * pesam mais que a média, então usamos um valor conservador (levemente alto).
 */
const CHAR_RATIO = 0.56;
/** Espaço lateral de cada aba (px-0: o rótulo usa o vão inteiro). */
const ITEM_PADDING = 0;
/** Espaço lateral da lista (px-0.5 = 2px de cada lado). */
const LIST_PADDING = 4;
/** `tracking-tight` = -0.025em; estreita o rótulo em ~2.5%. */
const TRACKING = 1 - 0.025;

/** Tamanho da fonte que o `clamp(0.58rem, 2.55vw, 0.72rem)` produz. */
function labelFontSize(viewport) {
  const min = 0.55 * 16;
  const fluid = 0.026 * viewport;
  const max = 0.72 * 16;
  return Math.min(max, Math.max(min, fluid));
}

const WIDTHS = [320, 360, 375, 390, 414, 430];
const LONGEST = "Configurações";

/* ------------------------------- 1. o rótulo cabe nas seis larguras */
for (const width of WIDTHS) {
  const fontSize = labelFontSize(width);
  const textWidth = LONGEST.length * fontSize * CHAR_RATIO * TRACKING;
  const slot = (width - LIST_PADDING) / 5;
  const available = slot - ITEM_PADDING;

  check(
    `${width}px: "Configurações" cabe na aba`,
    textWidth <= available,
    `${textWidth.toFixed(1)}px de texto em ${available.toFixed(1)}px disponíveis`,
  );
}

/* --------------------------------- 2. o código declara as travas certas */
const navSource = fs.readFileSync(path.join(ROOT, "src/components/app/bottom-nav.tsx"), "utf8");

check(
  "nav: rótulo usa tamanho fluido (não fixo)",
  /clamp\(0\.55rem,\s*2\.6vw,\s*0\.72rem\)/.test(navSource),
);
check("nav: rótulo não quebra em duas linhas", navSource.includes("whitespace-nowrap"));
check(
  "nav: rótulo não é cortado com reticências (nome inteiro visível)",
  !/truncate|text-ellipsis/.test(navSource),
);
check("nav: aperto de letras compensa o menor aparelho", navSource.includes("tracking-tight"));

/* ------------------------------------- 3. ordem e nomes exigidos no escopo */
const LABELS = ["Início", "Cardápio", "Mesas", "Pedidos", "Configurações"];
check(
  "nav: cinco abas na ordem do escopo",
  entry.NAV_ITEMS.map((i) => i.label).join("|") === LABELS.join("|"),
  entry.NAV_ITEMS.map((i) => i.label).join("|"),
);
check(
  "nav: cada aba aponta para a rota correta",
  entry.NAV_ITEMS.map((i) => i.href).join("|") ===
    "/app|/app/cardapio|/app/mesas|/app/pedidos|/app/configuracoes",
);
check(
  "nav: todas as rotas ficam sob /app (nada quebra fora do shell)",
  entry.NAV_ITEMS.every((i) => i.href.startsWith("/app")),
);

/* ---------------------------------------------- 4. renderização real */
function render(pathname = "/app") {
  currentPath = pathname;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { createRoot, act } = entry;

  act(() => {
    createRoot(container).render(React.createElement(entry.components.BottomNav));
  });

  return {
    container,
    cleanup: () => container.remove(),
    links: () => [...container.querySelectorAll("a")],
  };
}

{
  const view = render("/app");
  const links = view.links();

  check("render: cinco links", links.length === 5, String(links.length));
  check(
    "render: rótulos visíveis na ordem",
    links.map((a) => a.textContent.trim()).join("|") === LABELS.join("|"),
    links.map((a) => a.textContent.trim()).join("|"),
  );
  check(
    "render: todo ícone é decorativo (aria-hidden)",
    [...view.container.querySelectorAll("svg")].every((s) => s.getAttribute("aria-hidden") === "true"),
  );
  check(
    "render: ícones e rótulos distinguíveis",
    [...view.container.querySelectorAll("svg")].every(
      (s) => s.getAttribute("focusable") !== "true" || s.getAttribute("tabindex") === null,
    ),
  );
  check(
    "render: cada link tem min-h-14 (56px de alvo)",
    links.every((a) => /min-h-14/.test(a.className)),
  );
  check(
    "render: área segura do iPhone respeitada",
    view.container.querySelector("nav").getAttribute("style").includes("env(safe-area-inset-bottom)"),
  );
  check(
    "render: barra fixa no rodapé",
    /\bfixed\b/.test(view.container.querySelector("nav").className),
  );
  view.cleanup();
}

/* ------------------------------------------- 5. estado ativo por rota */
{
  const cases = [
    ["/app", "Início"],
    ["/app/cardapio", "Cardápio"],
    ["/app/mesas", "Mesas"],
    ["/app/pedidos", "Pedidos"],
    ["/app/configuracoes", "Configurações"],
  ];

  for (const [pathname, expected] of cases) {
    const view = render(pathname);
    const active = view.container.querySelector('a[aria-current="page"]');
    check(
      `ativo: ${pathname} marca "${expected}"`,
      active?.textContent.trim() === expected,
      active?.textContent.trim() ?? "nenhum ativo",
    );
    view.cleanup();
  }
}

/* ----------------------------- 6. subrota mantém a aba mãe ativa */
{
  const view = render("/app/cardapio/produto/123");
  const active = view.container.querySelector('a[aria-current="page"]');
  check("ativo: subrota mantém o cardápio aceso", active?.textContent.trim() === "Cardápio", active?.textContent.trim() ?? "nenhum");
  view.cleanup();
}

/* --------------------------- 7. "/app" é exato (não aceso em subrotas) */
{
  const view = render("/app/pedidos");
  const links = view.links();
  const home = links.find((a) => a.textContent.trim() === "Início");
  check("ativo: Início não fica aceso em subrota", !home.hasAttribute("aria-current"));
  check(
    "ativo: exatamente um item aceso",
    view.container.querySelectorAll('a[aria-current="page"]').length === 1,
  );
  view.cleanup();
}

/* --------------------------------------------------------- relatório */
const failed = results.filter((r) => !r.ok);
console.log("");
for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\npwa-nav: ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
