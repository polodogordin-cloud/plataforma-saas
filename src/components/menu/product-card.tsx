"use client";

import Image from "next/image";
import { useTransition } from "react";
import { GripVertical, Loader2, Pencil, Star } from "lucide-react";
import { toggleProductAvailable } from "@/actions/menu";
import { formatPrice } from "@/lib/validation";
import type { DragHandleProps } from "@/components/menu/sortable";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Card compacto de produto — o formato principal do painel no celular.
 * Imagem, nome, descrição, preço e status, com ações rápidas de 44px.
 */
export function ProductCard({
  product,
  onEdit,
  handleProps,
  showDragHandle = true,
  showCategory = false,
  categoryName,
}: {
  product: Product;
  onEdit: () => void;
  handleProps?: DragHandleProps;
  showDragHandle?: boolean;
  showCategory?: boolean;
  categoryName?: string;
}) {
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      await toggleProductAvailable(product.id, !product.is_available);
    });
  };

  return (
    <article
      className={cn(
        "flex items-stretch gap-2 rounded-xl border border-ink-200/80 bg-white p-2.5 transition-shadow",
        !product.is_available && "bg-ink-50/60",
      )}
    >
      {showDragHandle && handleProps && (
        <button
          type="button"
          ref={handleProps.ref}
          {...handleProps.listeners}
          {...handleProps.attributes}
          aria-label={`Reordenar ${product.name}. Use as setas do teclado.`}
          className="-ml-1 grid w-7 shrink-0 cursor-grab touch-none place-items-center self-stretch rounded-lg text-ink-300 hover:text-ink-500 active:cursor-grabbing"
        >
          <GripVertical className="size-4.5" aria-hidden="true" />
        </button>
      )}

      {/* Imagem / placeholder */}
      <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-ink-100">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt=""
            fill
            sizes="64px"
            className={cn("object-cover", !product.is_available && "grayscale")}
          />
        ) : (
          <span
            className="grid size-full place-items-center text-lg font-semibold text-ink-300"
            aria-hidden="true"
          >
            {product.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      {/* Conteúdo */}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-start gap-1.5">
          <h3
            className={cn(
              "min-w-0 flex-1 truncate text-[0.93rem] font-semibold leading-tight",
              product.is_available ? "text-ink-900" : "text-ink-500",
            )}
          >
            {product.name}
          </h3>
          {product.is_featured && (
            <Star
              className="mt-0.5 size-3.5 shrink-0 fill-amber-400 text-amber-400"
              aria-label="Produto em destaque"
            />
          )}
        </div>

        {product.description && (
          <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-ink-500">
            {product.description}
          </p>
        )}

        {showCategory && categoryName && (
          <p className="mt-0.5 truncate text-[0.7rem] font-medium text-brand-700">{categoryName}</p>
        )}

        <div className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              product.is_available ? "text-ink-900" : "text-ink-400 line-through",
            )}
          >
            {formatPrice(product.price)}
          </span>
          {product.internal_code && (
            <span className="truncate rounded bg-ink-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-ink-500">
              {product.internal_code}
            </span>
          )}
          <span
            className={cn(
              "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
              product.is_available
                ? "bg-brand-50 text-brand-700"
                : "bg-amber-50 text-amber-700",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                product.is_available ? "bg-brand-500" : "bg-amber-500",
              )}
              aria-hidden="true"
            />
            {product.is_available ? "Disponível" : "Indisponível"}
          </span>
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 border-l border-ink-100 pl-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${product.name}`}
          className="tap-target grid w-10 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={product.is_available}
          aria-label={
            product.is_available
              ? `Marcar ${product.name} como indisponível`
              : `Marcar ${product.name} como disponível`
          }
          className={cn(
            "tap-target grid w-10 place-items-center rounded-lg hover:bg-ink-100",
            product.is_available ? "text-brand-600" : "text-ink-400",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <span
              className={cn(
                "h-4 w-7 rounded-full p-0.5 transition-colors",
                product.is_available ? "bg-brand-600" : "bg-ink-300",
              )}
            >
              <span
                className={cn(
                  "block size-3 rounded-full bg-white transition-transform",
                  product.is_available && "translate-x-3",
                )}
              />
            </span>
          )}
        </button>
      </div>
    </article>
  );
}
