import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { CustomerDetailView } from "@/components/customers/customer-detail";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getCustomerOverview, getLoyaltySettings } from "@/lib/data/loyalty";
import { getRestaurantTimezone } from "@/lib/data/timezone";

export const metadata: Metadata = { title: "Cliente" };

/**
 * Ficha do cliente — Etapa 24.
 *
 * `getCustomerOverview` devolve `null` para cliente inexistente **e** para
 * cliente de outra casa. Os dois casos caem no mesmo 404: distinguir contaria a
 * quem forjou o id que aquele registo existe em outro restaurante.
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const detail = await getCustomerOverview(restaurant.id, id);
  if (!detail) notFound();

  const [settings, timeZone] = await Promise.all([
    getLoyaltySettings(restaurant.id),
    getRestaurantTimezone(restaurant.id),
  ]);

  return (
    <>
      <AppHeader title="Cliente" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-6 pt-4">
        <Link
          href="/app/clientes"
          className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-500"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Clientes
        </Link>

        <CustomerDetailView
          detail={detail}
          loyaltyEnabled={settings.enabled}
          redeemValue={settings.redeem_value}
          birthdayBonus={settings.birthday_bonus}
          timeZone={timeZone}
        />
      </main>
    </>
  );
}
