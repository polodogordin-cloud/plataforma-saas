/**
 * Harness de renderização SSR da cobrança por PIX — Etapa 19.
 *
 * O caminho real das telas é server-side. Aqui conferimos o HTML que sai:
 * o estado do pagamento em texto (não só cor), a chave PIX copiável, a frase
 * de confirmação manual e o aviso de "plano vence em X dias".
 *
 * Rodar: node .arena-test/payments-ssr.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-payments-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-payments-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "payments-ssr.js"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "next/link": path.join(__dirname, "stubs-admin/next-link.tsx"),
    // Os componentes usados aqui importam as Server Actions; sem o stub o
    // bundle arrastaria `next/cache` e o Supabase inteiro.
    "@/actions/subscription-payments": path.join(
      __dirname,
      "stubs-payments/subscription-payments-actions.ts",
    ),
    "@/lib/supabase/client": path.join(__dirname, "stubs-payments/supabase-client.ts"),
  },
  // `server-only` também precisa ficar de fora: o módulo lança de propósito
  // quando é carregado em cliente/teste.
  external: ["react", "react-dom", "react-dom/server", "server-only"],
  logLevel: "error",
});

const page = require(path.join(OUT, "payments-ssr.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const text = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");

/* ============================ 1. Estados ============================ */

const active = page.renderStatus();
check("ssr: planalto ativo mostra 'Plano ativo'", /Plano ativo/.test(text(active)), text(active).slice(0, 120));
check("ssr: ativo não pede pagamento", !/aguardando confirmação/i.test(text(active)));

const pending = page.renderStatus({ pending: page.fixtures.pendingRequest });
const pendingText = text(pending);
check("ssr: pendente diz que aguarda confirmação", /aguardando confirmação/i.test(pendingText), pendingText);
check("ssr: pendente mostra plano e valor", /Profissional/.test(pendingText) && /99,90/.test(pendingText));
check("ssr: pendente informa que o comprovante não foi enviado", /Nenhum comprovante/.test(pendingText));
check("ssr: pendente avisa que depende da conferência", /conferência manual/i.test(pendingText));

const expiring = page.renderStatus({
  subscription: { ...page.fixtures.base.subscription, days_left: 3 },
});
check("ssr: vencendo mostra os dias", /vence em 3 dias/i.test(text(expiring)), text(expiring));

const expired = page.renderStatus({
  subscription: { ...page.fixtures.base.subscription, status: "expired", days_left: 0 },
});
check("ssr: expirado diz que expirou", /expirou/i.test(text(expired)));
check("ssr: expirado orienta pagar de novo", /PIX/i.test(text(expired)));

const none = page.renderNoPanel();
check("ssr: sem painel convida a escolher plano", /Escolha um plano/i.test(text(none)));

const confirmed = page.renderStatus({ pending: null }, true);
check("ssr: recém-confirmado diz 'Pagamento confirmado'", /Pagamento confirmado/i.test(text(confirmed)));
check(
  "ssr: recém-confirmado mostra a data final do período",
  /01\/12\/2026/.test(text(confirmed)),
  text(confirmed).slice(0, 200),
);

/* ============================ 2. PIX ============================ */

const pix = page.renderPix();
const pixText = text(pix);
check("ssr: PIX mostra a chave", pixText.includes("12.345.678/0001-90"));
check("ssr: PIX mostra o recebedor", pixText.includes("Menuvo Tecnologia ME"));
check("ssr: PIX mostra o valor", /99,90/.test(pixText));
check("ssr: PIX lista os três passos", /Abrir o app|Abra o app/i.test(pixText) && /comprovante/i.test(pixText));
check("ssr: PIX avisa que a confirmação é manual", /confirmação é manual/i.test(pixText));
check("ssr: PIX renderiza o QR Code quando existe", /<img/.test(pix) && /QR Code/i.test(pixText));
check("ssr: PIX tem botão de copiar com rótulo acessível", /aria-label="Copiar chave PIX"/.test(pix));
check("ssr: PIX não expõe credencial", !/token|secret|service_role/i.test(pix));

const pixOff = page.renderPix({
  is_active: false,
  is_configured: false,
  recipient_name: null,
  pix_key: null,
  pix_key_type: null,
  instructions: null,
  qr_code_url: null,
});
check("ssr: PIX desligado não mostra chave", !/12\.345/.test(text(pixOff)) && /indisponível/i.test(text(pixOff)));

/* ============================ 3. Histórico ============================ */

const history = page.renderHistory([
  { ...page.fixtures.pendingRequest, status: "CONFIRMED", confirmed_at: "2026-11-21T10:00:00Z" },
  { ...page.fixtures.pendingRequest, status: "REJECTED", rejection_reason: "Valor divergente" },
]);
const historyText = text(history);
check("ssr: histórico mostra confirmado em texto", /Pagamento confirmado/.test(historyText));
check("ssr: histórico mostra rejeitado em texto", /rejeitado/i.test(historyText));
check("ssr: histórico mostra o motivo", /Valor divergente/.test(historyText));
check("ssr: histórico é lista, não tabela", history.startsWith("<ul") && !history.includes("<table"));

check("ssr: histórico vazio tem mensagem própria", /Nenhum pagamento anterior/i.test(text(page.renderHistory([]))));

/* ============================ 4. Selos ============================ */

check("ssr: selo PIX ativo tem texto", /PIX ativo/.test(text(page.renderBadge(true))));
check("ssr: selo sem dados não inventa status", /não verificado/i.test(text(page.renderBadge(false))));
check("ssr: selo de assinatura continua funcionando", /Ativa/.test(text(page.renderSubscriptionBadge("active"))));

/* ============================ Resultado ============================ */

const passed = results.filter((r) => r.ok).length;
console.log("");
for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\npayments-ssr: ${passed}/${results.length} PASS\n`);
process.exit(passed === results.length ? 0 : 1);
