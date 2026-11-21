import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  EMPTY_WHATSAPP_CONFIG,
  normalizeWhatsappConfig,
  type WhatsappConfig,
} from "@/lib/whatsapp";

/**
 * Leitura do WhatsApp — Etapa 13.
 *
 * Duas portas, como no tema:
 *
 *   • `getWhatsappSettings` (painel) usa a tabela com RLS: só membro lê, e o
 *     retorno alimenta o formulário.
 *   • `getPublicWhatsappConfig` (cardápio) usa a RPC `public_whatsapp_config`,
 *     que já exige casa publicada, interruptor ligado, número válido **e** o
 *     recurso `whatsapp` no plano.
 *
 * As duas passam por `normalizeWhatsappConfig`, que é o fallback: linha ausente,
 * coluna nula ou valor estranho caem em `EMPTY_WHATSAPP_CONFIG`. O cardápio
 * nunca quebra por falta de configuração — só deixa de mostrar o botão.
 */

/** Configuração do painel. `null` de restaurante → desligado. */
export const getWhatsappSettings = cache(
  async (restaurantId: string): Promise<WhatsappConfig> => {
    if (!restaurantId) return EMPTY_WHATSAPP_CONFIG;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("whatsapp_settings")
      .select("phone, message, is_active")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error || !data) return EMPTY_WHATSAPP_CONFIG;
    return normalizeWhatsappConfig(data);
  },
);

/**
 * Configuração do cardápio público — sem sessão.
 *
 * A RPC devolve linha **somente** quando o botão deve existir. `null` aqui
 * significa "não mostrar o botão", e é o valor certo para todos os casos:
 * sem configuração, desligado, número inválido ou plano sem o recurso.
 *
 * O plano não chega ao navegador: a decisão sai pronta do banco. Isso evita
 * expor o catálogo comercial no HTML e evita que a tela decida autorização.
 */
export const getPublicWhatsappConfig = cache(
  async (slug: string): Promise<WhatsappConfig | null> => {
    if (!slug) return null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("public_whatsapp_config", {
      p_slug: slug,
    });

    if (error || !data) return null;

    // A RPC devolve table(...) → vem como array de uma linha.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    const config = normalizeWhatsappConfig({
      phone: (row as { phone?: string | null }).phone,
      message: (row as { message?: string | null }).message,
      is_active: true,
    });

    // `shouldShowWhatsappButton` faz a última conferência: se o número não
    // normalizar, não existe botão — melhor não renderizar do que abrir o
    // WhatsApp sem destinatário.
    return config.phone ? config : null;
  },
);

/** A casa já configurou algo? (rótulo do painel de configurações) */
export async function hasWhatsappSettings(restaurantId: string): Promise<boolean> {
  if (!restaurantId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_settings")
    .select("restaurant_id")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return Boolean(data);
}
