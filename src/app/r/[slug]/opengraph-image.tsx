import { notFound } from "next/navigation";
import {
  SHARE_CARD_CACHE_SECONDS,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  shareCardSvg,
} from "@/lib/share-card";
import { getPublicRestaurant } from "@/lib/data/public-menu";
import { resolveSiteOrigin } from "@/lib/env";

/**
 * Imagem compartilhável do cardápio — `/r/{slug}/opengraph-image`.
 *
 * É a arte que o WhatsApp, o Instagram, o Facebook e o Telegram mostram quando
 * alguém cola o link do cardápio. Sem ela, o link aparece como um quadrado
 * cinza e perde o clique para quem tem foto.
 *
 * ─── Convenção de arquivo do Next ────────────────────────────────────────
 *
 * `opengraph-image.tsx` dentro de `app/r/[slug]/` é injetado automaticamente no
 * `openGraph.images` **da rota e das filhas** (`/table/[token]` inclusive). Isso
 * significa uma coisa a menos para manter: quem adicionar uma página pública
 * nova sob `/r/[slug]` herda a imagem sem precisar lembrar de nada.
 *
 * ─── Por que é dinâmica e por que isso não mata o ISR ────────────────────
 *
 * A imagem depende do **slug** (parâmetro de rota), não de header de requisição.
 * O Next a trata como estática com `generateStaticParams` ausente e a cacheia
 * pelo `revalidate`; a página continua ISR. Ler `headers()` aqui é que seria o
 * erro — foi exatamente o que quase matou o ISR na Etapa 14.
 *
 * ─── A logo vem em data URI ──────────────────────────────────────────────
 *
 * O `sharp` não busca URL remota: ele precisa dos bytes. Baixamos do bucket
 * público do tenant com limite de tamanho e tipo. Falha aqui não derruba a
 * imagem — sai sem logo, que é melhor que um 404 na prévia do link.
 */

export const alt = "Cardápio digital do restaurante";
export const size = { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT };
export const contentType = "image/png";
/*
 * O Next exige **literal** nas configurações de segmento: `revalidate` não pode
 * ser uma constante importada. O build recusa com "Unknown identifier
 * SHARE_CARD_CACHE_SECONDS at revalidate", então o número é repetido aqui e a
 * igualdade com `SHARE_CARD_CACHE_SECONDS` é conferida em `share-lib.cjs`.
 */
export const revalidate = 3600;

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const restaurant = await getPublicRestaurant(slug);

  // Cardápio não publicado não tem prévia: a rota responde 404 e o mensageiro
  // mostra o link simples, que é a verdade — a página também não existe.
  if (!restaurant) notFound();

  const origin = resolveSiteOrigin({ requestHost: null, requestProto: null }) ?? "";
  const displayUrl = `${origin.replace(/^https?:\/\//, "")}/r/${restaurant.slug}`;

  const logo = await loadLogo(restaurant.logo_url);

  const svg = shareCardSvg({
    restaurantName: restaurant.name,
    headline: headlineFromSettings(restaurant.settings),
    displayUrl,
    logoDataUri: logo,
  });

  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 9 }).toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=${SHARE_CARD_CACHE_SECONDS}, s-maxage=${SHARE_CARD_CACHE_SECONDS}, stale-while-revalidate=86400`,
    },
  });
}

/**
 * A chamada não sai da view pública (ela não expõe `share_headline`, e não deve:
 * a view é o contrato do cardápio, não do marketing). Então a imagem usa a
 * chamada **padrão**.
 *
 * Foi uma decisão, não um esquecimento: acrescentar a coluna em
 * `public_restaurants` faria toda leitura do cardápio carregar texto de
 * divulgação, e uma mudança de chamada invalidaria o ISR do cardápio inteiro.
 * O título e a descrição da página já carregam o texto editado — a imagem fica
 * com a chamada fixa da plataforma.
 */
function headlineFromSettings(_settings: unknown): string | null {
  return null;
}

/** Baixa a logo do bucket público do tenant, com limite de tipo e tamanho. */
async function loadLogo(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;

  try {
    const response = await fetch(logoUrl, { cache: "force-cache" });
    if (!response.ok) return null;

    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(type)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // 300 KB: a logo ocupa 120×120 px na arte. Acima disso é peso para o
    // mensageiro baixar antes de mostrar a prévia.
    if (buffer.byteLength > 300 * 1024) return null;

    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
