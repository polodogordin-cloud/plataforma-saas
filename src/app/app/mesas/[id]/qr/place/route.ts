import { NextResponse, type NextRequest } from "next/server";
import { resolvePlaceFileContext } from "@/lib/data/qr-place";
import { placeSvg, placeSvgWithCropMarks } from "@/lib/place-svg";
import {
  PLACE_FORMATS,
  normalizePlaceStyle,
  placeFileName,
  qrPublicPath,
  readabilityReport,
  type PlaceStyle,
} from "@/lib/place-card";
import { resolveSiteOrigin } from "@/lib/env";
import { toUuidOrNull } from "@/lib/validation";

/**
 * Download da plaquinha de QR Code — Etapa 22.
 *
 * `GET /app/mesas/[id]/qr/place?format=svg|png|pdf&crop=1`
 *
 * ─── Por que o arquivo é gerado aqui e não no navegador ───────────────────
 *
 * O navegador tem a arte na tela, mas não tem o token: ele aparece no HTML da
 * página e poderia ser montado à mão. Gerar no servidor garante que
 * **a URL do QR é a mesma que o banco considera válida agora** — se o token foi
 * regenerado em outra aba, o download sai com o token novo, não com o que estava
 * na tela há dez minutos.
 *
 * ─── Autorização ─────────────────────────────────────────────────────────
 *
 * `resolvePlaceFileContext` resolve o restaurante pela sessão e confere que a
 * mesa está naquele conjunto. Mesa de outro tenant → 404 (não 403: 403
 * confirmaria a existência da mesa em outra casa).
 *
 * ─── Formatos ────────────────────────────────────────────────────────────
 *
 * • `svg` — vetor, medidas em mm. É o arquivo para gráfica.
 * • `png` — 300 DPI reais. O SVG é rasterizado pelo `sharp`, que já vem com o
 *   Next: não acrescenta dependência e mantém o QR vetorial até o último passo
 *   (rasterizar o QR direto num PNG de 720px, como antes, borrava os módulos).
 * • `pdf` — **não** é gerado. Embutir PDF exigiria uma biblioteca de PDF (ou
 *   imprimir via navegador, que não existe no servidor). O SVG abre em qualquer
 *   visualizador e imprime em tamanho real; a tela diz isso em vez de prometer
 *   um botão que não baixa nada.
 */

export const dynamic = "force-dynamic";

/**
 * Resolução de saída, em pixels por milímetro.
 *
 * 11,8 px/mm ≈ **300 DPI**. O `sharp` decide o tamanho de um SVG por
 * `width`/`height` (com unidade) ou, sem unidade, por `density` — e `density`
 * foi uma armadilha: 300 DPI aplicado a um SVG de 100 mm produziu 4921 px de
 * largura (escala de ~4×, o "72 DPI" virou base), gerando arquivo de 350 KB para
 * uma plaquinha. Aqui o cálculo é explícito: mm → px na taxa desejada, e o SVG
 * recebe `width`/`height` em px, com o `viewBox` em mm preservado.
 */
const PX_PER_MM = 300 / 25.4;

function originOf(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? null;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null;
  return (
    resolveSiteOrigin({ requestHost: host, requestProto: proto }) ?? request.nextUrl.origin
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const tableId = toUuidOrNull(id);
  if (!tableId) {
    return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
  }

  const context = await resolvePlaceFileContext(tableId);
  if (!context) {
    return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
  }

  const { restaurant, table, style } = context;

  // A arte da URL pode sobrescrever a arte salva (o editor manda o que está na
  // tela). Ainda assim passa pela mesma validação: um link com cores ilegíveis
  // não vira arquivo.
  const styleParam = request.nextUrl.searchParams.get("style");
  const effectiveStyle = parseStyleOverride(styleParam) ?? style;

  const report = readabilityReport(effectiveStyle);
  if (!report.ok) {
    return NextResponse.json(
      {
        error: "Esta arte não pode ser baixada: o QR Code ficaria ilegível.",
        problems: report.problems,
      },
      { status: 422 },
    );
  }

  const url = `${originOf(request)}${qrPublicPath({
    restaurantSlug: restaurant.slug,
    publicToken: table.publicToken,
  })}`;

  const logoDataUri = await loadLogoDataUri(restaurant.logoUrl);
  const input = {
    url,
    restaurantName: restaurant.name,
    tableName: table.name,
    style: effectiveStyle,
    logoDataUri,
  };

  const crop = request.nextUrl.searchParams.get("crop") === "1";
  const format = (request.nextUrl.searchParams.get("format") ?? "svg").toLowerCase();
  const filename = placeFileName({
    restaurantSlug: restaurant.slug,
    tableName: table.name,
    format: format === "png" ? "png" : "svg",
    style: effectiveStyle,
  });

  if (format === "svg") {
    const svg = crop ? placeSvgWithCropMarks(input) : placeSvg(input);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A arte pode mudar a qualquer momento (personalização), e o token muda
        // ao regenerar. Cache curto e privado evita servir placa antiga.
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  if (format === "png") {
    try {
      const sharp = (await import("sharp")).default;
      const svg = crop ? placeSvgWithCropMarks(input) : placeSvg(input);
      const png = await sharp(Buffer.from(toPixelSvg(svg)), { density: 72 })
        .png({ compressionLevel: 9 })
        .toBuffer();

      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(png.length),
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      // Se a rasterização falhar (binário nativo indisponível), o SVG continua
      // sendo a saída correta — e é melhor entregar o vetor do que um 500.
      return NextResponse.json(
        {
          error: "Não foi possível gerar o PNG agora. Baixe o SVG — ele imprime no mesmo tamanho.",
          fallback: "svg",
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json(
    {
      error: "Formato não suportado. Use SVG (vetor, ideal para impressão) ou PNG.",
      supported: ["svg", "png"],
    },
    { status: 400 },
  );
}

/**
 * Troca a unidade do SVG de mm para pixel, na taxa de saída.
 *
 * O `viewBox` não é tocado: ele continua em milímetros, então o desenho é o
 * mesmo e só muda a quantidade de pixels que o representa. Reescrever as
 * coordenadas seria outra chance de a placa do arquivo divergir da placa da tela.
 */
function toPixelSvg(svg: string): string {
  const { widthMm, heightMm } = readDimensions(svg);
  return svg.replace(
    /<svg([^>]*?)width="[\d.]+mm"([^>]*?)height="[\d.]+mm"/,
    `<svg$1width="${Math.round(widthMm * PX_PER_MM)}"$2height="${Math.round(heightMm * PX_PER_MM)}"`,
  );
}

function readDimensions(svg: string): { widthMm: number; heightMm: number } {
  const width = Number(svg.match(/width="([\d.]+)mm"/)?.[1] ?? 0);
  const height = Number(svg.match(/height="([\d.]+)mm"/)?.[1] ?? 0);
  return { widthMm: width, heightMm: height };
}

/**
 * Arte vinda da query string.
 *
 * Existe para o preview "baixar do jeito que está na tela" antes de salvar.
 * Devolve `null` em qualquer entrada inválida — o chamador então usa a arte
 * salva, que já é legível por construção.
 */
function parseStyleOverride(raw: string | null): PlaceStyle | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { format?: unknown };
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.format || !(String(parsed.format) in PLACE_FORMATS)) return null;
    // `normalizePlaceStyle` — mesma função da tela e da action, para não haver
    // duas interpretações do mesmo JSON.
    return normalizePlaceStyle(parsed);
  } catch {
    return null;
  }
}

/**
 * Logo em data URI para embutir no SVG.
 *
 * O SVG baixado tem de abrir **offline** e num editor de vetor: uma `<image
 * href="https://...">` deixaria a placa sem logo na gráfica e no avião. Baixamos
 * a imagem do bucket público do próprio tenant, com limite de tamanho e de tipo.
 *
 * Falha aqui não derruba o download: placa sem logo é melhor que placa nenhuma.
 */
async function loadLogoDataUri(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;

  try {
    const response = await fetch(logoUrl, { cache: "no-store" });
    if (!response.ok) return null;

    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(type)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // Limite de 400 KB: a logo aparece com 12 mm na placa. Um arquivo maior que
    // isso é desperdício de banda e de payload de SVG.
    if (buffer.byteLength > 400 * 1024) return null;

    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
