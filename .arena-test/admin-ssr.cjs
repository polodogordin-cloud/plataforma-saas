/**
 * Harness de renderização SSR do painel master — Etapa 10.
 *
 * O caminho real das telas é renderização no servidor. Aqui conferimos o HTML
 * que sai de fato:
 *   • as três mensagens públicas de indisponibilidade, com textos distintos;
 *   • a tela de bloqueio do restaurante suspenso;
 *   • cards de métrica com número, rótulo e link para o filtro;
 *   • selos com **texto** (não só cor), incluindo o ícone escondido de leitor.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-admin-ssr");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "entry-admin-ssr.tsx")],
  bundle: true,
  outfile: path.join(OUT, "admin-ssr.js"),
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

const page = require(path.join(OUT, "admin-ssr.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/* ------------------------- cardápio indisponível ------------------------- */

const suspended = page.renderMenuUnavailable("suspended", "Famintos");
const unpublished = page.renderMenuUnavailable("unpublished", "Pizzaria");
const table = page.renderMenuUnavailable("table");

check("ssr: suspenso gera HTML completo", suspended.length > 400, String(suspended.length));
check(
  "ssr: suspenso usa o título de indisponibilidade",
  suspended.includes("temporariamente indisponível"),
);
check("ssr: suspenso nomeia a casa", suspended.includes("Famintos"));
check(
  "ssr: suspenso não revela detalhes internos (motivo/pagamento)",
  !/pagamento|suspenso por/i.test(suspended),
);
check(
  "ssr: suspenso orienta o cliente a chamar atendente",
  suspended.includes("atendente"),
);
check(
  "ssr: as três mensagens são diferentes entre si",
  new Set([suspended, unpublished, table]).size === 3,
);
check(
  "ssr: não publicado tem seu próprio texto e convite a voltar",
  unpublished.includes("não publicado") && unpublished.includes("Volte mais tarde"),
);
check(
  "ssr: mesa mantém o texto de mesa (não culpa o restaurante)",
  table.includes("mesa não está disponível"),
);
check(
  "ssr: nenhuma das mensagens diz 'não encontrado'",
  ![suspended, unpublished, table].some((html) => /não encontrad/i.test(html)),
);

/* ----------------------- bloqueio do painel ----------------------- */

const notice = page.renderSuspendedNotice("Pendência de pagamento");
check("ssr: tela de bloqueio renderiza", notice.includes("Famintos está suspenso"));
check("ssr: bloqueio mostra o motivo informado pela plataforma", notice.includes("Pendência de pagamento"));
check("ssr: bloqueio informa que nada foi apagado", notice.includes("nada foi apagado"));
check(
  "ssr: bloqueio diz que só a plataforma reativa (evita ticket errado)",
  notice.includes("Só a equipe da plataforma"),
);

const noReason = page.renderSuspendedNotice(null);
check("ssr: sem motivo, o bloco de motivo desaparece", !noReason.includes("Motivo"));

/* --------------------------- métricas --------------------------- */

const metrics = page.renderMetrics();
check("ssr: métricas mostram os três rótulos", ["Restaurantes", "Suspensos", "Produtos"].every((l) => metrics.includes(l)));
check("ssr: métricas mostram os números", metrics.includes(">3<") && metrics.includes(">15<"));
check(
  "ssr: métrica com link aponta para a lista filtrada",
  metrics.includes('href="/admin/restaurantes?status=suspended"'),
);
check(
  "ssr: métrica sem link não vira âncora (nada de promessa de navegação)",
  metrics.split("<a ").length - 1 === 2,
  String(metrics.split("<a ").length - 1),
);
check("ssr: dica da métrica aparece", metrics.includes("Bloqueados pela plataforma"));

/* ---------------------------- selos ---------------------------- */

const badges = page.renderBadges();
for (const [status, label] of [
  ["published", "Ativo"],
  ["paused", "Pausado"],
  ["suspended", "Suspenso"],
  ["draft", "Rascunho"],
]) {
  check(`ssr: selo ${status} mostra "${label}" em texto`, badges.includes(label));
}
check(
  "ssr: ícone do selo é aria-hidden (leitor de tela não lê '⊘')",
  badges.includes('aria-hidden="true"'),
);
check(
  "ssr: suspenso é o único selo com vermelho",
  (badges.match(/bg-red-50/g) || []).length === 1,
  String((badges.match(/bg-red-50/g) || []).length),
);

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
