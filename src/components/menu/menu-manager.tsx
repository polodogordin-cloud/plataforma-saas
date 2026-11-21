"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { SortableProvider, SortableItem } from "@/components/menu/sortable";
import { CategoryCardHeader } from "@/components/menu/category-card";
import { CategorySheet } from "@/components/menu/category-sheet";
import { ProductCard } from "@/components/menu/product-card";
import { ProductSheet } from "@/components/menu/product-sheet";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { Button } from "@/components/ui/button";
import {
  deleteCategory,
  deleteProduct,
  reorderCategories,
  reorderProducts,
} from "@/actions/menu";
import type { Category, CategoryWithProducts, Product } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  initialMenu: CategoryWithProducts[];
  initialUncategorized: Product[];
  canEdit: boolean;
};

/**
 * Painel do cardápio.
 *
 * Estrutura:
 *  - Busca e filtro no topo (sticky no celular).
 *  - Categorias em accordion, arrastáveis pela alça.
 *  - Produtos em cards compactos, arrastáveis dentro da categoria.
 *  - Criação/edição em bottom sheets.
 */
export function MenuManager({ initialMenu, initialUncategorized, canEdit }: Props) {
  const [menu, setMenu] = useState<CategoryWithProducts[]>(initialMenu);
  const [uncategorized, setUncategorized] = useState<Product[]>(initialUncategorized);

  /**
   * Depois que uma action revalida a rota (`router.refresh()`), o servidor entrega
   * listas novas. Comparar a identidade do array e rederivar o estado mantém a
   * tela em sincronia sem perder a resposta otimista do arraste.
   */
  const [syncedFrom, setSyncedFrom] = useState({ menu: initialMenu, uncategorized: initialUncategorized });
  if (initialMenu !== syncedFrom.menu || initialUncategorized !== syncedFrom.uncategorized) {
    setSyncedFrom({ menu: initialMenu, uncategorized: initialUncategorized });
    setMenu(initialMenu);
    setUncategorized(initialUncategorized);
  }

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialMenu.length === 1 ? [initialMenu[0]!.id] : []),
  );
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dragging, setDragging] = useState(false);

  // Sheets
  const [categorySheet, setCategorySheet] = useState<{ open: boolean; category: Category | null }>(
    { open: false, category: null },
  );
  const [productSheet, setProductSheet] = useState<{
    open: boolean;
    product: Product | null;
    defaultCategoryId: string | null;
  }>({ open: false, product: null, defaultCategoryId: null });
  const [confirm, setConfirm] = useState<
    | { kind: "category"; category: CategoryWithProducts }
    | { kind: "product"; product: Product }
    | null
  >(null);

  const categories: Category[] = useMemo(
    () => menu.map(({ products: _products, ...category }) => category),
    [menu],
  );

  /** Reordena categorias: aplica na hora e reverte se o servidor recusar. */
  const [reorderError, setReorderError] = useState<string | null>(null);
  const moveCategories = useCallback(
    (ids: string[]) => {
      const byId = new Map(menu.map((category) => [category.id, category]));
      const next = ids
        .map((id) => byId.get(id))
        .filter((category): category is CategoryWithProducts => Boolean(category));
      // Só aplica se a nova ordem realmente contém as mesmas categorias.
      if (next.length !== menu.length) return;

      const previous = menu;
      setReorderError(null);
      setMenu(next);

      void reorderCategories(ids).then((result) => {
        if (result.ok) return;
        setMenu(previous);
        setReorderError(result.message ?? "Não foi possível salvar a ordem.");
      });
    },
    [menu],
  );

  /* ---------------------------------------------------------------- busca */
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0 || categoryFilter !== "all";

  const matches = useCallback(
    (product: Product) =>
      !normalizedQuery ||
      product.name.toLowerCase().includes(normalizedQuery) ||
      (product.description ?? "").toLowerCase().includes(normalizedQuery) ||
      (product.internal_code ?? "").toLowerCase().includes(normalizedQuery),
    [normalizedQuery],
  );

  const visibleMenu = useMemo(() => {
    if (!isSearching) return menu;

    return menu
      .filter((category) => categoryFilter === "all" || category.id === categoryFilter)
      .map((category) => ({ ...category, products: category.products.filter(matches) }))
      .filter((category) => category.products.length > 0 || !normalizedQuery);
  }, [menu, isSearching, categoryFilter, matches, normalizedQuery]);

  const resultCount = visibleMenu.reduce((sum, category) => sum + category.products.length, 0);

  /* ---------------------------------------------------------------- ações */
  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => setExpanded(new Set(menu.map((c) => c.id)));
  const collapseAll = () => setExpanded(new Set());

  const handleDeleteCategory = async () => {
    if (confirm?.kind !== "category") return;
    const id = confirm.category.id;
    const result = await deleteCategory(id);
    if (result.ok) {
      setMenu((current) => current.filter((category) => category.id !== id));
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    const result = await deleteProduct(product.id);
    if (result.ok) {
      setMenu((current) =>
        current.map((category) => ({
          ...category,
          products: category.products.filter((item) => item.id !== product.id),
        })),
      );
      setUncategorized((current) => current.filter((item) => item.id !== product.id));
    }
    setConfirm(null);
  };

  const totalProducts = menu.reduce((sum, category) => sum + category.products.length, 0);
  const availableProducts = menu.reduce(
    (sum, category) => sum + category.products.filter((p) => p.is_available).length,
    0,
  );

  /* ----------------------------------------------------------------- view */
  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Categorias" value={menu.length} />
        <SummaryTile label="Produtos" value={totalProducts} />
        <SummaryTile label="Disponíveis" value={availableProducts} tone="brand" />
      </div>

      {/* Busca + filtro */}
      <div className="space-y-2.5">
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
            placeholder="Buscar produto por nome, descrição ou código"
            aria-label="Buscar produto"
            className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-11 pr-10 text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="tap-target absolute right-1 top-1/2 grid w-10 -translate-y-1/2 place-items-center rounded-lg text-ink-400 hover:text-ink-700"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {menu.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-2">
              <FilterChip
                active={categoryFilter === "all"}
                onClick={() => setCategoryFilter("all")}
              >
                Todas
              </FilterChip>
              {menu.map((category) => (
                <FilterChip
                  key={category.id}
                  active={categoryFilter === category.id}
                  onClick={() =>
                    setCategoryFilter((current) =>
                      current === category.id ? "all" : category.id,
                    )
                  }
                >
                  {category.name}
                </FilterChip>
              ))}
            </div>
          </div>
        )}
      </div>

      {isSearching && (
        <p className="text-sm text-ink-500" role="status" aria-live="polite">
          {resultCount === 0
            ? "Nenhum produto encontrado."
            : `${resultCount} ${resultCount === 1 ? "produto encontrado" : "produtos encontrados"}`}
        </p>
      )}

      {/* Lista de categorias */}
      {menu.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={() => setCategorySheet({ open: true, category: null })} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
              {menu.length} {menu.length === 1 ? "categoria" : "categorias"}
            </p>
            <button
              type="button"
              onClick={expanded.size === menu.length ? collapseAll : expandAll}
              className="tap-target inline-flex items-center rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              {expanded.size === menu.length ? "Recolher tudo" : "Expandir tudo"}
            </button>
          </div>

          <SortableProvider
            ids={menu.map((category) => category.id)}
            onReorder={moveCategories}
            onDragStateChange={setDragging}
          >
            <div className="space-y-3">
              {visibleMenu.map((category) => {
                const isOpen = isSearching || expanded.has(category.id);

                return (
                  <SortableItem key={category.id} id={category.id}>
                    {({ handleProps, isDragging }) => (
                      <section
                        className={cn(
                          "overflow-hidden rounded-[var(--radius-card)] border border-ink-200/80 bg-white shadow-[var(--shadow-soft)]",
                          isDragging && "shadow-[var(--shadow-lift)] ring-2 ring-brand-300",
                        )}
                        aria-label={`Categoria ${category.name}`}
                      >
                        <CategoryCardHeader
                          category={category}
                          expanded={isOpen}
                          onToggle={() => toggleExpanded(category.id)}
                          onEdit={() =>
                            setCategorySheet({ open: true, category })
                          }
                          onDelete={() => setConfirm({ kind: "category", category })}
                          handleProps={handleProps}
                          isDragging={isDragging}
                        />

                        {isOpen && (
                          <div className="animate-fade-in space-y-2 border-t border-ink-100 bg-ink-50/50 p-2.5">
                            {category.products.length === 0 ? (
                              <p className="px-1 py-3 text-center text-sm text-ink-500">
                                Nenhum produto nesta categoria ainda.
                              </p>
                            ) : (
                              <SortableProvider
                                ids={category.products.map((product) => product.id)}
                                onReorder={(ids) => {
                                  const previous = category.products;
                                  const map = new Map(
                                    previous.map((product) => [product.id, product]),
                                  );
                                  const next = ids
                                    .map((id) => map.get(id))
                                    .filter((product): product is Product => Boolean(product));

                                  setMenu((current) =>
                                    current.map((item) =>
                                      item.id === category.id
                                        ? { ...item, products: next }
                                        : item,
                                    ),
                                  );

                                  void reorderProducts(ids).then((result) => {
                                    if (result.ok) return;
                                    // Reverte a ordem local se o servidor recusar.
                                    setMenu((current) =>
                                      current.map((item) =>
                                        item.id === category.id
                                          ? { ...item, products: previous }
                                          : item,
                                      ),
                                    );
                                  });
                                }}
                                onDragStateChange={setDragging}
                              >
                                <div className="space-y-2">
                                  {category.products.map((product) => (
                                    <SortableItem key={product.id} id={product.id}>
                                      {({ handleProps: productHandle }) => (
                                        <ProductCard
                                          product={product}
                                          handleProps={productHandle}
                                          showDragHandle={!isSearching && canEdit}
                                          onEdit={() =>
                                            setProductSheet({
                                              open: true,
                                              product,
                                              defaultCategoryId: category.id,
                                            })
                                          }
                                        />
                                      )}
                                    </SortableItem>
                                  ))}
                                </div>
                              </SortableProvider>
                            )}

                            {canEdit && (
                              <Button
                                variant="secondary"
                                size="md"
                                block
                                onClick={() =>
                                  setProductSheet({
                                    open: true,
                                    product: null,
                                    defaultCategoryId: category.id,
                                  })
                                }
                                className="border-dashed"
                              >
                                <Plus className="size-4" aria-hidden="true" />
                                Adicionar em {category.name}
                              </Button>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                  </SortableItem>
                );
              })}
            </div>
          </SortableProvider>
        </>
      )}

      {/* Produtos sem categoria */}
      {uncategorized.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Sem categoria ({uncategorized.length})
          </h2>
          <div className="space-y-2">
            {uncategorized.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                showDragHandle={false}
                onEdit={() =>
                  setProductSheet({ open: true, product, defaultCategoryId: null })
                }
              />
            ))}
          </div>
        </section>
      )}

      {reorderError && (
        <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {reorderError}
        </p>
      )}

      {/* Barra de ação fixa acima da navegação */}
      {canEdit && (
        <div
          className="fixed inset-x-0 z-30 px-4"
          style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
        >
          <div className="app-shell">
            <Button
              size="lg"
              block
              onClick={() =>
                setProductSheet({ open: true, product: null, defaultCategoryId: null })
              }
              className={cn(
                "shadow-[0_12px_28px_-12px_rgba(15,146,80,0.9)]",
                dragging && "pointer-events-none opacity-0",
              )}
            >
              <Plus className="size-5" aria-hidden="true" />
              Adicionar produto
            </Button>
          </div>
        </div>
      )}

      {/* Sheets */}
      <CategorySheet
        open={categorySheet.open}
        category={categorySheet.category}
        onClose={() => setCategorySheet({ open: false, category: null })}
      />

      <ProductSheet
        open={productSheet.open}
        product={productSheet.product}
        categories={categories}
        defaultCategoryId={productSheet.defaultCategoryId}
        onClose={() => setProductSheet({ open: false, product: null, defaultCategoryId: null })}
        onDelete={(product) => {
          setProductSheet({ open: false, product: null, defaultCategoryId: null });
          setConfirm({ kind: "product", product });
        }}
      />

      <ConfirmSheet
        open={confirm?.kind === "category"}
        onClose={() => setConfirm(null)}
        title="Excluir categoria?"
        confirmLabel="Excluir categoria"
        description={
          confirm?.kind === "category" ? (
            <>
              <strong>{confirm.category.name}</strong> será removida.{" "}
              {confirm.category.products.length > 0 ? (
                <>
                  Os {confirm.category.products.length}{" "}
                  {confirm.category.products.length === 1 ? "produto" : "produtos"} dela{" "}
                  <strong>não serão apagados</strong> — vão para &ldquo;Sem categoria&rdquo;.
                </>
              ) : (
                "Ela não tem produtos."
              )}
            </>
          ) : null
        }
        onConfirm={handleDeleteCategory}
      />

      <ConfirmSheet
        open={confirm?.kind === "product"}
        onClose={() => setConfirm(null)}
        title="Excluir produto?"
        confirmLabel="Excluir produto"
        description={
          confirm?.kind === "product" ? (
            <>
              <strong>{confirm.product.name}</strong> será apagado do cardápio. Essa ação não
              pode ser desfeita.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (confirm?.kind === "product") await handleDeleteProduct(confirm.product);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ peças */

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "brand";
}) {
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white px-3 py-2.5 text-center">
      <p
        className={cn(
          "text-xl font-semibold leading-none tabular-nums",
          tone === "brand" ? "text-brand-700" : "text-ink-900",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[0.7rem] font-medium text-ink-500">{label}</p>
    </div>
  );
}

function FilterChip({
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
        "tap-target shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white px-5 py-8 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <Plus className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-lg font-semibold text-ink-900">Comece pelas categorias</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-ink-500">
        Crie grupos como Hambúrgueres, Pizzas ou Bebidas. Depois você adiciona os produtos
        em cada um.
      </p>
      {canEdit && (
        <Button size="lg" className="mt-5 w-full max-w-xs" onClick={onCreate}>
          <Plus className="size-5" aria-hidden="true" />
          Criar primeira categoria
        </Button>
      )}
    </div>
  );
}
