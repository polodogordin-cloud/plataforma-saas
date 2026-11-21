"use client";

import { BellRing, Receipt, ShoppingBag } from "lucide-react";
import { useCart } from "@/components/public/cart-provider";
import { DEFAULT_THEME, themeTokens } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import type { RestaurantTheme } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Barra inferior do cardápio da mesa: **Garçom · Carrinho · Conta**.
 *
 * Fica sempre visível enquanto o cliente navega — é o equivalente ao que ele
 * faria levantando a mão. Os três destinos ficam no mesmo lugar em todas as
 * telas de cardápio, porque o cliente não deveria ter de procurar.
 *
 * O botão do carrinho fica no centro e é o maior: é a ação mais frequente. Ele
 * mostra a quantidade quando há itens e a barra cresce em verde escuro para
 * destacar. Sem itens, continua visível ("Carrinho vazio") — sumir com ele
 * faria o cliente achar que o cardápio não aceita pedido.
 *
 * Os botões laterais não são destrutivos nem exigem confirmação aqui: quem
 * confirma é o sheet (`WaiterDialog`), que é onde o texto de confirmação vive.
 */
export function TableActionsBar({
  onWaiter,
  onCart,
  onBill,
  waiterPending,
  billPending,
  busy,
  theme = DEFAULT_THEME,
}: {
  onWaiter: () => void;
  onCart: () => void;
  onBill: () => void;
  /** Já existe chamada de garçom viva nesta mesa. */
  waiterPending: boolean;
  /** Já existe pedido de conta vivo nesta mesa. */
  billPending: boolean;
  /** Desabilita os botões enquanto uma solicitação está em voo. */
  busy?: boolean;
  /** Tema do restaurante: a barra é a parte mais visível do cardápio. */
  theme?: RestaurantTheme;
}) {
  const { count, subtotal, ready, canOrder } = useCart();
  const tokens = themeTokens(theme);

  if (!canOrder) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--mv-border)] bg-[var(--mv-surface)]/95 backdrop-blur-lg"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
    >
      <div className="mx-auto flex w-full max-w-lg items-stretch gap-1.5 px-2.5 pt-2">
        <SideAction
          icon={BellRing}
          label={waiterPending ? "Chamado" : "Garçom"}
          badge={waiterPending ? "✓" : undefined}
          onClick={onWaiter}
          disabled={busy}
          active={waiterPending}
          srHint={waiterPending ? "Garçom já foi chamado" : "Chamar garçom"}
          radius={themebarRadius(theme)}
        />

        {/* Carrinho: centro, maior, com valor */}
        <button
          type="button"
          onClick={onCart}
          className={cn(
            "relative flex min-h-14 min-w-0 flex-[1.4] flex-col items-center justify-center gap-0.5 rounded-xl px-2 transition-transform active:scale-[0.97]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700",
            ready && count > 0 ? "" : "bg-[var(--mv-surface-muted)] text-[var(--mv-text-muted)]",
          )}
          aria-label={
            ready && count > 0
              ? `Carrinho: ${count} ${count === 1 ? "item" : "itens"}, ${formatPrice(subtotal)}`
              : "Carrinho vazio"
          }
          style={
            ready && count > 0
              ? {
                  backgroundColor: tokens.button,
                  color: tokens.buttonText,
                  borderRadius: themebarRadius(theme),
                }
              : { borderRadius: themebarRadius(theme) }
          }
        >
          <span className="flex items-center gap-1.5">
            <ShoppingBag className="size-5" aria-hidden="true" strokeWidth={2.2} />
            {ready && count > 0 && (
              <span className="text-[0.95rem] font-bold tabular-nums">{formatPrice(subtotal)}</span>
            )}
          </span>
          {/*
            O rótulo "Carrinho" fica SEMPRE visível, mesmo com itens: é ele que
            ensina o que aquele botão do meio faz. A quantidade vai no selo, o
            valor na linha de cima — assim nada substitui o nome da ação.
          */}
          <span className="text-[0.7rem] font-semibold leading-none" aria-hidden="true">
            {ready && count > 0 ? "Carrinho" : "Carrinho vazio"}
          </span>
          {ready && count > 0 && (
            <span
              className="absolute -top-1 right-1 grid min-w-5 place-items-center rounded-full bg-[var(--mv-surface)] px-1 text-[0.65rem] font-bold tabular-nums text-[var(--mv-primary)] shadow-sm"
              aria-hidden="true"
            >
              {count}
            </span>
          )}
        </button>

        <SideAction
          icon={Receipt}
          label={billPending ? "Conta pedida" : "Conta"}
          badge={billPending ? "✓" : undefined}
          onClick={onBill}
          disabled={busy}
          active={billPending}
          srHint={billPending ? "Conta já solicitada" : "Pedir a conta"}
          radius={themebarRadius(theme)}
        />
      </div>
    </div>
  );
}

function SideAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  badge,
  srHint,
  radius,
}: {
  icon: typeof BellRing;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string;
  srHint: string;
  radius?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={srHint}
      className={cn(
        "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700",
        "disabled:opacity-60",
        active
          ? "bg-[var(--mv-primary-soft)] text-[var(--mv-primary)] ring-1 ring-inset ring-[var(--mv-primary)]/25"
          : "bg-[var(--mv-surface-muted)] text-[var(--mv-text)] hover:bg-[var(--mv-border)]",
      )}
      style={radius ? { borderRadius: radius } : undefined}
    >
      <Icon className="size-5" aria-hidden="true" strokeWidth={2.2} />
      <span className="line-clamp-1 text-[0.7rem] font-semibold leading-none">{label}</span>
      {badge && (
        <span
          className="absolute right-1.5 top-1 grid size-4 place-items-center rounded-full bg-[var(--mv-primary)] text-[0.6rem] font-bold text-[var(--mv-on-primary)]"
          aria-hidden="true"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * Raio dos botões da barra.
 *
 * `pill` estica até a pílula porque a barra convive com o botão do carrinho;
 * nos outros estilos usamos o raio do tema, para a barra não destoar dos cards.
 */
function themebarRadius(theme: RestaurantTheme): string {
  return theme.button_style === "pill" ? "999px" : "0.75rem";
}
