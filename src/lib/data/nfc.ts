import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { NfcEvent, TableNfcTag } from "@/lib/types";

/**
 * Leitura das TAGs NFC.
 *
 * Painel só: passa pela RLS de `table_nfc_tags` (membro ativo lê). Nada aqui
 * é usado pela rota pública — o visitante nunca consulta NFC, ele só abre a
 * URL da mesa que a Etapa 4 já resolve.
 */

/** TAGs de uma mesa, com `nfc_url` calculada pelo banco. */
export const listTableNfcTags = cache(
  async (tableId: string): Promise<TableNfcTag[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("table_nfc_overview")
      .select("*")
      .eq("table_id", tableId)
      .order("created_at", { ascending: true });

    if (error) return [];
    return (data ?? []) as TableNfcTag[];
  },
);

/** TAGs do restaurante inteiro (contagem do painel e seção "NFC" da lista). */
export const listRestaurantNfcTags = cache(
  async (restaurantId: string): Promise<TableNfcTag[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("table_nfc_overview")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true });

    if (error) return [];
    return (data ?? []) as TableNfcTag[];
  },
);

/** TAG única, sempre escopada pelo restaurante do usuário. */
export const getNfcTag = cache(
  async (tagId: string, restaurantId: string): Promise<TableNfcTag | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("table_nfc_overview")
      .select("*")
      .eq("tag_id", tagId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error || !data) return null;
    return data as TableNfcTag;
  },
);

/** Histórico da mesa (append-only, escrito por trigger). */
export const listNfcHistory = cache(
  async (tableId: string, limit = 20): Promise<NfcEvent[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("table_nfc_events")
      .select("id, event, from_status, to_status, note, created_at, actor_id")
      .eq("table_id", tableId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data ?? []) as NfcEvent[];
  },
);
