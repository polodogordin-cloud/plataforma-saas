"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChefHat, Loader2, MessageSquareText, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PaymentSection } from "@/components/orders/payment-section";
import { formatPrice } from "@/lib/validation";
import { STATUS_TONE } from "@/lib/order-status";
import { orderAgeLabel, orderClock, orderDate } from "@/lib/order-time";
import {
  ORDER_CANCELLABLE,
  ORDER_NEXT_ACTION,
  type OrderStatusEvent,
  type OrderPayment,
  type PaymentMethod,
  type PanelOrder,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Detalhe do pedido — tudo o que a cozinha e o salão precisam conferir sem
 * sair da tela: número, mesa, data e hora, itens com preço e subtotal,
 * observação, total e o histórico de status com horário de cada etapa.
 *
 * O histórico vem por `fetchOrderHistory` (RLS por restaurante). Enquanto
 * carrega, a seção mostra um esqueleto — nunca "nenhum registro" antes de saber.
 */
export function OrderDetailSheet({
  order,
  onClose,
  onAdvance,
  onCancel,
  fetchHistory,
  fetchPayments,
  onRecordPayment,
  onRefundPayment,
  timeZone,
}: {
  order: PanelOrder | null;
  onClose: () => void;
  onAdvance: () => void;
  onCancel: () => void;
  fetchHistory: (orderId: string) => Promise<OrderStatusEvent[]>;
  /**
   * Etapa 16: pagamentos. Opcionais para o detalhe continuar funcionando em
   * qualquer tela que só queira mostrar o pedido (o tipo não muda de
   * significado, e sem as props a seção simplesmente não aparece).
   */
  fetchPayments?: (orderId: string) => Promise<OrderPayment[]>;
  onRecordPayment?: (input: {
    amount: string;
    method: PaymentMethod;
    note?: string;
  }) => Promise<string | null>;
  onRefundPayment?: (paymentId: string) => Promise<string | null>;
  timeZone: string;
}) {
  const [history, setHistory] = useState<OrderStatusEvent[] | null>(null);
  const [payments, setPayments] = useState<OrderPayment[] | null>(null);

  useEffect(() => {
    if (!order) {
      setHistory(null);
      return;
    }

    let cancelled = false;
    setHistory(null);
    setPayments(fetchPayments ? null : []);

    fetchHistory(order.id).then((rows) => {
      if (!cancelled) setHistory(rows);
    });

    /*
     * Pagamentos em paralelo com o histórico: são duas consultas independentes
     * e o sheet abre mais rápido do que em série. `fetchPayments` é opcional —
     * quando não vem, a lista fica vazia e a seção não renderiza.
     */
    if (fetchPayments) {
      fetchPayments(order.id).then((rows) => {
        if (!cancelled) setPayments(rows);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [order, fetchHistory, fetchPayments]);

  if (!order) return null;

  const tone = STATUS_TONE[order.status];
  const Icon = tone.icon;
  const action = ORDER_NEXT_ACTION[order.status];
  const canCancel = ORDER_CANCELLABLE.includes(order.status);

  return (
    <Sheet
      open={Boolean(order)}
      onClose={onClose}
      title={`Pedido #${order.order_number}`}
      description={`${order.table_name} · ${orderClock(order.created_at, timeZone)}`}
      size="tall"
      footer={
        action || canCancel ? (
          <div className="flex gap-2">
            {action && (
              <Button size="lg" className="min-w-0 flex-1 px-3 text-[0.9rem]" onClick={onAdvance}>
                {action.label}
              </Button>
            )}
            {canCancel && (
              <Button
                size="lg"
                variant="secondary"
                className="shrink-0 px-3 text-[0.9rem] text-red-700"
                onClick={onCancel}
              >
                Cancelar
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Status + tempo */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset",
              tone.badge,
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" strokeWidth={2.6} />
            {tone.label}
          </span>
          <span className="text-xs text-ink-500">{tone.hint}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs tabular-nums text-ink-400">
            <ChefHat className="size-3.5" aria-hidden="true" />
            há {orderAgeLabel(order.created_at)}
          </span>
        </div>

        {/* Mesa, data e hora */}
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-ink-50 px-3 py-2.5">
            <dt className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">
              <UtensilsCrossed className="size-3" aria-hidden="true" />
              Mesa
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink-900">{order.table_name}</dd>
          </div>
          <div className="rounded-xl bg-ink-50 px-3 py-2.5">
            <dt className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">
              <CalendarClock className="size-3" aria-hidden="true" />
              Recebido
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">
              {orderDate(order.created_at, timeZone)} · {orderClock(order.created_at, timeZone)}
            </dd>
          </div>
        </dl>

        {/* Itens */}
        <section aria-labelledby="detail-items">
          <h3
            id="detail-items"
            className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400"
          >
            Itens ({order.item_count})
          </h3>
          <ul className="mt-1.5 divide-y divide-ink-100 rounded-2xl border border-ink-200/70 px-3.5">
            {order.items.map((item, index) => (
              <li key={`${item.product_id ?? item.name}-${index}`} className="py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
                    {item.quantity}x
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink-900">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
                    {formatPrice(item.subtotal)}
                  </span>
                </div>
                <p className="pl-6 text-[0.75rem] tabular-nums text-ink-400">
                  {formatPrice(item.unit_price)} cada
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Observação */}
        {order.notes && (
          <section aria-labelledby="detail-notes">
            <h3
              id="detail-notes"
              className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400"
            >
              Observações
            </h3>
            <p className="mt-1.5 flex items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-900">
              <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{order.notes}</span>
            </p>
          </section>
        )}

        {/* Totais */}
        <section aria-labelledby="detail-totals">
          <h3
            id="detail-totals"
            className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400"
          >
            Valores
          </h3>
          <dl className="mt-1.5 space-y-1 rounded-2xl bg-ink-50 px-3.5 py-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-600">Subtotal</dt>
              <dd className="font-medium tabular-nums text-ink-900">
                {formatPrice(order.subtotal)}
              </dd>
            </div>
            {order.fees > 0 && (
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-600">Taxas</dt>
                <dd className="tabular-nums text-ink-900">{formatPrice(order.fees)}</dd>
              </div>
            )}
            {order.discount > 0 && (
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-600">Desconto</dt>
                <dd className="tabular-nums text-brand-700">- {formatPrice(order.discount)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-ink-200 pt-1.5">
              <dt className="font-semibold text-ink-800">Total</dt>
              <dd className="text-base font-bold tabular-nums text-ink-900">
                {formatPrice(order.total)}
              </dd>
            </div>
          </dl>
        </section>

        {/*
         * Pagamentos (etapa 16): só quando a tela passou as props. Fica antes
         * do histórico porque é a pergunta operacional do fim da conta ("já
         * pagou?"), enquanto o histórico é auditoria.
         */}
        {fetchPayments && onRecordPayment && onRefundPayment && payments !== null && (
          <PaymentSection
            order={order}
            payments={payments}
            onRecord={async (input) => {
              const problem = await onRecordPayment(input);
              if (!problem) {
                // Relê do banco: o saldo só é verdade depois de o banco
                // aceitar. Ajustar no cliente daria número bonito e errado.
                const rows = await fetchPayments(order.id);
                setPayments(rows);
              }
              return problem;
            }}
            onRefund={async (paymentId) => {
              const problem = await onRefundPayment(paymentId);
              if (!problem) {
                const rows = await fetchPayments(order.id);
                setPayments(rows);
              }
              return problem;
            }}
          />
        )}

        {/* Histórico */}
        <section aria-labelledby="detail-history">
          <h3
            id="detail-history"
            className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400"
          >
            Histórico
          </h3>

          {history === null ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-400" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Carregando histórico…
            </p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-sm text-ink-400">Sem registros de status.</p>
          ) : (
            <ol className="mt-2 space-y-0">
              {history.map((event, index) => {
                const eventTone = STATUS_TONE[event.to_status];
                const last = index === history.length - 1;
                return (
                  <li key={event.id} className="flex gap-2.5">
                    {/* Linha do tempo: ponto + traço */}
                    <div className="flex flex-col items-center pt-1">
                      <span
                        className={cn("size-2.5 rounded-full", eventTone.dot)}
                        aria-hidden="true"
                      />
                      {!last && <span className="w-px flex-1 bg-ink-200" aria-hidden="true" />}
                    </div>
                    <div className={last ? "pb-1" : "pb-3"}>
                      <p className="text-sm font-medium text-ink-800">
                        {event.from_status
                          ? `${STATUS_TONE[event.from_status].label} → ${eventTone.label}`
                          : "Pedido recebido"}
                      </p>
                      <p className="text-xs tabular-nums text-ink-400">
                        {orderClock(event.created_at, timeZone)}
                        {event.actor_id ? " · equipe" : " · cliente"}
                      </p>
                      {event.note && <p className="text-xs text-ink-500">{event.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </Sheet>
  );
}
