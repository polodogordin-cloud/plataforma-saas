import Image from "next/image";
import { Clock, MapPin, Star, Store } from "lucide-react";
import { TableBadge } from "@/components/public/table-badge";
import { withAlpha } from "@/components/public/themed";
import { getOpeningState } from "@/lib/opening-hours";
import { cardRadius, cardShadow, themeTokens } from "@/lib/theme";
import { formatPrice } from "@/lib/validation";
import type {
  PublicMenu,
  PublicProduct,
  PublicRestaurant,
  RestaurantTheme,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Capa do cardápio público.
 *
 * Não é uma tela administrativa: nada de sidebar, tabela ou métrica. É a
 * vitrine do restaurante — capa, logo, nome, uma linha de descrição e se está
 * aberto.
 *
 * Etapa 9: as cores vêm do tema (`--mv-*`), o logo pode vir do tema (que é
 * editável) e há uma **imagem de capa** opcional. Sem capa, o cabeçalho usa a
 * cor principal — nunca fica um retângulo vazio.
 */
export function PublicHeader({
  restaurant,
  menu,
  timeZone,
  tableName,
  theme,
}: {
  restaurant: PublicRestaurant;
  menu: PublicMenu;
  timeZone: string;
  /** Quando o acesso veio por QR Code/NFC, o rótulo da mesa. */
  tableName?: string | null;
  theme: RestaurantTheme;
}) {
  const opening = getOpeningState(restaurant, timeZone);
  const location = [restaurant.city, restaurant.state].filter(Boolean).join(" · ");
  const tokens = themeTokens(theme);

  // Logo do tema tem prioridade: é o que o dono acabou de trocar na tela de
  // personalização. O logo do cadastro continua valendo como fallback.
  const logoUrl = theme.logo_url ?? restaurant.logo_url;
  const coverUrl = theme.cover_url;

  return (
    <header
      className="relative overflow-hidden pb-7 pt-safe text-[var(--mv-on-primary)]"
      style={{ backgroundColor: tokens.primary }}
    >
      {/* Capa: imagem do restaurante, com véu na cor principal para o texto
          continuar legível em qualquer foto. Sem capa, os brilhos decorativos
          dão profundidade à cor sólida. */}
      {coverUrl ? (
        <>
          <Image
            src={coverUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 640px) 100vw, 512px"
            className="object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${withAlpha(tokens.primary, 0.55)} 0%, ${withAlpha(
                tokens.primary,
                0.92,
              )} 78%, ${tokens.primary} 100%)`,
            }}
          />
        </>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-3xl"
            style={{ backgroundColor: withAlpha(tokens.secondary, 0.32) }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-20 top-24 size-48 rounded-full blur-3xl"
            style={{ backgroundColor: withAlpha(tokens.onPrimary, 0.12) }}
          />
        </>
      )}

      <div className="relative mx-auto w-full max-w-lg px-4 pt-6">
        <div className="flex items-start gap-3.5">
          {/* Logo */}
          <div
            className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl ring-1 ring-inset"
            style={{
              backgroundColor: withAlpha(tokens.onPrimary, 0.14),
              // @ts-expect-error -- custom property no ring
              "--tw-ring-color": withAlpha(tokens.onPrimary, 0.22),
            }}
          >
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={`Logo de ${restaurant.name}`}
                fill
                sizes="64px"
                priority
                className="object-cover"
              />
            ) : (
              <Store
                className="size-7 opacity-80"
                style={{ color: tokens.onPrimary }}
                aria-hidden="true"
              />
            )}
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="text-[1.4rem] font-semibold leading-tight tracking-tight text-balance">
              {restaurant.name}
            </h1>

            {tableName && (
              <TableBadge name={tableName} variant="dark" className="mt-1.5" />
            )}

            {restaurant.description && (
              <p className="mt-1 line-clamp-3 text-sm leading-snug opacity-80">
                {restaurant.description}
              </p>
            )}
          </div>
        </div>

        {/* Status + informações básicas */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {opening ? (
            <OpeningPill opening={opening} onPrimary={tokens.onPrimary} />
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: withAlpha(tokens.onPrimary, 0.14) }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: withAlpha(tokens.onPrimary, 0.75) }}
                aria-hidden="true"
              />
              {restaurant.status === "published" ? "Aceitando pedidos" : "Fechado"}
            </span>
          )}

          {location && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium opacity-75">
              <MapPin className="size-3.5" aria-hidden="true" />
              {location}
            </span>
          )}

          <span className="inline-flex items-center gap-1.5 text-xs font-medium opacity-75">
            <Clock className="size-3.5" aria-hidden="true" />
            {menu.counts.products} {menu.counts.products === 1 ? "item" : "itens"}
          </span>
        </div>
      </div>
    </header>
  );
}

function OpeningPill({
  opening,
  onPrimary,
}: {
  opening: ReturnType<typeof getOpeningState>;
  onPrimary: string;
}) {
  if (!opening) return null;

  // Aberto/fechado não pode depender da cor do restaurante: se o dono escolher
  // amarelo, a pílula de "aberto" ainda precisa ser reconhecível. A cor da
  // marca entra como fundo; o ícone textual (dot + rótulo) carrega o sentido.
  const isOpen = opening.state === "open";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: withAlpha(onPrimary, isOpen ? 0.18 : 0.12),
        color: onPrimary,
      }}
    >
      <span
        className={cn("size-1.5 rounded-full", isOpen ? "animate-pulse" : "")}
        style={{ backgroundColor: onPrimary, opacity: isOpen ? 1 : 0.6 }}
        aria-hidden="true"
      />
      {opening.label}
    </span>
  );
}

/**
 * Faixa de destaques: produtos marcados com `is_featured`.
 *
 * Segue o tema — card, preço e estrela usam as cores do restaurante. A estrela
 * fica na cor secundária, que é a única cor "de acento" que o dono escolhe.
 */
export function FeaturedStrip({
  products,
  onSelect,
  theme,
}: {
  products: PublicProduct[];
  onSelect: (product: PublicProduct) => void;
  theme: RestaurantTheme;
}) {
  if (!products.length) return null;

  const tokens = themeTokens(theme);

  return (
    <section aria-labelledby="destaques" className="pt-4">
      <div className="mx-auto flex w-full max-w-lg items-center gap-1.5 px-4">
        <Star
          className="size-3.5"
          style={{ color: tokens.secondary, fill: tokens.secondary }}
          aria-hidden="true"
        />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]">
          Destaques da casa
        </h2>
      </div>

      <div className="mt-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="mx-auto flex w-max max-w-none gap-2.5 px-4">
          {products.map((product) => (
            <li key={product.id} className="w-[9.5rem] shrink-0">
              <button
                type="button"
                onClick={() => onSelect(product)}
                className="group block min-h-11 w-full overflow-hidden border border-[var(--mv-border)] bg-[var(--mv-surface)] text-left transition-transform duration-200 active:scale-[0.98]"
                style={{
                  borderRadius: cardRadius(theme.card_style),
                  boxShadow: cardShadow(theme.card_style),
                }}
              >
                <span className="relative block aspect-[4/3] w-full bg-[var(--mv-surface-muted)]">
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
                      className="grid size-full place-items-center text-2xl font-semibold text-[var(--mv-text-muted)] opacity-50"
                      aria-hidden="true"
                    >
                      {product.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="block px-2.5 pb-2.5 pt-2">
                  <span className="line-clamp-2 block text-[0.8rem] font-semibold leading-tight">
                    {product.name}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-[var(--mv-primary)]">
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
