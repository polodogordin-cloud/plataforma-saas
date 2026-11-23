import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { CouponForm } from "@/components/marketing/coupon-form";
import { getActiveRestaurant } from "@/lib/data/restaurants";

export const metadata: Metadata = { title: "Novo cupom" };

/**
 * Criar cupom — Etapa 25.
 *
 * `canEdit` só esconde o formulário; quem recusa de verdade é
 * `is_restaurant_member` dentro de `save_coupon`.
 */
export default async function NewCouponPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  return (
    <>
      <AppHeader title="Novo cupom" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-8 pt-4">
        <Link
          href="/app/marketing/cupons"
          className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-500"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Cupons
        </Link>

        <CouponForm canEdit={canEdit} />
      </main>
    </>
  );
}
