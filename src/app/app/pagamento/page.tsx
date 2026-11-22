import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Card, SectionTitle } from "@/components/ui/card";
import {
  PaymentHistoryList,
  PaymentStatusCard,
  ReceiptUpload,
} from "@/components/payments/payment-status-card";
import { PixInstructions } from "@/components/payments/plan-pix-picker";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getMyPaymentPanel } from "@/lib/data/payments";
import { getMySubscription } from "@/lib/data/billing";
import { canRequestPayment, paymentStage } from "@/lib/payments";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Pagamento" };
export const dynamic = "force-dynamic";

/**
 * `/app/pagamento` — Etapa 19.
 *
 * Também servida em `/dashboard/billing` (a rota que o escopo pede), que
 * reexporta esta página: mesma tela, dois caminhos, nenhuma duplicação — o
 * item 23 do escopo proíbe uma segunda tela de assinatura.
 *
 * A casa vem de `getActiveRestaurant()`, nunca da URL: abrir este endereço não
 * mostra o pagamento de outra pessoa. O PIX exibido é o global da plataforma,
 * e a RPC devolve só os campos de recebimento.
 *
 * Quem não é owner/admin vê o estado e o histórico, mas não vê o formulário de
 * comprovante — quem paga é a casa, e a casa é representada por eles.
 */
export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmado?: string }>;
}) {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const { confirmado } = await searchParams;
  const [panel, subscription] = await Promise.all([
    getMyPaymentPanel(restaurant.id),
    getMySubscription(restaurant.id),
  ]);

  const canManage = restaurant.role === "owner" || restaurant.role === "admin";
  const stage = paymentStage(panel, Boolean(confirmado));
  const pending = panel?.pending ?? null;

  return (
    <>
      <AppHeader title="Pagamento" subtitle={restaurant.name} />

      <main className="app-shell space-y-4 px-4 pb-10 pt-4">
        <Link
          href="/app/plano"
          className="tap-target -mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-600"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Meu plano
        </Link>

        <PaymentStatusCard panel={panel} justConfirmed={Boolean(confirmado)} />

        {pending ? (
          <>
            <PixInstructions
              pix={panel!.pix}
              amount={pending.amount}
              planName={pending.plan_name}
            />

            {canManage && (
              <ReceiptUpload
                requestId={pending.id}
                restaurantId={restaurant.id}
                receiptPathValue={pending.receipt_path}
                disabled={!canManage}
              />
            )}

            <Card className="space-y-2">
              <SectionTitle
                title="Detalhes da solicitação"
                description="O valor sai do catálogo de planos, não da tela"
              />
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Plano</dt>
                  <dd className="font-medium text-ink-900">{pending.plan_name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Período</dt>
                  <dd className="font-medium text-ink-900">
                    {pending.billing_interval === "yearly" ? "12 meses" : "1 mês"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Método</dt>
                  <dd className="font-medium text-ink-900">PIX manual</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Solicitado em</dt>
                  <dd className="font-medium text-ink-900">{formatDate(pending.created_at)}</dd>
                </div>
              </dl>
            </Card>
          </>
        ) : (
          <Card className="space-y-2">
            <SectionTitle title="Nenhum pagamento em análise" />
            <p className="text-sm text-ink-600">
              {canRequestPayment(stage)
                ? "Escolha um plano para gerar a solicitação de pagamento."
                : "Quando o plano estiver perto do vencimento, você poderá pedir a renovação por aqui."}
            </p>
            <Link
              href="/app/plano"
              className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700"
            >
              Escolher plano
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </Card>
        )}

        {subscription && (
          <Card className="space-y-1.5">
            <SectionTitle title="Assinatura" description="Estado registrado no banco" />
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Plano</dt>
                <dd className="font-medium text-ink-900">{subscription.plan.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Vínculo ativo até</dt>
                <dd className="font-medium text-ink-900">
                  {panel?.subscription.period_end ? formatDate(panel.subscription.period_end) : "—"}
                </dd>
              </div>
            </dl>
            <p className="pt-1 text-xs text-ink-400">
              Somente o administrador da plataforma altera o vencimento.
            </p>
          </Card>
        )}

        <Card>
          <SectionTitle title="Histórico" description="Últimos 5 pagamentos desta casa" />
          <PaymentHistoryList history={panel?.history ?? []} />
        </Card>
      </main>
    </>
  );
}
