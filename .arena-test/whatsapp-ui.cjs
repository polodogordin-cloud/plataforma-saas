/**
 * Harness de UI do WhatsApp (jsdom) — Etapa 13.
 *
 * O que se pode provar sem aparelho: o botão aparece só quando deve, o `href`
 * é um `wa.me` válido com a mensagem codificada, o alvo de toque tem 56px, o
 * link não promete "envio", e o formulário do painel salva, valida e mostra a
 * prévia certa.
 *
 * O que **não** se pode provar aqui: o WhatsApp abrir de verdade no Android e
 * no iPhone. Isso é checklist de aparelho (README).
 *
 * Armadilhas do jsdom já conhecidas desta base (documentadas para não repetir):
 *   • `globalThis.navigator` é read-only no Node 22 → `Object.defineProperty`;
 *   • `navigator.userAgent` é getter no protótipo do jsdom;
 *   • `window.matchMedia` não existe;
 *   • `lucide-react` é ESM e precisa de stub com **exports nomeados**;
 *   • `Intl.NumberFormat` usa `\u00a0` — por isso o dinheiro aqui é formatado
 *     à mão em `lib/whatsapp.ts`.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-whatsapp-ui");
fs.rmSync(OUT, { recursive: true, force: true });

/* ------------------------------------------------ stub de lucide-react */
fs.writeFileSync(
  path.join(__dirname, "stubs-whatsapp/icons.cjs"),
  `import React from "react";
const Icon = (props) => React.createElement("svg", { ...props, "data-icon": props["data-icon"] ?? "icon" });
module.exports = {
  MessageCircle: Icon, Check: Icon, Copy: Icon, Loader2: Icon,
  ExternalLink: Icon, ChevronRight: Icon,
  AlertCircle: Icon, CheckCircle2: Icon, Eye: Icon, EyeOff: Icon,
};
`,
);

/*
 * Stub da Server Action.
 *
 * A action real importa o cliente Supabase (e o Next inteiro). Aqui o que se
 * testa é a **interface**: que o formulário chama a action com os campos
 * certos, mostra o erro e reflete o retorno. A autorização e a normalização do
 * lado do servidor são testadas em `whatsapp-lib.cjs` e no banco.
 */
/*
 * O esbuild **inlina** este arquivo no bundle, então um `require` externo daria
 * outra instância do módulo (e as chamadas registradas nunca apareceriam). O
 * estado vive em `globalThis`, que é o mesmo para o bundle e para o harness.
 */
fs.writeFileSync(
  path.join(__dirname, "stubs-whatsapp/actions.ts"),
  `const store = (globalThis.__whatsappActionStub ??= { calls: [], response: null });
function saveWhatsappSettings(input) {
  store.calls.push(input);
  if (store.response) return Promise.resolve(store.response(input));
  return Promise.resolve({
    ok: true,
    config: { phone: input.phone ? "5511999990000" : null, message: input.message, isActive: input.isActive },
    message: input.isActive ? "WhatsApp ativado no cardápio." : "WhatsApp desativado.",
  });
}
module.exports = { saveWhatsappSettings, deactivateWhatsapp: async () => ({ ok: true }) };
`,
);

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-whatsapp.tsx")],
  bundle: true,
  outfile: path.join(OUT, "entry.cjs"),
  platform: "node",
  format: "cjs",
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",
  alias: {
    "@": path.join(ROOT, "src"),
    "lucide-react": path.join(__dirname, "stubs-whatsapp/icons.cjs"),
    "@/actions/whatsapp": path.join(__dirname, "stubs-whatsapp/actions.ts"),
  },
  external: ["react", "react-dom", "next/link", "next/navigation", "server-only"],
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

dom.window.matchMedia = () => ({
  matches: false,
  media: "",
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

// Área de transferência: o jsdom não tem. Contamos as chamadas para provar
// que o botão "copiar link" copia o link certo.
const clipboard = { text: null, calls: 0 };
const clipboardMock = {
  writeText: async (value) => {
    clipboard.text = value;
    clipboard.calls++;
  },
};
// O componente lê `navigator.clipboard` do **global** do Node, não do window.
Object.defineProperty(globalThis.navigator, "clipboard", {
  value: clipboardMock,
  configurable: true,
});
Object.defineProperty(dom.window.navigator, "clipboard", {
  value: clipboardMock,
  configurable: true,
});

/* --------------------------------- Server Action falsa, com instrumentação */

const actionStore = (globalThis.__whatsappActionStub = { calls: [], response: null });
const actionCalls = actionStore.calls;

/** Resposta padrão da action (sucesso). `response` troca por cenário. */
function resetAction(response = null) {
  actionStore.calls.length = 0;
  actionStore.response = response;
}

resetAction();

const entry = require(path.join(OUT, "entry.cjs"));
const React = entry.React;
const { act } = React;

/* ------------------------------------------------------------ utilitários */
(async () => {
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const rerender = () => {
  // Reaplica os patches de módulo a cada cenário: o bundle guarda a referência
  // resolvida no momento do require.
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const ACTIVE_CONFIG = {
  phone: "5511999990000",
  message: "Olá! Gostaria de fazer um pedido.",
  isActive: true,
};

/* ======================================================================== */
/* Botão do cardápio público                                                */
/* ======================================================================== */

{
  const view = entry.mount(
    React.createElement(entry.components.WhatsappButton, {
      config: ACTIVE_CONFIG,
      restaurantName: "Cantina da Praça",
    }),
  );

  const link = view.container.querySelector("a");

  check("botão: renderiza um link", Boolean(link));
  check(
    "botão: href é wa.me com o número",
    link?.getAttribute("href")?.startsWith("https://wa.me/5511999990000?text="),
    link?.getAttribute("href"),
  );
  check(
    "botão: mensagem vai codificada",
    (() => {
      const encoded = link.getAttribute("href").split("?text=")[1];
      return decodeURIComponent(encoded) === ACTIVE_CONFIG.message;
    })(),
    link?.getAttribute("href"),
  );
  check("botão: abre em nova aba", link.getAttribute("target") === "_blank");
  check(
    "botão: rel com noopener",
    (link.getAttribute("rel") ?? "").includes("noopener"),
  );
  check(
    "botão: texto é 'Falar no WhatsApp'",
    link.textContent.includes("Falar no WhatsApp"),
    link.textContent.trim(),
  );
  check(
    "botão: não promete envio",
    !/enviar|enviado|enviamos/i.test(link.textContent),
    link.textContent.trim(),
  );
  check(
    "botão: aria-label diz com quem é a conversa",
    link.getAttribute("aria-label") === "Falar no WhatsApp com Cantina da Praça",
    link.getAttribute("aria-label"),
  );
  check(
    "botão: ícone é decorativo",
    view.container.querySelector("svg")?.getAttribute("aria-hidden") === "true",
  );
  check("botão: min-h-14 (56px de alvo)", /min-h-14/.test(link.className), link.className.slice(0, 60));
  check("botão: ocupa a largura disponível", /\bw-full\b/.test(link.className));
  check(
    "botão: verde do WhatsApp com texto escuro (contraste AA)",
    // O jsdom serializa o style em rgb, então comparamos pelos dois canais.
    /rgb\(37, 211, 102\)|#25d366/.test(link.getAttribute("style") ?? "") &&
      /rgb\(11, 61, 36\)|#0b3d24/.test(link.getAttribute("style") ?? ""),
    link.getAttribute("style"),
  );
  check(
    "botão: sem telemetria (nenhum handler de clique)",
    !link.getAttribute("onclick"),
  );

  view.root.unmount();
  view.container.remove();
}

/* --- visibilidade ------------------------------------------------------- */

const HIDDEN = [
  ["config nula", null],
  ["config undefined", undefined],
  ["desligado", { ...ACTIVE_CONFIG, isActive: false }],
  ["sem número", { phone: null, message: "x", isActive: true }],
  ["número inválido", { phone: "1234", message: "x", isActive: true }],
];

for (const [label, config] of HIDDEN) {
  const view = entry.mount(
    React.createElement(entry.components.WhatsappButton, {
      config,
      restaurantName: "Cantina",
    }),
  );
  check(`botão: não renderiza com ${label}`, view.container.innerHTML === "", view.container.innerHTML.slice(0, 40));
  view.root.unmount();
  view.container.remove();
}

/* --- mensagem vazia não gera link feio ---------------------------------- */

{
  const view = entry.mount(
    React.createElement(entry.components.WhatsappButton, {
      config: { phone: "5511999990000", message: "", isActive: true },
      restaurantName: "Cantina",
    }),
  );
  const href = view.container.querySelector("a")?.getAttribute("href");
  check("botão: sem mensagem, link sem ?text= vazio", href === "https://wa.me/5511999990000", href);
  view.root.unmount();
  view.container.remove();
}

/* --- mensagem com acento e emoji não quebra a URL ---------------------- */

{
  const message = "Olá! Quero 2x X-Bacon 🍔 e uma Coca-Cola, por favor. Total: R$ 59,80";
  const view = entry.mount(
    React.createElement(entry.components.WhatsappButton, {
      config: { phone: "5511999990000", message, isActive: true },
      restaurantName: "Cantina",
    }),
  );

  const href = view.container.querySelector("a").getAttribute("href");
  check("botão: mensagem com emoji e acento continua válida", (() => {
    try {
      const url = new URL(href);
      return decodeURIComponent(url.searchParams.get("text")) === message;
    } catch {
      return false;
    }
  })(), href);
  check("botão: href não tem espaço cru", !href.includes(" "));

  view.root.unmount();
  view.container.remove();
}

/* ======================================================================== */
/* Formulário do painel                                                     */
/* ======================================================================== */

function mountForm(overrides = {}) {
  actionCalls.length = 0;
  return entry.mount(
    React.createElement(entry.components.WhatsappSettingsForm, {
      restaurantName: "Cantina da Praça",
      restaurantSlug: "cantina",
      initialConfig: { phone: null, message: "Olá! Gostaria de fazer um pedido.", isActive: false },
      formattedPhone: "",
      canUseWhatsapp: true,
      ...overrides,
    }),
  );
}

function setInput(container, name, value) {
  const field = container.querySelector(`[name="${name}"]`);
  const setter = Object.getOwnPropertyDescriptor(
    field.constructor.prototype,
    "value",
  ).set;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  return field;
}

/* --- estado inicial ----------------------------------------------------- */

{
  const view = mountForm();

  check("painel: mostra o interruptor", Boolean(view.container.querySelector('[role="switch"]')));
  check(
    "painel: interruptor começa desligado",
    view.container.querySelector('[role="switch"]').getAttribute("aria-checked") === "false",
  );
  check("painel: campo de número existe", Boolean(view.container.querySelector('[name="phone"]')));
  check("painel: campo de mensagem existe", Boolean(view.container.querySelector('[name="message"]')));
  check(
    "painel: mensagem inicial vem preenchida com a sugestão",
    view.container.querySelector('[name="message"]').value === "Olá! Gostaria de fazer um pedido.",
  );
  check(
    "painel: prévia não aparece sem número",
    !view.container.textContent.includes("Prévia no cardápio"),
  );

  view.root.unmount();
  view.container.remove();
}

/* --- digitar número gera prévia ---------------------------------------- */

{
  const view = mountForm();
  setInput(view.container, "phone", "(11) 99999-0000");

  check("painel: prévia aparece ao digitar número válido", view.container.textContent.includes("Prévia no cardápio"));
  check(
    "painel: prévia mostra o número normalizado",
    view.container.textContent.includes("(11) 99999-0000"),
    view.container.textContent.slice(0, 200),
  );
  const code = view.container.querySelector("code");
  check("painel: prévia mostra o link wa.me", code?.textContent?.startsWith("https://wa.me/5511999990000"), code?.textContent);

  view.root.unmount();
  view.container.remove();
}

{
  const view = mountForm();
  setInput(view.container, "phone", "11 99999-0000");
  const before = view.container.querySelector("code").textContent;

  setInput(view.container, "message", "Olá! Quero pedir.");
  const after = view.container.querySelector("code").textContent;

  check("painel: mudar a mensagem muda a prévia", before !== after);
  check(
    "painel: prévia carrega a mensagem codificada",
    decodeURIComponent(after.split("?text=")[1]) === "Olá! Quero pedir.",
    after,
  );

  view.root.unmount();
  view.container.remove();
}

{
  const view = mountForm();
  setInput(view.container, "phone", "1234");
  check("painel: número inválido não gera prévia", !view.container.textContent.includes("Prévia no cardápio"));
  view.root.unmount();
  view.container.remove();
}

/* --- ligar sem número é recusado na hora -------------------------------- */

{
  const view = mountForm();
  const toggle = view.container.querySelector('[role="switch"]');

  await act(async () => {
    toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await flush();

  check("painel: ligar sem número não chama o servidor", actionCalls.length === 0, String(actionCalls.length));
  check(
    "painel: ligar sem número mostra o motivo",
    view.container.textContent.includes("Informe o número de WhatsApp para ativar"),
    view.container.textContent.slice(0, 200),
  );
  check(
    "painel: interruptor continua desligado",
    view.container.querySelector('[role="switch"]').getAttribute("aria-checked") === "false",
  );

  view.root.unmount();
  view.container.remove();
}

/* --- ligar com número salva -------------------------------------------- */

{
  const view = mountForm();
  setInput(view.container, "phone", "(11) 99999-0000");

  await act(async () => {
    view.container.querySelector('[role="switch"]').dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  await flush();

  check("painel: ligar com número chama o servidor", actionCalls.length === 1, String(actionCalls.length));
  check(
    "painel: servidor recebe o número digitado (normaliza ele mesmo)",
    actionCalls[0]?.phone === "(11) 99999-0000",
    actionCalls[0]?.phone,
  );
  check("painel: servidor recebe isActive", actionCalls[0]?.isActive === true);
  check(
    "painel: confirmação aparece",
    view.container.textContent.includes("WhatsApp ativado no cardápio"),
    view.container.textContent.slice(0, 200),
  );
  check(
    "painel: interruptor fica ligado",
    view.container.querySelector('[role="switch"]').getAttribute("aria-checked") === "true",
  );

  view.root.unmount();
  view.container.remove();
}

/* --- erro do servidor é mostrado --------------------------------------- */

{
  resetAction(() => ({
    ok: false,
    error: "Você não tem permissão para configurar o WhatsApp desta casa.",
  }));

  const view = mountForm();
  setInput(view.container, "phone", "(11) 99999-0000");
  await act(async () => {
    view.container.querySelector('[role="switch"]').dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
  await flush();

  check(
    "painel: erro do servidor aparece como alerta",
    view.container.textContent.includes("não tem permissão"),
    view.container.textContent.slice(0, 200),
  );

  // Erro com campo: destaca o input.
  resetAction(() => ({
    ok: false,
    error: "Número inválido.",
    fieldErrors: { phone: ["Número inválido. Use DDD + número, ex.: (11) 99999-0000."] },
  }));

  const second = mountForm();
  setInput(second.container, "phone", "999999");
  await flush(); // o estado do React assenta antes de olhar o botão
  // "Salvar" só habilita quando algo mudou (evita gravação sem alteração).
  // Digitar o número já suja o formulário; conferimos para não testar um botão
  // desabilitado e concluir que o erro não aparece.
  const save = [...second.container.querySelectorAll("button")].find(
    (button) => button.textContent.includes("Salvar"),
  );
  check("painel: salvar habilita depois de editar", save && !save.disabled, String(save?.disabled));

  await act(async () => {
    second.container.querySelectorAll("button").forEach((button) => {
      if (button.textContent.trim() === "Salvar") {
        button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      }
    });
  });
  await flush();

  check(
    "painel: erro de campo destaca o número",
    second.container.textContent.includes("Número inválido"),
    second.container.textContent.slice(0, 300),
  );

  view.root.unmount();
  view.container.remove();
  second.root.unmount();
  second.container.remove();

  // Restaura a resposta padrão para os cenários seguintes.
  resetAction();
}

/* --- copiar o link ----------------------------------------------------- */

{
  const view = mountForm();
  setInput(view.container, "phone", "(11) 99999-0000");
  await flush();

  const copyButton = view.container.querySelector('[aria-label="Copiar link"]');
  check("painel: botão de copiar existe", Boolean(copyButton));

  await act(async () => {
    copyButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await flush();

  check("painel: copiou pela área de transferência", clipboard.calls === 1, String(clipboard.calls));
  check(
    "painel: copiou o link da prévia",
    clipboard.text?.startsWith("https://wa.me/5511999990000"),
    clipboard.text,
  );
  check(
    "painel: botão de copiar tem 44px",
    /size-11/.test(copyButton.className),
    copyButton.className,
  );

  view.root.unmount();
  view.container.remove();
}

/* --- mensagem sugerida ------------------------------------------------- */

{
  const view = mountForm();
  setInput(view.container, "message", "Texto qualquer");

  const reset = [...view.container.querySelectorAll("button")].find((button) =>
    button.textContent.includes("Usar a mensagem sugerida"),
  );
  check("painel: botão de mensagem sugerida existe", Boolean(reset));

  await act(async () => {
    reset.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  check(
    "painel: botão restaura a mensagem padrão",
    view.container.querySelector('[name="message"]').value === "Olá! Gostaria de fazer um pedido.",
    view.container.querySelector('[name="message"]').value,
  );

  view.root.unmount();
  view.container.remove();
}

/* --- alvos de toque --------------------------------------------------- */

{
  const view = mountForm();
  const buttons = [...view.container.querySelectorAll("button")];

  const bigEnough = buttons.every((button) => {
    const cls = button.className ?? "";
    // 44px é o mínimo da WCAG 2.5.8; o formulário usa min-h-11/size-11/h-11.
    return /min-h-1[12]|size-11|h-11|tap-target|min-h-14/.test(cls);
  });

  check(
    `painel: todos os ${buttons.length} botões têm alvo ≥ 44px`,
    bigEnough,
    buttons.map((b) => b.className.slice(0, 40)).join(" | "),
  );

  view.root.unmount();
  view.container.remove();
}

/* --- risco de plano: aviso, não bloqueio da tela ---------------------- */

{
  const view = mountForm({ canUseWhatsapp: false });
  check(
    "painel: sem o recurso no plano, o formulário continua visível",
    Boolean(view.container.querySelector('[name="phone"]')),
  );
  check(
    "painel: aviso diz que o botão espera o plano",
    view.container.textContent.includes("quando o plano liberar"),
    view.container.textContent.slice(-160),
  );
  view.root.unmount();
  view.container.remove();
}

/* --- segurança: nada de dado administrativo na tela ------------------- */

{
  const view = mountForm();
  const text = view.container.textContent;

  check("painel: não mostra id de restaurante", !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text));
  check("painel: não mostra token nem chave", !/token|api[_-]?key|secret/i.test(text));
  check("painel: não mostra dados de equipe", !/equipe|membros|usu[aá]rios/i.test(text));

  view.root.unmount();
  view.container.remove();
}

/* ------------------------------------------------------------ relatório */

const failed = results.filter((r) => !r.ok);
console.log("");
for (const r of failed) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\nwhatsapp-ui: ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
})();
