import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { Card, SectionTitle } from "@/components/ui/card";
import { EditPlanButton, NewPlanButton } from "@/components/admin/plan-form";
import { PlanToggle } from "@/components/admin/plan-toggle";
import { TrialSettingsForm } from "@/components/admin/trial-settings";
import { PlanPrice, SubscriptionBadge } from "@/components/billing/plan-card";
import { listAdminPlans, getBillingSummary, getPlatformSettings } from "@/lib/data/billing";
import { PLAN_FEATURE_LABEL, isPlanFeatureKey, PLAN_LIMIT_KEYS, PLAN_LIMIT_LABEL } from "@/lib/types";
import { limitOf } from "@/lib/plan-rules";
import { formatPrice } from "@/lib/validation";

export const metadata: Metadata = { title: "Planos" };
export const dynamic = "force-dynamic";

/**
 * Catálogo de planos — Etapa 11, item 9.
 *
 * Lista **todos** os planos, inclusive os desativados: o admin precisa ver o
 * que saiu da vitrine para poder trazer de volta. Cada card mostra preço,
 * limites e recursos como estão no banco — não há valor duplicado no código.
 */
export default async function AdminPlansPage() {
  const [plans, summary, settings] = await Promise.all([
    listAdminPlans(),
    getBillingSummary(),
    getPlatformSettings(),
  ]);

  return (
    <>
      <AdminHeader title="Planos" subtitle="Catálogo e configuração comercial" />

      <main className="app-shell space-y-5 px-4 pb-8 pt-4">
        {summary && (
          <div className="grid grid-cols-2 gap-3">
            <Card className="space-y-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Assinaturas</p>
              <p className="text-2xl font-bold text-ink-900">{summary.subscriptions_total}</p>
              <p className="text-xs text-ink-500">
                {summary.trials} em teste · {summary.active} ativas
              </p>
            </Card>
            <Card className="space-y-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Receita mensal</p>
              <p className="text-2xl font-bold text-ink-900">{formatPrice(summary.mrr)}</p>
              <p className="text-xs text-ink-500">
                {summary.past_due} em atraso · {summary.expired} expiradas
              </p>
            </Card>
          </div>
        )}

        <Card>
          <SectionTitle
            title="Teste e tolerância"
            description="Configuração global aplicada a todas as casas"
          />
          <TrialSettingsForm trialDays={settings.trial_days ?? 7} graceDays={settings.grace_days ?? 5} />
        </Card>

        <div className="flex items-center justify-between gap-3">
          <SectionTitle
            title="Catálogo"
            description={`${plans.length} plano(s) — os inativos não aparecem em /planos`}
          />
          <NewPlanButton nextPosition={(plans.at(-1)?.position ?? 0) + 10} />
        </div>

        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink-900">{plan.name}</h2>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-ink-600">
                        {plan.id}
                      </span>
                      {!plan.is_active && <SubscriptionBadge status="cancelled" />}
                    </div>
                    {plan.description && <p className="mt-1 text-sm text-ink-500">{plan.description}</p>}
                  </div>
                  <div className="text-right">
                    <PlanPrice price={plan.price} interval={plan.interval} size="sm" />
                    <p className="text-xs text-ink-400">Posição {plan.position}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-600">
                  {PLAN_LIMIT_KEYS.map((key) => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt>{PLAN_LIMIT_LABEL[key]}</dt>
                      <dd className="font-medium text-ink-800">
                        {limitOf(plan.limits, key) ?? "sem limite"}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="flex flex-wrap gap-1.5">
                  {plan.features.length === 0 && (
                    <span className="text-xs text-ink-400">Nenhum recurso marcado</span>
                  )}
                  {plan.features.map((feature) => (
                    <span
                      key={feature}
                      className="rounded-full bg-brand-50 px-2 py-0.5 text-[0.7rem] font-medium text-brand-700"
                    >
                      {isPlanFeatureKey(feature) ? PLAN_FEATURE_LABEL[feature] : feature}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <EditPlanButton plan={plan} />
                  <PlanToggle id={plan.id} active={plan.is_active} />
                </div>
              </Card>
            </li>
          ))}
        </ul>

        <Link
          href="/admin/assinaturas"
          className="tap-target flex min-h-14 items-center justify-between rounded-[var(--radius-card)] border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-800"
        >
          Ver assinaturas das casas
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </main>
    </>
  );
}
