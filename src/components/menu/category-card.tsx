"use client";

import { useTransition } from "react";
import {
  ChevronDown,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/card";
import { toggleCategoryActive } from "@/actions/menu";
import { formatPrice } from "@/lib/validation";
import type { DragHandleProps } from "@/components/menu/sortable";
import type { CategoryWithProducts } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Cabeçalho de uma categoria no painel: nome, contagem, ações e arraste. */
export function CategoryCardHeader({
  category,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  handleProps,
  isDragging,
}: {
  category: CategoryWithProducts;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  handleProps: DragHandleProps;
  isDragging: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const count = category.products.length;
  const unavailable = category.products.filter((product) => !product.is_available).length;
  const total = category.products.reduce((sum, product) => sum + product.price, 0);

  const handleToggleActive = () => {
    startTransition(async () => {
      await toggleCategoryActive(category.id, !category.is_active);
    });
  };

  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-t-[var(--radius-card)] bg-white p-3 transition-colors",
        isDragging && "shadow-[var(--shadow-lift)]",
        !category.is_active && "bg-ink-50/70",
      )}
    >
      {/* Handle de arraste: área de toque confortável */}
      <button
        type="button"
        ref={handleProps.ref}
        {...handleProps.listeners}
        {...handleProps.attributes}
        aria-label={`Reordenar categoria ${category.name}. Use as setas do teclado.`}
        className="tap-target -ml-1 grid w-8 shrink-0 cursor-grab touch-none place-items-center self-stretch rounded-lg text-ink-300 hover:text-ink-500 active:cursor-grabbing"
      >
        <GripVertical className="size-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-lg py-1 text-left"
      >
        <span
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold",
            category.is_active ? "bg-brand-50 text-brand-700" : "bg-ink-200 text-ink-500",
          )}
          aria-hidden="true"
        >
          {category.image_url ? (
            <ImageIcon className="size-4" />
          ) : (
            category.name.slice(0, 1).toUpperCase()
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[0.95rem] font-semibold",
                category.is_active ? "text-ink-900" : "text-ink-500",
              )}
            >
              {category.name}
            </span>
            {!category.is_active && (
              <Badge tone="muted" className="shrink-0">
                Oculta
              </Badge>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
            <span className="tabular-nums">
              {count} {count === 1 ? "item" : "itens"}
            </span>
            {unavailable > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-amber-600">{unavailable} indisponível</span>
              </>
            )}
            {count > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatPrice(total)}</span>
              </>
            )}
          </span>
        </span>

        <ChevronDown
          className={cn(
            "mt-1 size-4.5 shrink-0 text-ink-400 transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {/* Ações rápidas */}
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={handleToggleActive}
          disabled={pending}
          aria-pressed={category.is_active}
          aria-label={
            category.is_active
              ? `Ocultar categoria ${category.name}`
              : `Mostrar categoria ${category.name}`
          }
          className="tap-target grid w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <span
              className={cn(
                "h-4 w-7 rounded-full p-0.5 transition-colors",
                category.is_active ? "bg-brand-600" : "bg-ink-300",
              )}
            >
              <span
                className={cn(
                  "block size-3 rounded-full bg-white transition-transform",
                  category.is_active && "translate-x-3",
                )}
              />
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar categoria ${category.name}`}
          className="tap-target grid w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir categoria ${category.name}`}
          className="tap-target grid w-9 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>

    </div>
  );
}
