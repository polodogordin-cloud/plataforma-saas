import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/lib/types";

/**
 * Fuso do restaurante.
 *
 * A view pública não expõe `timezone`, então lemos da tabela base. Para o
 * visitante anônimo a RLS não devolve linha — nesse caso usamos o fuso padrão
 * brasileiro, que é o correto para todos os tenants atuais.
 */
export const getRestaurantTimezone = cache(
  async (restaurantId: string): Promise<string> => {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("restaurants")
        .select("timezone")
        .eq("id", restaurantId)
        .maybeSingle();

      return (data as Pick<Restaurant, "timezone"> | null)?.timezone ?? "America/Sao_Paulo";
    } catch {
      return "America/Sao_Paulo";
    }
  },
);
