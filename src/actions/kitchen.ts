"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getKitchenSettings, listKitchenOrders } from "@/lib/data/kitchen";
import type { KitchenOrder, OrderStatus } from "@/lib/types";

/**
 * Ações do painel de cozinha — Etapa 17.
 *
 * **Não existe função de "avançar status" nova aqui.** Tudo chama
 * `set_order_status`, a mesma RPC da Etapa 7, que desde a `0017` também olha o
 * papel de quem pede a transição. Um segundo caminho de escrita de status seria
 * um segundo lugar para esquecer uma regra — e o KDS e o painel do salão
 * começariam a divergir na primeira manutenção.
 *
 * A tela também esconde o botão errado, mas isso é conveniência: quem barra é o
 * banco.
 */

const statusSchema = z.enum([
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
]);

const advanceSchema = z.object({
  orderId: z.string().uuid("Pedido inválido."),
  status: statusSchema,
  note: z.string().trim().max(200).optional(),
});

export type KitchenActionResult =
  | { ok: true; status: OrderStatus; updatedAt: string }
  | { ok: false; error: string };

/**
 * Mensagens por chave de erro do banco.
 *
 * `role_forbidden` é o caso novo da Etapa 17: a cozinha não cancela. A mensagem
 * é específica de propósito — "você não pode cancelar" ensina a regra; "erro ao
 * atualizar" faria o operador tentar de novo para sempre.
 */
const MESSAGES: Record<string, string> = {
  order_not_found: "Pedido não encontrado.",
  invalid_transition: "Esse pedido já mudou de etapa. O painel vai atualizar.",
  role_forbidden: "Seu perfil não pode fazer essa ação.",
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

export async function advanceKitchenOrder(input: unknown): Promise<KitchenActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = advanceSchema.safeParse(input);
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

  /*
   * Revalida as três telas que mostram o mesmo pedido:
   *
   *   • `/kitchen` — a própria cozinha;
   *   • `/app/pedidos` — o salão precisa ver "pronto" sem recarregar;
   *   • `/app` — os contadores do dashboard.
   *
   * O pedido do cliente (`/r/.../table/...`) não é revalidado aqui: é página
   * pública com ISR e o cliente relê por RPC quando quer. Forçar revalidação a
   * cada toque na cozinha invalidaria cache de cardápio para todo mundo.
   */
  revalidatePath("/kitchen");
  revalidatePath("/app/pedidos");
  revalidatePath("/app");

  return { ok: true, status: row.status, updatedAt: row.updated_at };
}

/* -------------------------------------------------------------------------- */
/* Recarga do painel                                                          */
/* -------------------------------------------------------------------------- */

const refreshSchema = z.object({
  station: z.string().max(32).nullable().optional(),
});

/**
 * Recarrega a lista do KDS.
 *
 * Chamada pelo evento de tempo real (e pelo botão "Atualizar"). O evento do
 * Supabase é só o **sinal** de que algo mudou — ele não carrega o pedido
 * completo, e mesmo se carregasse não teria a estação resolvida nem o histórico
 * de preparo. Reler pela RPC mantém uma única fonte de verdade.
 */
export async function refreshKitchenOrders(input: unknown): Promise<{
  orders: KitchenOrder[];
  lateAfter: number;
  warnAfter: number;
}> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { orders: [], lateAfter: 15, warnAfter: 10 };

  const parsed = refreshSchema.safeParse(input);
  const station = parsed.success ? (parsed.data.station ?? null) : null;

  const [orders, settings] = await Promise.all([
    listKitchenOrders({ restaurantId: restaurant.id, station }),
    getKitchenSettings(restaurant.id),
  ]);

  return {
    orders,
    lateAfter: settings.late_after_minutes,
    warnAfter: settings.warn_after_minutes,
  };
}
