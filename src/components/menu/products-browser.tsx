"use client";

import { useMemo, useState } from "react";
import { PackageSearch, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { ProductCard } from "@/components/menu/product-card";
import { ProductSheet } from "@/components/menu/product-sheet";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { Button } from "@/components/ui/button";
import { deleteProduct } from "@/actions/menu";
import type { Category, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";

type Item = { product: Product; categoryName: string | null };

type StatusFilter = "all" | "available" | "unavailable" | "featured";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "available", label: "Disponíveis" },
  { value: "unavailable", label: "Indisponíveis" },
  { value: "featured", label: "Destaques" },
];

/**
 * Lista completa de produtos com busca, filtro por categoria e por status.
 * Sem tabelas: cards empilhados com ações de toque.
 */
export function ProductsBrowser({
  initialItems,
  categories,
  canEdit,
}: {
  initialItems: Item[];
  categories: Category[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);

  // Rederiva quando o servidor revalida (após criar/editar/excluir).
  const [syncedFrom, setSyncedFrom] = useState(initialItems);
  if (initialItems !== syncedFrom) {
    setSyncedFrom(initialItems);
    setItems(initialItems);
  }
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  });
  const [confirm, setConfirm] = useState<Product | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return items.filter(({ product, categoryName }) => {
      if (q) {
        const haystack = [
          product.name,
          product.description ?? "",
          product.internal_code ?? "",
          categoryName ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (categoryFilter !== "all") {
        if (categoryFilter === "none" ? product.category_id !== null : product.category_id !== categoryFilter) {
          return false;
        }
      }

      if (statusFilter === "available" && !product.is_available) return false;
      if (statusFilter === "unavailable" && product.is_available) return false;
      if (statusFilter === "featured" && !product.is_featured) return false;

      return true;
    });
  }, [items, query, categoryFilter, statusFilter]);

  const activeFilters =
    (categoryFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);

  const handleDelete = async () => {
    if (!confirm) return;
    const result = await deleteProduct(confirm.id);
    if (result.ok) {
      setItems((current) => current.filter(({ product }) => product.id !== confirm.id));
    }
    setConfirm(null);
  };

  const total = items.length;
  const availableCount = items.filter(({ product }) => product.is_available).length;
  const averagePrice =
    total > 0 ? items.reduce((sum, { product }) => sum + product.price, 0) / total : 0;

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Produtos" value={String(total)} />
        <Tile label="Disponíveis" value={String(availableCount)} tone="brand" />
        <Tile label="Preço médio" value={formatPrice(averagePrice)} small />
      </div>

      {/* Busca */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar produto"
          aria-label="Buscar produto"
          className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-11 pr-20 text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="tap-target grid w-9 place-items-center rounded-lg text-ink-400 hover:text-ink-700"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
            aria-label="Filtros"
            className={cn(
              "tap-target relative grid w-9 place-items-center rounded-lg",
              activeFilters > 0 ? "text-brand-700" : "text-ink-400 hover:text-ink-700",
            )}
          >
            <SlidersHorizontal className="size-4.5" aria-hidden="true" />
            {activeFilters > 0 && (
              <span className="absolute right-0 top-0 grid size-4 place-items-center rounded-full bg-brand-600 text-[0.6rem] font-bold text-white">
                {activeFilters}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filtros */}
      {showFilters && (
        <div className="animate-fade-in space-y-3 rounded-xl border border-ink-200 bg-white p-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Categoria
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>
                Todas
              </Chip>
              {categories.map((category) => (
                <Chip
                  key={category.id}
                  active={categoryFilter === category.id}
                  onClick={() => setCategoryFilter(category.id)}
                >
                  {category.name}
                </Chip>
              ))}
              <Chip active={categoryFilter === "none"} onClick={() => setCategoryFilter("none")}>
                Sem categoria
              </Chip>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Status
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  active={statusFilter === option.value}
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
          </div>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setStatusFilter("all");
              }}
              className="tap-target inline-flex items-center text-xs font-semibold text-brand-700"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      <p className="text-sm text-ink-500" role="status" aria-live="polite">
        {filtered.length === 0
          ? "Nenhum produto encontrado."
          : `${filtered.length} ${filtered.length === 1 ? "produto" : "produtos"}`}
      </p>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white px-5 py-9 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-400">
            <PackageSearch className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink-700">
            {items.length === 0 ? "Nenhum produto cadastrado ainda" : "Nada com esses filtros"}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">
            {items.length === 0
              ? "Adicione o primeiro item do seu cardápio."
              : "Ajuste a busca ou limpe os filtros."}
          </p>
          {items.length === 0 && canEdit && (
            <Button
              size="lg"
              className="mt-5 w-full max-w-xs"
              onClick={() => setSheet({ open: true, product: null })}
            >
              <Plus className="size-5" aria-hidden="true" />
              Adicionar produto
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(({ product, categoryName }) => (
            <li key={product.id}>
              <ProductCard
                product={product}
                showDragHandle={false}
                showCategory
                categoryName={categoryName ?? "Sem categoria"}
                onEdit={() => canEdit && setSheet({ open: true, product })}
              />
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div
          className="fixed inset-x-0 z-30 px-4"
          style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
        >
          <div className="app-shell">
            <Button
              size="lg"
              block
              onClick={() => setSheet({ open: true, product: null })}
              className="shadow-[0_12px_28px_-12px_rgba(15,146,80,0.9)]"
            >
              <Plus className="size-5" aria-hidden="true" />
              Adicionar produto
            </Button>
          </div>
        </div>
      )}

      <ProductSheet
        open={sheet.open}
        product={sheet.product}
        categories={categories}
        onClose={() => setSheet({ open: false, product: null })}
        onDelete={(product) => {
          setSheet({ open: false, product: null });
          setConfirm(product);
        }}
      />

      <ConfirmSheet
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Excluir produto?"
        confirmLabel="Excluir produto"
        description={
          confirm ? (
            <>
              <strong>{confirm.name}</strong> será apagado do cardápio. Essa ação não pode ser
              desfeita.
            </>
          ) : null
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
  small = false,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "brand";
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white px-2.5 py-2.5 text-center">
      <p
        className={cn(
          "font-semibold leading-tight tabular-nums",
          small ? "text-[0.9rem]" : "text-xl",
          tone === "brand" ? "text-brand-700" : "text-ink-900",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[0.7rem] font-medium text-ink-500">{label}</p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "tap-target inline-flex items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50",
      )}
    >
      {children}
    </button>
  );
}
