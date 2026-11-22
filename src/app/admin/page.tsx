import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Package,
  PauseCircle,
  ScrollText,
  Store,
  UtensilsCrossed,
  Users,
  CreditCard,
  Banknote,
  Clock3,
  Receipt,
  ChartNoAxesColumn,
  ChevronRight,
} from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { MetricCard } from "@/components/admin/metric-card";
import { getAdminDashboard, listAdminAudit, listAdminRestaurants } from "@/lib/data/admin";
import { getBillingSummary } from "@/lib/data/billing";
import { getAdminPaymentSummary } from "@/lib/data/payments";
import { formatDate } from "@/lib/utils";
import { AUDIT_ACTION_LABEL } from "@/lib/admin-audit";

export const metadata: Metadata = { title: "Início" };
export const dynamic = "force-dynamic";

/**
 * Dashboard da plataforma.
 *
 * Responde às perguntas que o suporte faz ao abrir o painel: quantas casas
 * existem, quantas estão no ar, quantas estão bloqueadas e quanto movimento há
 * hoje. Os cards de "suspensos" e "inativos" são atalhos para a lista filtrada
 * — número sem ação não resolve nada.
 */
export default async function AdminDashboardPage() {
  const [metrics, recent, audit, billing, payments] = await Promise.all([
    getAdminDashboard(),
    listAdminRestaurants(),
    listAdminAudit(6),
    getBillingSummary(),
    // Etapa 19: dinheiro esperando conferência é a primeira coisa da manhã.
    getAdminPaymentSummary(),
  ]);

  if (!metrics) {
    return (
      <>
        <AdminHeader title="Não foi possível carregar" />
        <main className="app-shell px-4 py-6">
          <div className="card p-5 text-sm text-ink-600">
            Os contadores não puderam ser lidos agora. Recarregue a página; se
            persistir, verifique a conexão com o banco.
          </div>
        </main>
      </>
    );
  }

  const latest = recent.slice(0, 4);

  return (
    <>
      <AdminHeader title="Visão geral" subtitle="Toda a plataforma em uma tela" />

      <main className="app-shell space-y-6 px-4 py-5">
        {/* Restaurantes */}
        <section aria-labelledby="metricas-restaurantes">
          <h2 id="metricas-restaurantes" className="mb-2.5 text-sm font-semibold text-ink-700">
            Restaurantes
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Restaurantes"
              value={metrics.restaurants_total}
              icon={Store}
              href="/admin/restaurantes"
              tone="neutral"
            />
            <MetricCard
              label="Ativos"
              value={metrics.restaurants_active}
              icon={CheckCircle2}
              href="/admin/restaurantes?status=published"
              tone="brand"
              hint="No ar para o cliente"
            />
            <MetricCard
              label="Inativos"
              value={metrics.restaurants_inactive}
              icon={PauseCircle}
              href="/admin/restaurantes?status=paused"
              tone="amber"
              hint="Pausados ou em rascunho"
            />
            <MetricCard
              label="Suspensos"
              value={metrics.restaurants_suspended}
              icon={AlertTriangle}
              href="/admin/restaurantes?status=suspended"
              tone="danger"
              hint="Bloqueados pela plataforma"
            />
          </div>
        </section>

        {/* Volume */}
        <section aria-labelledby="metricas-volume">
          <h2 id="metricas-volume" className="mb-2.5 text-sm font-semibold text-ink-700">
            Operação
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard label="Produtos" value={metrics.products_total} icon={Package} />
            <MetricCard label="Mesas" value={metrics.tables_total} icon={UtensilsCrossed} />
            <MetricCard
              label="Pedidos"
              value={metrics.orders_total}
              icon={ClipboardList}
              href="/admin/pedidos"
            />
            <MetricCard
              label="Pedidos hoje"
              value={metrics.orders_today}
              icon={ClipboardList}
              href="/admin/pedidos"
              tone="sky"
              hint="Fuso de Brasília"
            />
          </div>
          <p className="mt-2 text-xs text-ink-500">
            {metrics.users_total}{" "}
            {metrics.users_total === 1 ? "usuário cadastrado" : "usuários cadastrados"} na
            plataforma ·{" "}
            <Link href="/admin/usuarios" className="font-medium text-brand-700 underline-offset-2 hover:underline">
              ver todos
            </Link>
          </p>
        </section>

        {/* Pagamentos PIX (Etapa 19) */}
        {payments && (
          <section aria-labelledby="metricas-pagamentos">
            <h2 id="metricas-pagamentos" className="mb-2.5 text-sm font-semibold text-ink-700">
              Pagamentos PIX
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              <MetricCard
                label="Aguardando confirmação"
                value={payments.pending}
                icon={Clock3}
                href="/admin/pagamentos?status=PENDING"
                tone={payments.pending > 0 ? "amber" : "neutral"}
                hint="Conferir o recebimento"
              />
              <MetricCard
                label="Confirmado no mês"
                value={payments.confirmed_amount_month}
                icon={Banknote}
                href="/admin/pagamentos?status=CONFIRMED"
                tone="brand"
                format="currency"
              />
            </div>
            <p className="mt-2 text-xs text-ink-500">
              A confirmação é sempre manual:{" "}
              <Link
                href="/admin/pagamentos"
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                abrir fila de pagamentos
              </Link>
              {" · "}
              <Link
                href="/admin/settings/payment"
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                dados de recebimento
              </Link>
            </p>
          </section>
        )}

        {/* Comercial (Etapa 11) */}
        {billing && (
          <section aria-labelledby="metricas-comercial">
            <h2 id="metricas-comercial" className="mb-2.5 text-sm font-semibold text-ink-700">
              Planos e assinaturas
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              <MetricCard
                label="Em teste"
                value={billing.trials}
                icon={CreditCard}
                href="/admin/assinaturas"
                hint="Trials em andamento"
              />
              <MetricCard
                label="Assinaturas ativas"
                value={billing.active}
                icon={Receipt}
                href="/admin/assinaturas"
                tone="sky"
              />
              <MetricCard
                label="Receita mensal"
                value={billing.mrr}
                icon={CreditCard}
                href="/admin/planos"
                format="currency"
                hint="Soma dos planos ativos"
              />
              <MetricCard
                label="Em atraso"
                value={billing.past_due}
                icon={AlertTriangle}
                href="/admin/assinaturas"
                tone={billing.past_due > 0 ? "danger" : "neutral"}
              />
            </div>
            <p className="mt-2 text-xs text-ink-500">
              {billing.plans_active} de {billing.plans_total} planos na vitrine ·{" "}
              <Link href="/admin/planos" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                gerenciar planos
              </Link>
            </p>
          </section>
        )}

        {/* Precisa de atenção */}
        {metrics.restaurants_suspended > 0 && (
          <section aria-labelledby="atencao">
            <h2 id="atencao" className="mb-2.5 text-sm font-semibold text-ink-700">
              Precisa de atenção
            </h2>
            <Link
              href="/admin/restaurantes?status=suspended"
              className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">
                  {metrics.restaurants_suspended}{" "}
                  {metrics.restaurants_suspended === 1
                    ? "restaurante suspenso"
                    : "restaurantes suspensos"}
                </strong>
                <span className="mt-0.5 block text-red-700">
                  O cardápio público está fora do ar. Toque para revisar.
                </span>
              </span>
            </Link>
          </section>
        )}

        {/* Últimos cadastros */}
        {latest.length > 0 && (
          <section aria-labelledby="recentes">
            <div className="mb-2.5 flex items-end justify-between gap-3">
              <h2 id="recentes" className="text-sm font-semibold text-ink-700">
                Últimos restaurantes
              </h2>
              <Link
                href="/admin/restaurantes"
                className="text-xs font-semibold text-brand-700 hover:underline"
              >
                Ver todos
              </Link>
            </div>
            <ul className="card divide-y divide-ink-100 p-0">
              {latest.map((restaurant) => (
                <li key={restaurant.id}>
                  <Link
                    href={`/admin/restaurantes/${restaurant.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-xs font-bold text-ink-600">
                      {restaurant.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-900">
                        {restaurant.name}
                      </span>
                      <span className="block truncate text-xs text-ink-500">
                        /r/{restaurant.slug} · {formatDate(restaurant.created_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/*
         * Etapa 16: relatórios da plataforma.
         *
         * Entra como cartão no dashboard, e não como sexta aba da navegação
         * inferior — mesmo critério já usado para Planos/Assinaturas (etapa 11):
         * seis alvos de 56px numa tela de 320px deixam cada aba com ~48px e o
         * rótulo quebra. Quem procura relatório começa pelo dashboard.
         */}
        <section aria-labelledby="relatorios-atalho">
          <h2 id="relatorios-atalho" className="mb-2.5 text-sm font-semibold text-ink-700">
            Relatórios
          </h2>
          <Link
            href="/admin/analytics"
            className="card flex items-center gap-3.5 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] active:scale-[0.99]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <ChartNoAxesColumn className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.95rem] font-semibold text-ink-900">
                Analytics da plataforma
              </span>
              <span className="block truncate text-xs text-ink-500">
                Crescimento, pedidos e receita de todas as casas
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
          </Link>
        </section>

        {/* Auditoria */}
        <section aria-labelledby="atividade">
          <div className="mb-2.5 flex items-end justify-between gap-3">
            <h2 id="atividade" className="text-sm font-semibold text-ink-700">
              Atividade administrativa
            </h2>
            <Link
              href="/admin/auditoria"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              <ScrollText className="size-3.5" aria-hidden="true" />
              Auditoria
            </Link>
          </div>

          {audit.length === 0 ? (
            <p className="card p-4 text-sm text-ink-500">
              Nada registrado ainda. Suspensões, edições e acessos de suporte
              aparecem aqui automaticamente.
            </p>
          ) : (
            <ul className="card divide-y divide-ink-100 p-0">
              {audit.map((event) => (
                <li key={event.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-800">
                      {AUDIT_ACTION_LABEL[event.action] ?? event.action}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {event.restaurant_name ?? "—"} ·{" "}
                      {event.actor_email ?? "sistema"} · {formatDate(event.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[0.7rem] text-ink-400">
          <Users className="size-3.5" aria-hidden="true" />
          Acesso restrito a administradores da plataforma
        </p>
      </main>
    </>
  );
}
