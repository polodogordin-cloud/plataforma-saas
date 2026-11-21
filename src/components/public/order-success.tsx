"use client";

import { useEffect, useState } from "react";
import { CircleCheck, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readTableOrder } from "@/actions/orders";
import { formatPrice } from "@/lib/validation";
import {
  ORDER_STATUS_HINT,
  ORDER_STATUS_LABEL,
  type OrderStatus,
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
}: {
  order: TableOrder;
  /** Token da mesa: credencial para reler o próprio pedido. */
  tableToken: string | null;
  onBackToMenu: () => void;
}) {
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
      <div className="rounded-[1.5rem] border border-brand-200 bg-white p-6 text-center shadow-[var(--shadow-soft)]">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-50 text-brand-600">
          <CircleCheck className="size-9" aria-hidden="true" strokeWidth={2.2} />
        </span>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink-900">Pedido enviado!</h1>

        <p className="mt-1 text-sm text-ink-500">
          {ORDER_STATUS_HINT[current.status] ?? ORDER_STATUS_HINT.pending}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-ink-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Pedido</p>
            <p className="text-xl font-bold tabular-nums text-ink-900">#{current.order_number}</p>
          </div>
          <div className="rounded-2xl bg-ink-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Mesa</p>
            <p className="text-xl font-bold text-ink-900">{current.table_name}</p>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 rounded-2xl border border-ink-200/70 p-4 text-left">
          {current.items.map((item, index) => (
            <li
              key={`${item.product_id ?? item.name}-${index}`}
              className="flex items-baseline gap-2"
            >
              <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
                {item.quantity}x
              </span>
              <span className="min-w-0 flex-1 text-sm text-ink-800">{item.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-ink-600">
                {formatPrice(item.subtotal)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-ink-900 px-4 py-3 text-white">
          <span className="text-sm text-white/80">Total</span>
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

      <Button size="lg" block className="mt-4" onClick={onBackToMenu}>
        Voltar ao cardápio
      </Button>

      <Button
        variant="ghost"
        block
        size="sm"
        className="mt-1"
        onClick={refresh}
        loading={refreshing}
      >
        <RotateCw className="size-4" aria-hidden="true" />
        Atualizar status
      </Button>
    </div>
  );
}
