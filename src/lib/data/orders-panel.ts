import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { OrderStatus, OrderStatusEvent, PanelOrder } from "@/lib/types";

/**
 * Leitura de pedidos do painel — Etapa 7.
 *
 * Tudo passa por RPC `security definer` que confere o vínculo de equipe
 * (`is_restaurant_member`), e não pela tabela direto. Duas camadas de proteção:
 * RLS na tabela e o guard dentro da função. Se alguém afrouxar uma policy por
 * engano, o guard da função ainda segura.
 */

/** Converte numeric/texto do PostgREST em número sem perder centavos. */
function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Normaliza a linha da view para o tipo do app. */
function normalizeOrder(row: Record<string, unknown>): PanelOrder {
  const items = Array.isArray(row.items) ? row.items : [];

  return {
    id: String(row.id),
    restaurant_id: String(row.restaurant_id),
    table_id: String(row.table_id),
    table_name: String(row.table_name ?? ""),
    order_number: Number(row.order_number),
    status: row.status as OrderStatus,
    channel: row.channel as PanelOrder["channel"],
    subtotal: toNumber(row.subtotal),
    fees: toNumber(row.fees),
    discount: toNumber(row.discount),
    total: toNumber(row.total),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    items: (items as Array<Record<string, unknown>>).map((item) => ({
      product_id: (item.product_id as string | null) ?? null,
      name: String(item.name ?? ""),
      unit_price: toNumber(item.unit_price),
      quantity: Number(item.quantity ?? 0),
      subtotal: toNumber(item.subtotal),
      notes: null,
    })),
    item_count: Number(row.item_count ?? 0),
  };
}

/**
 * Página de pedidos.
 *
 * `statuses` vem das abas do painel (que agrupam mais de um status em "Em
 * preparo" e "Finalizados"). Como a RPC filtra um status por vez, pedimos cada
 * um em paralelo e juntamos — cada chamada é limitada, então o custo é o mesmo
 * de uma consulta por status ativo, não "carregar tudo".
 *
 * `beforeNumber` é o cursor: o `order_number` do último pedido já exibido.
 */
export async function listPanelOrders({
  restaurantId,
  statuses,
  beforeNumber,
  limit = 20,
}: {
  restaurantId: string;
  statuses: OrderStatus[];
  beforeNumber?: number | null;
  limit?: number;
}): Promise<PanelOrder[]> {
  if (statuses.length === 0) return [];

  const supabase = await createClient();
  const perStatus = Math.max(1, Math.ceil(limit / statuses.length));

  const results = await Promise.all(
    statuses.map(async (status) => {
      const { data, error } = await supabase.rpc("list_restaurant_orders", {
        p_restaurant_id: restaurantId,
        p_status: status,
        p_before_number: beforeNumber ?? null,
        p_limit: perStatus,
      });

      // Erro aqui é "sem permissão" ou "sem pedidos": nos dois casos a tela
      // mostra vazio em vez de quebrar.
      if (error || !data) return [] as PanelOrder[];
      return (data as Array<Record<string, unknown>>).map(normalizeOrder);
    }),
  );

  // Mais recentes primeiro. `order_number` é único por casa, então a ordenação
  // é determinística mesmo com todos na mesma transação.
  return results
    .flat()
    .sort((a, b) => b.order_number - a.order_number)
    .slice(0, limit);
}

/** Contadores da home: novos, em preparo (confirmado + em preparo), prontos. */
export async function getOrderBoardCounts(restaurantId: string): Promise<{
  pending: number;
  preparing: number;
  ready: number;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_board_counts", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data) return { pending: 0, preparing: 0, ready: 0 };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { pending: number; preparing: number; ready: number }
    | undefined;

  if (!row) return { pending: 0, preparing: 0, ready: 0 };

  return {
    pending: Number(row.pending ?? 0),
    preparing: Number(row.preparing ?? 0),
    ready: Number(row.ready ?? 0),
  };
}

/**
 * Histórico de status de um pedido, do mais antigo para o mais novo.
 *
 * A RLS de `order_status_events` já limita ao restaurante do membro; o filtro
 * por `order_id` evita trazer o histórico da casa inteira.
 */
export async function listOrderStatusEvents(orderId: string): Promise<OrderStatusEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_status_events")
    .select("id, order_id, from_status, to_status, note, actor_id, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as OrderStatusEvent[];
}
