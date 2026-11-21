import { NextResponse, type NextRequest } from "next/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getTable } from "@/lib/data/tables";
import { toUuidOrNull } from "@/lib/validation";
import { qrToPng, qrToSvg } from "@/lib/qr";
import { resolveSiteOrigin } from "@/lib/env";

/**
 * Download do QR Code de uma mesa.
 *
 * Fica atrás do painel: só um membro do restaurante dono da mesa baixa isto.
 * A autorização não depende da interface — `getActiveRestaurant` resolve a
 * sessão e a consulta filtra pelo restaurante, então trocar o id na URL por
 * uma mesa de outro tenant devolve 404.
 *
 * `?format=png` (padrão, 720px, pronto para impressão) ou `?format=svg`
 * (vetorial, escala sem perda para gráfica).
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const restaurant = await getActiveRestaurant();
  if (!restaurant) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const tableId = toUuidOrNull(id);
  if (!tableId) {
    return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
  }

  const table = await getTable(tableId);

  // Duas checagens: existe e pertence ao restaurante ativo do usuário.
  if (!table || table.restaurant_id !== restaurant.id) {
    return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
  }

  const origin = resolveOrigin(request);
  const url = `${origin}/r/${restaurant.slug}/table/${table.public_token}`;
  const prettyName = table.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  const format = request.nextUrl.searchParams.get("format") ?? "png";

  if (format === "svg") {
    const svg = qrToSvg(url, { quietZone: 4 });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="mesa-${prettyName}.svg"`,
        // O QR não muda a menos que o token seja regenerado.
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // Escala 16 → 720px para versão 4 (33 módulos + margem). Ótimo em impressão
  // até ~12 cm de lado, sem borrar em impressora caseira.
  const png = qrToPng(url, { scale: 16, quietZone: 4 });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="mesa-${prettyName}.png"`,
      "Content-Length": String(png.length),
      "Cache-Control": "private, max-age=300",
    },
  });
}

/**
 * Origem pública do QR.
 *
 * `NEXT_PUBLIC_SITE_URL` ganha do header: um QR impresso precisa apontar para o
 * domínio próprio, não para o host interno que atendeu o download (preview,
 * IP da VPS). Só quando a variável não existe é que o header responde.
 */
function resolveOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? null;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null;

  return (
    resolveSiteOrigin({ requestHost: forwardedHost, requestProto: forwardedProto }) ??
    request.nextUrl.origin
  );
}
