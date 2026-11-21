import Image from "next/image";
import { Plus, Star } from "lucide-react";
import { cardRadius, cardShadow, themeTokens } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import type { PublicProduct, RestaurantTheme } from "@/lib/types";
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
 *
 * Etapa 9: o card e o `+` seguem o tema do restaurante. A cor do `+` é a cor
 * dos botões (com texto por contraste) — o que faz um tema "fast food"
 * realmente parecer fast food.
 */
export function ProductRow({
  product,
  onSelect,
  onQuickAdd,
  quantityInCart = 0,
  theme,
  compact = false,
}: {
  product: PublicProduct;
  onSelect: (product: PublicProduct) => void;
  /** Ausente = sem mesa na sessão (cardápio aberto pelo link). */
  onQuickAdd?: (product: PublicProduct) => void;
  /** Unidades deste produto já no carrinho. */
  quantityInCart?: number;
  theme: RestaurantTheme;
  /** Versão estreita, usada no preview do painel (80 px em vez de 88 px). */
  compact?: boolean;
}) {
  const tokens = themeTokens(theme);

  return (
    <li>
      <div
        className={cn(
          "group relative flex w-full items-stretch gap-3 border border-[var(--mv-border)] bg-[var(--mv-surface)] p-2.5 transition-transform duration-200 has-[button:active]:scale-[0.995]",
        )}
        style={{
          borderRadius: cardRadius(theme.card_style),
          boxShadow: cardShadow(theme.card_style),
        }}
      >
        {/* O card inteiro abre o detalhe; o + é um segundo alvo. */}
        <button
          type="button"
          onClick={() => onSelect(product)}
          className="flex min-h-11 min-w-0 flex-1 items-stretch gap-3 text-left"
          aria-label={`Ver ${product.name}, ${formatPrice(product.price)}`}
        >
          <span className="min-w-0 flex-1 py-0.5">
            <span className="flex items-start gap-1.5">
              <span className="min-w-0 text-[0.95rem] font-semibold leading-snug text-[var(--mv-text)]">
                {product.name}
              </span>
              {product.is_featured && (
                <Star
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--mv-secondary)]"
                  style={{ fill: tokens.secondary }}
                  aria-label="Destaque"
                />
              )}
            </span>

            {product.description && (
              <span className="mt-0.5 line-clamp-2 block text-[0.8rem] leading-snug text-[var(--mv-text-muted)]">
                {product.description}
              </span>
            )}

            <span className="mt-1.5 block text-[0.95rem] font-semibold tabular-nums text-[var(--mv-primary)]">
              {formatPrice(product.price)}
            </span>
          </span>

          <span
            className={cn(
              "relative shrink-0 overflow-hidden rounded-xl bg-[var(--mv-surface-muted)]",
              compact ? "size-[4.5rem]" : "size-[5.5rem]",
            )}
          >
            {product.image_url ? (
              <Image
                src={product.image_url}
                alt=""
                fill
                sizes={compact ? "72px" : "88px"}
                className="object-cover"
              />
            ) : (
              <span
                className="grid size-full place-items-center text-xl font-semibold text-[var(--mv-text-muted)] opacity-50"
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
            onQuickAdd ? `Adicionar ${product.name} ao pedido` : `Ver ${product.name}`
          }
          className="absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full transition-transform duration-150 active:scale-90"
          style={{
            backgroundColor: tokens.button,
            color: tokens.buttonText,
            borderRadius: theme.button_style === "pill" ? "999px" : "0.75rem",
          }}
        >
          <Plus className="size-5" aria-hidden="true" strokeWidth={2.5} />
          {quantityInCart > 0 && (
            <span
              className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[var(--mv-text)] px-1 text-[0.7rem] font-bold tabular-nums text-[var(--mv-bg)] ring-2 ring-[var(--mv-surface)]"
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
