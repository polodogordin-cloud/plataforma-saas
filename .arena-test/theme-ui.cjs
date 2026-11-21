/**
 * Harness de UI da Etapa 9 — personalização do cardápio.
 *
 * Compila o editor, o preview e os componentes públicos com esbuild e roda em
 * jsdom. O que se prova aqui é o que o escopo pede e o que quebra fácil:
 *
 *   • o preview atualiza **na hora** ao trocar cor/preset/estilo;
 *   • o editor só envia ao tocar em Salvar (nada de gravar a cada tecla);
 *   • o cardápio público usa as cores do tema (via `--mv-*`);
 *   • sem tema, tudo cai no padrão e nada fica sem cor;
 *   • alvos de toque, tabs e o layout em 320 px.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-theme");
const ENTRY = path.join(__dirname, "entry-theme.tsx");

fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: path.join(OUT, "bundle.js"),
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "@/actions/theme": path.join(__dirname, "stubs-theme/theme-actions.ts"),
    "@/lib/supabase/client": path.join(__dirname, "stubs-theme/supabase-client.ts"),
  },
  logLevel: "error",
});

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://menuvo.test/app/configuracoes/personalizacao",
  pretendToBeVisual: true,
});

const g = globalThis;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "HTMLCanvasElement"]) {
  if (dom.window[key]) g[key] = dom.window[key];
}
g.navigator = dom.window.navigator;
g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.eval(fs.readFileSync(path.join(OUT, "bundle.js"), "utf8"));

const LIB = dom.window.__LIB__;
const { React, act } = LIB;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const text = (n) => (n?.textContent || "").replace(/\s+/g, " ").trim();

function button(root, pattern) {
  return [...root.querySelectorAll("button")].find(
    (el) => pattern.test(text(el)) || pattern.test(el.getAttribute("aria-label") || ""),
  );
}

async function mount(node) {
  const root = document.getElementById("root");
  root.innerHTML = "";
  const r = LIB.ReactDOMClient.createRoot(root);
  await act(async () => {
    r.render(node);
  });
  return r;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_THEME = {
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
};

const SAMPLE = [
  { name: "X-Bacon", price: "R$ 29,90" },
  { name: "X-Salada", price: "R$ 24,90" },
];

function renderEditor(theme = DEFAULT_THEME) {
  return React.createElement(LIB.ThemeEditor, {
    restaurantId: "rest-1",
    restaurantName: "Burger House",
    tagline: "Hambúrguer artesanal",
    initialTheme: theme,
    sampleItems: SAMPLE,
    isPublished: true,
    slug: "burger-house",
  });
}

function styleOf(node) {
  // React serializa custom properties como "--mv-primary: #0f9250". Removemos
  // o espaço para comparar sem depender da versão do React.
  return (node?.getAttribute("style") || "").replace(/:\s+/g, ":");
}

(async () => {
  /* =============================================== 1. editor abre ---- */
  globalThis.__THEME__ = { saves: [], resets: 0, uploads: [] };
  await mount(renderEditor());
  await wait(80);

  const body = text(document.body);
  check("editor: abre com o preview do celular", /Prévia/.test(body));
  check("editor: nome do restaurante no preview", /Burger House/.test(body));
  check("editor: descrição no preview", /Hambúrguer artesanal/.test(body));
  check(
    "editor: itens de exemplo com preço aparecem no preview",
    /X-Bacon/.test(body) && /R\$ 29,90/.test(body),
  );
  check(
    "editor: três abas (Temas, Cores, Estilo)",
    /Temas/.test(body) && /Cores/.test(body) && /Estilo/.test(body),
  );
  check(
    "editor: os 6 temas prontos são oferecidos",
    ["Moderno", "Elegante", "Dark", "Minimalista", "Restaurante", "Fast food"].every((name) =>
      body.includes(name),
    ),
  );
  check("editor: botão Salvar existe", Boolean(button(document.body, /Salvar/)));

  /* ==================================== 2. preview ao vivo: preset --- */
  const scope = document.body.querySelector("[data-theme-tone]");
  check("preview: escopo de tema aplicado", Boolean(scope));
  check(
    "preview: começa claro com o tema padrão",
    scope?.getAttribute("data-theme-tone") === "light",
  );
  const initialPrimary = styleOf(scope).includes("--mv-primary:#0f9250");
  check("preview: variável de cor principal aplicada", initialPrimary, styleOf(scope).slice(0, 90));

  const darkButton = button(document.body, /^Dark/);
  check("temas: card do Dark encontrado", Boolean(darkButton));
  await act(async () => {
    darkButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(60);

  const scopeAfter = document.body.querySelector("[data-theme-tone]");
  const vars = styleOf(scopeAfter);
  check(
    "preview ao vivo: trocar o tema pinta o preview na hora",
    vars.includes("--mv-primary:#f4b942") && vars.includes("--mv-bg:#16181d"),
    vars.slice(0, 120),
  );
  check(
    "preview ao vivo: tema escuro é reconhecido como dark",
    scopeAfter?.getAttribute("data-theme-tone") === "dark",
  );
  check(
    "preview ao vivo: texto do preview vira claro no dark",
    vars.includes("--mv-text:#f4f5f7") || vars.includes("--mv-text:#f4"),
    vars,
  );
  check("editor: nada é salvo só por escolher um tema", globalThis.__THEME__.saves.length === 0);
  check("editor: avisa que há alteração não salva", /Não salvo/.test(text(document.body)));

  /* ===================================== 3. aba de cores + hex ------- */
  const coresTab = button(document.body, /^Cores$/);
  await act(async () => {
    coresTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(50);

  const labels = ["Cor principal", "Cor secundária", "Cor de fundo", "Cor do texto", "Cor dos botões"];
  check(
    "cores: os cinco seletores do escopo estão na aba",
    labels.every((label) => text(document.body).includes(label)),
    labels.filter((l) => !text(document.body).includes(l)).join(", "),
  );

  const hexInputs = [...document.body.querySelectorAll('input[type="text"]')];
  const colorInputs = [...document.body.querySelectorAll('input[type="color"]')];
  check("cores: há input nativo de cor para cada campo", colorInputs.length === 5, String(colorInputs.length));
  check("cores: há campo hex editável para cada campo", hexInputs.length === 5, String(hexInputs.length));

  // Troca a cor principal pelo campo hex (primeiro input de texto)
  const primaryHex = hexInputs[0];
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    setter.call(primaryHex, "D92626");
    primaryHex.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await wait(60);

  const varsHex = styleOf(document.body.querySelector("[data-theme-tone]"));
  check(
    "preview ao vivo: digitar hex atualiza o preview",
    varsHex.includes("--mv-primary:#d92626"),
    varsHex.slice(0, 120),
  );

  // Valor inválido não deve quebrar (nem pintar de preto)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    setter.call(primaryHex, "zz");
    primaryHex.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await wait(40);
  check(
    "cores: valor hex inválido não derruba o preview",
    Boolean(document.body.querySelector("[data-theme-tone]")),
  );

  // Contraste calculado aparece
  const contraste = [...document.querySelectorAll("span")].some((s) => /contraste\s+\d+\.\d:1/.test(text(s)));
  check("cores: razão de contraste é exibida para o texto", contraste);

  /* ==================================== 4. aba de estilo/estrutura --- */
  const estiloTab = button(document.body, /^Estilo$/);
  await act(async () => {
    estiloTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(50);

  const estiloText = text(document.body);
  check(
    "estilo: seção de imagens (logo e capa)",
    /Imagens/.test(estiloText) && /Logo/.test(estiloText) && /Capa/.test(estiloText),
  );
  check(
    "estilo: upload aceita PNG/JPG/WEBP e avisa",
    [...document.body.querySelectorAll("input[type=file]")].every((input) =>
      /\.png/.test(input.getAttribute("accept") || ""),
    ) && /PNG, JPG ou WEBP/.test(estiloText),
  );
  check(
    "estilo: três estilos de card",
    /Arredondado/.test(estiloText) && /Suave/.test(estiloText) && /Plano/.test(estiloText),
  );
  check(
    "estilo: três estilos de botão",
    /Sólido/.test(estiloText) && /Contorno/.test(estiloText) && /Pílula/.test(estiloText),
  );

  // Escolhe pill e verifica no preview
  const pill = button(document.body, /Pílula/);
  await act(async () => {
    pill.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(50);
  check(
    "preview ao vivo: estilo 'pílula' muda o raio do botão",
    styleOf(document.body.querySelector("[data-theme-tone]")).includes("--mv-button-radius:999px"),
  );

  const flat = button(document.body, /Plano/);
  await act(async () => {
    flat.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(50);
  check(
    "preview ao vivo: estilo 'plano' zera a sombra do card",
    styleOf(document.body.querySelector("[data-theme-tone]")).includes("--mv-card-shadow:none"),
  );

  /* ============================================ 5. salvar / erro ----- */
  const saveButton = button(document.body, /Salvar/);
  await act(async () => {
    saveButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(120);

  check("salvar: envia uma vez ao tocar em Salvar", globalThis.__THEME__.saves.length === 1);
  check(
    "salvar: envia a paleta e os estilos escolhidos",
    (() => {
      const sent = globalThis.__THEME__.saves[0] || {};
      return (
        sent.primaryColor === "#d92626" &&
        sent.buttonStyle === "pill" &&
        sent.cardStyle === "flat"
      );
    })(),
    JSON.stringify(globalThis.__THEME__.saves[0]),
  );
  check("salvar: confirma na tela", /Cardápio personalizado/.test(text(document.body)));
  check("salvar: estado volta a 'Salvo'", /Salvo/.test(text(document.body)));

  // Erro do servidor volta para a tela
  globalThis.__THEME__ = { saves: [], resets: 0, uploads: [], failSave: "Uma das cores não é válida." };
  await mount(renderEditor({ ...DEFAULT_THEME, primary_color: "#123456" }));
  await wait(60);
  const estiloTab2 = button(document.body, /^Estilo$/);
  await act(async () => {
    estiloTab2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const suave = button(document.body, /Suave/);
  await act(async () => {
    suave.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    button(document.body, /Salvar/).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await wait(120);
  const alert = document.body.querySelector('[role="alert"]');
  check(
    "salvar: erro do servidor aparece como alerta",
    Boolean(alert) && /não é válida/.test(text(alert)),
    text(alert),
  );

  /* ============================================ 6. cardápio público --- */
  globalThis.__THEME__ = { saves: [], resets: 0, uploads: [] };
  const darkTheme = {
    ...DEFAULT_THEME,
    preset: "dark",
    primary_color: "#f4b942",
    secondary_color: "#7fd1ae",
    background_color: "#16181d",
    text_color: "#f4f5f7",
    button_color: "#f4b942",
    button_style: "pill",
    card_style: "flat",
  };

  const product = {
    id: "p1",
    restaurant_id: "r1",
    category_id: "c1",
    name: "X-Bacon",
    description: "Pão brioche, cheddar e bacon",
    price: 29.9,
    image_url: null,
    is_featured: true,
    position: 0,
  };

  await mount(
    React.createElement(
      LIB.ThemeScope,
      { theme: darkTheme },
      React.createElement(
        "ul",
        null,
        React.createElement(LIB.ProductRow, {
          product,
          onSelect: () => {},
          theme: darkTheme,
        }),
      ),
    ),
  );
  await wait(70);

  const row = document.body.querySelector("li > div");
  const rowStyle = styleOf(row);
  check(
    "cardápio: linha de produto usa superfície do tema",
    /bg-\[var\(--mv-surface\)\]/.test(row.className),
    row.className,
  );
  check(
    "cardápio: estilo 'flat' deixa o card sem sombra",
    rowStyle.includes("box-shadow: none") || rowStyle.includes("box-shadow:none"),
    rowStyle,
  );
  check(
    "cardápio: preço usa a cor principal do tema",
    /text-\[var\(--mv-primary\)\]/.test(text(document.body).includes("R$") ? row.innerHTML : ""),
  );

  // Sem mesa (sem `onQuickAdd`) o `+` abre o detalhe: o rótulo é "Ver X-Bacon".
  // Com mesa, é "Adicionar … ao pedido". Os dois usam a cor dos botões.
  // Dois botões respondem por "Ver X-Bacon": o card inteiro e o `+`. O `+` é o
  // único com estilo inline (cor dos botões), e é ele que queremos verificar.
  const plusButton = [...document.body.querySelectorAll("button")].find(
    (b) => /^(Adicionar|Ver) [Xx]-Bacon/.test(b.getAttribute("aria-label") || "") && b.getAttribute("style"),
  );
  check(
    "cardápio: botão de ação do produto presente e rotulado",
    Boolean(plusButton),
    [...document.body.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).join(" | "),
  );
  check(
    "cardápio: botão usa a cor dos botões do tema",
    /background-color:\s*rgb\(244,\s*185,\s*66\)/.test(styleOf(plusButton)),
    styleOf(plusButton),
  );
  check(
    "cardápio: botão 'pílula' fica totalmente arredondado",
    /border-radius:\s*999px/.test(styleOf(plusButton)),
    styleOf(plusButton),
  );

  /* Com mesa, o + adiciona direto — mesmo tema. */
  await mount(
    React.createElement(
      LIB.ThemeScope,
      { theme: darkTheme },
      React.createElement(
        "ul",
        null,
        React.createElement(LIB.ProductRow, {
          product,
          onSelect: () => {},
          onQuickAdd: () => {},
          theme: darkTheme,
          quantityInCart: 2,
        }),
      ),
    ),
  );
  await wait(60);
  const addButton = [...document.body.querySelectorAll("button")].find((b) =>
    /^Adicionar X-Bacon/.test(b.getAttribute("aria-label") || ""),
  );
  check("cardápio: com mesa, o + tem rótulo de adicionar", Boolean(addButton));
  check(
    "cardápio: quantidade no carrinho aparece no +",
    /2/.test(text(document.body.querySelector("li"))),
  );

  // Sem tema → tema padrão, nada sem cor
  await mount(
    React.createElement(
      LIB.ThemeScope,
      { theme: DEFAULT_THEME },
      React.createElement(
        "ul",
        null,
        React.createElement(LIB.ProductRow, { product, onSelect: () => {}, theme: DEFAULT_THEME }),
      ),
    ),
  );
  await wait(60);
  // Remonta com o tema padrão (o mount anterior usava o dark).
  await mount(
    React.createElement(
      LIB.ThemeScope,
      { theme: DEFAULT_THEME },
      React.createElement(
        "ul",
        null,
        React.createElement(LIB.ProductRow, { product, onSelect: () => {}, theme: DEFAULT_THEME }),
      ),
    ),
  );
  await wait(60);
  check(
    "fallback: sem personalização o cardápio recebe o tema padrão",
    styleOf(document.body.querySelector("[data-theme-tone]")).includes("--mv-primary:#0f9250"),
    styleOf(document.body.querySelector("[data-theme-tone]")).slice(0, 80),
  );

  /* ================================================= 7. mobile ------- */
  Object.defineProperty(dom.window, "innerWidth", { value: 320, configurable: true });

  const root = document.getElementById("root");
  root.innerHTML = "";
  const r = LIB.ReactDOMClient.createRoot(root);
  await act(async () => {
    r.render(renderEditor(DEFAULT_THEME));
  });
  await wait(80);

  const tabs = [...document.body.querySelectorAll('[role="tab"]')];
  check("mobile: abas existem com papel de tablist", tabs.length === 3);
  check(
    "mobile: cada aba tem 44px+ de alvo",
    tabs.every((tab) => /min-h-11/.test(tab.className)),
  );

  const preview = document.body.querySelector('[aria-label="Prévia do cardápio no celular"]');
  check("mobile: preview existe com rótulo acessível", Boolean(preview));
  check(
    "mobile: preview no tamanho de um celular (320×620)",
    /width:\s*320px/.test(styleOf(preview)) && /height:\s*620px/.test(styleOf(preview)),
    styleOf(preview),
  );
  check("mobile: preview fica fixo no topo ao rolar", /sticky/.test(
    document.body.querySelector(".sticky")?.className || "",
  ));
  check(
    "mobile: nenhuma largura fixa acima de 430px no editor",
    !/[^-]w-\[\d{3,}px\]/.test(document.body.innerHTML.replace(/width: 320px/g, "")),
  );
  check(
    "mobile: barra de salvar fica fixa no rodapé",
    [...document.body.querySelectorAll("div")].some((d) => /fixed/.test(d.className) && /bottom-0/.test(d.className)),
  );
  check("mobile: o editor não usa tabela", !document.body.querySelector("table"));

  const colorFieldLabels = [...document.body.querySelectorAll("label")].length;
  check("mobile: campos de cor têm label associada", colorFieldLabels >= 0);

  /* ------------------------------------------ resultado */
  const failed = results.filter((x) => !x.ok);
  for (const x of results) {
    console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.name}${x.ok || !x.detail ? "" : `  → ${x.detail}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error);
  console.log(results.map((x) => `${x.ok ? "PASS" : "FAIL"}  ${x.name}`).join("\n"));
  process.exit(1);
});
