import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import type { RestaurantTable, TableContext } from "@/lib/types";

/**
 * Leitura de mesas.
 *
 * Painel: passa pela RLS de `tables` (membro ativo lê; owner/admin escreve).
 * Público: usa as views/RPC pensadas para `anon`, nunca a tabela base.
 */

/** Mesas do restaurante, ordenadas como o dono vê o salão. */
export const listTables = cache(async (restaurantId: string): Promise<RestaurantTable[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tables")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("name", { ascending: true });

  // Tabela ausente ou sem permissão: a tela mostra vazio em vez de quebrar.
  if (error) return [];
  return (data ?? []) as RestaurantTable[];
});

/** Mesa única (tela de edição). A RLS impede enxergar mesa de outro tenant. */
export const getTable = cache(async (tableId: string): Promise<RestaurantTable | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tables")
    .select("*")
    .eq("id", tableId)
    .maybeSingle();

  if (error || !data) return null;
  return data as RestaurantTable;
});

/**
 * Resolve o token do QR Code / NFC para (restaurante, mesa).
 *
 * Chama a RPC `resolve_table_token`, que:
 *  - só devolve restaurante publicado;
 *  - só devolve mesa ativa;
 *  - aceita o token anterior dentro da janela de tolerância.
 *
 * Devolve `null` para token inexistente, mesa desativada ou restaurante
 * fora do ar — as três respondem 404, sem revelar qual foi o caso.
 */
export const resolveTableToken = cache(
  async (token: string): Promise<TableContext | null> => {
    const clean = token.trim();
    // O alfabeto do token é base32 sem ambíguos; descarta consulta malformada.
    if (!/^[2-9A-HJKMNP-Z]{10,64}$/i.test(clean)) return null;

    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("resolve_table_token", { p_token: clean });

    if (error || !data) return null;

    const row = (Array.isArray(data) ? data[0] : data) as
      | { restaurant_id: string; table_id: string; table_name: string }
      | undefined;

    if (!row) return null;

    return {
      restaurant_id: row.restaurant_id,
      table_id: row.table_id,
      table_name: row.table_name,
    };
  },
);

/** Contagem rápida para o card do dashboard. */
export async function countTables(restaurantId: string): Promise<{
  total: number;
  active: number;
}> {
  const tables = await listTables(restaurantId);
  return {
    total: tables.length,
    active: tables.filter((table) => table.is_active).length,
  };
}
