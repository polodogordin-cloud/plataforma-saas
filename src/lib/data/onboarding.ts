import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  readProgress,
  setupOverview,
  type ProgressSteps,
  type RestaurantSegment,
  type SetupOverview,
} from "@/lib/onboarding";
import type { RestaurantStatus } from "@/lib/types";

/**
 * Leitura do onboarding — Etapa 21.
 *
 * Tudo passa por `onboarding_overview()`, que já confere o tenant no banco.
 * Não existe consulta direta em `restaurants` aqui de propósito: a RLS deixa o
 * **membro** ler a casa, mas quem configura é o dono/admin. Deixar a leitura
 * solta daria à cozinha uma tela de configuração que ela pode abrir e não pode
 * salvar — pior experiência que um 404.
 */

export type OnboardingSnapshot = {
  restaurantId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  phone: string | null;
  segment: RestaurantSegment | null;
  status: RestaurantStatus;
  steps: ProgressSteps;
  completed: boolean;
  completedAt: string | null;
  counts: {
    categories: number;
    products: number;
    tables: number;
    activeTables: number;
    whatsapp: boolean;
  };
  checklist: SetupOverview;
};

type OverviewRow = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    description: string | null;
    phone: string | null;
    segment: RestaurantSegment | null;
    status: RestaurantStatus;
  };
  onboarding: unknown;
  completed: boolean;
  completed_at: string | null;
  counts: {
    categories: number;
    products: number;
    tables: number;
    active_tables: number;
    whatsapp: boolean;
  };
};

/**
 * Fotografia completa do onboarding.
 *
 * `cache()` porque a página do wizard e o cabeçalho do layout chamam a mesma
 * função no mesmo render — sem cache, seriam duas RPCs para o mesmo dado.
 *
 * Devolve `null` quando o restaurante não é do usuário (a RPC devolve null) ou
 * quando a função ainda não existe no banco (deploy à frente da migration). Nos
 * dois casos a tela trata como "não encontrado", não como erro 500.
 */
export const getOnboardingSnapshot = cache(
  async (restaurantId: string): Promise<OnboardingSnapshot | null> => {
    if (!restaurantId) return null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("onboarding_overview", {
      p_restaurant_id: restaurantId,
    });

    if (error || !data) return null;

    const row = (Array.isArray(data) ? data[0] : data) as OverviewRow | undefined;
    if (!row?.restaurant) return null;

    const facts = {
      name: row.restaurant.name,
      description: row.restaurant.description,
      logoUrl: row.restaurant.logo_url,
      categories: row.counts?.categories ?? 0,
      products: row.counts?.products ?? 0,
      tables: row.counts?.tables ?? 0,
      activeTables: row.counts?.active_tables ?? 0,
      whatsapp: Boolean(row.counts?.whatsapp),
      published: row.restaurant.status === "published",
    };

    return {
      restaurantId: row.restaurant.id,
      name: row.restaurant.name,
      slug: row.restaurant.slug,
      logoUrl: row.restaurant.logo_url,
      description: row.restaurant.description,
      phone: row.restaurant.phone,
      segment: row.restaurant.segment,
      status: row.restaurant.status,
      steps: readProgress(row.onboarding),
      completed: Boolean(row.completed),
      completedAt: row.completed_at,
      counts: {
        categories: facts.categories,
        products: facts.products,
        tables: facts.tables,
        activeTables: facts.activeTables,
        whatsapp: facts.whatsapp,
      },
      checklist: setupOverview(facts),
    };
  },
);
