import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImagePlus, Link2, Lock } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { StatusBadge } from "@/components/app/status-toggle";
import { Card, SectionTitle } from "@/components/ui/card";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { formatDate } from "@/lib/utils";
import { RestaurantSettingsForm } from "./restaurant-form";

export const metadata: Metadata = { title: "Dados do restaurante" };

export default async function RestaurantSettingsPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  return (
    <>
      <AppHeader
        title="Dados do restaurante"
        subtitle={restaurant.name}
        backHref="/app/configuracoes"
      />

      <main className="app-shell space-y-5 px-4 pb-6 pt-5">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Status</p>
              <div className="mt-1">
                <StatusBadge status={restaurant.status} />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Criado em</p>
              <p className="mt-1 text-sm text-ink-700">{formatDate(restaurant.created_at)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2.5 text-sm text-ink-600">
            <Link2 className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
            <span className="truncate">menuvo.app/{restaurant.slug}</span>
          </div>
        </Card>

        <SectionTitle title="Logo" description="Etapa 8 traz o upload e o editor de identidade." />
        <Card className="flex items-center gap-3.5 opacity-70">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-ink-200 text-ink-300">
            <ImagePlus className="size-6" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-700">Trocar logo</p>
            <p className="text-xs text-ink-500">
              O bucket de imagens já está criado e isolado por restaurante.
            </p>
          </div>
          <Lock className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
        </Card>

        <SectionTitle title="Informações" description="Aparecem no cardápio público." />

        {canEdit ? (
          <Card>
            <RestaurantSettingsForm restaurant={restaurant} />
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-ink-600">
              Seu perfil <strong>{restaurant.role}</strong> não tem permissão para editar os dados
              do restaurante. Peça a um proprietário ou administrador para alterar.
            </p>
          </Card>
        )}
      </main>
    </>
  );
}
