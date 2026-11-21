"use client";

import { Clock, MessageSquareText, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/validation";
import { STATUS_TONE } from "@/lib/order-status";
import { ORDER_CANCELLABLE, ORDER_NEXT_ACTION, type PanelOrder } from "@/lib/types";
import { orderAgeLabel, orderAgeLevel } from "@/lib/order-time";
import { cn } from "@/lib/utils";

/**
 * Card do pedido no painel.
 *
 * Pensado para 320px de largura: tudo em coluna, números grandes, texto curto.
 * O card inteiro é clicável (abre o detalhe), e a ação principal é um botão de
 * 52px de altura por fora da área de clique — um alvo grande e separado, para
 * ninguém confirmar um pedido por acidente ao rolar a lista.
 *
 * Identificação de status: cor + ícone + texto. Nunca só cor.
 */
export function OrderCard({
  order,
  highlight,
  busy,
  now: nowProp,
  onOpen,
  onAdvance,
  onCancel,
}: {
  order: PanelOrder;
  /** Pedido recém-chegado: pulsa e ganha contorno. */
  highlight?: boolean;
  busy?: boolean;
  /** Injetado no teste; na tela vem do relógio do aparelho. */
  now?: number;
  onOpen: () => void;
  onAdvance: () => void;
  onCancel: () => void;
}) {
  const tone = STATUS_TONE[order.status];
  const now = nowProp ?? Date.now();
  const ageLevel = orderAgeLevel(order.created_at, now);
  const Icon = tone.icon;
  const action = ORDER_NEXT_ACTION[order.status];
  const canCancel = ORDER_CANCELLABLE.includes(order.status);

  return (
    <li>
      <article
        className={cn(
          "overflow-hidden rounded-2xl border bg-white shadow-[var(--shadow-soft)] transition-shadow",
          order.status === "pending"
            ? "border-red-200"
            : "border-ink-200/70",
          highlight && "ring-2 ring-brand-300 ring-offset-1",
          order.status === "cancelled" && "opacity-75",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          // `min-h-11`: alvo explícito mesmo no card mais curto (1 item, sem
          // observação). O conteúdo quase sempre passa disso, mas a garantia
          // não pode depender do conteúdo.
          className="block min-h-11 w-full px-3.5 pb-3 pt-3 text-left"
          aria-label={`Pedido ${order.order_number}, ${order.table_name}, ${tone.label}, ${formatPrice(order.total)}. Abrir detalhes.`}
        >
          {/* Faixa de status: ícone + texto + tempo */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide ring-1 ring-inset",
                tone.badge,
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" strokeWidth={2.6} />
              {tone.label}
            </span>

            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold tabular-nums",
                // Alerta de espera: texto muda junto com a cor, nunca só a cor.
                ageLevel === "late" && "bg-red-50 text-red-700",
                ageLevel === "warn" && "bg-amber-50 text-amber-800",
                ageLevel === "fresh" && "text-ink-400",
              )}
            >
              <Clock className="size-3" aria-hidden="true" />
              {orderAgeLabel(order.created_at, now)}
              {ageLevel === "late" && <span className="sr-only"> — espera longa</span>}
            </span>
          </div>

          {/* Número + mesa */}
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums tracking-tight text-ink-900">
              #{order.order_number}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-ink-600">
              <UtensilsCrossed className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
              <span className="truncate">{order.table_name}</span>
            </span>
          </div>

          {/* Itens: no máximo 3 linhas visíveis, o resto vira "+N" */}
          <ul className="mt-2 space-y-0.5">
            {order.items.slice(0, 3).map((item, index) => (
              <li
                key={`${item.product_id ?? item.name}-${index}`}
                className="flex items-baseline gap-1.5 text-[0.85rem] leading-snug text-ink-700"
              >
                <span className="shrink-0 font-bold tabular-nums text-brand-700">
                  {item.quantity}x
                </span>
                <span className="truncate">{item.name}</span>
              </li>
            ))}
            {order.items.length > 3 && (
              <li className="text-[0.8rem] font-medium text-ink-400">
                + {order.items.length - 3} {order.items.length - 3 === 1 ? "item" : "itens"}
              </li>
            )}
          </ul>

          {order.notes && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-2.5 py-2 text-[0.8rem] leading-snug text-amber-900">
              <MessageSquareText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{order.notes}</span>
            </p>
          )}

          <div className="mt-2.5 flex items-baseline justify-between border-t border-ink-100 pt-2.5">
            <span className="text-xs text-ink-400">
              {order.item_count} {order.item_count === 1 ? "item" : "itens"}
            </span>
            <span className="text-base font-bold tabular-nums text-ink-900">
              {formatPrice(order.total)}
            </span>
          </div>
        </button>

        {/* Ações */}
        {(action || canCancel) && (
          <div className="flex gap-2 border-t border-ink-100 bg-ink-50/60 px-3 py-2.5">
            {action && (
              <Button
                size="lg"
                className="min-w-0 flex-1 px-3 text-[0.9rem]"
                loading={busy}
                onClick={onAdvance}
              >
                {action.label}
              </Button>
            )}
            {canCancel && (
              <Button
                size="lg"
                variant="secondary"
                className="shrink-0 px-3 text-[0.9rem] text-red-700"
                disabled={busy}
                onClick={onCancel}
              >
                Cancelar
              </Button>
            )}
          </div>
        )}
      </article>
    </li>
  );
}
