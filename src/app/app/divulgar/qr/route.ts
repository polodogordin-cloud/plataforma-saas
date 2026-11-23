import { NextResponse, type NextRequest } from "next/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getShareSnapshot } from "@/lib/data/share";
import { qrToPng, qrToSvg } from "@/lib/qr";
import { menuPath, absoluteUrl } from "@/lib/share";
import { resolveSiteOrigin } from "@/lib/env";

/**
 * QR Code **geral** do restaurante — `/app/divulgar/qr`.
 *
 * Diferente do QR da mesa (Etapa 4/22): este aponta para `/r/{slug}`, o cardápio
 * inteiro, sem mesa. Serve para a porta, o balcão, o adesivo da sacola e o story
 * — lugares onde não existe mesa.
 *
 * Mesma autorização da tela: `getActiveRestaurant` resolve o tenant pela sessão.
 * O slug vem do banco, não da query string — trocar o parâmetro não muda o que
 * é gerado, então não há como gerar QR de outro restaurante.
 *
 * `?format=png` (padrão, 720 px) ou `?format=svg` (vetor para gráfica).
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const snapshot = await getShareSnapshot(restaurant.id);
  if (!snapshot) {
    return NextResponse.json({ error: "Restaurante não encontrado." }, { status: 404 });
  }

  const origin =
    resolveSiteOrigin({
      requestHost: request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? null,
      requestProto: request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null,
    }) ?? request.nextUrl.origin;

  const url = absoluteUrl(origin, menuPath(snapshot.slug));
  const format = request.nextUrl.searchParams.get("format") ?? "png";
  const filename = `qr-${snapshot.slug}`;

  if (format === "svg") {
    const svg = qrToSvg(url, { quietZone: 4 });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.svg"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // Escala 16 → ~720 px para versão 4, o mesmo tamanho do QR de mesa: impressão
  // caseira até ~12 cm sem borrar.
  const png = qrToPng(url, { scale: 16, quietZone: 4 });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}.png"`,
      "Content-Length": String(png.length),
      "Cache-Control": "private, max-age=300",
    },
  });
}
