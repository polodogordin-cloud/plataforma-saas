"use client";

import { useEffect, useState } from "react";
import { CircleCheck, RotateCw } from "lucide-react";
import { primaryButtonBase, primaryButtonStyle } from "@/components/public/themed";
import { readTableOrder } from "@/actions/orders";
import { DEFAULT_THEME, themeTokens } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import {
  ORDER_STATUS_HINT,
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type RestaurantTheme,
  type TableOrder,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Tela de sucesso — "Pedido enviado!"
 *
 * Mostra o número do pedido, a mesa, os itens e o total **gravado no banco**.
 * O status vem do pedido: nesta etapa ele nasce PENDENTE e fica assim até a
 * equipe confirmar (o painel chega na Etapa 7) — por isso o texto
 * "Aguardando confirmação.".
 *
 * Sobrevive a recarregamento: o número fica guardado no `localStorage` desta
 * mesa e o pedido é relido por `get_table_order`, RPC que só devolve pedidos
 * daquela mesa. A tela também tem um botão para reler o status na mão.
 */

export const LAST_ORDER_KEY_PREFIX = "menuvo_last_order_";

export const lastOrderStorageKey = (tableToken: string) =>
  `${LAST_ORDER_KEY_PREFIX}${tableToken.toUpperCase()}`;

/** Lê o último número de pedido salvo para esta mesa (após recarregar). */
export function readLastOrderNumber(tableToken: string | null | undefined): number | null {
  if (!tableToken) return null;
  try {
    const raw = window.localStorage.getItem(lastOrderStorageKey(tableToken));
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function OrderSuccess({
  order,
  tableToken,
  onBackToMenu,
  theme = DEFAULT_THEME,
}: {
  order: TableOrder;
  /** Token da mesa: credencial para reler o próprio pedido. */
  tableToken: string | null;
  onBackToMenu: () => void;
  /** Tema do restaurante: a confirmação faz parte do cardápio. */
  theme?: RestaurantTheme;
}) {
  const tokens = themeTokens(theme);
  const [current, setCurrent] = useState<TableOrder>(order);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);

  // Mantém o número salvo para o próximo carregamento da página. Gravar de
  // novo aqui cobre o caso de o envio ter vindo de uma aba já aberta.
  useEffect(() => {
    if (!tableToken) return;
    try {
      window.localStorage.setItem(lastOrderStorageKey(tableToken), String(order.order_number));
    } catch {
      /* modo privado: a tela ainda funciona, só não sobrevive ao reload */
    }
  }, [order.order_number, tableToken]);

  const refresh = async () => {
    if (!tableToken) return;
    setRefreshing(true);
    const updated = await readTableOrder(tableToken, current.order_number);
    setRefreshing(false);
    if (updated) {
      setCurrent(updated);
      setStale(false);
    } else {
      setStale(true);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-10 pt-8">
      <div className="rounded-[1.5rem] border border-[var(--mv-border)] bg-[var(--mv-surface)] p-6 text-center shadow-[var(--shadow-soft)]">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--mv-primary-soft)] text-[var(--mv-primary)]">
          <CircleCheck className="size-9" aria-hidden="true" strokeWidth={2.2} />
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-[var(--mv-text)]">Pedido enviado!</h1>

        <p className="mt-1 text-sm text-[var(--mv-text-muted)]">
          {ORDER_STATUS_HINT[current.status] ?? ORDER_STATUS_HINT.pending}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-[var(--mv-surface-muted)] px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]">
              Pedido
            </p>
            <p className="text-xl font-bold tabular-nums text-[var(--mv-text)]">#{current.order_number}</p>
          </div>
          <div className="rounded-2xl bg-[var(--mv-surface-muted)] px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]">
              Mesa
            </p>
            <p className="text-xl font-bold text-[var(--mv-text)]">{current.table_name}</p>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 rounded-2xl border border-[var(--mv-border)] p-4 text-left">
          {current.items.map((item, index) => (
            <li
              key={`${item.product_id ?? item.name}-${index}`}
              className="flex items-baseline gap-2"
            >
              <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--mv-primary)]">
                {item.quantity}x
              </span>
              <span className="min-w-0 flex-1 text-sm text-[var(--mv-text)]">{item.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-[var(--mv-text-muted)]">
                {formatPrice(item.subtotal)}
              </span>
            </li>
          ))}
        </ul>

        {/*
          Etapa 25: desconto visível antes do total.

          O valor vem do pedido que o BANCO devolveu — não da prévia do
          carrinho. Se o cupom não valeu no envio, esta tela não mostra
          desconto nenhum, porque `discount` é zero.
        */}
        {current.discount > 0 && (
          <dl className="mt-3 space-y-1 px-4 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--mv-text-muted)]">Subtotal</dt>
              <dd className="tabular-nums text-[var(--mv-text)]">{formatPrice(current.subtotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--mv-text-muted)]">
                Desconto{current.coupon_code ? ` (${current.coupon_code})` : ""}
              </dt>
              <dd className="font-medium tabular-nums text-[var(--mv-primary)]">
                − {formatPrice(current.discount)}
              </dd>
            </div>
          </dl>
        )}

        <div
          className="mt-3 flex items-baseline justify-between rounded-2xl px-4 py-3"
          style={{ backgroundColor: tokens.button, color: tokens.buttonText }}
        >
          <span className="text-sm opacity-80">Total</span>
          <span className="text-xl font-bold tabular-nums">{formatPrice(current.total)}</span>
        </div>

        <p
          className={cn(
            "mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold",
            current.status === "cancelled"
              ? "bg-red-50 text-red-700"
              : "bg-amber-50 text-amber-800",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              current.status === "cancelled" ? "bg-red-500" : "bg-amber-500",
            )}
            aria-hidden="true"
          />
          {ORDER_STATUS_LABEL[current.status] ?? ORDER_STATUS_LABEL.pending}
        </p>
      </div>

      {stale && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-center text-sm font-medium text-amber-800"
        >
          Não conseguimos reler o pedido agora. Se precisar, chame um atendente e informe o
          número #{current.order_number}.
        </p>
      )}

      <button
        type="button"
        onClick={onBackToMenu}
        className={`mt-4 w-full ${primaryButtonBase} min-h-[3.25rem] text-base`}
        style={primaryButtonStyle(theme)}
      >
        Voltar ao cardápio
      </button>

      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="mt-1 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--mv-text-muted)] disabled:opacity-50"
      >
        <RotateCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
        Atualizar status
      </button>
    </div>
  );
}
