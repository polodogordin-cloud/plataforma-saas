"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, SearchX } from "lucide-react";
import { ProductRow } from "@/components/public/product-row";
import { ProductDetail } from "@/components/public/product-detail";
import { FeaturedStrip } from "@/components/public/public-header";
import type { PublicMenu, PublicMenuSection, PublicProduct } from "@/lib/types";
import { cn, normalizeSearch } from "@/lib/utils";

/** Distância do topo considerada "categoria atual" (capa + abas fixas). */
const SCROLL_OFFSET = 96;

/**
 * Cardápio do cliente.
 *
 * - Abas horizontais roláveis, sincronizadas com a rolagem (scroll-spy).
 * - Ao tocar na aba, rola até a seção com compensação do cabeçalho fixo.
 * - Busca instantânea no cliente: o cardápio inteiro já veio no HTML, então
 *   filtrar é instantâneo e funciona sem rede.
 */
export function PublicMenuView({
  menu,
  tableName,
}: {
  menu: PublicMenu;
  /** Presente quando o acesso veio por QR Code/NFC. Reservado para o carrinho. */
  tableName?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(menu.sections[0]?.id ?? null);
  const [selected, setSelected] = useState<PublicProduct | null>(null);

  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabStripRef = useRef<HTMLDivElement>(null);
  /** Ignora o scroll-spy enquanto uma rolagem programática está em curso. */
  const programmaticUntil = useRef(0);

  const normalizedQuery = query.trim().toLowerCase();

  /* ---------------------------------------------------------------- busca */
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return null;

    const needle = normalizeSearch(query);
    const matches = (product: PublicProduct) =>
      normalizeSearch(product.name).includes(needle) ||
      normalizeSearch(product.description).includes(needle);

    return menu.sections
      .map((section) => ({ ...section, products: section.products.filter(matches) }))
      .filter((section) => section.products.length > 0);
  }, [menu.sections, normalizedQuery]);

  const resultCount =
    searchResults?.reduce((sum, section) => sum + section.products.length, 0) ?? 0;

  /* ------------------------------------------------------------ scroll-spy */
  useEffect(() => {
    if (normalizedQuery) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < programmaticUntil.current) return;

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        const first = visible[0];
        if (first?.target.id) setActiveId(first.target.id.replace("secao-", ""));
      },
      // Faixa estreita perto do topo: evita trocar de aba no meio da seção.
      { rootMargin: `-${SCROLL_OFFSET}px 0px -70% 0px`, threshold: 0 },
    );

    for (const element of sectionRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [menu.sections, normalizedQuery]);

  /** Mantém a aba ativa visível na faixa horizontal. */
  useEffect(() => {
    if (!activeId) return;
    const tab = tabRefs.current.get(activeId);
    const strip = tabStripRef.current;
    if (!tab || !strip) return;

    const tabLeft = tab.offsetLeft;
    const tabRight = tabLeft + tab.offsetWidth;
    const visibleLeft = strip.scrollLeft;
    const visibleRight = visibleLeft + strip.clientWidth;

    if (tabLeft < visibleLeft + 16) {
      strip.scrollTo({ left: tabLeft - 16, behavior: "smooth" });
    } else if (tabRight > visibleRight - 16) {
      strip.scrollTo({ left: tabRight - strip.clientWidth + 16, behavior: "smooth" });
    }
  }, [activeId]);

  const goToSection = useCallback((id: string) => {
    const element = sectionRefs.current.get(id);
    if (!element) return;

    programmaticUntil.current = Date.now() + 700;
    setActiveId(id);

    const top = element.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET + 8;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  const clearSearch = () => setQuery("");

  return (
    <>
      {/* ---------------------------------------------------------- busca */}
      <div className="sticky top-0 z-30 border-b border-ink-200/60 bg-ink-50/85 backdrop-blur-lg">
        <div className="mx-auto w-full max-w-lg px-4 pb-2.5 pt-3">
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
              placeholder="Buscar no cardápio"
              aria-label="Buscar no cardápio"
              className="w-full rounded-xl border border-ink-200 bg-white py-2.5 pl-11 pr-11 text-ink-900 shadow-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Limpar busca"
                className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-ink-400 transition hover:text-ink-700"
              >
                <X className="size-4.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Abas de categoria — escondidas durante a busca */}
          {!normalizedQuery && menu.sections.length > 1 && (
            <div
              ref={tabStripRef}
              className="-mx-4 mt-2.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex w-max gap-1.5" role="tablist" aria-label="Categorias do cardápio">
                {menu.sections.map((section) => {
                  const isActive = activeId === section.id;
                  return (
                    <button
                      key={section.id}
                      ref={(node) => {
                        if (node) tabRefs.current.set(section.id, node);
                        else tabRefs.current.delete(section.id);
                      }}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => goToSection(section.id)}
                      className={cn(
                        "shrink-0 whitespace-nowrap rounded-full px-3.5 text-[0.8rem] font-semibold transition-colors",
                        "min-h-11",
                        isActive
                          ? "bg-ink-900 text-white"
                          : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-100",
                      )}
                    >
                      {section.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------- destaques */}
      {!normalizedQuery && <FeaturedStrip products={menu.featured} onSelect={setSelected} />}

      {/* ------------------------------------------------- resultado busca */}
      {normalizedQuery ? (
        <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-4">
          <p className="text-sm text-ink-500" role="status" aria-live="polite">
            {resultCount === 0
              ? "Nenhum produto encontrado."
              : `${resultCount} ${resultCount === 1 ? "produto" : "produtos"} para “${query.trim()}”`}
          </p>

          {resultCount === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-ink-300 bg-white px-5 py-9 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-400">
                <SearchX className="size-6" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink-700">Nada com esse nome</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">
                Tente outra palavra ou toque em “Limpar busca” para ver o cardápio inteiro.
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white active:scale-95"
              >
                Limpar busca
              </button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {searchResults?.flatMap((section) =>
                section.products.map((product) => (
                  <ProductRow key={product.id} product={product} onSelect={setSelected} />
                )),
              )}
            </ul>
          )}
        </div>
      ) : (
        /* ------------------------------------------------- seções do cardápio */
        <div className="mx-auto w-full max-w-lg px-4 pb-14 pt-5">
          {menu.sections.map((section) => (
            <Section
              key={section.id}
              section={section}
              onSelect={setSelected}
              registerRef={(node) => {
                if (node) sectionRefs.current.set(section.id, node);
                else sectionRefs.current.delete(section.id);
              }}
            />
          ))}

          {menu.sections.length === 0 && (
            <div className="rounded-2xl border border-dashed border-ink-300 bg-white px-5 py-10 text-center">
              <p className="text-sm font-medium text-ink-700">Cardápio em preparação</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">
                O restaurante ainda não publicou itens. Volte em instantes.
              </p>
            </div>
          )}
        </div>
      )}

      <ProductDetail
        product={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function Section({
  section,
  onSelect,
  registerRef,
}: {
  section: PublicMenuSection;
  onSelect: (product: PublicProduct) => void;
  registerRef: (node: HTMLElement | null) => void;
}) {
  return (
    <section
      id={`secao-${section.id}`}
      ref={registerRef}
      aria-labelledby={`titulo-${section.id}`}
      className="scroll-mt-24 pb-6 last:pb-0"
    >
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2
          id={`titulo-${section.id}`}
          className="text-[1.05rem] font-semibold tracking-tight text-ink-900"
        >
          {section.name}
        </h2>
        <span className="text-xs font-medium tabular-nums text-ink-400">
          {section.products.length}
        </span>
      </div>

      {section.description && (
        <p className="mb-2.5 -mt-1 text-xs leading-snug text-ink-500">{section.description}</p>
      )}

      <ul className="space-y-2">
        {section.products.map((product) => (
          <ProductRow key={product.id} product={product} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}
