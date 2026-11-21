"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { listOrderStatusEvents, listPanelOrders } from "@/lib/data/orders-panel";
import type { OrderStatus, OrderStatusEvent, PanelOrder } from "@/lib/types";

/**
 * Ações do painel de pedidos — Etapa 7.
 *
 * Toda ação passa por três checagens, nesta ordem:
 *
 *  1. sessão + restaurante ativo (aqui);
 *  2. vínculo de equipe e transição válida (dentro de `set_order_status`, no
 *     banco — a parte que não dá para contornar chamando a API direto);
 *  3. RLS nas tabelas, como última linha.
 *
 * A tela também esconde o botão errado, mas isso é conveniência, não segurança.
 */

const statusSchema = z.enum([
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
]);

const setStatusSchema = z.object({
  orderId: z.string().uuid("Pedido inválido."),
  status: statusSchema,
  note: z.string().trim().max(200).optional(),
});

export type OrderActionResult =
  | { ok: true; status: OrderStatus; updatedAt: string }
  | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  order_not_found: "Pedido não encontrado.",
  invalid_transition: "Esse pedido já mudou de etapa. Recarregue o painel.",
  note_too_long: "A anotação ficou longa demais.",
};

function translate(message: string | undefined): string {
  if (message) {
    for (const [key, text] of Object.entries(MESSAGES)) {
      if (message.includes(key)) return text;
    }
  }
  return "Não foi possível atualizar o pedido. Tente novamente.";
}

export async function setOrderStatus(input: unknown): Promise<OrderActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_order_status", {
    p_order_id: parsed.data.orderId,
    p_status: parsed.data.status,
    p_note: parsed.data.note || null,
  });

  if (error) return { ok: false, error: translate(error.message) };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { order_id: string; order_number: number; status: OrderStatus; updated_at: string }
    | undefined;

  if (!row) return { ok: false, error: "Pedido não encontrado." };

  // Home e painel mostram contadores: ambos precisam refletir a mudança.
  revalidatePath("/app");
  revalidatePath("/app/pedidos");

  return { ok: true, status: row.status, updatedAt: row.updated_at };
}

/* -------------------------------------------------------------------------- */
/* Leitura sob demanda (paginação e detalhe)                                   */
/* -------------------------------------------------------------------------- */

const listSchema = z.object({
  statuses: z.array(statusSchema).min(1).max(6),
  beforeNumber: z.number().int().positive().nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function fetchPanelOrders(input: unknown): Promise<PanelOrder[]> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return [];

  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return [];

  return listPanelOrders({
    restaurantId: restaurant.id,
    statuses: parsed.data.statuses,
    beforeNumber: parsed.data.beforeNumber ?? null,
    limit: parsed.data.limit ?? 20,
  });
}

/**
 * Histórico de um pedido.
 *
 * O `orderId` sozinho não autoriza nada: a consulta passa pela RLS de
 * `order_status_events`, que só devolve evento de restaurante de que o usuário
 * é membro. Pedido de outro tenant volta lista vazia.
 */
export async function fetchOrderHistory(orderId: string): Promise<OrderStatusEvent[]> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return [];
  if (!z.string().uuid().safeParse(orderId).success) return [];

  return listOrderStatusEvents(orderId);
}
