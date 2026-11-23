import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { DEFAULT_PLACE_STYLE, normalizePlaceStyle, type PlaceStyle } from "@/lib/place-card";
import type { RestaurantStatus } from "@/lib/types";

/**
 * Leitura do gerador de plaquinhas — Etapa 22.
 *
 * Tudo vem de `qr_place_overview()`, que confere o tenant no banco. Não há
 * consulta direta em `tables` aqui: a RPC já devolve o que a tela precisa
 * (token, estado de publicação, slug, arte salva) numa única ida, e a guarda de
 * `is_restaurant_owner` impede que um membro de outra casa use a tela como
 * oráculo de tokens.
 */

export type QrPlaceTable = {
  id: string;
  name: string;
  code: string | null;
  /** Token público — base da URL do QR e do NFC. Não é segredo: está impresso. */
  publicToken: string;
  isActive: boolean;
  status: string;
  /** Existe token anterior dentro da janela de tolerância (QR antigo ainda abre). */
  hasStaleToken: boolean;
};

export type QrPlaceSnapshot = {
  restaurantId: string;
  restaurantName: string;
  slug: string;
  logoUrl: string | null;
  status: RestaurantStatus;
  style: PlaceStyle;
  tables: QrPlaceTable[];
};

type OverviewRow = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    status: RestaurantStatus;
    qr_place_style: unknown;
  };
  tables: Array<{
    id: string;
    name: string;
    code: string | null;
    public_token: string;
    is_active: boolean;
    status: string;
    has_stale_token: boolean;
  }>;
};

/**
 * Snapshot do gerador.
 *
 * `cache()` porque a página e o cabeçalho leem o mesmo dado no mesmo render.
 * Devolve `null` quando a RPC não existe (deploy à frente da migration) ou o
 * restaurante não é do usuário — a página trata como 404, não como 500.
 */
export const getQrPlaceSnapshot = cache(
  async (restaurantId: string): Promise<QrPlaceSnapshot | null> => {
    if (!restaurantId) return null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("qr_place_overview", {
      p_restaurant_id: restaurantId,
    });

    if (error || !data) return null;

    const row = (Array.isArray(data) ? data[0] : data) as OverviewRow | undefined;
    if (!row?.restaurant) return null;

    return {
      restaurantId: row.restaurant.id,
      restaurantName: row.restaurant.name,
      slug: row.restaurant.slug,
      logoUrl: row.restaurant.logo_url,
      status: row.restaurant.status,
      // A arte salva passa pela mesma normalização da tela: valor antigo ou
      // estranho cai no padrão em vez de gerar placa ilegível.
      style: row.restaurant.qr_place_style
        ? normalizePlaceStyle(row.restaurant.qr_place_style)
        : DEFAULT_PLACE_STYLE,
      tables: (row.tables ?? []).map((table) => ({
        id: table.id,
        name: table.name,
        code: table.code,
        publicToken: table.public_token,
        isActive: table.is_active,
        status: table.status,
        hasStaleToken: Boolean(table.has_stale_token),
      })),
    };
  },
);

/** Mesa + restaurante já validados pelo tenant ativo do usuário. */
export type PlaceFileContext = {
  restaurant: { id: string; name: string; slug: string; logoUrl: string | null };
  table: QrPlaceTable;
  style: PlaceStyle;
};

/**
 * Contexto para a **rota de arquivo** (SVG/PNG/PDF).
 *
 * A rota recebe `?table=<uuid>` — um id que o cliente escolhe, então isso é
 * entrada hostil por definição. A resposta não depende do id ser confiável: a
 * consulta filtra pelo restaurante ativo do usuário e a comparação de mesa é
 * feita depois. Mesa de outro tenant devolve `null`, e a rota responde 404 (não
 * 403: não confirma que a mesa existe em outro lugar).
 */
export async function resolvePlaceFileContext(tableId: string | null): Promise<PlaceFileContext | null> {
  if (!tableId) return null;

  const restaurant = await getActiveRestaurant();
  if (!restaurant) return null;

  const snapshot = await getQrPlaceSnapshot(restaurant.id);
  if (!snapshot) return null;

  const table = snapshot.tables.find((item) => item.id === tableId);
  if (!table) return null;

  return {
    restaurant: {
      id: snapshot.restaurantId,
      name: snapshot.restaurantName,
      slug: snapshot.slug,
      logoUrl: snapshot.logoUrl,
    },
    table,
    style: snapshot.style,
  };
}
