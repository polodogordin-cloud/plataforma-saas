/**
 * Harness de layout — a barra inferior cabe em 320px?
 *
 * Este teste existe por um motivo específico: a primeira versão da fonte fluida
 * da `BottomNav` foi escolhida por **estimativa** ("~0.55 em por caractere"), e
 * a estimativa errou. Nada no app quebrava — não há erro de runtime, não há
 * aviso no console. O sintoma era silencioso: com `whitespace-nowrap`, o rótulo
 * "Configurações" passava do slot e empurrava a barra, criando rolagem
 * horizontal no app inteiro em 320px.
 *
 * Por isso a verificação aqui não usa heurística: lê as tabelas reais da fonte
 * (`cmap` formato 4, `hmtx`, `head.unitsPerEm`) e soma as larguras de avanço de
 * cada glifo. Duas fontes, de propósito:
 *
 *   • **Noto Sans** — fonte de UI real; é o que o aparelho do usuário usa na
 *     prática (SF Pro e Roboto têm larguras próximas);
 *   • **DejaVu Sans Bold** — ~12% mais largo que qualquer semibold de sistema.
 *     Não precisa caber: serve para provar que `truncate` é necessário, e não
 *     decorativo.
 *
 * Rodar: node .arena-test/nav-fit.cjs
 */

const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");

/* -------------------------------------------------------------------------- */
/* Leitura de métricas de TTF (sem dependência externa)                       */
/* -------------------------------------------------------------------------- */

function loadFont(file) {
  const d = fs.readFileSync(file);
  const numTables = d.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i += 1) {
    const off = 12 + i * 16;
    const tag = d.toString("latin1", off, off + 4);
    tables[tag] = { off: d.readUInt32BE(off + 8), len: d.readUInt32BE(off + 12) };
  }

  const unitsPerEm = d.readUInt16BE(tables.head.off + 18);
  const numHMetrics = d.readUInt16BE(tables.hhea.off + 34);
  const advances = [];
  for (let i = 0; i < numHMetrics; i += 1) {
    advances.push(d.readUInt16BE(tables.hmtx.off + i * 4 + 2 - 2));
  }

  // cmap: pega o primeiro subtable formato 4 (BMP) — suficiente para pt-BR.
  let best = null;
  const cmapOff = tables.cmap.off;
  const nSub = d.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < nSub; i += 1) {
    const sub = cmapOff + d.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    if (d.readUInt16BE(sub) === 4 && best === null) best = sub;
  }
  if (best === null) throw new Error(`cmap formato 4 não encontrado em ${file}`);

  const segX2 = d.readUInt16BE(best + 6);
  const segs = segX2 / 2;
  const endsOff = best + 14;
  const startsOff = endsOff + segX2 + 2;
  const deltasOff = startsOff + segX2;
  const rangesOff = deltasOff + segX2;

  function glyphFor(ch) {
    const c = ch.codePointAt(0);
    for (let i = 0; i < segs; i += 1) {
      const end = d.readUInt16BE(endsOff + i * 2);
      if (c > end) continue;
      const start = d.readUInt16BE(startsOff + i * 2);
      if (c < start) return 0;
      const delta = d.readInt16BE(deltasOff + i * 2);
      const range = d.readUInt16BE(rangesOff + i * 2);
      if (range === 0) return (c + delta) & 0xffff;
      const addr = rangesOff + i * 2 + range + (c - start) * 2;
      const g = d.readUInt16BE(addr);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }

  return (text, px) => {
    let units = 0;
    for (const ch of text) {
      const g = Math.min(glyphFor(ch), advances.length - 1);
      units += advances[g];
    }
    return (units / unitsPerEm) * px;
  };
}

/* -------------------------------------------------------------------------- */
/* Os valores que o código usa — lidos do componente, não copiados           */
/* -------------------------------------------------------------------------- */

const source = fs.readFileSync(
  path.join(ROOT, "src/components/app/bottom-nav.tsx"),
  "utf8",
);

const clampSource = /text-\[clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)\]/.exec(source);
const labels = [...source.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

check("fonte fluida declarada em um clamp(rem, vw, rem)", Boolean(clampSource), String(clampSource?.[0]));
check("a barra tem seis abas", labels.length === 6, labels.join(", "));
check("a aba de relatórios existe", labels.includes("Relatórios"));
check("o rótulo mais longo é 'Configurações'", labels.includes("Configurações"));

const [, minRem, vwCoef, maxRem] = (clampSource || ["", "0.45", "2.15", "0.62"]).map((v, i) =>
  i === 0 ? v : Number(v),
);

const TRACKING = -0.025; // `tracking-tight` do Tailwind
const PADDING = 4; // px-0.5 = 2px de cada lado no <ul>

const longest = labels.reduce((a, b) => (a.length >= b.length ? a : b), "");

const fonts = [
  {
    name: "Noto Sans",
    path: path.join(ROOT, "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf"),
    mustFit: true,
    why: "fonte de UI real: SF Pro e Roboto têm larguras próximas desta",
  },
  {
    name: "DejaVu Sans Bold",
    path: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    mustFit: false,
    why: "~12% mais largo que semibold de sistema; prova que `truncate` é necessário",
  },
];

const measurements = [];

for (const font of fonts) {
  if (!fs.existsSync(font.path)) {
    check(`fonte ${font.name} disponível`, false, font.path);
    continue;
  }

  const widthOf = loadFont(font.path);

  for (const vw of [320, 360, 390, 430]) {
    const size = Math.min(Math.max(minRem * 16, (vwCoef / 100) * vw), maxRem * 16);
    const slot = (vw - PADDING) / Math.max(labels.length, 1);
    const measured = widthOf(longest, size) + TRACKING * size * longest.length;
    const fits = measured <= slot;
    measurements.push({ font: font.name, vw, size, slot, measured, fits });

    if (font.mustFit) {
      check(
        `${font.name} cabe em ${vw}px`,
        fits,
        `"${longest}" mede ${measured.toFixed(1)}px num slot de ${slot.toFixed(1)}px`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Guardas estruturais — o que impede o estouro de virar rolagem             */
/* -------------------------------------------------------------------------- */

check(
  "cada aba tem min-w-0 (deixa o flex encolher)",
  /<li[^>]*className="[^"]*min-w-0/.test(source),
  "sem min-w-0 o flex item tem largura mínima de conteúdo e empurra a barra",
);
check(
  "o rótulo usa truncate",
  /<span[^>]*className="[^"]*truncate/.test(source),
  "sem truncate um rótulo largo vira rolagem horizontal no app",
);
check(
  "nenhum rótulo usa whitespace-nowrap",
  !/whitespace-nowrap/.test(source),
  "nowrap + overflow = rolagem horizontal",
);
check(
  "a barra tem altura de alvo de toque (min-h-14)",
  /min-h-14/.test(source),
  "texto menor não pode custar o alvo de 56px do dedo",
);
check(
  "o valor não passa de 2.15vw",
  vwCoef <= 2.15,
  `2.3vw estourava em DejaVu Bold; medido agora ${vwCoef}vw`,
);

/* -------------------------------------------------------------------------- */
/* Resultado                                                                  */
/* -------------------------------------------------------------------------- */

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log("medidas (slot | rótulo mais largo | folga):");
for (const m of measurements) {
  const slack = m.slot - m.measured;
  console.log(
    `  ${m.font.padEnd(18)} ${String(m.vw).padStart(3)}px · fonte ${m.size.toFixed(2)}px · ` +
      `${m.measured.toFixed(1)}px / ${m.slot.toFixed(1)}px · ` +
      (slack >= 0 ? `folga +${slack.toFixed(1)}` : `estoura ${(-slack).toFixed(1)}`),
  );
}

console.log(`\nnav-fit: ${passed}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFalhas:");
  for (const item of failed) {
    console.log(`  ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  process.exit(1);
}
