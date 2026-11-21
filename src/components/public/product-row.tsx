import Image from "next/image";
import { Plus, Star } from "lucide-react";
import { formatPrice } from "@/lib/validation";
import type { PublicProduct } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Linha de produto do cardápio público.
 *
 * Formato de app de delivery: texto à esquerda, foto quadrada à direita.
 * O botão + é um atalho para abrir o detalhe com quantidade 1 — nunca adiciona
 * escondido, porque o cliente precisa ver as opções (adicionais na Etapa 7).
 */
export function ProductRow({
  product,
  onSelect,
}: {
  product: PublicProduct;
  onSelect: (product: PublicProduct) => void;
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
          onClick={() => onSelect(product)}
          aria-label={`Adicionar ${product.name}`}
          className={cn(
            "absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full",
            "bg-brand-600 text-white shadow-[0_6px_14px_-6px_rgba(15,146,80,0.9)]",
            "transition-transform duration-150 active:scale-90",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          )}
        >
          <Plus className="size-5" aria-hidden="true" strokeWidth={2.5} />
        </button>
      </div>
    </li>
  );
}
