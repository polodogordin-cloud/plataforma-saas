import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, ChevronRight, Clock3, Filter } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { Card, SectionTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/admin/metric-card";
import {
  getAdminPaymentRequestList,
  getAdminPaymentSummary,
} from "@/lib/data/payments";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";
import {
  BILLING_INTERVAL_LABEL,
  PAYMENT_REQUEST_STATUS_LABEL,
  PAYMENT_REQUEST_STATUS_TONE,
  type PaymentRequestStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pagamentos" };
export const dynamic = "force-dynamic";

const STATUSES: Array<PaymentRequestStatus | "ALL"> = ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "ALL"];

/**
 * `/admin/pagamentos` — Etapa 19, item 10 do escopo.
 *
 * A lista responde, em uma olhada: quem quer assinar, qual plano, quanto, por
 * qual método, quando pediu e se enviou comprovante. Pendentes vêm primeiro e
 * com o destaque que importa — são dinheiro esperando conferência.
 *
 * Sem tabela horizontal: cada pagamento é um cartão vertical com alvo de toque
 * de 44px, porque o master também confirma pelo celular.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const filter = (STATUSES as string[]).includes(status ?? "")
    ? (status as PaymentRequestStatus | "ALL")
    : "PENDING";

  const [rows, summary] = await Promise.all([
    getAdminPaymentRequestList(filter, q),
    getAdminPaymentSummary(),
  ]);

  return (
    <>
      <AdminHeader title="Pagamentos" subtitle="Confirmação manual de PIX" />

      <main className="app-shell space-y-5 px-4 pb-8 pt-4">
        {summary && (
          <section aria-label="Resumo de pagamentos" className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Aguardando"
              value={summary.pending}
              icon={Clock3}
              tone="amber"
              hint="Conferir recebimento"
              href="/admin/pagamentos?status=PENDING"
            />
            <MetricCard
              label="Confirmado no mês"
              value={summary.confirmed_amount_month}
              icon={Banknote}
              tone="brand"
              format="currency"
              href="/admin/pagamentos?status=CONFIRMED"
            />
          </section>
        )}

        <nav aria-label="Filtrar por status" className="flex gap-2 overflow-x-auto pb-1">
          <span className="flex shrink-0 items-center text-ink-400" aria-hidden="true">
            <Filter className="size-4" />
          </span>
          {STATUSES.map((option) => {
            const active = option === filter;
            const label = option === "ALL" ? "Todos" : PAYMENT_REQUEST_STATUS_LABEL[option];
            const href = option === "ALL" ? "/admin/pagamentos?status=ALL" : `/admin/pagamentos?status=${option}`;
            return (
              <Link
                key={option}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "tap-target inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-xs font-semibold ring-1 ring-inset",
                  active
                    ? "bg-ink-900 text-white ring-ink-900"
                    : "bg-white text-ink-600 ring-ink-200",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <section aria-label="Solicitações de pagamento">
          <SectionTitle
            title={filter === "ALL" ? "Todas as solicitações" : `Solicitações · ${PAYMENT_REQUEST_STATUS_LABEL[filter]}`}
            description={q ? `Busca: ${q}` : "Mais recentes primeiro"}
          />

          {rows.length === 0 ? (
            <Card className="text-sm text-ink-500">
              {filter === "PENDING"
                ? "Nenhum pagamento aguardando confirmação. Quando uma casa pedir o PIX, aparece aqui."
                : "Nenhuma solicitação encontrada com este filtro."}
            </Card>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/pagamentos/${row.id}`}
                    className="tap-target block rounded-[var(--radius-card)] border border-ink-200 bg-white p-3.5 shadow-[var(--shadow-soft)] transition-transform active:scale-[0.995]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-900">{row.restaurant_name}</p>
                        <p className="truncate text-xs text-ink-500">
                          {row.requester_name ?? "responsável não informado"}
                          {row.requester_email ? ` · ${row.requester_email}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
                          {
                            success: "bg-brand-50 text-brand-700 ring-brand-200",
                            warning: "bg-amber-50 text-amber-700 ring-amber-200",
                            danger: "bg-red-50 text-red-700 ring-red-200",
                            info: "bg-sky-50 text-sky-700 ring-sky-200",
                            neutral: "bg-ink-50 text-ink-600 ring-ink-200",
                          }[PAYMENT_REQUEST_STATUS_TONE[row.status]],
                        )}
                      >
                        {PAYMENT_REQUEST_STATUS_LABEL[row.status]}
                      </span>
                    </div>

                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div className="min-w-0">
                        <dt className="text-ink-400">Plano</dt>
                        <dd className="truncate font-medium text-ink-800">{row.plan_name}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-ink-400">Valor</dt>
                        <dd className="font-bold text-ink-900">{formatPrice(row.amount)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-ink-400">Período</dt>
                        <dd className="font-medium text-ink-800">
                          {BILLING_INTERVAL_LABEL[row.billing_interval]}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-ink-400">Pedido em</dt>
                        <dd className="font-medium text-ink-800">{formatDate(row.created_at)}</dd>
                      </div>
                    </dl>

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-ink-100 pt-2 text-xs">
                      <span className={row.receipt_path ? "text-brand-700" : "text-ink-400"}>
                        {row.receipt_path ? "Comprovante anexado" : "Sem comprovante"}
                      </span>
                      <span className="inline-flex items-center gap-0.5 font-semibold text-ink-700">
                        Ver detalhes
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
