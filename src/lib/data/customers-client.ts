"use client";

import { getBrowserClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/types";

/**
 * Leitura paginada de clientes a partir do navegador — Etapa 24.
 *
 * ─── Por que não reutilizar `lib/data/loyalty.ts` ─────────────────────────
 *
 * Aquele módulo é `server-only`: importá-lo num componente cliente quebra o
 * build (é literalmente o que a biblioteca existe para impedir). E a busca não
 * precisa dele: a RPC `list_restaurant_customers` já recorta por
 * `is_restaurant_member` e a RLS de `customers` recorta de novo. O navegador
 * pode chamar com a anon key + o JWT do usuário logado, como qualquer outro
 * fetch do painel.
 *
 * A autorização continua no banco. Este arquivo só escolhe por qual porta
 * entrar — e a porta é a mesma que a do servidor.
 */

export type CustomerListResult = {
  customers: Customer[];
  total: number;
};

/** Converte `numeric` do PostgREST (string) sem perder centavos. */
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function listCustomers({
  restaurantId,
  search,
  limit = 50,
  offset = 0,
}: {
  restaurantId: string;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<CustomerListResult> {
  const supabase = getBrowserClient();

  const { data, error } = await supabase.rpc("list_restaurant_customers", {
    p_restaurant_id: restaurantId,
    p_search: search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error || !Array.isArray(data)) return { customers: [], total: 0 };

  const rows = data as Array<Record<string, unknown>>;

  return {
    total: rows.length > 0 ? num(rows[0]?.total_count) : 0,
    customers: rows.map((row) => ({
      id: String(row.id),
      name: (row.name as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      total_orders: num(row.total_orders),
      total_spent: num(row.total_spent),
      last_order_at: (row.last_order_at as string | null) ?? null,
      created_at: String(row.created_at ?? ""),
      points_balance: num(row.points_balance),
      erased_at: (row.erased_at as string | null) ?? null,
    })),
  };
}
