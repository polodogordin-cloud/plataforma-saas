import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  BellRing,
  CalendarClock,
  ChartNoAxesColumn,
  CircleSlash,
  Coins,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Card, SectionTitle } from "@/components/ui/card";
import { AnalyticsMetric, MetricRow, RefreshButton } from "@/components/analytics/metric-card";
import { DailyBars, HoursBars, RankedBars, TrendArea } from "@/components/analytics/charts";
import { PeriodFilter } from "@/components/analytics/period-filter";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getAnalytics } from "@/lib/data/analytics";
import {
  describePeriod,
  formatCount,
  formatDayLabel,
  formatHour,
  formatMoney,
  formatMoneyCompact,
  hasEnoughForTrend,
  isEmptyPeriod,
  validateCustomRange,
} from "@/lib/analytics";
import {
  ANALYTICS_PERIODS,
  ANALYTICS_NEEDS_DATES,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  type AnalyticsPeriod,
  type OrderStatus,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Relatórios",
  // Relatório é dado de negócio do dono: nunca indexado.
  robots: { index: false, follow: false },
};

/**
 * Analytics do restaurante — Etapa 16.
 *
 * `force-dynamic` de propósito. O período vem da querystring e o conteúdo muda
 * com pedidos que chegam no salão; cachear esta página serviria número velho
 * para quem está decidindo compra de insumo. O custo é uma consulta por
 * abertura — e é por isso que as agregações são funções de banco indexadas e
 * não `select *` de pedidos trazido para o Node somar.
 *
 * (O cardápio público continua ISR; esta decisão vale só para o painel.)
 */
export const dynamic = "force-dynamic";

/** Lê e valida o período da URL. Nunca confia no valor cru. */
function parsePeriod(searchParams: Record<string, string | string[] | undefined>): {
  preset: AnalyticsPeriod;
  from: string | null;
  to: string | null;
  invalid: string | null;
} {
  const raw = Array.isArray(searchParams.periodo) ? searchParams.periodo[0] : searchParams.periodo;
  const known = ANALYTICS_PERIODS.some((p) => p.id === raw);
  const preset = (known ? raw : "today") as AnalyticsPeriod;

  if (!ANALYTICS_NEEDS_DATES(preset)) {
    return { preset, from: null, to: null, invalid: null };
  }

  const from = Array.isArray(searchParams.de) ? searchParams.de[0] : searchParams.de;
  const to = Array.isArray(searchParams.ate) ? searchParams.ate[0] : searchParams.ate;

  const problem = validateCustomRange(from ?? "", to ?? "");
  if (problem) return { preset: "today", from: null, to: null, invalid: problem };

  return { preset, from: from ?? null, to: to ?? null, invalid: null };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const params = await searchParams;
  const { preset, from, to, invalid } = parsePeriod(params);

  const payload = await getAnalytics({
    restaurantId: restaurant.id,
    preset,
    from,
    to,
  });

  const header = (
    <AppHeader
      title="Relatórios"
      subtitle={payload ? describePeriod(preset, payload.summary.from_date, payload.summary.to_date) : restaurant.name}
    />
  );

  // ── Estado de erro ────────────────────────────────────────────────────────
  // Distinguir "falhou" de "sem dados" é o que evita o dono achar que perdeu
  // o movimento do mês. Aqui a mensagem fala de conexão, não de venda.
  if (!payload) {
    return (
      <>
        {header}
        <main className="app-shell space-y-4 px-4 py-5">
          <Card className="space-y-3 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-50 text-red-600">
              <AlertCircle className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-ink-900">Não foi possível carregar os relatórios</p>
              <p className="mt-1 text-sm text-ink-500">
                Pode ser a conexão. Tente atualizar — nenhum dado foi perdido.
              </p>
            </div>
            <RefreshButton className="mx-auto" />
          </Card>
        </main>
      </>
    );
  }

  const { summary, previous, daily, hours, products, categories, tables, methods } = payload;

  const empty = isEmptyPeriod(summary);
  const daysWithOrders = daily.filter((d) => d.orders_count > 0).length;
  const canTrend = hasEnoughForTrend(daysWithOrders);

  const growth = (current: number, prev: number) => ({
    current,
    previous: prev,
    hasPreviousData: previous.has_data,
  });

  const maxHour = hours.reduce(
    (best, hour) => (hour.orders_count > best.orders_count ? hour : best),
    hours[0] ?? { hour: 0, orders_count: 0, orders_value: 0 },
  );

  const totalMethod = methods.reduce((sum, m) => sum + m.amount, 0);

  return (
    <>
      {header}

      <main className="app-shell space-y-5 px-4 pb-6 pt-4">
        {invalid && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            {invalid} Mostrando hoje.
          </p>
        )}

        <PeriodFilter preset={preset} from={summary.from_date} to={summary.to_date} />

        {empty ? (
          <EmptyState restaurantName={restaurant.name} />
        ) : (
          <>
            {/* ── Faturamento e dinheiro recebido ─────────────────────────── */}
            <section aria-labelledby="faturamento">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h2 id="faturamento" className="text-sm font-semibold text-ink-700">
                  Faturamento
                </h2>
                <RefreshButton />
              </div>

              {/*
               * Os dois cards que o escopo exige separar. O visual reforça a
               * diferença: "pedido" em branco, "recebido" em verde cheio — um
               * parece um total, o outro parece dinheiro no caixa.
               */}
              <div className="grid grid-cols-2 gap-2.5">
                <AnalyticsMetric
                  label="Pedido"
                  value={formatMoneyCompact(summary.orders_value)}
                  rawValue={formatMoney(summary.orders_value)}
                  icon={ShoppingBag}
                  tone="neutral"
                  growth={growth(summary.orders_value, previous.orders_value)}
                />
                <div className="flex flex-col rounded-xl border border-brand-700 bg-brand-600 p-3 shadow-[var(--shadow-soft)]">
                  <div className="flex items-center gap-1.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/15 text-white">
                      <Wallet className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 truncate text-[0.7rem] font-semibold leading-tight text-brand-50">
                      Recebido
                    </span>
                  </div>
                  <p
                    className="mt-2 text-[1.35rem] leading-none font-semibold tabular-nums tracking-tight text-white"
                    title={formatMoney(summary.paid_value)}
                  >
                    {formatMoneyCompact(summary.paid_value)}
                  </p>
                  <p className="mt-1.5 text-[0.68rem] font-semibold text-brand-100">
                    {summary.unpaid_value > 0
                      ? `${formatMoneyCompact(summary.unpaid_value)} a receber`
                      : "tudo recebido"}
                  </p>
                </div>
              </div>

              {summary.unpaid_value > 0 && (
                <Link
                  href="/app/pedidos"
                  className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 transition active:scale-[0.99]"
                >
                  <Coins className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-[0.78rem] leading-snug text-amber-800">
                    <strong className="font-semibold">{formatMoney(summary.unpaid_value)}</strong> em
                    pedidos ainda não marcados como pagos. Registre o recebimento no detalhe do
                    pedido.
                  </span>
                </Link>
              )}
            </section>

            {/* ── Volume ──────────────────────────────────────────────────── */}
            <section aria-labelledby="volume">
              <h2 id="volume" className="mb-2.5 text-sm font-semibold text-ink-700">
                Movimento
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                <AnalyticsMetric
                  label="Pedidos"
                  value={formatCount(summary.orders_count)}
                  icon={ReceiptText}
                  tone="brand"
                  growth={growth(summary.orders_count, previous.orders_count)}
                />
                <AnalyticsMetric
                  label="Ticket médio"
                  value={formatMoneyCompact(summary.ticket_average)}
                  rawValue={formatMoney(summary.ticket_average)}
                  icon={TrendingUp}
                  tone="sky"
                  growth={growth(summary.ticket_average, previous.ticket_average)}
                />
                <AnalyticsMetric
                  label="Itens vendidos"
                  value={formatCount(summary.items_sold)}
                  icon={UtensilsCrossed}
                  tone="neutral"
                />
                <AnalyticsMetric
                  label="Cancelados"
                  value={formatCount(summary.orders_cancelled)}
                  hint={
                    summary.cancelled_value > 0
                      ? `${formatMoneyCompact(summary.cancelled_value)} perdidos`
                      : undefined
                  }
                  icon={CircleSlash}
                  tone={summary.orders_cancelled > 0 ? "danger" : "neutral"}
                />
              </div>
            </section>

            {/* ── Vendas por dia ─────────────────────────────────────────── */}
            <section aria-labelledby="vendas">
              <SectionTitle title="Vendas por dia" description="Valor dos pedidos, sem cancelados" />
              <Card>
                {canTrend ? (
                  <TrendArea data={daily} metric="orders_value" formatValue={formatMoney} />
                ) : (
                  <InsufficientData
                    message={
                      daysWithOrders === 0
                        ? "Nenhuma venda no período."
                        : "Só um dia com venda — o gráfico de evolução aparece a partir de dois."
                    }
                    fallback={
                      <div className="space-y-1">
                        {daily
                          .filter((d) => d.orders_count > 0)
                          .map((d) => (
                            <MetricRow
                              key={d.day}
                              label={formatDayLabel(d.day)}
                              value={formatMoney(d.orders_value)}
                            />
                          ))}
                      </div>
                    }
                  />
                )}
              </Card>
            </section>

            {/* ── Pedidos por dia ────────────────────────────────────────── */}
            <section aria-labelledby="pedidos-dia">
              <SectionTitle title="Pedidos por dia" description="Quantidade, dia a dia" />
              <Card>
                <DailyBars data={daily} metric="orders_count" formatValue={formatCount} />
              </Card>
            </section>

            {/* ── Horários de pico ───────────────────────────────────────── */}
            <section aria-labelledby="pico">
              <SectionTitle
                title="Horários de pico"
                description={
                  maxHour.orders_count > 0
                    ? `Pico às ${formatHour(maxHour.hour)} · ${maxHour.orders_count} ${maxHour.orders_count === 1 ? "pedido" : "pedidos"}`
                    : undefined
                }
              />
              <Card>
                <HoursBars data={hours} />
              </Card>
            </section>

            {/* ── Produtos ───────────────────────────────────────────────── */}
            {products.length > 0 && (
              <section aria-labelledby="produtos">
                <SectionTitle title="Produtos mais vendidos" description="Por quantidade" />
                <Card>
                  <RankedBars
                    items={products.map((product) => ({
                      key: product.product_name,
                      label: product.product_name,
                      value: product.quantity,
                      valueLabel: `${formatCount(product.quantity)} · ${formatMoneyCompact(product.revenue)}`,
                    }))}
                  />
                </Card>
              </section>
            )}

            {/* ── Categorias ─────────────────────────────────────────────── */}
            {categories.length > 0 && (
              <section aria-labelledby="categorias">
                <SectionTitle title="Categorias" description="De onde vem a venda" />
                <Card>
                  <RankedBars
                    items={categories.map((category) => ({
                      key: category.category_id ?? category.category_name,
                      label: category.category_name,
                      value: category.quantity,
                      valueLabel: formatMoneyCompact(category.revenue),
                    }))}
                  />
                </Card>
              </section>
            )}

            {/* ── Mesas ──────────────────────────────────────────────────── */}
            {tables.length > 0 && (
              <section aria-labelledby="mesas">
                <SectionTitle title="Mesas que mais vendem" description="Volume por mesa" />
                <Card>
                  <RankedBars
                    items={tables.map((table) => ({
                      key: table.table_id,
                      label: table.table_name,
                      value: table.orders_count,
                      valueLabel: `${formatCount(table.orders_count)} · ${formatMoneyCompact(table.orders_value)}`,
                    }))}
                  />
                </Card>
              </section>
            )}

            {/* ── Pagamentos e atendimento ───────────────────────────────── */}
            <section aria-labelledby="recebimentos">
              <SectionTitle
                title="Recebimentos"
                description="Como o dinheiro entrou"
              />
              <Card className="space-y-3">
                {methods.length === 0 ? (
                  <p className="py-1 text-sm text-ink-500">
                    Nenhum pagamento registrado no período. O valor recebido aparece aqui assim que
                    a equipe registrar o recebimento de um pedido.
                  </p>
                ) : (
                  <>
                    <RankedBars
                      items={methods.map((method) => ({
                        key: method.method,
                        label: PAYMENT_METHOD_LABEL[method.method],
                        value: method.amount,
                        valueLabel: formatMoneyCompact(method.amount),
                      }))}
                    />
                    <div className="border-t border-ink-100 pt-1">
                      <MetricRow label="Total recebido" value={formatMoney(totalMethod)} tone="brand" />
                    </div>
                  </>
                )}
              </Card>
            </section>

            {/* ── Atendimento ────────────────────────────────────────────── */}
            <section aria-labelledby="atendimento">
              <SectionTitle title="Atendimento" description="Atenção pedida na mesa" />
              <Card>
                <MetricRow
                  label="Chamadas de garçom"
                  value={formatCount(summary.waiter_calls)}
                  tone="warning"
                />
                <MetricRow label="Pedidos de conta" value={formatCount(summary.bill_requests)} />
              </Card>
            </section>

            {/* ── Pedidos por status ─────────────────────────────────────── */}
            <section aria-labelledby="status">
              <SectionTitle title="Pedidos por status" description="Como o período terminou" />
              <Card>
                {Object.keys(summary.orders_by_status).length === 0 ? (
                  <p className="text-sm text-ink-500">Nenhum pedido no período.</p>
                ) : (
                  (Object.entries(summary.orders_by_status) as Array<[OrderStatus, number]>)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => (
                      <MetricRow
                        key={status}
                        label={ORDER_STATUS_LABEL[status] ?? status}
                        value={formatCount(count)}
                        tone={status === "cancelled" ? "danger" : "neutral"}
                      />
                    ))
                )}
              </Card>
            </section>

            {/* ── Comparação ─────────────────────────────────────────────── */}
            <section aria-labelledby="comparacao">
              <SectionTitle title="Comparação" description="Mesmo tamanho de período, antes" />
              <Card className="space-y-1">
                <p className="mb-1 text-[0.72rem] text-ink-400">
                  {previous.from_date && previous.to_date
                    ? `${formatDayLabel(previous.from_date)} – ${formatDayLabel(previous.to_date)}`
                    : "período anterior"}
                </p>
                <MetricRow label="Pedidos" value={formatCount(previous.orders_count)} />
                <MetricRow label="Valor dos pedidos" value={formatMoney(previous.orders_value)} />
                <MetricRow label="Recebido" value={formatMoney(previous.paid_value)} />
                <MetricRow label="Ticket médio" value={formatMoney(previous.ticket_average)} />
                {!previous.has_data && (
                  <p className="pt-1.5 text-[0.72rem] leading-snug text-ink-400">
                    Sem movimento no período anterior — percentual de crescimento fica sem base de
                    comparação.
                  </p>
                )}
              </Card>
            </section>
          </>
        )}

        <p className="pb-2 text-center text-[0.7rem] leading-relaxed text-ink-400">
          Relatórios do seu restaurante. Nenhum dado de outra casa aparece aqui.
        </p>
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Estados                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Período sem nenhum movimento.
 *
 * A frase é delicada de propósito: "sem dados" num painel novo parece defeito,
 * então a tela explica **o que** ainda não aconteceu e **o que fazer** para
 * acontecer — em vez de mostrar quatro gráficos zerados que parecem quebrados.
 */
function EmptyState({ restaurantName }: { restaurantName: string }) {
  return (
    <Card className="space-y-4 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-50 text-brand-700">
        <ChartNoAxesColumn className="size-7" aria-hidden="true" />
      </span>

      <div className="space-y-1.5">
        <p className="font-semibold text-ink-900">Ainda não há movimento neste período</p>
        <p className="text-sm leading-relaxed text-ink-500">
          Assim que os clientes fizerem pedidos pelo QR Code de {restaurantName}, os números
          aparecem aqui: faturamento, produtos mais vendidos, horários de pico e mesas que mais
          vendem.
        </p>
      </div>

      <div className="space-y-2 border-t border-ink-100 pt-4 text-left">
        <p className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-400">
          Para começar
        </p>
        <Link
          href="/app/mesas"
          className="flex items-center gap-2.5 rounded-xl border border-ink-200 px-3.5 py-2.5 transition active:scale-[0.99]"
        >
          <UtensilsCrossed className="size-4 shrink-0 text-brand-700" aria-hidden="true" />
          <span className="text-sm font-medium text-ink-800">Confira os QR Codes das mesas</span>
        </Link>
        <Link
          href="/app/cardapio"
          className="flex items-center gap-2.5 rounded-xl border border-ink-200 px-3.5 py-2.5 transition active:scale-[0.99]"
        >
          <ShoppingBag className="size-4 shrink-0 text-brand-700" aria-hidden="true" />
          <span className="text-sm font-medium text-ink-800">Revise o cardápio publicado</span>
        </Link>
      </div>

      <p className="text-[0.72rem] leading-snug text-ink-400">
        Tentando outro período? Use os filtros acima — o movimento pode estar em outro dia.
      </p>
    </Card>
  );
}

/**
 * "Dados insuficientes" — diferente de "sem dados".
 *
 * Aqui existe número, mas não existe série: um único dia de venda não forma
 * tendência. Em vez de desenhar um gráfico enganoso, a tela mostra o número
 * exato em lista e explica quando o gráfico aparece.
 */
function InsufficientData({
  message,
  fallback,
}: {
  message: string;
  fallback: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2">
        <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
        <p className="text-[0.75rem] leading-snug text-ink-500">{message}</p>
      </div>
      {fallback}
    </div>
  );
}
