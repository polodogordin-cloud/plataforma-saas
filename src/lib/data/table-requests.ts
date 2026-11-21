import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { TableRequest } from "@/lib/types";

/**
 * Leitura das solicitações da mesa — Etapa 8.
 *
 * Como no painel de pedidos, tudo passa por RPC `security definer` que confere
 * `is_restaurant_member`, com RLS na tabela como segunda camada. O
 * `restaurant_id` que chega aqui vem do servidor (`getActiveRestaurant`), nunca
 * do navegador — então não existe como pedir a lista de outra casa.
 */

/** Lista da fila (padrão) ou histórico recente. */
export async function listTableRequests({
  restaurantId,
  openOnly = true,
  limit = 30,
}: {
  restaurantId: string;
  openOnly?: boolean;
  limit?: number;
}): Promise<TableRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_table_requests", {
    p_restaurant_id: restaurantId,
    p_open_only: openOnly,
    p_limit: limit,
  });

  // Sem permissão ou sem tabela: a tela mostra vazio em vez de quebrar.
  if (error || !data) return [];

  return (data as TableRequest[]).map((row) => ({
    ...row,
    // O PostgREST devolve numeric como string em alguns caminhos; aqui não há
    // números, mas mantemos o cuidado de não repassar campo indefinido.
    note: row.note ?? null,
    acknowledged_at: row.acknowledged_at ?? null,
    resolved_at: row.resolved_at ?? null,
  }));
}

export async function tableRequestCounts(restaurantId: string): Promise<{
  pending: number;
  acknowledged: number;
  bills: number;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("table_request_counts", {
    p_restaurant_id: restaurantId,
  });

  const empty = { pending: 0, acknowledged: 0, bills: 0 };
  if (error || !data) return empty;

  const row = (Array.isArray(data) ? data[0] : data) as
    | { pending: number; acknowledged: number; bills: number }
    | undefined;

  if (!row) return empty;

  return {
    pending: Number(row.pending ?? 0),
    acknowledged: Number(row.acknowledged ?? 0),
    bills: Number(row.bills ?? 0),
  };
}
