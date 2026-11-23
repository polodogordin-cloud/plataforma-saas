import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { RestaurantStatus } from "@/lib/types";

/**
 * Leitura da tela de divulgação — Etapa 23.
 *
 * Uma RPC (`share_overview`) devolve restaurante, mesas e últimos pedidos. A
 * guarda de tenant é do banco (`is_restaurant_owner`), então trocar o id na
 * chamada devolve `null` em vez de dado alheio.
 */

export type ShareTable = {
  id: string;
  name: string;
  code: string | null;
  publicToken: string;
  isActive: boolean;
  status: string;
};

export type ShareOrder = {
  id: string;
  orderNumber: number;
  status: string;
  createdAt: string;
  tableId: string;
  tableName: string;
  publicToken: string;
};

export type ShareSnapshot = {
  restaurantId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  status: RestaurantStatus;
  /** Chamada salva pelo dono; `null` = usar a padrão. */
  headline: string | null;
  tables: ShareTable[];
  orders: ShareOrder[];
};

type RawRestaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  status: RestaurantStatus;
  share_headline: string | null;
};

type RawTable = {
  id: string;
  name: string;
  code: string | null;
  public_token: string;
  is_active: boolean;
  status: string;
};

type RawOrder = {
  id: string;
  order_number: number;
  status: string;
  created_at: string;
  table_id: string;
  table_name: string;
  public_token: string;
};

/**
 * Snapshot da divulgação.
 *
 * `cache()` porque a página lê os mesmos dados para renderizar a lista e para
 * montar os links do cabeçalho. `null` cobre os dois casos que a página trata
 * igual: restaurante de outra pessoa e migration não aplicada.
 */
export const getShareSnapshot = cache(
  async (restaurantId: string): Promise<ShareSnapshot | null> => {
    if (!restaurantId) return null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("share_overview", {
      p_restaurant_id: restaurantId,
    });

    if (error || !data) return null;

    const row = (Array.isArray(data) ? data[0] : data) as
      | { restaurant: RawRestaurant; tables: RawTable[]; orders: RawOrder[] }
      | undefined;

    if (!row?.restaurant) return null;

    return {
      restaurantId: row.restaurant.id,
      name: row.restaurant.name,
      slug: row.restaurant.slug,
      logoUrl: row.restaurant.logo_url,
      description: row.restaurant.description,
      status: row.restaurant.status,
      headline: row.restaurant.share_headline,
      tables: (row.tables ?? []).map((table) => ({
        id: table.id,
        name: table.name,
        code: table.code,
        publicToken: table.public_token,
        isActive: table.is_active,
        status: table.status,
      })),
      orders: (row.orders ?? []).map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        createdAt: order.created_at,
        tableId: order.table_id,
        tableName: order.table_name,
        publicToken: order.public_token,
      })),
    };
  },
);
