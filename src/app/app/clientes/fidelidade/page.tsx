import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { LoyaltySettingsForm } from "@/components/customers/loyalty-settings-form";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getLoyaltySettings } from "@/lib/data/loyalty";

export const metadata: Metadata = { title: "Fidelidade" };

/**
 * Regra do programa de pontos — Etapa 24.
 *
 * Fica fora de `/app/configuracoes` de propósito: o dono chega aqui pensando
 * "meus clientes", não "configurações do app". A tela é curta e explica o
 * efeito de cada número, então não precisa competir com a lista inteira de
 * ajustes.
 *
 * `canEdit` só desabilita o formulário — quem recusa de verdade é
 * `is_restaurant_owner` dentro de `save_loyalty_settings`.
 */
export default async function LoyaltySettingsPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const settings = await getLoyaltySettings(restaurant.id);
  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  return (
    <>
      <AppHeader title="Fidelidade" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-8 pt-4">
        <Link
          href="/app/clientes"
          className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-500"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Clientes
        </Link>

        <LoyaltySettingsForm initial={settings} canEdit={canEdit} />
      </main>
    </>
  );
}
