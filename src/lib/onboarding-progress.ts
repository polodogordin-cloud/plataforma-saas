import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getOnboardingSnapshot } from "@/lib/data/onboarding";
import type { OnboardingStepId } from "@/lib/onboarding";

/**
 * Marca uma etapa do onboarding como feita a partir de uma ação comum —
 * Etapa 21.
 *
 * ─── O problema ────────────────────────────────────────────────────────────
 *
 * O wizard não é o único caminho para configurar a casa. O dono pode editar o
 * nome em Configurações, trocar o tema em Personalização e conectar o WhatsApp
 * sem nunca abrir o passo a passo. Sem isto, o wizard continuaria dizendo
 * "pendente" para coisas feitas — e o "continuar de onde parou" mandaria a
 * pessoa refazer o trabalho.
 *
 * ─── Por que não bloquear a ação original ─────────────────────────────────
 *
 * Quem salva o restaurante não deve receber erro porque a anotação de progresso
 * falhou: são coisas independentes, e a segunda é cosmética. Por isso a função
 * engole qualquer falha e devolve `false` — o chamador só chama e segue.
 *
 * ─── Por que não é por etapa, mas por dado ────────────────────────────────
 *
 * O dashboard (`SetupProgressCard`) já lê os dados reais e não depende disto.
 * Este mapa serve ao wizard. Um dado real sempre vence: se o dono apagar a
 * logo depois de marcar "informações", o checklist volta a acusar, mesmo que o
 * mapa diga "done". É a assimetria certa — o mapa é atalho, o dado é verdade.
 */
export async function trackOnboardingStep(step: OnboardingStepId): Promise<boolean> {
  try {
    const restaurant = await getActiveRestaurant();
    if (!restaurant) return false;

    const snapshot = await getOnboardingSnapshot(restaurant.id);
    if (!snapshot) return false;

    // Já marcada: não gasta um UPDATE no banco a cada salvamento de produto.
    if (snapshot.steps[step] === "done") return true;

    const supabase = await createClient();
    const { error } = await supabase.rpc("save_onboarding_progress", {
      p_restaurant_id: restaurant.id,
      p_steps: { ...snapshot.steps, [step]: "done" },
      p_complete: false,
    });

    return !error;
  } catch {
    // Nunca propaga: o trabalho do dono já foi salvo pela ação de origem.
    return false;
  }
}
