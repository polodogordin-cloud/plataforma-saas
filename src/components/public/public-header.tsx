import Image from "next/image";
import { Clock, MapPin, Star, Store } from "lucide-react";
import { getOpeningState } from "@/lib/opening-hours";
import { formatPrice } from "@/lib/validation";
import type { PublicMenu, PublicProduct, PublicRestaurant } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Capa do cardápio público.
 *
 * Não é uma tela administrativa: nada de sidebar, tabela ou métrica. É a
 * vitrine do restaurante — logo, nome, uma linha de descrição e se está aberto.
 */
export function PublicHeader({
  restaurant,
  menu,
  timeZone,
}: {
  restaurant: PublicRestaurant;
  menu: PublicMenu;
  timeZone: string;
}) {
  const opening = getOpeningState(restaurant, timeZone);
  const location = [restaurant.city, restaurant.state].filter(Boolean).join(" · ");

  return (
    <header className="relative overflow-hidden bg-gradient-to-b from-brand-950 via-brand-900 to-brand-800 pb-7 pt-safe text-white">
      {/* Brilho decorativo discreto */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-brand-500/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 top-24 size-48 rounded-full bg-accent-400/10 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-lg px-4 pt-6">
        <div className="flex items-start gap-3.5">
          {/* Logo */}
          <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10 ring-1 ring-inset ring-white/20 backdrop-blur-sm">
            {restaurant.logo_url ? (
              <Image
                src={restaurant.logo_url}
                alt={`Logo de ${restaurant.name}`}
                fill
                sizes="64px"
                priority
                className="object-cover"
              />
            ) : (
              <Store className="size-7 text-white/80" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="text-[1.4rem] font-semibold leading-tight tracking-tight text-white text-balance">
              {restaurant.name}
            </h1>

            {restaurant.description && (
              <p className="mt-1 line-clamp-2 text-sm leading-snug text-white/75">
                {restaurant.description}
              </p>
            )}
          </div>
        </div>

        {/* Status + informações básicas */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {opening ? (
            <OpeningPill opening={opening} />
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                restaurant.status === "published"
                  ? "bg-brand-400/20 text-brand-100"
                  : "bg-white/10 text-white/70",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  restaurant.status === "published" ? "bg-brand-300" : "bg-white/50",
                )}
                aria-hidden="true"
              />
              {restaurant.status === "published" ? "Aceitando pedidos" : "Fechado"}
            </span>
          )}

          {location && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
              <MapPin className="size-3.5" aria-hidden="true" />
              {location}
            </span>
          )}

          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
            <Clock className="size-3.5" aria-hidden="true" />
            {menu.counts.products} {menu.counts.products === 1 ? "item" : "itens"}
          </span>
        </div>
      </div>
    </header>
  );
}

function OpeningPill({ opening }: { opening: ReturnType<typeof getOpeningState> }) {
  if (!opening) return null;

  const tone =
    opening.state === "open"
      ? "bg-brand-400/20 text-brand-100"
      : opening.state === "closed"
        ? "bg-amber-400/15 text-amber-100"
        : "bg-white/10 text-white/70";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        tone,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          opening.state === "open"
            ? "bg-brand-300"
            : opening.state === "closed"
              ? "bg-amber-300"
              : "bg-white/50",
        )}
        aria-hidden="true"
      />
      {opening.label}
    </span>
  );
}

/** Faixa de destaques: produtos marcados com `is_featured`. */
export function FeaturedStrip({
  products,
  onSelect,
}: {
  products: PublicProduct[];
  onSelect: (product: PublicProduct) => void;
}) {
  if (!products.length) return null;

  return (
    <section aria-labelledby="destaques" className="pt-4">
      <div className="mx-auto flex w-full max-w-lg items-center gap-1.5 px-4">
        <Star className="size-3.5 fill-accent-500 text-accent-500" aria-hidden="true" />
        <h2 id="destaques" className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Destaques da casa
        </h2>
      </div>

      <div className="-mx-0 mt-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="mx-auto flex w-max max-w-none gap-2.5 px-4">
          {products.map((product) => (
            <li key={product.id} className="w-[9.5rem] shrink-0">
              <button
                type="button"
                onClick={() => onSelect(product)}
                className="group block min-h-11 w-full overflow-hidden rounded-2xl border border-ink-200/80 bg-white text-left shadow-[var(--shadow-soft)] transition-transform duration-200 active:scale-[0.98]"
              >
                <span className="relative block aspect-[4/3] w-full bg-ink-100">
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt=""
                      fill
                      sizes="152px"
                      className="object-cover"
                    />
                  ) : (
                    <span
                      className="grid size-full place-items-center text-2xl font-semibold text-ink-300"
                      aria-hidden="true"
                    >
                      {product.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="block px-2.5 pb-2.5 pt-2">
                  <span className="line-clamp-2 block text-[0.8rem] font-semibold leading-tight text-ink-900">
                    {product.name}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-brand-700">
                    {formatPrice(product.price)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
