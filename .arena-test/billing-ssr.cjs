/**
 * Harness de renderização SSR de planos/assinaturas — Etapa 11.
 *
 * O caminho real das telas é server-side. Aqui conferimos o HTML que sai:
 *   • card de plano com preço, recursos e CTA (sem tabela de comparação);
 *   • limites nulos escritos como "sem limite";
 *   • barra de uso com `aria-valuenow` coerente com o número escrito;
 *   • aviso de limite com link de saída;
 *   • tela de assinatura sem acesso com texto e ação diferentes por estado.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-billing-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-billing-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "billing-ssr.js"),
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@": path.join(ROOT, "src"),
    "next/link": path.join(__dirname, "stubs-admin/next-link.tsx"),
  },
  external: ["react", "react-dom", "lucide-react"],
  logLevel: "error",
});

const page = require(path.join(OUT, "billing-ssr.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/* ------------------------------ card de plano ------------------------------ */

const card = page.renderPlanCard();
const cardText = text(card);

check("ssr: card gera HTML completo", card.length > 500, String(card.length));
check("ssr: card é <li> dentro de lista (vertical, não tabela)", card.startsWith("<ul>") && card.includes("<li") && !card.includes("<table"));
check("ssr: nome do plano visível", cardText.includes("Profissional"));
check("ssr: preço em reais", cardText.includes("R$ 99,90"));
check("ssr: sufixo por mês", cardText.includes("por mês"));
check("ssr: recursos em português", cardText.includes("Etiquetas NFC") && cardText.includes("Chamar garçom"));
check("ssr: CTA presente", cardText.includes("Começar agora"));
check("ssr: destaque com selo textual", cardText.includes("Mais escolhido"));
check("ssr: limite no rodapé", cardText.includes("Mesas") && cardText.includes("50"));

const freeCard = page.renderPlanCard({ price: 0 });
check("ssr: plano grátis escreve 'Grátis' e não R$ 0,00", text(freeCard).includes("Grátis") && !text(freeCard).includes("R$ 0,00"));

/* -------------------------------- recursos -------------------------------- */

const features = page.renderFeatures(["nfc", "qr_code", "coisa_nova"]);
check("ssr: recurso listado com ✓ acessível", features.includes('aria-hidden="true"') && text(features).includes("Etiquetas NFC"));
check("ssr: chave crua é filtrada da lista", !text(features).includes("coisa_nova"));

const featuresEmpty = page.renderFeatures([]);
check("ssr: plano sem recursos não quebra", featuresEmpty.includes("<ul") && text(featuresEmpty).trim() === "");

/* --------------------------------- preço --------------------------------- */

check("ssr: preço anual usa 'por ano'", text(page.renderPrice(999, "yearly")).includes("por ano"));
check("ssr: preço zero vira 'Grátis'", text(page.renderPrice(0)).includes("Grátis"));

/* --------------------------------- selos --------------------------------- */

for (const [status, label] of [
  ["trial", "Em teste"],
  ["active", "Ativa"],
  ["past_due", "Pagamento atrasado"],
  ["cancelled", "Cancelada"],
  ["expired", "Expirada"],
  ["suspended", "Suspensa"],
]) {
  check(`ssr: selo de ${status} mostra '${label}'`, text(page.renderBadge(status)).includes(label));
}

/* ------------------------------- barras --------------------------------- */

const meterOk = page.renderMeter(8, 10);
check("ssr: barra mostra '8 de 10'", text(meterOk).includes("8 de 10"));
check("ssr: barra tem role=progressbar", meterOk.includes('role="progressbar"'));
check("ssr: barra informa percentual em aria-valuenow", meterOk.includes('aria-valuenow="80"'), meterOk);
check("ssr: barra tem rótulo acessível", meterOk.includes("aria-label=") && meterOk.includes("Mesas"));

const meterFull = page.renderMeter(10, 10);
check("ssr: barra cheia em 100", meterFull.includes('aria-valuenow="100"'));
check("ssr: barra cheia usa vermelho", meterFull.includes("bg-red-500"));

const meterNoLimit = page.renderMeter(120, null);
check("ssr: sem limite escreve '120 · sem limite'", text(meterNoLimit).includes("120 · sem limite"), text(meterNoLimit));
check("ssr: sem limite a barra fica em 0 (não mente)", meterNoLimit.includes('aria-valuenow="0"'));
check("ssr: sem limite mostra a legenda", text(meterNoLimit).includes("Sem limite neste plano"));

/* --------------------------- aviso de limite ----------------------------- */

const notice = page.renderLimitNotice();
check("ssr: aviso é role=alert", notice.includes('role="alert"'));
check("ssr: aviso repete a frase do escopo", text(notice).includes("Seu plano atingiu o limite de mesas."));
check("ssr: aviso tem link para /planos", notice.includes('href="/planos"'));
check("ssr: aviso tem botão 'Ver planos'", text(notice).includes("Ver planos"));

/* --------------------- tela de assinatura sem acesso --------------------- */

const expired = page.renderSubscriptionNotice("expired");
const cancelled = page.renderSubscriptionNotice("cancelled");

check("ssr: expirada tem título próprio", text(expired).includes("Seu período de acesso terminou"));
check("ssr: cancelada tem título diferente", text(cancelled).includes("Sua assinatura está cancelada"));
check("ssr: expirada cita a data de fim", text(expired).includes("2026"));
check("ssr: expirada tranquiliza sobre os dados", text(expired).includes("continuam salvos"));
check("ssr: tela leva para /planos", expired.includes('href="/planos"') && cancelled.includes('href="/planos"'));
check("ssr: tela não é um 404 seco", !text(expired).toLowerCase().includes("não encontrado"));
check("ssr: cancelada explica o que continua no ar", text(cancelled).includes("cardápio público"));

/* ------------------------------ relatório ------------------------------ */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail.slice(0, 200)}` : ""}`);
}
console.log(`\nbilling-ssr: ${results.length - failed.length}/${results.length} PASS\n`);
process.exit(failed.length ? 1 : 0);
