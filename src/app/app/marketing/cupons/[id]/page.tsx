import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import { CouponForm } from "@/components/marketing/coupon-form";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getCouponDetails } from "@/lib/data/coupons";
import { getRestaurantTimezone } from "@/lib/data/timezone";
import {
  COUPON_STATUS_LABEL,
  describeCoupon,
  describeUsage,
  describeValidity,
  formatMoney,
} from "@/lib/coupons";

export const metadata: Metadata = { title: "Cupom" };

/**
 * Ficha do cupom — Etapa 25.
 *
 * Duas metades na mesma página: **desempenho** (quantos usos, quanto abateu,
 * quem usou) em cima, e o **formulário de edição** embaixo. Separar em duas
 * telas faria o dono navegar para conferir se a edição funcionou.
 *
 * `getCouponDetails` devolve `null` para cupom inexistente **e** de outra casa;
 * os dois caem no mesmo 404 de propósito — distinguir contaria a quem forjou o
 * id que aquele cupom existe em outro restaurante.
 */
export default async function CouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const detail = await getCouponDetails(restaurant.id, id);
  if (!detail) notFound();

  const timeZone = await getRestaurantTimezone(restaurant.id);
  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  return (
    <>
      <AppHeader title="Cupom" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-8 pt-4">
        <Link
          href="/app/marketing/cupons"
          className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-500"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Cupons
        </Link>

        {/* ------------------------------------------------------ cabeçalho */}
        <Card className="mb-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xl font-bold tracking-wide text-ink-900">
                {detail.code}
              </p>
              <p className="truncate text-xs text-ink-500">{detail.name}</p>
            </div>
            <Badge
              tone={
                detail.status === "active"
                  ? "success"
                  : detail.status === "scheduled"
                    ? "info"
                    : detail.status === "exhausted"
                      ? "warning"
                      : "neutral"
              }
              className="shrink-0"
            >
              {COUPON_STATUS_LABEL[detail.status]}
            </Badge>
          </div>

          {detail.description && (
            <p className="text-sm leading-snug text-ink-700">{detail.description}</p>
          )}

          <p className="text-sm font-medium leading-snug text-ink-800">{describeCoupon(detail)}</p>
          <p className="text-xs text-ink-500">
            {describeValidity(detail.starts_at, detail.ends_at, timeZone)}
          </p>
        </Card>

        {/* ----------------------------------------------------- desempenho */}
        <div className="mb-4">
          <SectionTitle title="Desempenho" />
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Usos" value={describeUsage(detail.used_count, detail.max_uses)} />
            <Stat label="Abatido" value={formatMoney(detail.total_discount)} />
            <Stat
              label="Restam"
              value={
                detail.max_uses === null
                  ? "Ilimitado"
                  : String(Math.max(0, detail.max_uses - detail.used_count))
              }
            />
          </div>
        </div>

        {/* ---------------------------------------------------------- usos */}
        <div className="mb-4">
          <SectionTitle title="Quem usou" />
          {detail.redemptions.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-500">
                Ninguém usou este cupom ainda. Ele aparece no carrinho do cliente assim que
                estiver no ar.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-ink-100 p-0">
              {detail.redemptions.map((redemption) => (
                <Link
                  key={redemption.id}
                  href={`/app/pedidos/${redemption.order_id}/imprimir`}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 active:bg-ink-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      Pedido #{redemption.order_number}
                      <span className="ml-1 text-xs font-normal text-ink-500">
                        · {redemption.table_name}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {redemption.customer_name ?? "Cliente não identificado"} ·{" "}
                      {dateFormatter.format(new Date(redemption.created_at))}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-700">
                    − {formatMoney(redemption.amount)}
                  </span>
                </Link>
              ))}
            </Card>
          )}
        </div>

        {/* ------------------------------------------------------ edição */}
        <div>
          <SectionTitle title="Editar cupom" />
          <CouponForm coupon={detail} canEdit={canEdit} />
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
