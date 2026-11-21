/**
 * Gerador de QR Code — implementação própria, sem dependência externa.
 *
 * Por que não uma lib: o cardápio público já é servido em 3G dentro do salão;
 * adicionar ~30 kB de dependência (ou um serviço de imagem externo, que
 * *vazaria o link de cada mesa para terceiros*) não se justifica para uma
 * matriz de 21×21 a 33×33 módulos.
 *
 * Escopo: saída em SVG (vetorial, ideal para impressão) e PNG (área de
 * transferência e WhatsApp). Byte mode, correção de erro nível M, versões 1–10
 * — suficiente para as URLs do Menuvo (~60 caracteres).
 *
 * Referência: ISO/IEC 18004. Máscaras, formato e Reed-Solomon conforme a
 * especificação.
 */

/* -------------------------------------------------------------------------- */
/* Galois Field GF(256) para Reed-Solomon                                      */
/* -------------------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Polinômio gerador de grau `degree` para Reed-Solomon. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ (poly[j] ?? 0);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j] ?? 0, EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

/** Bytes de correção de erro para um bloco de dados. */
function rsEncode(data: number[], eccLength: number): number[] {
  const generator = rsGenerator(eccLength);
  const result = new Array<number>(eccLength).fill(0);

  for (const byte of data) {
    const factor = byte ^ result[0]!;
    result.shift();
    result.push(0);
    for (let i = 0; i < eccLength; i += 1) {
      result[i] = (result[i] ?? 0) ^ gfMul(generator[i + 1] ?? 0, factor);
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Tabelas de capacidade (versões 1–10, nível M)                               */
/* -------------------------------------------------------------------------- */

type Capacity = {
  version: number;
  /** Total de codewords de dados. */
  dataCodewords: number;
  /** Codewords de correção por bloco. */
  eccPerBlock: number;
  /** Divisão em blocos: [quantidade, codewords por bloco]. */
  blocks: Array<[number, number]>;
};

const CAPACITIES: Capacity[] = [
  { version: 1, dataCodewords: 16, eccPerBlock: 10, blocks: [[1, 16]] },
  { version: 2, dataCodewords: 28, eccPerBlock: 16, blocks: [[1, 28]] },
  { version: 3, dataCodewords: 44, eccPerBlock: 26, blocks: [[1, 44]] },
  { version: 4, dataCodewords: 64, eccPerBlock: 18, blocks: [[2, 32]] },
  { version: 5, dataCodewords: 86, eccPerBlock: 24, blocks: [[2, 43]] },
  { version: 6, dataCodewords: 108, eccPerBlock: 16, blocks: [[4, 27]] },
  { version: 7, dataCodewords: 124, eccPerBlock: 18, blocks: [[4, 31]] },
  { version: 8, dataCodewords: 154, eccPerBlock: 22, blocks: [[2, 38], [2, 39]] },
  { version: 9, dataCodewords: 182, eccPerBlock: 22, blocks: [[3, 36], [2, 37]] },
  { version: 10, dataCodewords: 216, eccPerBlock: 26, blocks: [[4, 43], [1, 44]] },
];

/** Coordenadas dos padrões de alinhamento por versão. */
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/* -------------------------------------------------------------------------- */
/* Codificação dos dados                                                       */
/* -------------------------------------------------------------------------- */

/** Converte o texto em bits no byte mode (ISO-8859-1 / UTF-8 por byte). */
function encodeDataBits(text: string, version: number): number[] {
  const bytes = new TextEncoder().encode(text);
  const bits: number[] = [];

  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  // Contador de caracteres: 8 bits nas versões 1–9, 16 bits na 10+.
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  return bits;
}

/** Empacota os bits em codewords, com terminator e preenchimento padrão. */
function bitsToCodewords(bits: number[], dataCodewords: number): number[] {
  const capacityBits = dataCodewords * 8;
  const result = bits.slice(0, capacityBits);

  // Terminator: até 4 zeros.
  for (let i = 0; i < 4 && result.length < capacityBits; i += 1) result.push(0);
  // Completa o byte.
  while (result.length % 8 !== 0) result.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < result.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (result[i + j] ?? 0);
    codewords.push(value);
  }

  // Pad bytes alternados 0xEC / 0x11.
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < dataCodewords) {
    codewords.push(pads[padIndex % 2]!);
    padIndex += 1;
  }

  return codewords;
}

/** Divide em blocos, calcula ECC e intercala (ordem exigida pela spec). */
function interleave(codewords: number[], capacity: Capacity): number[] {
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];

  let offset = 0;
  for (const [count, size] of capacity.blocks) {
    for (let i = 0; i < count; i += 1) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      eccBlocks.push(rsEncode(block, capacity.eccPerBlock));
    }
  }

  const result: number[] = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]!);
    }
  }
  for (let i = 0; i < capacity.eccPerBlock; i += 1) {
    for (const block of eccBlocks) {
      result.push(block[i]!);
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Matriz                                                                      */
/* -------------------------------------------------------------------------- */

type Matrix = { size: number; modules: boolean[][]; reserved: boolean[][] };

function createMatrix(version: number): Matrix {
  const size = version * 4 + 17;
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function placeFinder(matrix: Matrix, row: number, col: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= matrix.size || cc >= matrix.size) continue;
      const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix.modules[rr]![cc] = isBorder || isCore;
      matrix.reserved[rr]![cc] = true;
    }
  }
}

function placeAlignment(matrix: Matrix, version: number) {
  const positions = ALIGNMENT[version] ?? [];
  for (const row of positions) {
    for (const col of positions) {
      // Não sobrepõe os finders.
      if (
        (row === 6 && col === 6) ||
        (row === 6 && col === positions[positions.length - 1]) ||
        (row === positions[positions.length - 1] && col === 6)
      ) {
        continue;
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
          const isCenter = r === 0 && c === 0;
          matrix.modules[row + r]![col + c] = isBorder || isCenter;
          matrix.reserved[row + r]![col + c] = true;
        }
      }
    }
  }
}

function placeTiming(matrix: Matrix) {
  for (let i = 8; i < matrix.size - 8; i += 1) {
    const value = i % 2 === 0;
    if (!matrix.reserved[6]![i]) {
      matrix.modules[6]![i] = value;
      matrix.reserved[6]![i] = true;
    }
    if (!matrix.reserved[i]![6]) {
      matrix.modules[i]![6] = value;
      matrix.reserved[i]![6] = true;
    }
  }
}

function reserveFormatAreas(matrix: Matrix) {
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      matrix.reserved[8]![i] = true;
      matrix.reserved[i]![8] = true;
    }
  }
  matrix.reserved[8]![8] = true;
  for (let i = 0; i < 8; i += 1) {
    matrix.reserved[8]![matrix.size - 1 - i] = true;
    matrix.reserved[matrix.size - 1 - i]![8] = true;
  }
  matrix.reserved[matrix.size - 8]![8] = true;
}

/** Reserva a área de versão (só existe da versão 7 em diante). */
function reserveVersionArea(matrix: Matrix, version: number) {
  if (version < 7) return;
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      matrix.reserved[matrix.size - 11 + j]![i] = true;
      matrix.reserved[i]![matrix.size - 11 + j] = true;
    }
  }
}

/** Posiciona os bits de dados em ziguezague. */
function placeData(matrix: Matrix, codewords: number[]) {
  const bits: number[] = [];
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((codeword >> i) & 1);
  }

  let index = 0;
  let upward = true;

  for (let col = matrix.size - 1; col > 0; col -= 2) {
    // A coluna 6 é a linha de timing: pula.
    if (col === 6) col = 5;

    for (let step = 0; step < matrix.size; step += 1) {
      const row = upward ? matrix.size - 1 - step : step;
      for (let c = 0; c < 2; c += 1) {
        const cc = col - c;
        if (matrix.reserved[row]![cc]) continue;
        matrix.modules[row]![cc] = bits[index] === 1;
        index += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, maskIndex: number) {
  const mask = MASKS[maskIndex]!;
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.reserved[row]![col]) continue;
      if (mask(row, col)) matrix.modules[row]![col] = !matrix.modules[row]![col];
    }
  }
}

/** Penalidades da spec, usadas para escolher a melhor máscara. */
function penalty(matrix: Matrix): number {
  const size = matrix.size;
  let score = 0;

  // Regra 1: sequências de 5+ módulos iguais.
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(matrix.modules[i]!);
    lines.push(matrix.modules.map((row) => row[i]!));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }

  // Regra 2: blocos 2×2 da mesma cor.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = matrix.modules[row]![col];
      if (
        value === matrix.modules[row]![col + 1] &&
        value === matrix.modules[row + 1]![col] &&
        value === matrix.modules[row + 1]![col + 1]
      ) {
        score += 3;
      }
    }
  }

  // Regra 3: padrão 1:1:3:1:1 com quatro claros de um lado.
  const pattern = [true, false, true, true, true, false, true];
  const hasPattern = (line: boolean[]) => {
    for (let i = 0; i + 6 < line.length; i += 1) {
      if (pattern.every((value, k) => line[i + k] === value)) {
        const before = line.slice(Math.max(0, i - 4), i);
        const after = line.slice(i + 7, i + 11);
        const clearBefore = before.length === 4 && before.every((v) => !v);
        const clearAfter = after.length === 4 && after.every((v) => !v);
        if (clearBefore || clearAfter) return true;
      }
    }
    return false;
  };
  for (const line of lines) if (hasPattern(line)) score += 40;

  // Regra 4: proporção de módulos escuros.
  let dark = 0;
  for (const row of matrix.modules) for (const value of row) if (value) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** Bits de formato (nível M + máscara), com BCH e XOR da spec. */
function formatBits(maskIndex: number): boolean[] {
  const data = (0b00 << 3) | maskIndex; // 00 = nível M
  let bch = data << 10;
  const generator = 0b10100110111;
  for (let i = 14; i >= 10; i -= 1) {
    if ((bch >> i) & 1) bch ^= generator << (i - 10);
  }
  const bits = ((data << 10) | bch) ^ 0b101010000010010;

  return Array.from({ length: 15 }, (_, i) => Boolean((bits >> (14 - i)) & 1));
}

function placeFormat(matrix: Matrix, maskIndex: number) {
  const bits = formatBits(maskIndex);
  const size = matrix.size;

  // Cópia 1: ao redor do finder superior esquerdo.
  let i = 0;
  for (let col = 0; col <= 8; col += 1) {
    if (col === 6) continue;
    matrix.modules[8]![col] = bits[i]!;
    i += 1;
  }
  for (let row = 7; row >= 0; row -= 1) {
    if (row === 6) continue;
    matrix.modules[row]![8] = bits[i]!;
    i += 1;
  }

  // Cópia 2: canto superior direito e inferior esquerdo.
  for (let k = 0; k < 8; k += 1) {
    matrix.modules[8]![size - 1 - k] = bits[k]!;
  }
  for (let k = 0; k < 7; k += 1) {
    matrix.modules[size - 1 - k]![8] = bits[8 + k]!;
  }
  matrix.modules[size - 8]![8] = true; // módulo escuro fixo
}

/** Bits de versão (só versões 7+). */
function placeVersion(matrix: Matrix, version: number) {
  if (version < 7) return;
  let bch = version << 12;
  const generator = 0b1111100100101;
  for (let i = 17; i >= 12; i -= 1) {
    if ((bch >> i) & 1) bch ^= generator << (i - 12);
  }
  const bits = (version << 12) | bch;
  const size = matrix.size;

  for (let k = 0; k < 18; k += 1) {
    const bit = Boolean((bits >> k) & 1);
    const row = Math.floor(k / 3);
    const col = k % 3;
    matrix.modules[size - 11 + col]![row] = bit;
    matrix.modules[row]![size - 11 + col] = bit;
  }
}

/* -------------------------------------------------------------------------- */
/* API pública                                                                 */
/* -------------------------------------------------------------------------- */

export type QrMatrix = {
  size: number;
  version: number;
  /** true = módulo escuro. */
  modules: boolean[][];
};

/**
 * Gera a matriz do QR Code para o texto.
 * Lança erro se o texto exceder a versão 10 (~213 bytes).
 */
export function createQrMatrix(text: string): QrMatrix {
  const byteLength = new TextEncoder().encode(text).length;

  const capacity = CAPACITIES.find((entry) => {
    const overhead = entry.version < 10 ? 2 : 3; // modo + contador
    return entry.dataCodewords - overhead >= byteLength;
  });

  if (!capacity) {
    throw new Error("Conteúdo longo demais para o QR Code.");
  }

  const bits = encodeDataBits(text, capacity.version);
  const codewords = bitsToCodewords(bits, capacity.dataCodewords);
  const finalCodewords = interleave(codewords, capacity);

  const base = createMatrix(capacity.version);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, base.size - 7);
  placeFinder(base, base.size - 7, 0);
  placeAlignment(base, capacity.version);
  placeTiming(base);
  reserveFormatAreas(base);
  reserveVersionArea(base, capacity.version);

  placeData(base, finalCodewords);

  // Escolhe a máscara de menor penalidade.
  let best: { index: number; score: number } = { index: 0, score: Number.POSITIVE_INFINITY };

  for (let maskIndex = 0; maskIndex < 8; maskIndex += 1) {
    const candidate = createMatrix(capacity.version);
    candidate.modules = base.modules.map((row) => [...row]);
    candidate.reserved = base.reserved.map((row) => [...row]);

    applyMask(candidate, maskIndex);
    placeFormat(candidate, maskIndex);
    placeVersion(candidate, capacity.version);

    const score = penalty(candidate);
    if (score < best.score) best = { index: maskIndex, score };
  }

  const final = createMatrix(capacity.version);
  final.modules = base.modules.map((row) => [...row]);
  final.reserved = base.reserved.map((row) => [...row]);
  applyMask(final, best.index);
  placeFormat(final, best.index);
  placeVersion(final, capacity.version);

  return { size: final.size, version: capacity.version, modules: final.modules };
}

/* -------------------------------------------------------------------------- */
/* SVG                                                                         */
/* -------------------------------------------------------------------------- */

export type QrStyle = {
  /** Módulos escuros. */
  dark?: string;
  /** Fundo. Use "none" para SVG transparente. */
  light?: string;
  /** Margem silenciosa em módulos (spec pede 4). */
  quietZone?: number;
};

/** SVG vetorial — o formato para imprimir. */
export function qrToSvg(text: string, style: QrStyle = {}): string {
  const { dark = "#0e0f14", light = "#ffffff", quietZone = 4 } = style;
  const matrix = createQrMatrix(text);
  const total = matrix.size + quietZone * 2;

  // Caminho único com todos os módulos: SVG menor e renderização mais rápida.
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row]![col]) {
        col += 1;
        continue;
      }
      // Agrupa sequências horizontais em um único retângulo.
      let run = 1;
      while (col + run < matrix.size && matrix.modules[row]![col + run]) run += 1;
      parts.push(`M${col + quietZone} ${row + quietZone}h${run}v1h-${run}z`);
      col += run;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges" role="img">`,
    light === "none" ? "" : `<rect width="${total}" height="${total}" fill="${light}"/>`,
    `<path d="${parts.join("")}" fill="${dark}"/>`,
    `</svg>`,
  ].join("");
}

/* -------------------------------------------------------------------------- */
/* PNG                                                                         */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

/**
 * Deflate com LZ77 + blocos fixos de Huffman.
 *
 * Um PNG "stored" (sem compressão) de 720×720 daria ~1,5 MB — inviável para
 * baixar no celular ou mandar no WhatsApp. Aqui o QR comprime para poucos kB:
 * as linhas são altamente repetitivas, então as repetições casam rápido.
 */
function zlibDeflate(raw: Uint8Array): Uint8Array {
  const MAX_WINDOW = 32768;
  const MIN_MATCH = 3;
  const MAX_MATCH = 258;

  // Base da codificação fixa de Huffman (RFC 1951 §3.2.6).
  const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const writeBits = (value: number, length: number) => {
    bitBuffer |= value << bitCount;
    bitCount += length;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  /**
   * Códigos de comprimento fixo (RFC 1951 §3.2.6), já com os bits invertidos.
   * O DEFLATE empacota os códigos Huffman do bit mais significativo para o
   * menos significativo — sem a inversão o stream decodifica lixo.
   */
  const reverse = (code: number, length: number) => {
    let result = 0;
    for (let i = 0; i < length; i += 1) {
      result = (result << 1) | ((code >> i) & 1);
    }
    return result;
  };

  const writeLiteral = (value: number) => {
    if (value < 144) writeBits(reverse(0x30 + value, 8), 8);
    else if (value < 256) writeBits(reverse(0x190 + value - 144, 9), 9);
    else if (value < 280) writeBits(reverse(value - 256, 7), 7);
    else writeBits(reverse(0xc0 + value - 280, 8), 8);
  };

  // Bloco único, tipo 01 (Huffman fixo), último bloco.
  writeBits(1, 1);
  writeBits(1, 2);

  const lengthCode = (length: number) => {
    for (let i = lengthBase.length - 1; i >= 0; i -= 1) {
      if (length >= lengthBase[i]!) return i;
    }
    return 0;
  };

  const distCode = (distance: number) => {
    for (let i = distBase.length - 1; i >= 0; i -= 1) {
      if (distance >= distBase[i]!) return i;
    }
    return 0;
  };

  // Tabela de hashes de 3 bytes para achar repetições.
  const head = new Map<number, number>();
  const key = (i: number) => (raw[i]! << 16) | (raw[i + 1]! << 8) | raw[i + 2]!;

  let i = 0;
  while (i < raw.length) {
    let bestLength = 0;
    let bestDistance = 0;

    if (i + MIN_MATCH <= raw.length) {
      const candidate = head.get(key(i));
      if (candidate !== undefined && i - candidate <= MAX_WINDOW) {
        let length = 0;
        while (
          length < MAX_MATCH &&
          i + length < raw.length &&
          raw[candidate + length] === raw[i + length]
        ) {
          length += 1;
        }
        if (length >= MIN_MATCH) {
          bestLength = length;
          bestDistance = i - candidate;
        }
      }
      head.set(key(i), i);
    }

    if (bestLength >= MIN_MATCH) {
      const lc = lengthCode(bestLength);
      writeLiteral(257 + lc);
      writeBits(bestLength - lengthBase[lc]!, lengthExtra[lc]!);

      const dc = distCode(bestDistance);
      writeBits(reverse(dc, 5), 5); // distância usa código fixo de 5 bits, invertido
      writeBits(bestDistance - distBase[dc]!, distExtra[dc]!);

      // Registra os bytes cobertos pelo match para manter o dicionário quente.
      for (let k = 1; k < bestLength && i + k + MIN_MATCH <= raw.length; k += 1) {
        head.set(key(i + k), i + k);
      }
      i += bestLength;
    } else {
      writeLiteral(raw[i]!);
      i += 1;
    }
  }

  writeLiteral(256); // fim do bloco

  if (bitCount > 0) out.push(bitBuffer & 0xff);

  // Cabeçalho zlib + Adler-32
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;

  return new Uint8Array([
    0x78, 0x01,
    ...out,
    (adler >> 24) & 0xff,
    (adler >> 16) & 0xff,
    (adler >> 8) & 0xff,
    adler & 0xff,
  ]);
}

/**
 * PNG RGB. `scale` é o tamanho de cada módulo em pixels: para impressão,
 * 512px+ de largura final é o alvo (scale 16 com versão 3 dá ~464px).
 */
export function qrToPng(
  text: string,
  options: { scale?: number; quietZone?: number; dark?: [number, number, number]; light?: [number, number, number] } = {},
): Uint8Array {
  const {
    scale = 16,
    quietZone = 4,
    dark = [14, 15, 20],
    light = [255, 255, 255],
  } = options;

  const matrix = createQrMatrix(text);
  const totalModules = matrix.size + quietZone * 2;
  const size = totalModules * scale;

  // Linhas: filtro 0 + RGB por pixel.
  const rowBytes = 1 + size * 3;
  const raw = new Uint8Array(rowBytes * size);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filtro None
    const moduleRow = Math.floor(y / scale) - quietZone;

    for (let x = 0; x < size; x += 1) {
      const moduleCol = Math.floor(x / scale) - quietZone;
      const isDark =
        moduleRow >= 0 &&
        moduleCol >= 0 &&
        moduleRow < matrix.size &&
        moduleCol < matrix.size &&
        matrix.modules[moduleRow]![moduleCol] === true;

      const color = isDark ? dark : light;
      const offset = rowStart + 1 + x * 3;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }

  // Cabeçalho IHDR: largura, altura, 8 bits, RGB (2), compressão 0, filtro 0, sem entrelace.
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size);
  ihdrView.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlibDeflate(raw)), chunk("IEND", new Uint8Array(0))];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    png.set(part, position);
    position += part.length;
  }
  return png;
}
