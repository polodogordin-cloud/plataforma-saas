/**
 * Gera os ícones PNG do PWA — Etapa 12, item 3.
 *
 * Por que gerar em vez de commitar binário desenhado à mão: o logo já existe
 * como SVG (`public/icon.svg`) e o desenho certo é derivado dele. Se alguém
 * mexer na marca, roda este script e os quatro tamanhos saem coerentes — em vez
 * de ficar um 192 antigo ao lado de um 512 novo.
 *
 * Sem dependência externa: escrevemos PNG direto (zlib é do Node). Um
 * `sharp`/`resvg` aqui seria mais uma dependência nativa para desenhar quatro
 * retângulos arredondados com três traços.
 *
 * Uso: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* ----------------------------------------------------------------- cores */

const BRAND_TOP = [27, 181, 99]; // #1bb563 — mesma parada do gradiente do SVG
const BRAND_BOTTOM = [12, 75, 48]; // #0c4b30
const CREAM = [238, 253, 243]; // #eefdf3
const ACCENT = [255, 209, 102]; // #ffd166

/* --------------------------------------------------------------- desenho */

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Distância de um ponto à reta finita (a→b), em unidades do viewBox 512. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Desenha a marca convertendo o SVG em geometria.
 *
 * O SVG original tem garfo (duas hastes + cabo), faca (lâmina curva + cabo) e um
 * fundo com cantos arredondados. Aqui a mesma geometria é recriada em
 * coordenadas 512×512; `scale` controla o recuo da zona segura do maskable.
 */
function renderIcon(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);

  // "any": a marca do SVG ocupa ~45% do quadro; ampliar deixa o ícone legível a
  // 32px (favicon). Maskable: recuar para caber no círculo de recorte do
  // Android, que corta até 20% de cada borda.
  const scale = maskable ? 0.86 : 1.18;
  const offset = (size * (1 - scale)) / 2;
  const radius = maskable ? 0 : size * 0.22; // maskable é quadrado; o SO recorta
  const k = (512 / size) * (1 / scale); // pixel → unidade do viewBox

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Cantos arredondados da versão "any" (fora do raio = transparente).
      if (!insideRoundedRect(x, y, size, radius)) {
        px[i + 3] = 0;
        continue;
      }

      // Gradiente diagonal, como no SVG da marca.
      const grad = Math.max(0, Math.min(1, (x / size + y / size) / 2));
      let [r, g, b] = mix(BRAND_TOP, BRAND_BOTTOM, grad);

      // Converte o pixel para o viewBox, desfazendo a escala.
      const vx = (x - offset) * k;
      const vy = (y - offset) * k;

      if (inFork(vx, vy)) [r, g, b] = CREAM;
      else if (inKnife(vx, vy)) [r, g, b] = ACCENT;

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  return px;
}

/**
 * Garfo: duas hastes externas em U, dois dentes internos e o cabo.
 *
 * O U é um arco de verdade (semicírculo inferior). Desenhar o fundo do U com
 * diagonais deixa o talher anguloso e com rebarbas nas pontas — o formato só se
 * lê como garfo porque o fundo é curvo.
 */
function inFork(vx, vy) {
  // Hastes externas (laterais do U).
  if (inSegment(vx, vy, 150, 176, 150, 268, 12)) return true;
  if (inSegment(vx, vy, 238, 176, 238, 268, 12)) return true;
  // Fundo do U: semicírculo de raio 44 centrado no eixo do talher.
  if (inArc(vx, vy, 194, 268, 44, 0, Math.PI, 12)) return true;
  // Dentes internos, mais curtos e mais finos.
  if (inSegment(vx, vy, 166, 176, 166, 236, 9)) return true;
  if (inSegment(vx, vy, 222, 176, 222, 236, 9)) return true;
  // Cabo: nasce no fundo do U (mesma geometria do `icon.svg`), descendo até a
  // base do talher.
  if (inSegment(vx, vy, 194, 312, 194, 368, 12)) return true;
  return false;
}

/**
 * Faca: silhueta fechada, com ponta e cabo arredondados.
 *
 * Uma cápsula de largura variável. Cápsula uniforme (só um traço grosso) fica
 * com cara de "palito amarelo"; a barriga é o que faz a forma ser lida como
 * faca mesmo em 32px. O fio fica à direita: à esquerda está o garfo, e uma
 * lâmina encostada nele gruda visualmente nos dois tamanhos pequenos.
 */
function inKnife(vx, vy) {
  const EIXO = 344; // centro da lâmina no viewBox
  const topo = 196;
  const base = 356;
  if (vy < topo || vy > base) return false;

  const t = (vy - topo) / (base - topo); // 0 = ponta, 1 = fim do cabo
  // Barriga máxima logo abaixo da ponta, afinando até o cabo.
  // Lâmina de chef: larga no ombro, afinando até o cabo.
  const centro = EIXO + 3 * t;
  const largura = 20 * (1 - 0.62 * Math.pow(t, 1.1)) + 3;
  const dx = vx - centro;

  // Recorte circular na ponta e no cabo: sem isso o topo fica reto e o ícone
  // parece truncado em vez de lâmina.
  if (vy < topo + 17) return Math.abs(dx) <= Math.sqrt(Math.max(0, 289 - (vy - topo - 17) ** 2));
  if (vy > base - 6) return Math.abs(dx) <= Math.sqrt(Math.max(0, 36 - (vy - base + 6) ** 2));

  return Math.abs(dx) <= largura;
}

/** Distância a uma reta finita ≤ `half` (traço com pontas arredondadas). */
function inSegment(px, py, ax, ay, bx, by, half) {
  return distToSegment(px, py, ax, ay, bx, by) <= half;
}

/** Distância à circunferência ≤ `half`, restrita ao arco [from, to] em rad. */
function inArc(px, py, cx, cy, radius, from, to, half) {
  const dx = px - cx;
  const dy = py - cy;
  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += Math.PI * 2;
  const start = from < 0 ? from + Math.PI * 2 : from;
  const end = to < 0 ? to + Math.PI * 2 : to;
  const inRange = start <= end ? ang >= start && ang <= end : ang >= start || ang <= end;
  return inRange && Math.abs(Math.hypot(dx, dy) - radius) <= half;
}

function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

/* ------------------------------------------------------------------- PNG */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Cada linha ganha o byte de filtro (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ main */

const outDir = join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-192.png", size: 192, maskable: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  // iOS usa este para a tela inicial (o manifest não vale para o ícone).
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "favicon-32.png", size: 32, maskable: false },
];

for (const { file, size, maskable } of targets) {
  const png = encodePng(size, renderIcon(size, { maskable }));
  writeFileSync(join(outDir, file), png);
  console.log(`  ✓ public/icons/${file} (${size}×${size}, ${png.length} bytes)`);
}

console.log(`\n${targets.length} ícones gerados em public/icons/\n`);
