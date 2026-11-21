"use client";

import { ShoppingBag } from "lucide-react";
import { useCart } from "@/components/public/cart-provider";
import { formatPrice } from "@/lib/validation";

/**
 * Barra fixa no rodapé — o "carrinho sempre à mão" do cardápio.
 *
 * Aparece só quando há itens, ocupa a largura toda e fica acima da área segura
 * do iPhone. É o caminho de ESCANEAR → ESCOLHER → ADICIONAR → **REVISAR**:
 * um toque abre o carrinho, do qualquer ponto do cardápio.
 *
 * Reserva espaço no fluxo da página (`<div>` fantasma da mesma altura) para a
 * última seção do cardápio não ficar escondida atrás da barra.
 */
export function CartBar({ onOpen }: { onOpen: () => void }) {
  const { count, subtotal, ready, canOrder } = useCart();

  if (!canOrder || !ready || count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
      <div className="mx-auto w-full max-w-lg">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 rounded-2xl bg-brand-600 px-4 py-3 text-left text-white shadow-[0_12px_30px_-12px_rgba(15,146,80,0.85)] transition-transform duration-150 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-white/15">
            <ShoppingBag className="size-5" aria-hidden="true" strokeWidth={2.2} />
            <span
              className="absolute -right-1.5 -top-1.5 grid min-w-6 place-items-center rounded-full bg-white px-1.5 text-xs font-bold tabular-nums text-brand-700 shadow-sm"
              aria-hidden="true"
            >
              {count}
            </span>
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[0.95rem] font-semibold leading-tight">
              Carrinho
            </span>
            <span className="block text-xs text-white/85" aria-live="polite">
              {count} {count === 1 ? "item" : "itens"}
            </span>
          </span>

          <span className="shrink-0 text-[1.05rem] font-bold tabular-nums">
            {formatPrice(subtotal)}
          </span>
        </button>
      </div>
    </div>
  );
}
