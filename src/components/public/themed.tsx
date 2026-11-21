import type { CSSProperties } from "react";
import { cardRadius, cardShadow, themeTokens, themeToCssVars } from "@/lib/theme";
import type { ButtonStyle, RestaurantTheme } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Primitivas *themed* do cardápio público — Etapa 9.
 *
 * Não há classe de cor fixa aqui: tudo sai de CSS custom properties (`--mv-*`)
 * definidas pelo `<ThemeScope>` no topo da página. Isso é o que faz a
 * personalização valer para **toda** a árvore do cardápio sem tocar em cada
 * componente, e sem gerar CSS novo por restaurante.
 *
 * Estes componentes não têm "use client": são usados dentro de componentes
 * cliente (viram parte do bundle deles) e também no servidor, no cabeçalho.
 */

/**
 * Aplica o tema numa subárvore.
 *
 * `data-theme-tone` no wrapper serve para os poucos lugares que precisam de
 * `dark:` de verdade (por exemplo, sombra de imagem). O resto é variável.
 */
export function ThemeScope({
  theme,
  children,
  className,
  as: Tag = "div",
}: {
  theme: RestaurantTheme;
  children: React.ReactNode;
  className?: string;
  as?: "div" | "main";
}) {
  const tokens = themeTokens(theme);

  return (
    <Tag
      data-theme-tone={tokens.isDark ? "dark" : "light"}
      data-card-style={theme.card_style}
      data-button-style={theme.button_style}
      style={themeToCssVars(theme) as unknown as CSSProperties}
      className={cn("bg-[var(--mv-bg)] text-[var(--mv-text)]", className)}
    >
      {children}
    </Tag>
  );
}

/** Card do cardápio (produto, destaque): raio, borda e sombra vêm do estilo. */
export function cardClasses(style: RestaurantTheme["card_style"], extra?: string): string {
  return cn(
    "bg-[var(--mv-surface)] text-[var(--mv-text)]",
    style === "flat"
      ? "border-b border-[var(--mv-border)]"
      : "border border-[var(--mv-border)]",
    extra,
  );
}

/** Style inline com raio e sombra — mais previsível que classe dinâmica. */
export function cardStyle(theme: RestaurantTheme): CSSProperties {
  return {
    borderRadius: cardRadius(theme.card_style),
    boxShadow: cardShadow(theme.card_style),
  };
}

/** Texto secundário (descrição, metadados). */
export const mutedText = "text-[var(--mv-text-muted)]";

/** Preço / acento: usa a cor principal, que é a que o dono escolheu. */
export const accentText = "text-[var(--mv-primary)]";

/**
 * Botão principal do cardápio ("Adicionar", ação do carrinho).
 *
 * Três estilos de botão do escopo, e em todos o texto é escolhido por
 * contraste (`buttonText`), não fixado em branco:
 *
 *   solid   → preenchido
 *   outline → fundo da superfície + borda e texto na cor do botão
 *   pill    → preenchido e totalmente arredondado
 */
export function primaryButtonStyle(theme: RestaurantTheme): CSSProperties {
  const tokens = themeTokens(theme);
  const base: CSSProperties = { borderRadius: buttonRadiusFor(theme.button_style) };

  if (theme.button_style === "outline") {
    return {
      ...base,
      backgroundColor: tokens.surface,
      color: tokens.button,
      border: `1.5px solid ${tokens.button}`,
    };
  }

  return {
    ...base,
    backgroundColor: tokens.button,
    color: tokens.buttonText,
    border: "1.5px solid transparent",
  };
}

export function buttonRadiusFor(style: ButtonStyle): string {
  return style === "pill" ? "999px" : "0.75rem";
}

/** Classe base do botão principal (alvo de toque ≥ 44 px). */
export const primaryButtonBase =
  "inline-flex min-h-11 select-none items-center justify-center gap-1.5 px-4 text-sm font-bold " +
  "transition-transform duration-150 active:scale-[0.97] disabled:opacity-60 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mv-primary)]";

/** Pílula de status (aberto/fechado) sobre o cabeçalho colorido. */
export function pillOnPrimary(theme: RestaurantTheme): CSSProperties {
  const tokens = themeTokens(theme);
  return {
    backgroundColor: withAlpha(tokens.onPrimary, 0.16),
    color: tokens.onPrimary,
  };
}

/**
 * `#rrggbb` + alpha → `rgba()`. CSS não aceita alpha em hex de 6 dígitos.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
