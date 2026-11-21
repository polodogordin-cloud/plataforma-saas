import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { DEFAULT_THEME, normalizeTheme } from "@/lib/theme";
import type { RestaurantTheme } from "@/lib/types";

/**
 * Leitura do tema — Etapa 9.
 *
 * Duas portas, de propósito:
 *
 *   • `getRestaurantTheme` (painel) usa a tabela com RLS: só membro lê, e o
 *     retorno alimenta o editor.
 *   • `getPublicRestaurantTheme` (cardápio) usa a view `public_restaurant_themes`
 *     com o cliente anônimo: nenhuma credencial, nenhuma coluna extra.
 *
 * As duas passam por `normalizeTheme`, que é o **fallback**: linha ausente,
 * coluna nula ou valor estranho caem no tema padrão. O cardápio nunca fica sem
 * cor por falta de configuração (item 10 do escopo).
 */

const emptyTheme = (): RestaurantTheme => normalizeTheme(null);

/** Tema do painel. `null` de restaurante → tema padrão. */
export const getRestaurantTheme = cache(async (restaurantId: string): Promise<RestaurantTheme> => {
  if (!restaurantId) return emptyTheme();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("restaurant_themes")
    .select(
      "preset, primary_color, secondary_color, background_color, text_color, button_color, card_style, button_style, logo_url, cover_url",
    )
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (error || !data) return emptyTheme();
  return normalizeTheme(data);
});

/**
 * Tema do cardápio público — sem sessão.
 *
 * Separado de `getPublicRestaurant` porque o tema é acessório: se esta consulta
 * falhar, o cardápio abre com o tema padrão em vez de dar 404.
 */
export const getPublicRestaurantTheme = cache(
  async (restaurantId: string): Promise<RestaurantTheme> => {
    if (!restaurantId) return emptyTheme();

    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("public_restaurant_themes")
      .select(
        "preset, primary_color, secondary_color, background_color, text_color, button_color, card_style, button_style, logo_url, cover_url",
      )
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error || !data) return emptyTheme();
    return normalizeTheme(data);
  },
);

/** O restaurante já personalizou alguma coisa? (rótulo do painel) */
export async function hasSavedTheme(restaurantId: string): Promise<boolean> {
  if (!restaurantId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurant_themes")
    .select("restaurant_id")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return Boolean(data);
}

export { DEFAULT_THEME };
