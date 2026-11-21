"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Minus, Plus, ReceiptText, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { primaryButtonBase, primaryButtonStyle } from "@/components/public/themed";
import { useCart } from "@/components/public/cart-provider";
import { createOrder } from "@/actions/orders";
import { CART_MAX_QUANTITY, ORDER_NOTES_MAX, lineTotal, toOrderItems } from "@/lib/cart";
import { DEFAULT_THEME, themeTokens } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import type { RestaurantTheme, TableOrder } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Carrinho (revisão) e confirmação do pedido — Etapa 6.
 *
 * Duas etapas no mesmo painel, porque o cliente está com o celular na mão e
 * qualquer tela a mais no meio é desistência:
 *
 *  1. **Carrinho** — item, quantidade, preço unitário e subtotal, com −/+ e
 *     remover. Subtotal, taxas (ainda zero) e total.
 *  2. **Confirmar** — "Pedido para: Mesa 04", as linhas no formato do pedido,
 *     observação opcional e o botão "Enviar pedido".
 *
 * A mesa aparece, nunca é digitada: vem do QR Code/NFC. Se o cardápio foi
 * aberto pelo link sem mesa, o painel explica em vez de deixar enviar.
 *
 * O total mostrado aqui é uma estimativa calculada com o preço que o cardápio
 * tinha ao carregar. Depois de enviar, a tela de sucesso usa o total devolvido
 * pelo banco — que é o único oficial.
 */
export function CartSheet({
  open,
  onClose,
  onSent,
  theme = DEFAULT_THEME,
}: {
  open: boolean;
  onClose: () => void;
  onSent: (order: TableOrder) => void;
  /** Tema do restaurante — o carrinho é a última tela antes do envio. */
  theme?: RestaurantTheme;
}) {
  const tokens = themeTokens(theme);
  const {
    items,
    subtotal,
    count,
    tableName,
    tableToken,
    canOrder,
    setQuantity,
    removeItem,
    clear,
  } = useCart();

  const [step, setStep] = useState<"cart" | "confirm">("cart");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sempre volta para a revisão ao fechar, e limpa o erro de uma tentativa
  // anterior: reabrir o carrinho não deve mostrar um erro "fantasma".
  useEffect(() => {
    if (!open) return;
    setStep("cart");
    setError(null);
  }, [open]);

  const notesLeft = ORDER_NOTES_MAX - notes.length;

  const send = useCallback(async () => {
    if (!tableToken || sending) return;

    setSending(true);
    setError(null);

    const result = await createOrder({
      tableToken,
      items: toOrderItems(items),
      notes: notes.slice(0, ORDER_NOTES_MAX),
    });

    setSending(false);

    if (result.ok === false) {
      setError(result.error);
      return;
    }

    // A tela de sucesso usa o que o BANCO gravou, não a estimativa local.
    const order: TableOrder = {
      order_id: result.order.order_id,
      order_number: result.order.order_number,
      table_name: result.order.table_name,
      status: result.order.status,
      subtotal: result.order.subtotal,
      fees: 0,
      discount: 0,
      total: result.order.total,
      notes: notes.trim() || null,
      created_at: result.order.created_at,
      items: items.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        subtotal: lineTotal(item),
        notes: null,
      })),
    };

    // Pedido virou registro no banco: o carrinho cumpriu o papel. Limpar aqui
    // (e não na tela de sucesso) cobre também o reload no meio do caminho.
    setNotes("");
    clear();
    onSent(order);
  }, [tableToken, sending, items, notes, onSent, clear]);

  const lines = useMemo(() => items, [items]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose();
      }}
      title={step === "cart" ? "Seu pedido" : "Confirmar pedido"}
      description={
        step === "cart"
          ? tableName
            ? `Pedido para: ${tableName}`
            : "Revise os itens antes de enviar"
          : "Confira tudo antes de enviar para a cozinha"
      }
      size="tall"
      footer={
        step === "cart" ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between px-1 text-sm">
              <span className="text-[var(--mv-text-muted)]">Total estimado</span>
              <span className="text-lg font-bold tabular-nums text-[var(--mv-text)]">
                {formatPrice(subtotal)}
              </span>
            </div>
            <button
              type="button"
              disabled={!canOrder || count === 0}
              onClick={() => setStep("confirm")}
              className={cn(primaryButtonBase, "w-full min-h-[3.25rem] text-base")}
              style={primaryButtonStyle(theme)}
            >
              Continuar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={send}
              disabled={sending || !canOrder}
              className={cn(primaryButtonBase, "w-full min-h-[3.25rem] text-base")}
              style={primaryButtonStyle(theme)}
            >
              {sending ? "Enviando…" : "Enviar pedido"}
            </button>
            <button
              type="button"
              onClick={() => setStep("cart")}
              disabled={sending}
              className="tap-target flex w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-[var(--mv-text-muted)] disabled:opacity-50"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Voltar ao carrinho
            </button>
          </div>
        )
      }
    >
      {/* Sem mesa (link do cardápio, não QR/NFC): pedir não é possível. */}
      {!canOrder ? (
        <div className="rounded-2xl border border-dashed border-[var(--mv-border)] bg-[var(--mv-surface-muted)] px-5 py-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--mv-surface)] text-2xl shadow-sm">
            🪑
          </span>
          <p className="mt-3 text-sm font-semibold text-[var(--mv-text)]">Escaneie o QR Code da mesa</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-[var(--mv-text-muted)]">
            Para enviar um pedido, abra o cardápio pelo QR Code ou pela TAG NFC que está na sua
            mesa. Aí sabemos para onde levar o pedido.
          </p>
        </div>
      ) : count === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--mv-border)] bg-[var(--mv-surface-muted)] px-5 py-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--mv-surface)] text-[var(--mv-text-muted)] shadow-sm">
            <ReceiptText className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-semibold text-[var(--mv-text)]">Seu carrinho está vazio</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-[var(--mv-text-muted)]">
            Toque em um item do cardápio para adicionar ao pedido.
          </p>
          <button
            type="button"
            className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-4 text-sm font-semibold text-[var(--mv-text)]"
            onClick={onClose}
          >
            Ver o cardápio
          </button>
        </div>
      ) : step === "cart" ? (
        /* ------------------------------------------------- carrinho */
        <div className="space-y-4">
          <ul className="space-y-2">
            {lines.map((item) => (
              <li
                key={item.product_id}
                className="rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.95rem] font-semibold leading-snug text-[var(--mv-text)]">
                      {item.name}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-[var(--mv-text-muted)]">
                      {formatPrice(item.unit_price)} cada
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.product_id)}
                    aria-label={`Remover ${item.name}`}
                    className="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--mv-text-muted)] transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-xl bg-[var(--mv-surface-muted)] p-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                      aria-label={`Diminuir ${item.name}`}
                      className="grid size-10 place-items-center rounded-lg bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-sm active:scale-95"
                    >
                      <Minus className="size-4" aria-hidden="true" strokeWidth={2.5} />
                    </button>
                    <span
                      className="w-8 text-center text-sm font-semibold tabular-nums text-[var(--mv-text)]"
                      aria-label={`${item.quantity} de ${item.name}`}
                    >
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                      disabled={item.quantity >= CART_MAX_QUANTITY}
                      aria-label={`Aumentar ${item.name}`}
                      className="grid size-10 place-items-center rounded-lg bg-[var(--mv-surface)] text-[var(--mv-text)] shadow-sm disabled:opacity-40 active:scale-95"
                    >
                      <Plus className="size-4" aria-hidden="true" strokeWidth={2.5} />
                    </button>
                  </div>

                  <span className="text-[0.95rem] font-semibold tabular-nums text-[var(--mv-text)]">
                    {formatPrice(lineTotal(item))}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/* Resumo de valores. "Taxas" já aparece zerada: o espaço existe, a
              regra de taxa (garçom/entrega) é de outra etapa. */}
          <dl className="space-y-1.5 rounded-2xl bg-[var(--mv-surface-muted)] px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--mv-text-muted)]">Subtotal</dt>
              <dd className="font-medium tabular-nums text-[var(--mv-text)]">{formatPrice(subtotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-[var(--mv-text-muted)]">Taxas</dt>
              <dd className="tabular-nums text-[var(--mv-text-muted)]">{formatPrice(0)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-[var(--mv-border)] pt-1.5">
              <dt className="font-semibold text-[var(--mv-text)]">Total</dt>
              <dd className="text-base font-bold tabular-nums text-[var(--mv-text)]">
                {formatPrice(subtotal)}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        /* ------------------------------------------------ confirmação */
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--mv-primary)]/30 bg-[var(--mv-primary-soft)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-primary)]">
              Pedido para
            </p>
            <p className="text-lg font-bold text-[var(--mv-text)]">{tableName}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]">
              Itens ({count})
            </h3>
            <ul className="mt-2 divide-y divide-[var(--mv-border)] rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-4">
              {lines.map((item) => (
                <li key={item.product_id} className="flex items-baseline gap-2 py-2.5">
                  <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--mv-primary)]">
                    {item.quantity}x
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-[var(--mv-text)]">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-[var(--mv-text-muted)]">
                    {formatPrice(lineTotal(item))}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label
              htmlFor="order-notes"
              className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]"
            >
              <span>Observações do pedido</span>
              <span
                className={notesLeft <= 30 ? "tabular-nums text-amber-600" : "tabular-nums"}
                aria-live="polite"
              >
                {notes.length}/{ORDER_NOTES_MAX}
              </span>
            </label>
            <textarea
              id="order-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value.slice(0, ORDER_NOTES_MAX))}
              maxLength={ORDER_NOTES_MAX}
              rows={2}
              placeholder="Ex.: sem cebola, ponto da carne bem passado"
              className="mt-1.5 w-full resize-none rounded-2xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-3.5 py-2.5 text-sm text-[var(--mv-text)] placeholder:text-[var(--mv-text-muted)] focus:border-[var(--mv-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--mv-primary-soft)]"
            />
          </div>

          <div
            className="flex items-baseline justify-between rounded-2xl px-4 py-3"
            style={{ backgroundColor: tokens.button, color: tokens.buttonText }}
          >
            <span className="text-sm text-white/80">Total</span>
            <span className="text-xl font-bold tabular-nums">{formatPrice(subtotal)}</span>
          </div>

          <p className="text-center text-xs leading-snug text-[var(--mv-text-muted)]">
            O preço final é confirmado pela cozinha ao aceitar o pedido.
          </p>

          {sending && (
            <p className="flex items-center justify-center gap-2 text-xs text-[var(--mv-text-muted)]" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Enviando para a cozinha…
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
