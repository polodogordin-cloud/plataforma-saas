import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { MetricCard } from "@/components/admin/metric-card";
import { Card, SectionTitle } from "@/components/ui/card";
import { DailyBars, RankedBars } from "@/components/analytics/charts";
import { getAdminAnalytics } from "@/lib/data/analytics";
import { computeGrowth, formatCount, formatMoney, formatMoneyCompact, maxOf } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Relatórios" };

/**
 * Analytics da plataforma — Etapa 16 (item ADMIN MASTER).
 *
 * `force-dynamic`: os números mudam com pedidos chegando em todas as casas.
 *
 * A tela é de admin, então "global" é o contrato — diferente de
 * `/app/analytics`, onde o recorte por tenant é a regra. O guard é
 * `is_platform_admin()` dentro de `admin_analytics`; o layout de `/admin` já
 * barra antes, mas a função do banco barra de novo.
 *
 * A janela de crescimento é escolhida por querystring (7/30/90) e validada no
 * banco — pedir 3650 dias não trava nada.
 */
export const dynamic = "force-dynamic";

const WINDOWS = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
] as const;

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.janela) ? params.janela[0] : params.janela;
  const requested = Number(raw);
  const days = WINDOWS.some((w) => w.days === requested) ? requested : 30;

  const data = await getAdminAnalytics(days);

  if (!data) {
    return (
      <>
        <AdminHeader title="Relatórios" />
        <main className="app-shell px-4 py-6">
          <Card className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink-900">Não foi possível carregar</p>
              <p className="mt-1 text-sm text-ink-500">
                As métricas da plataforma não puderam ser lidas agora. Recarregue a página.
              </p>
            </div>
          </Card>
        </main>
      </>
    );
  }

  const { summary, daily } = data;

  const restaurantGrowth = computeGrowth(
    summary.restaurants_new,
    summary.restaurants_previous,
    summary.restaurants_previous > 0,
  );
  const orderGrowth = computeGrowth(
    summary.orders_new,
    summary.orders_previous,
    summary.orders_previous > 0,
  );

  const peakDay = daily.reduce(
    (best, day) => (day.orders_count > best.orders_count ? day : best),
    daily[0] ?? { day: "", orders_count: 0 },
  );

  const hasMovement = summary.orders_total > 0;
  const collectionRate =
    summary.orders_value > 0 ? Math.round((summary.paid_value / summary.orders_value) * 100) : 0;

  return (
    <>
      <AdminHeader
        title="Relatórios"
        subtitle={`Plataforma · últimos ${summary.days} dias`}
      />

      <main className="app-shell space-y-6 px-4 py-5">
        {/* Janela de comparação */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-1.5" role="group" aria-label="Janela de análise">
            {WINDOWS.map((window) => (
              <Link
                key={window.days}
                href={`/admin/analytics?janela=${window.days}`}
                aria-current={days === window.days ? "true" : undefined}
                className={cn(
                  "tap-target inline-flex shrink-0 items-center rounded-full border px-3.5 text-[0.82rem] font-semibold transition",
                  days === window.days
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-200 bg-white text-ink-600",
                )}
              >
                {window.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Crescimento */}
        <section aria-labelledby="crescimento">
          <SectionTitle
            title="Crescimento"
            description={`Comparado aos ${summary.days} dias anteriores`}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col rounded-xl border border-ink-200/70 bg-white p-3">
              <span className="grid size-6 place-items-center rounded-md bg-brand-50 text-brand-700">
                <Store className="size-3.5" aria-hidden="true" />
              </span>
              <p className="mt-2 text-[1.35rem] leading-none font-semibold tabular-nums text-ink-900">
                +{formatCount(summary.restaurants_new)}
              </p>
              <p className="mt-1 text-[0.7rem] font-medium text-ink-500">Novos restaurantes</p>
              <p
                className={cn(
                  "mt-1 text-[0.66rem] font-semibold",
                  restaurantGrowth.direction === "up" && "text-brand-700",
                  restaurantGrowth.direction === "down" && "text-red-600",
                  restaurantGrowth.direction === "flat" && "text-ink-400",
                )}
              >
                {restaurantGrowth.label}
              </p>
            </div>

            <div className="flex flex-col rounded-xl border border-ink-200/70 bg-white p-3">
              <span className="grid size-6 place-items-center rounded-md bg-sky-50 text-sky-700">
                <ClipboardList className="size-3.5" aria-hidden="true" />
              </span>
              <p className="mt-2 text-[1.35rem] leading-none font-semibold tabular-nums text-ink-900">
                +{formatCount(summary.orders_new)}
              </p>
              <p className="mt-1 text-[0.7rem] font-medium text-ink-500">Novos pedidos</p>
              <p
                className={cn(
                  "mt-1 text-[0.66rem] font-semibold",
                  orderGrowth.direction === "up" && "text-brand-700",
                  orderGrowth.direction === "down" && "text-red-600",
                  orderGrowth.direction === "flat" && "text-ink-400",
                )}
              >
                {orderGrowth.label}
              </p>
            </div>
          </div>
        </section>

        {/* Restaurantes */}
        <section aria-labelledby="casas">
          <SectionTitle title="Restaurantes" />
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Cadastrados"
              value={formatCount(summary.restaurants_total)}
              icon={Store}
              href="/admin/restaurantes"
              tone="neutral"
            />
            <MetricCard
              label="No ar"
              value={formatCount(summary.restaurants_active)}
              icon={CheckCircle2}
              href="/admin/restaurantes?status=published"
              tone="brand"
            />
            <MetricCard
              label="Suspensos"
              value={formatCount(summary.restaurants_suspended)}
              icon={AlertCircle}
              href="/admin/restaurantes?status=suspended"
              tone={summary.restaurants_suspended > 0 ? "danger" : "neutral"}
            />
            <MetricCard
              label="Assinaturas ativas"
              value={formatCount(summary.active_subscriptions)}
              icon={CreditCard}
              href="/admin/assinaturas"
              tone="sky"
              hint={`${summary.trials_now} em teste`}
            />
          </div>
        </section>

        {/* Volume */}
        <section aria-labelledby="volume-plataforma">
          <SectionTitle title="Volume" description="Todas as casas, desde o início" />
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Pedidos totais"
              value={formatCount(summary.orders_total)}
              icon={ClipboardList}
              tone="neutral"
              hint={
                summary.orders_cancelled > 0
                  ? `${formatCount(summary.orders_cancelled)} cancelados`
                  : undefined
              }
            />
            <MetricCard
              label="Valor pedido"
              value={formatMoneyCompact(summary.orders_value)}
              icon={TrendingUp}
              tone="brand"
            />
            <MetricCard
              label="Recebido"
              value={formatMoneyCompact(summary.paid_value)}
              icon={Wallet}
              tone="sky"
              hint={hasMovement ? `${collectionRate}% do valor pedido` : undefined}
            />
            <MetricCard
              label="MRR"
              value={formatMoneyCompact(summary.mrr)}
              icon={Sparkles}
              tone="neutral"
              hint="Só assinaturas pagas"
            />
          </div>
          <p className="mt-2 text-[0.7rem] leading-snug text-ink-400">
            &quot;Valor pedido&quot; é o que os clientes pediram; &quot;recebido&quot; é o que as
            casas registraram como pago. Os dois divergem quando a conta ainda não foi lançada — de
            propósito.
          </p>
        </section>

        {/* Pedidos por dia */}
        <section aria-labelledby="pedidos-dia-plataforma">
          <SectionTitle
            title="Pedidos por dia"
            description={
              peakDay && peakDay.orders_count > 0
                ? `Pico: ${formatCount(peakDay.orders_count)} em um dia`
                : "Sem pedidos na janela"
            }
          />
          <Card>
            <DailyBars
              data={daily.map((day) => ({
                day: day.day,
                orders_count: day.orders_count,
                orders_value: day.orders_value,
                paid_value: 0,
                cancelled_count: 0,
              }))}
              metric="orders_count"
              formatValue={formatCount}
            />
          </Card>
        </section>

        {/* Novos restaurantes por dia */}
        {maxOf(daily, (d) => d.restaurants_new) > 0 && (
          <section aria-labelledby="novas-casas">
            <SectionTitle title="Novas casas por dia" />
            <Card>
              <RankedBars
                items={[...daily]
                  .filter((day) => day.restaurants_new > 0)
                  .slice(-7)
                  .map((day) => ({
                    key: day.day,
                    label: day.day.split("-").reverse().slice(0, 2).join("/"),
                    value: day.restaurants_new,
                    valueLabel: formatCount(day.restaurants_new),
                  }))}
              />
            </Card>
          </section>
        )}

        <p className="pb-2 text-center text-[0.7rem] leading-relaxed text-ink-400">
          Visão global da plataforma — acesso restrito a administradores.
        </p>
      </main>
    </>
  );
}
