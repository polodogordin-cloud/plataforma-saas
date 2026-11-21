"use client";

import Image from "next/image";
import { Clock, Search, Star, Store } from "lucide-react";
import { withAlpha } from "@/components/public/themed";
import { cardRadius, cardShadow, themeTokens } from "@/lib/theme";
import type { RestaurantTheme } from "@/lib/types";

/**
 * Preview do cardápio no formato de celular.
 *
 * **Mesmo componente para o painel e para a página pública?** Não — aqui é uma
 * miniatura estática, sem carrinho, sem rede, sem pedido. O que os dois
 * compartilham é a fonte da verdade: `themeTokens` + as variáveis `--mv-*`
 * (aplicadas pelo `ThemeScope` do editor). Então o que aparece nesta moldura é
 * o mesmo cálculo que pinta o cardápio real — se a cor ficar ilegível aqui,
 * fica lá também.
 *
 * Medidas: 320 × 620 CSS px, a largura de um telefone pequeno de verdade. O
 * conteúdo é escalado por `transform` no container que o envolve, então a
 * proporção se mantém em qualquer tela do painel.
 */
export function MenuPreview({
  theme,
  restaurantName,
  tagline,
  items,
}: {
  theme: RestaurantTheme;
  restaurantName: string;
  tagline: string | null;
  items: { name: string; price: string }[];
}) {
  const tokens = themeTokens(theme);
  const logoUrl = theme.logo_url;
  const coverUrl = theme.cover_url;

  return (
    <div
      aria-label="Prévia do cardápio no celular"
      role="img"
      className="relative isolate overflow-hidden rounded-[1.75rem] bg-[var(--mv-bg)] text-[var(--mv-text)] shadow-[0_20px_45px_-25px_rgba(16,24,40,0.55)] ring-1 ring-black/10"
      style={{ width: 320, height: 620 }}
    >
      {/* ------------------------------------------------ capa / cabeçalho */}
      <div
        className="relative overflow-hidden px-4 pb-4 pt-5 text-[var(--mv-on-primary)]"
        style={{ backgroundColor: tokens.primary }}
      >
        {coverUrl ? (
          <>
            <Image
              src={coverUrl}
              alt=""
              fill
              sizes="320px"
              className="object-cover"
              // Preview no painel: a imagem já é pequena e vem do storage.
              unoptimized
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
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full blur-2xl"
            style={{ backgroundColor: withAlpha(tokens.secondary, 0.34) }}
          />
        )}

        <div className="relative flex items-start gap-2.5">
          <div
            className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl"
            style={{ backgroundColor: withAlpha(tokens.onPrimary, 0.16) }}
          >
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt=""
                fill
                sizes="44px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <Store className="size-5 opacity-80" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.95rem] font-bold leading-tight">
              {restaurantName || "Seu restaurante"}
            </p>
            {tagline && (
              <p className="mt-0.5 line-clamp-2 text-[0.68rem] leading-snug opacity-80">
                {tagline}
              </p>
            )}
          </div>
        </div>

        <div className="relative mt-3 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
            style={{ backgroundColor: withAlpha(tokens.onPrimary, 0.18) }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: tokens.onPrimary }}
              aria-hidden="true"
            />
            Aberto agora
          </span>
          <span className="inline-flex items-center gap-1 text-[0.6rem] font-medium opacity-75">
            <Clock className="size-3" aria-hidden="true" />
            25 itens
          </span>
        </div>
      </div>

      {/* -------------------------------------------------------- busca */}
      <div className="bg-[var(--mv-bg)] px-3 pt-3">
        <div className="flex items-center gap-1.5 rounded-xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-2.5 py-2">
          <Search className="size-3.5 text-[var(--mv-text-muted)]" aria-hidden="true" />
          <span className="text-[0.68rem] text-[var(--mv-text-muted)]">Buscar no cardápio</span>
        </div>

        {/* ------------------------------------------------ abas de categoria */}
        <div className="mt-2 flex gap-1.5">
          <span
            className="rounded-full px-2.5 py-1 text-[0.62rem] font-bold"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.onPrimary,
            }}
          >
            Hambúrgueres
          </span>
          <span className="rounded-full border border-[var(--mv-border)] bg-[var(--mv-surface)] px-2.5 py-1 text-[0.62rem] font-semibold text-[var(--mv-text-muted)]">
            Bebidas
          </span>
        </div>
      </div>

      {/* ----------------------------------------------------- produtos */}
      <div className="px-3 pt-3">
        <div className="flex items-baseline gap-1.5">
          <p className="text-[0.78rem] font-bold text-[var(--mv-text)]">Hambúrgueres</p>
          <span className="text-[0.6rem] text-[var(--mv-text-muted)]">{items.length}</span>
        </div>

        <ul className="mt-1.5 space-y-1.5">
          {items.slice(0, 3).map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="relative flex items-stretch gap-2 border border-[var(--mv-border)] bg-[var(--mv-surface)] p-2"
              style={{
                borderRadius: cardRadius(theme.card_style),
                boxShadow: cardShadow(theme.card_style),
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-[0.72rem] font-bold text-[var(--mv-text)]">
                  {item.name}
                  {index === 0 && (
                    <Star
                      className="size-2.5 shrink-0 text-[var(--mv-secondary)]"
                      style={{ fill: tokens.secondary }}
                      aria-hidden="true"
                    />
                  )}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[0.58rem] leading-snug text-[var(--mv-text-muted)]">
                  Pão brioche, queijo cheddar e bacon crocante
                </p>
                <p className="mt-1 text-[0.72rem] font-bold tabular-nums text-[var(--mv-primary)]">
                  {item.price}
                </p>
              </div>

              <div className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-[var(--mv-surface-muted)]">
                <span
                  className="grid size-full place-items-center text-sm font-bold text-[var(--mv-text-muted)] opacity-50"
                  aria-hidden="true"
                >
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
              </div>

              {/* O "+" na cor dos botões: é o que muda mais visivelmente entre
                  os estilos "sólido" e "contorno". */}
              <span
                aria-hidden="true"
                className="absolute bottom-2 right-2 grid size-6 place-items-center text-[0.8rem] font-bold leading-none"
                style={{
                  ...buttonChip(theme),
                  borderRadius: theme.button_style === "pill" ? "999px" : "0.5rem",
                }}
              >
                +
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ------------------------------------------- barra inferior fixa */}
      <div className="absolute inset-x-0 bottom-0 border-t border-[var(--mv-border)] bg-[var(--mv-surface)]/95 px-2 pb-2 pt-1.5 backdrop-blur">
        <div className="flex items-stretch gap-1">
          <span className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-[var(--mv-surface-muted)] py-1.5 text-[0.55rem] font-bold text-[var(--mv-text)]">
            <span aria-hidden="true" className="text-[0.7rem]">
              🛎
            </span>
            Garçom
          </span>
          <span
            className="flex flex-[1.3] flex-col items-center justify-center gap-0.5 py-1.5 text-[0.55rem] font-bold"
            style={{ ...buttonChip(theme), borderRadius: "0.5rem" }}
          >
            <span aria-hidden="true" className="text-[0.7rem]">
              🛒
            </span>
            Carrinho
          </span>
          <span className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-[var(--mv-surface-muted)] py-1.5 text-[0.55rem] font-bold text-[var(--mv-text)]">
            <span aria-hidden="true" className="text-[0.7rem]">
              💳
            </span>
            Conta
          </span>
        </div>
      </div>
    </div>
  );
}

/** Fundo/texto/borda do "chip" de botão conforme o estilo escolhido. */
function buttonChip(theme: RestaurantTheme): React.CSSProperties {
  const tokens = themeTokens(theme);

  if (theme.button_style === "outline") {
    return {
      backgroundColor: tokens.surface,
      color: tokens.button,
      border: `1.5px solid ${tokens.button}`,
    };
  }

  return {
    backgroundColor: tokens.button,
    color: tokens.buttonText,
  };
}
