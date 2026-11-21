"use client";

import { useState } from "react";
import {
  AlarmClock,
  Bell,
  CheckCircle2,
  ChefHat,
  CircleSlash,
  Flame,
  Loader2,
  Send,
  Timer,
  Utensils,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  KITCHEN_ACTION_LABEL,
  KITCHEN_URGENCY_LABEL,
  ORDER_STATUS_LABEL,
  type KitchenAction,
  type KitchenOrder,
  type KitchenUrgency,
} from "@/lib/types";
import { formatElapsed, orderPreparationMinutes, orderUrgency, secondsSince } from "@/lib/kitchen";

/**
 * Card do pedido no KDS.
 *
 * Princípios que este componente segue, e o motivo de cada um:
 *
 *   1. **Alvo grande.** O botão principal ocupa a largura inteira e tem 56px de
 *      altura. A cozinha toca com o dedo molhado ou com luva.
 *   2. **Nunca só cor.** Cada nível de urgência tem cor **e** texto **e**
 *      ícone. Quem não distingue vermelho de verde precisa ler "Atrasado" e ver
 *      o ícone de relógio. Isso não é enfeite: o escopo pede explicitamente.
 *   3. **Número do pedido é o maior texto do card.** É por ele que a equipe
 *      fala ("o 1042 está pronto"). Mesa vem em segundo.
 *   4. **Contador mono-espaçado.** `tabular-nums` impede o número de dançar a
 *      cada segundo — um contador que treme distrai mais do que informa.
 *   5. **Observação e adicional nunca escondidos.** "Sem cebola" atrás de um
 *      toque é o erro clássico de KDS: o prato sai errado e alguém reclama.
 */

const URGENCY_STYLE: Record<
  KitchenUrgency,
  { card: string; badge: string; ring: string; icon: typeof Timer; label: string }
> = {
  ok: {
    card: "border-ink-200 bg-white",
    badge: "bg-ink-100 text-ink-700 ring-ink-200",
    ring: "",
    icon: Timer,
    label: KITCHEN_URGENCY_LABEL.ok,
  },
  warn: {
    card: "border-amber-300 bg-amber-50/60",
    badge: "bg-amber-100 text-amber-900 ring-amber-300",
    ring: "ring-2 ring-amber-300/60",
    icon: AlarmClock,
    label: KITCHEN_URGENCY_LABEL.warn,
  },
  late: {
    card: "border-red-400 bg-red-50/70",
    badge: "bg-red-100 text-red-800 ring-red-300",
    ring: "ring-2 ring-red-400/70",
    icon: Flame,
    label: KITCHEN_URGENCY_LABEL.late,
  },
};

const ACTION_ICON: Record<KitchenAction, typeof CheckCircle2> = {
  accept: Bell,
  start: ChefHat,
  ready: Utensils,
  finish: Send,
  cancel: CircleSlash,
};

const ACTION_STYLE: Record<KitchenAction, string> = {
  accept: "bg-sky-600 text-white hover:bg-sky-700",
  start: "bg-brand-600 text-white hover:bg-brand-700",
  ready: "bg-amber-500 text-white hover:bg-amber-600",
  finish: "bg-ink-800 text-white hover:bg-ink-900",
  cancel: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
};

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function KitchenCard({
  order,
  nowMs,
  settings,
  actions,
  pending,
  highlighted,
  onAction,
  onDismissHighlight,
}: {
  order: KitchenOrder;
  nowMs: number;
  settings: { late_after_minutes: number; warn_after_minutes: number };
  /** Já recortadas pelo papel — a tela não oferece o que o banco recusaria. */
  actions: KitchenAction[];
  pending: KitchenAction | null;
  highlighted: boolean;
  onAction: (action: KitchenAction) => void;
  onDismissHighlight: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);

  const urgency = orderUrgency(order, nowMs, settings);
  const style = URGENCY_STYLE[urgency];
  const UrgencyIcon = style.icon;
  const prepMinutes = orderPreparationMinutes(order, nowMs);
  const isDone = order.status === "delivered" || order.status === "cancelled";

  // O botão de cada coluna tem um papel diferente: na primeira, é o principal.
  const primaryAction = actions.find((action) => action !== "cancel") ?? null;
  const cancelAction = actions.find((action) => action === "cancel") ?? null;

  return (
    <article
      aria-labelledby={`kds-${order.id}-title`}
      className={cn(
        "flex flex-col rounded-2xl border-2 shadow-[var(--shadow-soft)] transition-colors",
        style.card,
        style.ring,
        highlighted && "ring-4 ring-sky-400 motion-safe:animate-pulse",
        isDone && "opacity-70",
      )}
    >
      {/* Cabeçalho: número, mesa, horário, urgência */}
      <header className="flex items-start justify-between gap-3 border-b border-ink-200/70 p-4">
        <div className="min-w-0">
          <h3
            id={`kds-${order.id}-title`}
            className="flex items-baseline gap-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-[1.75rem]"
          >
            #{order.order_number}
            <span className="text-sm font-semibold text-ink-500">
              {ORDER_STATUS_LABEL[order.status]}
            </span>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-600">
            <span className="font-semibold text-ink-800">{order.table_name}</span>
            <span aria-hidden="true">·</span>
            <span>entrou {clock(order.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span>{order.item_count} {order.item_count === 1 ? "item" : "itens"}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className="rounded-lg bg-ink-900 px-2.5 py-1 font-mono text-lg font-bold tabular-nums text-white"
            aria-label={`Tempo desde a entrada: ${formatElapsed(secondsSince(order, nowMs))}`}
          >
            {formatElapsed(secondsSince(order, nowMs))}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide ring-1 ring-inset",
              style.badge,
            )}
          >
            <UrgencyIcon className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
            {style.label}
          </span>
        </div>
      </header>

      {/* Corpo: itens, quantidades, observações, adicionais */}
      <div className="flex-1 p-4">
        <ul className="space-y-2.5">
          {order.items.map((item) => (
            <li key={item.id} className="rounded-xl bg-white/70 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 rounded-md bg-ink-900 px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums text-white">
                  {item.quantity}×
                </span>
                <span className="text-[1.05rem] font-semibold leading-snug text-ink-900">
                  {item.name}
                </span>
              </div>

              {item.options.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 pl-8">
                  {item.options.map((option, index) => (
                    <li
                      key={`${item.id}-opt-${index}`}
                      className="flex items-baseline gap-1.5 text-sm text-ink-700"
                    >
                      <span className="text-ink-400" aria-hidden="true">
                        +
                      </span>
                      <span>
                        {option.quantity > 1 ? `${option.quantity}× ` : ""}
                        {option.name}
                        {option.price_delta > 0 && (
                          <span className="text-ink-500"> ({money(option.price_delta)})</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {item.notes && (
                <p className="mt-1.5 flex gap-1.5 rounded-lg bg-amber-100 px-2 py-1 pl-2 text-sm font-medium text-amber-950">
                  <span className="font-bold" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="sr-only">Observação do item: </span>
                    {item.notes}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>

        {order.notes && (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950">
            <span className="font-bold">Observação do pedido: </span>
            {order.notes}
          </p>
        )}

        {prepMinutes !== null && !isDone && (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-ink-600">
            <ChefHat className="size-4" aria-hidden="true" />
            Em preparo há {prepMinutes} min
          </p>
        )}
      </div>

      {/* Ações */}
      {!isDone && (primaryAction || cancelAction) && (
        <footer className="space-y-2 border-t border-ink-200/70 p-4">
          {primaryAction && (
            <button
              type="button"
              onClick={() => onAction(primaryAction)}
              disabled={pending !== null}
              aria-busy={pending === primaryAction || undefined}
              className={cn(
                "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-bold",
                "transition-colors active:scale-[0.99] disabled:opacity-60",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
                ACTION_STYLE[primaryAction],
              )}
            >
              {pending === primaryAction ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                (() => {
                  const Icon = ACTION_ICON[primaryAction];
                  return <Icon className="size-5" aria-hidden="true" strokeWidth={2.4} />;
                })()
              )}
              {KITCHEN_ACTION_LABEL[primaryAction]}
            </button>
          )}

          {cancelAction &&
            (confirmCancel ? (
              // Confirmação em dois toques, inline: `window.confirm` bloqueia a
              // thread e num tablet com fila isso trava o painel inteiro.
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="min-h-12 flex-1 rounded-xl border border-ink-200 bg-white text-sm font-semibold text-ink-700"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmCancel(false);
                    onAction("cancel");
                  }}
                  disabled={pending !== null}
                  className="min-h-12 flex-1 rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-60"
                >
                  {pending === "cancel" ? "Cancelando…" : "Confirmar cancelamento"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className={cn(
                  "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold",
                  ACTION_STYLE.cancel,
                )}
              >
                <CircleSlash className="size-4" aria-hidden="true" />
                {KITCHEN_ACTION_LABEL.cancel}
              </button>
            ))}
        </footer>
      )}

      {highlighted && (
        <button
          type="button"
          onClick={onDismissHighlight}
          className="border-t border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-800"
        >
          Pedido novo — toque para dispensar o destaque
        </button>
      )}
    </article>
  );
}
