/**
 * SVG da plaquinha de QR Code — Etapa 22.
 *
 * Gera a placa inteira (QR + logo + nome da mesa + restaurante + instrução) em
 * **vetor**, com medidas em milímetros. Por que SVG e não uma imagem composta:
 *
 *   • gráfica e impressora doméstica trabalham em milímetros; o SVG carrega
 *     `width="90mm"`, então o arquivo sai no tamanho físico certo em qualquer
 *     equipamento, sem "imprimir em 100%" e sem cálculo de DPI;
 *   • texto continua texto — não vira bitmap borrado no papel;
 *   • o arquivo é inspecionável e auditável: dá para abrir num editor e conferir
 *     que a cor e o tamanho são os que passaram na validação.
 *
 * ─── O QR é desenhado aqui, não embutido como imagem ──────────────────────
 *
 * `qrToSvg` desenha o código como um caminho único. Embutir um PNG dentro do SVG
 * funcionaria, mas reintroduziria o problema do bitmap: a placa é justamente o
 * arquivo que vai para a gráfica, e ali o código tem de ser vetor.
 *
 * ─── Espaçamento entre QR e placa ─────────────────────────────────────────
 *
 * A zona silenciosa (4 módulos brancos em volta do código) vem desenhada dentro
 * do bloco do QR. Além dela, a placa reserva `marginMm` até a borda física —
 * porque a tesoura, a guilhotina da gráfica e a moldura de acrílico comem
 * alguns milímetros. Perder a zona silenciosa é a causa nº 1 de QR que "funciona
 * na tela e não abre no papel".
 */
import { createQrMatrix } from "@/lib/qr";
import {
  PLACE_FORMATS,
  escapeXml,
  getPlaceTemplate,
  placeGeometry,
  placeText,
  type PlaceStyle,
} from "@/lib/place-card";

/** Fonte do sistema: existe em qualquer leitor de SVG e imprime igual. */
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Caminho do QR dentro de uma caixa de `sizeMm`.
 *
 * Os módulos são agrupados em sequências horizontais (um `h` por corrida), o que
 * reduz o número de subcaminhos de ~1.000 para ~200 num QR versão 4 — arquivo
 * menor, impressão mais rápida em RIP de gráfica.
 */
function qrPath(
  text: string,
  sizeMm: number,
  offsetX: number,
  offsetY: number,
  quietZoneModules: number,
): { path: string; boxMm: number } {
  const matrix = createQrMatrix(text);
  const total = matrix.size + quietZoneModules * 2;
  // Um módulo em mm. Usar o total (com zona silenciosa) garante que o desenho
  // caiba na caixa e a margem branca fique visível.
  const moduleMm = sizeMm / total;

  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row]![col]) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < matrix.size && matrix.modules[row]![col + run]) run += 1;

      const x = offsetX + (col + quietZoneModules) * moduleMm;
      const y = offsetY + (row + quietZoneModules) * moduleMm;
      // Altura 1 módulo, largura `run` módulos. `h`/`v` relativos mantêm o
      // caminho curto; arredondamos para 4 casas para não inflar o arquivo com
      // dízimas binárias.
      parts.push(
        `M${round(x)} ${round(y)}h${round(run * moduleMm)}v${round(moduleMm)}h${round(-run * moduleMm)}z`,
      );
      col += run;
    }
  }

  return { path: parts.join(""), boxMm: sizeMm };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export type PlaceSvgOptions = {
  /**
   * Deslocamento de todo o conteúdo, em mm.
   *
   * Existe para as marcas de corte: em vez de reescrever cada coordenada (e
   * arriscar a placa e as marcas divergirem), o conteúdo inteiro desce dentro de
   * um `<g transform>`. Padrão 0.
   */
  offsetMm?: number;
};

export type PlaceSvgInput = {
  /** URL que o QR aponta — a mesma do link e do NFC. */
  url: string;
  restaurantName: string;
  tableName: string;
  style: PlaceStyle;
  /**
   * Logo como data URI (`data:image/png;base64,...`).
   *
   * Não aceitamos URL remota: o arquivo baixado precisa abrir offline e num
   * editor de vetor sem depender de rede. Quem converte a logo em data URI é o
   * servidor, com validação de tipo e tamanho.
   */
  logoDataUri?: string | null;
};

/**
 * SVG completo da placa.
 *
 * A ordem dos elementos é a ordem de impressão: fundo, textos de cima, QR,
 * textos de baixo. O QR fica num grupo próprio para que uma eventual falha de
 * fonte não o afete.
 */
export function placeSvg(input: PlaceSvgInput, options: PlaceSvgOptions = {}): string {
  const { style } = input;
  const offset = options.offsetMm ?? 0;
  const geometry = placeGeometry(style);
  const text = placeText({
    restaurantName: input.restaurantName,
    tableName: input.tableName,
    style,
  });
  const template = getPlaceTemplate(style.template);
  const format = PLACE_FORMATS[style.format];

  const qr = qrPath(input.url, style.qrSizeMm, geometry.qrX, geometry.qrY, 4);

  const parts: string[] = [];

  const sheetW = format.widthMm + offset * 2;
  const sheetH = format.heightMm + offset * 2;

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}mm" height="${sheetH}mm" viewBox="0 0 ${sheetW} ${sheetH}" role="img" aria-label="${escapeXml(
      `${input.tableName} — QR Code do cardápio`,
    )}">`,
  );

  if (offset > 0) parts.push(`<g transform="translate(${offset} ${offset})">`);

  // Fundo. Sem cantos arredondados: raio de canto é recortado pela guilhotina
  // na impressão caseira e vira uma borda branca torta.
  parts.push(`<rect width="${format.widthMm}" height="${format.heightMm}" fill="${style.background}"/>`);

  // Logo
  if (style.showLogo && input.logoDataUri && geometry.logoY !== null) {
    const logoSize = 12;
    parts.push(
      `<image href="${escapeXml(input.logoDataUri)}" x="${round((geometry.widthMm - logoSize) / 2)}" y="${round(
        geometry.logoY - logoSize / 2,
      )}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }

  // Nome da mesa — o maior bloco, porque é o que o garçom confere.
  if (text.table && geometry.tableY !== null) {
    parts.push(
      `<text x="${round(geometry.widthMm / 2)}" y="${round(geometry.tableY)}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT_STACK}" font-size="9" font-weight="700" fill="${style.text}">${escapeXml(
        text.table,
      )}</text>`,
    );
  }

  // Nome do restaurante
  if (text.restaurant && geometry.restaurantY !== null) {
    parts.push(
      `<text x="${round(geometry.widthMm / 2)}" y="${round(geometry.restaurantY)}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT_STACK}" font-size="3.6" font-weight="600" letter-spacing="0.35" fill="${style.text}" opacity="0.75">${escapeXml(
        text.restaurant.toUpperCase(),
      )}</text>`,
    );
  }

  // Bloco do QR: fundo próprio + módulos.
  //
  // O retângulo de fundo do QR é desenhado **sempre**, inclusive quando a cor é
  // igual à da placa. Ele garante que a zona silenciosa exista mesmo se alguém
  // colar a placa num papel colorido ou imprimir em papel reciclado escuro.
  parts.push(
    `<rect x="${round(geometry.qrX)}" y="${round(geometry.qrY)}" width="${style.qrSizeMm}" height="${style.qrSizeMm}" fill="${style.qrLight}"/>`,
  );
  parts.push(`<g transform="translate(0 0)"><path d="${qr.path}" fill="${style.qrDark}" shape-rendering="crispEdges"/></g>`);

  // Instrução
  if (text.instruction && geometry.instructionY !== null) {
    parts.push(
      `<text x="${round(geometry.widthMm / 2)}" y="${round(geometry.instructionY)}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT_STACK}" font-size="3.4" font-weight="600" fill="${style.text}">${escapeXml(
        text.instruction,
      )}</text>`,
    );
  }

  // Marca NFC: um pictograma simples + a palavra.
  if (text.nfc && template.showNfc && geometry.nfcY !== null) {
    const centerX = geometry.widthMm / 2;
    const y = geometry.nfcY;
    parts.push(
      `<g fill="none" stroke="${style.text}" stroke-width="0.5" stroke-linecap="round" opacity="0.75">`,
      `<path d="M${round(centerX - 8)} ${round(y + 1.2)}a4 4 0 0 1 0 -2.4"/>`,
      `<path d="M${round(centerX - 6.4)} ${round(y + 2)}a6.4 6.4 0 0 1 0 -4"/>`,
      `</g>`,
      `<text x="${round(centerX + 1)}" y="${round(y)}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT_STACK}" font-size="2.9" font-weight="700" letter-spacing="0.4" fill="${style.text}" opacity="0.75">NFC</text>`,
    );
  }

  if (offset > 0) parts.push("</g>");
  parts.push("</svg>");

  return parts.join("");
}

/**
 * Placa com marcas de corte, para quem manda imprimir em A4 e recorta à mão.
 *
 * Desligada por padrão: a maioria dos donos imprime em casa, e uma cruz de
 * corte no meio do adesivo só suja o acabamento.
 *
 * A implementação desloca o conteúdo inteiro por `bleed` dentro de um `<g>` em
 * vez de reescrever cada coordenada — assim as marcas não podem divergir da
 * placa, porque a placa é gerada **uma vez** e apenas transladada.
 */
export function placeSvgWithCropMarks(input: PlaceSvgInput): string {
  const bleed = 4;
  const svg = placeSvg(input, { offsetMm: bleed });
  const { widthMm, heightMm } = PLACE_FORMATS[input.style.format];
  const totalW = widthMm + bleed * 2;
  const totalH = heightMm + bleed * 2;

  const marks = [
    `M${bleed / 2} ${bleed}V${bleed / 2}H${bleed}`,
    `M${totalW - bleed} ${bleed / 2}H${totalW - bleed / 2}V${bleed}`,
    `M${bleed / 2} ${totalH - bleed}V${totalH - bleed / 2}H${bleed}`,
    `M${totalW - bleed} ${totalH - bleed / 2}H${totalW - bleed / 2}V${totalH - bleed}`,
  ].join("");

  return svg.replace(
    "</svg>",
    `<path d="${marks}" fill="none" stroke="#9ca3af" stroke-width="0.2"/></svg>`,
  );
}
