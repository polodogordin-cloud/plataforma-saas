import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  KitchenOrder,
  KitchenOrderItem,
  KitchenSettings,
  KitchenStation,
  OrderItemOption,
  OrderStatus,
} from "@/lib/types";

/**
 * Leitura do KDS.
 *
 * Tudo por RPC `security definer` que confere o papel (`kds_can_view`), como no
 * resto do painel. Nada aqui consulta `orders` direto: a função é a única porta
 * que sabe montar item + observação + adicionais + estação numa ida ao banco.
 */

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeItem(raw: Record<string, unknown>): KitchenOrderItem {
  const options = Array.isArray(raw.options) ? raw.options : [];

  return {
    id: String(raw.id ?? ""),
    product_id: (raw.product_id as string | null) ?? null,
    name: String(raw.name ?? ""),
    quantity: Number(raw.quantity ?? 0),
    subtotal: toNumber(raw.subtotal),
    notes: (raw.notes as string | null) ?? null,
    category_id: (raw.category_id as string | null) ?? null,
    station_slug: (raw.station_slug as string | null) ?? null,
    options: (options as Array<Record<string, unknown>>).map(
      (option): OrderItemOption => ({
        group_name: String(option.group_name ?? ""),
        name: String(option.name ?? ""),
        price_delta: toNumber(option.price_delta),
        quantity: Number(option.quantity ?? 1),
      }),
    ),
  };
}

function normalizeOrder(row: Record<string, unknown>): KitchenOrder {
  const items = Array.isArray(row.items) ? row.items : [];

  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    table_id: String(row.table_id),
    table_name: String(row.table_name ?? ""),
    order_number: Number(row.order_number),
    status: row.status as OrderStatus,
    channel: row.channel as KitchenOrder["channel"],
    total: toNumber(row.total),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    preparing_since: (row.preparing_since as string | null) ?? null,
    items: (items as Array<Record<string, unknown>>).map(normalizeItem),
    item_count: Number(row.item_count ?? 0),
  };
}

/**
 * Pedidos do KDS.
 *
 * `sinceMinutes` é a janela de recência (default 12h): o KDS mostra o serviço
 * de hoje e os finalizados recentes, não o histórico da casa. Sem isso, uma
 * casa com meses de operação carregaria tudo até hoje a cada evento de tempo
 * real.
 */
export async function listKitchenOrders({
  restaurantId,
  station,
  sinceMinutes = 720,
}: {
  restaurantId: string;
  station?: string | null;
  sinceMinutes?: number;
}): Promise<KitchenOrder[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_kitchen_orders", {
    p_restaurant_id: restaurantId,
    p_station: station ?? null,
    p_since_minutes: sinceMinutes,
  });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map(normalizeOrder);
}

export async function listKitchenStations(restaurantId: string): Promise<KitchenStation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_kitchen_stations", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    kind: row.kind as KitchenStation["kind"],
    sort_order: Number(row.sort_order ?? 0),
  }));
}

/**
 * Limites de tempo, com fallback do banco.
 *
 * A RPC devolve 15/10 quando não há linha. O `catch` aqui cobre o outro caso:
 * usuário sem `kds_can_view` (a função levanta `42501`). Devolver o default em
 * vez de estourar deixa a tela renderizar e a falta de permissão aparecer no
 * guard do layout, que é onde a mensagem faz sentido.
 */
export async function getKitchenSettings(restaurantId: string): Promise<KitchenSettings> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_kitchen_settings", {
    p_restaurant_id: restaurantId,
  });

  if (error) return { late_after_minutes: 15, warn_after_minutes: 10 };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { late_after_minutes: number; warn_after_minutes: number }
    | undefined;

  return {
    late_after_minutes: Number(row?.late_after_minutes ?? 15),
    warn_after_minutes: Number(row?.warn_after_minutes ?? 10),
  };
}

/**
 * Permissões do papel atual, para o servidor renderizar a tela já recortada.
 *
 * As quatro RPCs são baratas (um `exists` em índice) e vão em paralelo. O
 * cliente recebe o resultado pronto em vez de perguntar ao banco de novo — e o
 * backend continua sendo quem decide em `set_order_status`.
 */
export async function getKitchenPermissions(restaurantId: string): Promise<{
  canView: boolean;
  canOperate: boolean;
  canFinish: boolean;
  canCancel: boolean;
}> {
  const supabase = await createClient();

  const [view, operate, finish, cancel] = await Promise.all([
    supabase.rpc("kds_can_view", { target_restaurant_id: restaurantId }),
    supabase.rpc("kds_can_operate", { target_restaurant_id: restaurantId }),
    supabase.rpc("kds_can_finish", { target_restaurant_id: restaurantId }),
    supabase.rpc("kds_can_cancel", { target_restaurant_id: restaurantId }),
  ]);

  return {
    canView: view.data === true,
    canOperate: operate.data === true,
    canFinish: finish.data === true,
    canCancel: cancel.data === true,
  };
}
