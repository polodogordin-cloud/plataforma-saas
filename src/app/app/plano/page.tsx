import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, ShieldQuestion } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import { StartTrialButton } from "@/components/billing/plan-switcher";
import { PaymentStatusCard } from "@/components/payments/payment-status-card";
import { PlanPixPicker } from "@/components/payments/plan-pix-picker";
import { FeatureList, PlanPrice, SubscriptionBadge } from "@/components/billing/plan-card";
import { UsageMeter } from "@/components/billing/usage-meter";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getMySubscription, listAdminPlans } from "@/lib/data/billing";
import { getMyPaymentPanel } from "@/lib/data/payments";
import { paymentStage } from "@/lib/payments";
import {
  daysUntil,
  formatUsage,
  subscriptionHeadline,
  usageEntries,
} from "@/lib/plan-rules";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";
import type { PlanCatalogEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Meu plano" };
export const dynamic = "force-dynamic";

/**
 * "Meu plano" — Etapa 11, item 5 do escopo.
 *
 * A tela responde cinco perguntas, na ordem em que o dono as faz:
 *
 *   1. **Qual plano é o meu?** (nome, preço, status)
 *   2. **Até quando?** (renovação ou fim do teste)
 *   3. **O que eu tenho?** (recursos liberados)
 *   4. **Quanto eu já usei?** (barras de limite, com o número do banco)
 *   5. **Como mudo?** (gerenciar plano)
 *
 * O plano atual e o uso vêm de `my_subscription`, que resolve a casa pelo
 * vínculo do usuário logado — não existe `restaurantId` na URL, então abrir a
 * tela nunca mostra dados de outra casa.
 */
export default async function MyPlanPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [subscription, plans, paymentPanel] = await Promise.all([
    getMySubscription(restaurant.id),
    listAdminPlans(),
    getMyPaymentPanel(restaurant.id),
  ]);

  // Etapa 19: o estágio comercial (sem plano / aguardando / confirmado / ativo /
  // vencendo / expirado) vem de uma função só, a mesma do dashboard e da tela
  // de pagamento — para as três telas não contarem histórias diferentes.
  const stage = paymentStage(paymentPanel);

  const canManage = restaurant.role === "owner" || restaurant.role === "admin";

  if (!subscription) {
    return (
      <>
        <AppHeader title="Meu plano" subtitle={restaurant.name} />
        <main className="app-shell px-4 pb-6 pt-4">
          <Card className="space-y-3 text-center">
            <ShieldQuestion className="mx-auto size-8 text-ink-400" aria-hidden="true" />
            <h2 className="font-semibold text-ink-900">Não foi possível carregar seu plano</h2>
            <p className="text-sm text-ink-500">
              Tente novamente em instantes. Se continuar, fale com o suporte da plataforma.
            </p>
          </Card>
        </main>
      </>
    );
  }

  const catalog: PlanCatalogEntry[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    interval: plan.interval,
    features: plan.features,
    limits: plan.limits,
  }));

  const visiblePlans = catalog.length > 0 ? catalog : [subscription.plan];
  const deadline = subscription.status === "trial" ? subscription.trial_end : subscription.period_end;
  const remaining = daysUntil(deadline);

  // Um plano só fica indisponível por motivo conhecido quando o uso atual já
  // passou do limite dele — o banco recusaria (`plan_downgrade_too_small`), e
  // o sheet explica antes.
  const blockedPlans: Record<string, string> = {};
  for (const plan of visiblePlans) {
    const tablesLimit = plan.limits.max_tables ?? null;
    const productsLimit = plan.limits.max_products ?? null;
    if (tablesLimit !== null && subscription.usage.tables.used > tablesLimit) {
      blockedPlans[plan.id] = `Você tem ${subscription.usage.tables.used} mesas e este plano permite ${tablesLimit}.`;
    } else if (productsLimit !== null && subscription.usage.products.used > productsLimit) {
      blockedPlans[plan.id] = `Você tem ${subscription.usage.products.used} produtos e este plano permite ${productsLimit}.`;
    }
  }

  const usage = usageEntries(subscription.usage);

  return (
    <>
      <AppHeader title="Meu plano" subtitle={restaurant.name} />

      <main className="app-shell space-y-5 px-4 pb-8 pt-4">
        {/* Plano atual */}
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Plano atual
              </p>
              <h1 className="text-xl font-bold tracking-tight text-ink-900">
                {subscription.plan.name}
              </h1>
            </div>
            <SubscriptionBadge status={subscription.status} />
          </div>

          <PlanPrice price={subscription.price_snapshot} interval={subscription.plan.interval} />

          <p className="rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
            {subscriptionHeadline(subscription.status, remaining)}
          </p>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-ink-500">Renovação</dt>
              <dd className="font-medium text-ink-900">
                {deadline ? formatDate(deadline) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">
                {subscription.status === "trial" ? "Fim do teste" : "Início do período"}
              </dt>
              <dd className="font-medium text-ink-900">
                {subscription.status === "trial"
                  ? subscription.trial_end
                    ? formatDate(subscription.trial_end)
                    : "—"
                  : subscription.period_start
                    ? formatDate(subscription.period_start)
                    : "—"}
              </dd>
            </div>
          </dl>

          {!subscription.has_subscription && (
            <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-sky-900">
                <CalendarClock className="size-4" aria-hidden="true" />
                Você ainda não iniciou um teste gratuito.
              </p>
              {canManage && <StartTrialButton days={subscription.trial_days} />}
            </div>
          )}
        </Card>

        {/* Etapa 19: estado do pagamento (aguardando / confirmado / vencendo…). */}
        <PaymentStatusCard panel={paymentPanel} compact />

        {/* Etapa 19: contratar/renovar passa por PIX, com confirmação manual.
            O preço mostrado vem do catálogo e o valor gravado vem do banco —
            a tela não envia preço em lugar nenhum. */}
        <PlanPixPicker
          plans={visiblePlans.filter((plan) => plan.price > 0)}
          currentPlanId={subscription.plan.id}
          currentInterval={subscription.plan.interval}
          pix={paymentPanel?.pix ?? { is_active: false, is_configured: false, recipient_name: null, pix_key: null, pix_key_type: null, instructions: null, qr_code_url: null }}
          canManage={canManage}
          blockedPlans={blockedPlans}
          hasPending={Boolean(paymentPanel?.pending)}
        />

        {stage === "pending" && (
          <Link
            href="/app/pagamento"
            className="tap-target flex min-h-11 items-center justify-between rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-900"
          >
            Ver instruções do PIX
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}

        {/* Recursos */}
        <Card>
          <SectionTitle
            title="Recursos do seu plano"
            description="O que já está liberado nesta casa"
          />
          <FeatureList features={subscription.plan.features} />
          <Link
            href="/planos"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700"
          >
            Comparar planos
          </Link>
        </Card>

        {/* Limites */}
        <Card>
          <SectionTitle title="Uso do plano" description="Você vê exatamente o que o sistema aplica" />
          <div className="space-y-4">
            {usage.map(({ key, label, counter }) => (
              <UsageMeter
                key={key}
                label={label}
                counter={counter}
                hint={counter.limit === null ? "Sem limite neste plano" : undefined}
              />
            ))}
          </div>

          {usage.some(({ counter }) => counter.limit !== null && counter.used >= counter.limit) && (
            <div className="mt-4 space-y-1.5 rounded-xl bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-medium text-amber-800">
                Um ou mais limites foram atingidos.
              </p>
              <Link
                href="/planos"
                className="tap-target -my-1 inline-flex min-h-11 items-center text-sm font-semibold text-amber-900 underline"
              >
                Ver planos para liberar mais
              </Link>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Badge tone="muted">Plano {subscription.plan.id}</Badge>
          <span>
            Limites aplicados pelo banco de dados, não pela tela.
          </span>
        </div>

        <p className="text-center text-xs text-ink-400">
          {formatUsage(subscription.usage.products)} produtos ·{" "}
          {formatPrice(subscription.price_snapshot)}
          {subscription.price_snapshot > 0 ? " por mês" : ""}
        </p>
      </main>
    </>
  );
}
