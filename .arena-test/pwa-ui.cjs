/**
 * Harness de UI do PWA (jsdom) — Etapa 12.
 *
 * O que se pode verificar sem aparelho de verdade: o convite aparece na hora
 * certa, some quando o usuário dispensa, não reaparece por 30 dias, e o texto
 * muda entre Android e iPhone. O que **não** se pode: o diálogo nativo de
 * instalação, o ícone na tela inicial e o comportamento do Safari — isso exige
 * aparelho (ver checklist no README).
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

// `lucide-react` é ESM e não carrega por `require` no harness. O stub abaixo
// exporta **nomes explícitos** (um Proxy não funciona com o interop de named
// imports do esbuild: os símbolos chegam como `undefined` e o React falha com
// "element type is invalid") e mantém o contrato de props que a acessibilidade
// verifica — `aria-hidden` e `className`.
fs.writeFileSync(
  path.join(__dirname, "build-pwa-icons.js"),
  `const React = require("react");
   const make = (name) => {
     const Icon = (props) => React.createElement("svg", { ...props, "data-icon": name });
     Icon.displayName = name;
     return Icon;
   };
   module.exports = {
     Download: make("Download"),
     Share: make("Share"),
     X: make("X"),
     RefreshCw: make("RefreshCw"),
   };`,
);

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-pwa-ui");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-pwa.tsx")],
  bundle: true,
  outfile: path.join(OUT, "pwa-ui.js"),
  platform: "browser",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "lucide-react": path.join(__dirname, "build-pwa-icons.js"),
  },
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  logLevel: "error",
});

/* ------------------------------------------------------------ ambiente */

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

let dom;

/**
 * Recria o DOM com o user agent do cenário.
 *
 * `navigator.userAgent` no jsdom (30+) é um getter **no protótipo** de
 * `Navigator` e ignora a opção `userAgent` do construtor: `defineProperty` no
 * objeto também não pega, porque a leitura sobe a cadeia. A única forma que
 * funciona é redefinir no protótipo — e sobrescrever o protótipo é global, então
 * também trocamos `platform`, `maxTouchPoints` e `standalone` no mesmo lugar.
 * Descobrir isso custou uma sessão de depuração com "HTML vazio", que não
 * aponta a causa.
 */
function createDom({ ua = ANDROID, standalone = false } = {}) {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://menuvo.app/app",
    pretendToBeVisual: true,
  });

  const navProto = Object.getPrototypeOf(dom.window.navigator);
  Object.defineProperty(navProto, "userAgent", { get: () => ua, configurable: true });
  Object.defineProperty(navProto, "platform", {
    get: () => (/iPhone|iPad|iPod/.test(ua) ? "iPhone" : /Macintosh/.test(ua) ? "MacIntel" : "Linux armv8l"),
    configurable: true,
  });
  Object.defineProperty(navProto, "maxTouchPoints", {
    get: () => (/iPhone|iPad|iPod|Android/.test(ua) ? 5 : 0),
    configurable: true,
  });
  Object.defineProperty(navProto, "standalone", {
    get: () => standalone,
    configurable: true,
  });

  dom.window.matchMedia = (query) => ({
    matches: standalone && query.includes("standalone"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });

  dom.window.requestIdleCallback ??= (cb) =>
    dom.window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 0);

  global.window = dom.window;
  global.document = dom.window.document;
  // `globalThis.navigator` é read-only no Node 22: atribuir não lança, mas não
  // muda nada — e o componente passa a ler o UA do Node ("Node.js/22"), o que
  // fazia todo cenário cair em `unknown` e o convite nunca aparecer. Definir a
  // propriedade é a forma que funciona.
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  global.self = dom.window;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.CustomEvent = dom.window.CustomEvent;
  global.localStorage = dom.window.localStorage;
  global.requestIdleCallback = dom.window.requestIdleCallback;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

createDom();

const lib = require(path.join(OUT, "pwa-ui.js"));
const React = lib.React;
const { act } = lib;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

const text = (node) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const buttonByText = (container, label) =>
  [...container.querySelectorAll("button")].find((b) => text(b).includes(label));

/* ------------------------------------------------------------- helpers */

/** storage de mentira, para controlar visitas e dispensa. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
    _data: data,
  };
}

/** Prepara um cenário limpo: DOM novo (com o UA certo) e body vazio. */
function setPlatform(ua, { standalone = false } = {}) {
  createDom({ ua, standalone });
  document.body.innerHTML = "";
}

const reset = () => {
  document.body.innerHTML = "";
};

/* ============ 1. Android: sem evento do navegador, sem convite ============ */

async function testAndroidWithoutEvent() {
  reset();
  setPlatform(ANDROID);

  const storage = fakeStorage({ "menuvo:visits": "1" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  check(
    "android: sem beforeinstallprompt não mostra convite",
    container.textContent.trim() === "",
    text(container),
  );

  await act(async () => root.unmount());
}

/* ============ 2. Android com evento: botão instala de verdade ============ */

async function testAndroidInstall() {
  reset();
  setPlatform(ANDROID);

  const storage = fakeStorage({ "menuvo:visits": "1" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  let prompted = 0;
  const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => {
    prompted++;
  };
  event.userChoice = Promise.resolve({ outcome: "accepted" });

  await act(async () => {
    dom.window.dispatchEvent(event);
  });
  await flush();

  check("android: convite aparece com o evento do navegador", text(container).includes("Instale o app"));
  check(
    "android: texto do escopo é exatamente o pedido",
    text(container).includes("Instale o app para acessar mais rápido."),
    text(container).slice(0, 60),
  );

  const installButton = buttonByText(container, "Instalar");
  check("android: oferece botão Instalar", Boolean(installButton));

  await act(async () => {
    installButton?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await flush();

  check("android: botão chama o prompt nativo", prompted === 1, String(prompted));
  check("android: convite some depois de instalar", container.textContent.trim() === "");

  await act(async () => root.unmount());
}

/* ================= 3. Android: recusa no diálogo do sistema ================= */

async function testAndroidDismissBySystem() {
  reset();
  setPlatform(ANDROID);

  const storage = fakeStorage({ "menuvo:visits": "1" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: "dismissed" });

  await act(async () => dom.window.dispatchEvent(event));
  await flush();

  await act(async () => {
    buttonByText(container, "Instalar")?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  await flush();

  check("android: recusa no diálogo conta como dispensa", container.textContent.trim() === "");
  check(
    "android: dispensa fica gravada com data",
    Number(storage.getItem("menuvo:install-dismissed-at")) > 0,
  );

  await act(async () => root.unmount());
}

/* ============================ 4. Botão "Agora não" ============================ */

async function testDismissButton() {
  reset();
  setPlatform(ANDROID);

  const storage = fakeStorage({ "menuvo:visits": "5" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  await act(async () => dom.window.dispatchEvent(event));
  await flush();

  const dismiss = buttonByText(container, "Agora não");
  check("dispensa: botão 'Agora não' existe", Boolean(dismiss));

  await act(async () => dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await flush();

  check("dispensa: convite desaparece ao dispensar", container.textContent.trim() === "");
  const stamp = Number(storage.getItem("menuvo:install-dismissed-at"));
  check("dispensa: data gravada para não repetir", stamp > 0);
  await act(async () => root.unmount());
}

/* ============================== 5. iPhone ============================== */

async function testIos() {
  reset();
  setPlatform(IPHONE);

  const storage = fakeStorage({ "menuvo:visits": "3" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  check("ios: convite aparece sem evento (Safari não dispara)", text(container).includes("Instale o app"));
  check(
    "ios: ensina o caminho do Safari",
    text(container).includes("Compartilhar") && text(container).includes("Tela de Início"),
    text(container),
  );
  check("ios: não oferece botão 'Instalar' falso", !buttonByText(container, "Instalar"));
  check("ios: oferece 'Entendi'", Boolean(buttonByText(container, "Entendi")));
  check("ios: permite dispensar", Boolean(buttonByText(container, "Agora não")));

  await act(async () =>
    buttonByText(container, "Entendi")?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    ),
  );
  await flush();

  check("ios: convite some ao entender", container.textContent.trim() === "");

  await act(async () => root.unmount());
}

/* ======================= 6. Já instalado / desktop ======================= */

async function testNoPromptCases() {
  reset();
  setPlatform(ANDROID, { standalone: true });

  const storage = fakeStorage({ "menuvo:visits": "9" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  await act(async () => dom.window.dispatchEvent(event));
  await flush();

  check("instalado: não convida quem já está em standalone", container.textContent.trim() === "");
  await act(async () => root.unmount());

  reset();
  setPlatform(DESKTOP);
  const desktopStorage = fakeStorage({ "menuvo:visits": "9" });
  const second = lib.mount(
    React.createElement(lib.components.InstallPrompt, { storage: desktopStorage }),
  );
  await flush();

  const desktopEvent = new dom.window.Event("beforeinstallprompt", { cancelable: true });
  desktopEvent.prompt = async () => {};
  desktopEvent.userChoice = Promise.resolve({ outcome: "accepted" });
  await act(async () => dom.window.dispatchEvent(desktopEvent));
  await flush();

  check("desktop: não convida no computador", second.container.textContent.trim() === "");
  await act(async () => second.root.unmount());
}

/* ==================== 7. Acessibilidade do convite ==================== */

async function testAccessibility() {
  reset();
  setPlatform(ANDROID);

  const storage = fakeStorage({ "menuvo:visits": "2" });
  const { container, root } = lib.mount(React.createElement(lib.components.InstallPrompt, { storage }));
  await flush();

  const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  await act(async () => dom.window.dispatchEvent(event));
  await flush();

  const aside = container.querySelector("aside");
  check("a11y: convite tem role=complementary", aside?.getAttribute("role") === "complementary");
  check("a11y: convite tem aria-label", Boolean(aside?.getAttribute("aria-label")));

  const close = container.querySelector('button[aria-label="Fechar sugestão de instalação"]');
  check("a11y: botão de fechar tem rótulo acessível", Boolean(close));

  const targets = [...container.querySelectorAll("button")].map((b) => b.className);
  check(
    "a11y: todos os botões têm alvo ≥ 44px",
    targets.length > 0 && targets.every((cls) => /min-h-11|size-11|min-h-\[/.test(cls)),
    targets.join(" | "),
  );

  check(
    "a11y: ícones decorativos marcados com aria-hidden",
    container.querySelectorAll("svg[aria-hidden='true']").length >= 1,
  );

  check(
    "layout: convite fica acima da navegação inferior",
    /bottom-\[calc\(4\.25rem\+env\(safe-area-inset-bottom\)\)\]/.test(
      aside?.className ?? "",
    ),
    aside?.className,
  );

  await act(async () => root.unmount());
}

/* ========================= 8. Aviso de atualização ========================= */

async function testUpdateToast() {
  reset();
  setPlatform(ANDROID);

  // Sem service worker registrado, o componente não pode quebrar a página.
  Object.defineProperty(dom.window.navigator, "serviceWorker", {
    value: undefined,
    configurable: true,
  });

  const { container, root } = lib.mount(React.createElement(lib.components.UpdateToast));
  await flush();

  check("atualização: sem service worker não renderiza nada", container.textContent.trim() === "");

  await act(async () => root.unmount());
}

/* ============================== relatório ============================== */

(async () => {
  await testAndroidWithoutEvent();
  await testAndroidInstall();
  await testAndroidDismissBySystem();
  await testDismissButton();
  await testIos();
  await testNoPromptCases();
  await testAccessibility();
  await testUpdateToast();

  const failures = results.filter((r) => !r.ok);
  console.log("");
  for (const r of failures) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  console.log(`\npwa-ui: ${results.length - failures.length}/${results.length} PASS\n`);
  process.exit(failures.length ? 1 : 0);
})();
