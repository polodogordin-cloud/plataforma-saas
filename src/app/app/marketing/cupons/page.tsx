import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, TicketPercent } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Card } from "@/components/ui/card";
import { CouponsList } from "@/components/marketing/coupons-list";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { listCoupons } from "@/lib/data/coupons";
import { getRestaurantTimezone } from "@/lib/data/timezone";

export const metadata: Metadata = { title: "Cupons" };

/**
 * Marketing → Cupons — Etapa 25.
 *
 * A lista vem inteira do servidor (é pequena, ver o comentário em
 * `CouponsList` sobre busca no navegador), com status e uso já calculados pela
 * RPC. Nenhum cálculo de "expirou?" acontece aqui: `coupon_status_of` no banco
 * é a única fonte, para a lista e a ficha nunca discordarem.
 */
export default async function CouponsPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [list, timeZone] = await Promise.all([
    listCoupons({ restaurantId: restaurant.id, limit: 100 }),
    getRestaurantTimezone(restaurant.id),
  ]);

  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";
  const running = list.coupons.filter((coupon) => coupon.status === "active").length;

  return (
    <>
      <AppHeader title="Cupons" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-8 pt-4">
        {/* ---------------------------------------------------- resumo */}
        <Card className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-900">
              {running > 0
                ? `${running} ${running === 1 ? "cupom no ar" : "cupons no ar"}`
                : "Nenhum cupom no ar"}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-ink-500">
              {running > 0
                ? "O cliente digita o código no carrinho e o desconto é validado no servidor."
                : "Crie um código de boas-vindas ou uma promoção com data para começar."}
            </p>
          </div>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <TicketPercent className="size-5" aria-hidden="true" />
          </span>
        </Card>

        {canEdit && (
          <Link
            href="/app/marketing/cupons/novo"
            className="mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white active:scale-[0.99]"
          >
            <Plus className="size-4" aria-hidden="true" />
            Criar cupom
          </Link>
        )}

        <CouponsList initialCoupons={list.coupons} timeZone={timeZone} />
      </main>
    </>
  );
}
