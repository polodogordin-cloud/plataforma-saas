import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader } from "@/components/admin/admin-header";
import { Card, SectionTitle } from "@/components/ui/card";
import { SubscriptionBadge } from "@/components/billing/plan-card";
import { SubscriptionEditor } from "@/components/admin/subscription-editor";
import { ReviewSubscriptionsButton } from "@/components/admin/subscription-review";
import { listAdminPlans, listAdminSubscriptions, getBillingSummary } from "@/lib/data/billing";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";
import { BILLING_INTERVAL_LABEL } from "@/lib/types";

export const metadata: Metadata = { title: "Assinaturas" };
export const dynamic = "force-dynamic";

/**
 * Assinaturas por casa — Etapa 11, item 9.
 *
 * Cada linha responde: qual restaurante, qual plano, qual status, qual período,
 * qual trial e qual identificador externo (vazio até existir gateway). O
 * "revisar" aciona `run_subscription_review`, que expira trials vencidos e
 * marca atrasos — é o mesmo trabalho que um cron fará quando houver cobrança.
 */
export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const [rows, summary, plans] = await Promise.all([
    listAdminSubscriptions(q),
    getBillingSummary(),
    listAdminPlans(),
  ]);

  const planOptions = plans.map((plan) => ({ id: plan.id, name: plan.name }));

  return (
    <>
      <AdminHeader title="Assinaturas" subtitle="Plano, status e período de cada casa" />

      <main className="app-shell space-y-5 px-4 pb-8 pt-4">
        {summary && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-ink-400">Em teste</p>
              <p className="text-xl font-bold text-ink-900">{summary.trials}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-ink-400">Ativas</p>
              <p className="text-xl font-bold text-ink-900">{summary.active}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-ink-400">Atrasadas</p>
              <p className="text-xl font-bold text-ink-900">{summary.past_due}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-ink-400">Receita mensal</p>
              <p className="text-xl font-bold text-ink-900">{formatPrice(summary.mrr)}</p>
            </Card>
          </div>
        )}

        <form action="/admin/assinaturas" className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por nome ou link"
            aria-label="Buscar assinatura"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3.5 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
          <button
            type="submit"
            className="tap-target min-h-12 shrink-0 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white"
          >
            Buscar
          </button>
        </form>

        <div className="flex items-center justify-between gap-3">
          <SectionTitle title="Casas" description={`${rows.length} restaurante(s)`} />
          <ReviewSubscriptionsButton />
        </div>

        {rows.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">Nenhum restaurante encontrado.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.restaurant_id}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/restaurantes/${row.restaurant_id}`}
                        className="tap-target inline-flex min-h-11 items-center font-semibold text-ink-900 underline-offset-4 hover:underline"
                      >
                        {row.restaurant_name}
                      </Link>
                      <p className="text-xs text-ink-500">/r/{row.restaurant_slug}</p>
                    </div>
                    <SubscriptionBadge status={row.status} />
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-ink-600">
                    <div className="flex justify-between gap-2">
                      <dt>Plano</dt>
                      <dd className="font-medium text-ink-900">{row.plan_name}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Valor</dt>
                      <dd className="font-medium text-ink-900">
                        {formatPrice(row.price)} {BILLING_INTERVAL_LABEL[row.billing_interval]}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Período</dt>
                      <dd className="font-medium text-ink-900">
                        {row.current_period_start ? formatDate(row.current_period_start) : "—"} →{" "}
                        {row.current_period_end ? formatDate(row.current_period_end) : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Trial</dt>
                      <dd className="font-medium text-ink-900">
                        {row.trial_end ? formatDate(row.trial_end) : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Dias restantes</dt>
                      <dd className="font-medium text-ink-900">{row.days_left ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Gateway</dt>
                      <dd className="font-medium text-ink-900">
                        {row.provider ?? "sem gateway"}
                      </dd>
                    </div>
                  </dl>

                  <SubscriptionEditor
                    restaurantId={row.restaurant_id}
                    restaurantName={row.restaurant_name}
                    plans={planOptions}
                    currentPlanId={row.plan_id}
                    currentStatus={row.status}
                    currentInterval={row.billing_interval}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
