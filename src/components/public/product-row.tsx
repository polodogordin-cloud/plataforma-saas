import Image from "next/image";
import { Plus, Star } from "lucide-react";
import { formatPrice } from "@/lib/validation";
import type { PublicProduct } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Linha de produto do cardápio público.
 *
 * Formato de app de delivery: texto à esquerda, foto quadrada à direita.
 *
 * Dois caminhos, de propósito:
 *  - tocar no card abre o detalhe (descrição, foto grande, quantidade);
 *  - tocar no `+` adiciona 1 unidade na hora, sem abrir nada.
 *
 * O `+` é o caminho rápido de quem já sabe o que quer. Ele só aparece quando
 * existe mesa na sessão (`onQuickAdd` presente): sem QR/NFC não há pedido,
 * então o toque leva ao detalhe em vez de encher um carrinho que não vai sair.
 * A quantidade já no carrinho aparece no canto do botão — sem abrir o painel.
 */
export function ProductRow({
  product,
  onSelect,
  onQuickAdd,
  quantityInCart = 0,
}: {
  product: PublicProduct;
  onSelect: (product: PublicProduct) => void;
  /** Ausente = sem mesa na sessão (cardápio aberto pelo link). */
  onQuickAdd?: (product: PublicProduct) => void;
  /** Unidades deste produto já no carrinho. */
  quantityInCart?: number;
}) {
  return (
    <li>
      <div className="group relative flex w-full items-stretch gap-3 rounded-2xl border border-ink-200/70 bg-white p-2.5 shadow-[var(--shadow-soft)] transition-transform duration-200 has-[button:active]:scale-[0.995]">
        {/* O card inteiro abre o detalhe; o + é um segundo alvo. */}
        <button
          type="button"
          onClick={() => onSelect(product)}
          className="flex min-h-11 min-w-0 flex-1 items-stretch gap-3 text-left"
          aria-label={`Ver ${product.name}, ${formatPrice(product.price)}`}
        >
          <span className="min-w-0 flex-1 py-0.5">
            <span className="flex items-start gap-1.5">
              <span className="min-w-0 text-[0.95rem] font-semibold leading-snug text-ink-900">
                {product.name}
              </span>
              {product.is_featured && (
                <Star
                  className="mt-0.5 size-3.5 shrink-0 fill-accent-500 text-accent-500"
                  aria-label="Destaque"
                />
              )}
            </span>

            {product.description && (
              <span className="mt-0.5 line-clamp-2 block text-[0.8rem] leading-snug text-ink-500">
                {product.description}
              </span>
            )}

            <span className="mt-1.5 block text-[0.95rem] font-semibold tabular-nums text-brand-700">
              {formatPrice(product.price)}
            </span>
          </span>

          <span className="relative size-[5.5rem] shrink-0 overflow-hidden rounded-xl bg-ink-100">
            {product.image_url ? (
              <Image
                src={product.image_url}
                alt=""
                fill
                sizes="88px"
                className="object-cover"
              />
            ) : (
              <span
                className="grid size-full place-items-center text-xl font-semibold text-ink-300"
                aria-hidden="true"
              >
                {product.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={() => (onQuickAdd ? onQuickAdd(product) : onSelect(product))}
          aria-label={
            onQuickAdd
              ? `Adicionar ${product.name} ao pedido`
              : `Ver ${product.name}`
          }
          className={cn(
            "absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full",
            "bg-brand-600 text-white shadow-[0_6px_14px_-6px_rgba(15,146,80,0.9)]",
            "transition-transform duration-150 active:scale-90",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          )}
        >
          <Plus className="size-5" aria-hidden="true" strokeWidth={2.5} />
          {quantityInCart > 0 && (
            <span
              className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-ink-900 px-1 text-[0.7rem] font-bold tabular-nums text-white ring-2 ring-white"
              aria-hidden="true"
            >
              {quantityInCart}
            </span>
          )}
        </button>
      </div>
    </li>
  );
}
