/**
 * Tema visual do cardápio — Etapa 9.
 *
 * Módulo **neutro**: roda no servidor (para gerar as CSS vars da página
 * pública) e no navegador (para o preview ao vivo do painel). Por isso não
 * importa `server-only` nem React.
 *
 * ─── A ideia central ────────────────────────────────────────────────────────
 *
 * O cardápio público não usa classes de cor fixas (`bg-brand-600`). Ele lê
 * variáveis CSS com o sufixo `--mv-*`, e este módulo é a única coisa que decide
 * quanto valem. Assim:
 *
 *   • trocar de tema não gera CSS novo nem rebuild — é um `style` de 12 linhas
 *     no elemento raiz;
 *   • o mesmo objeto que pinta a página alimenta o preview do painel, então
 *     preview e produção não podem divergir;
 *   • restaurante sem tema nenhum cai no tema padrão e continua bonito.
 *
 * ─── Contraste é regra, não sugestão ────────────────────────────────────────
 *
 * Cor livre em formulário vira ilegível com facilidade (texto branco sobre
 * amarelo). Toda cor de texto que não é escolhida explicitamente é **derivada**
 * por contraste contra o fundo, e o texto de botão é escolhido entre branco e
 * quase-preto pelo maior contraste. Se o restaurante escolher um par ruim, o
 * cardápio continua legível — o que ele pediu vale onde não quebra a leitura.
 */

import type {
  CardStyle,
  ButtonStyle,
  RestaurantTheme,
  ThemePresetId,
  ThemeTokens,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Cores                                                                      */
/* -------------------------------------------------------------------------- */

type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Valida e normaliza "#abc" / "abcdef" para "#aabbcc". Inválido → null. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = HEX_RE.exec(value.trim());
  if (!match) return null;

  const digits = match[1]!.toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((char) => char + char)
          .join("")
      : digits;

  return `#${full}`;
}

export function hexToRgb(value: string): Rgb {
  const hex = normalizeHex(value) ?? "#000000";
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channelToHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/** Mistura duas cores: `amount` 0 = a, 1 = b. Usado para tons de superfície. */
export function mix(a: string, b: string, amount: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  });
}

/** Luminância relativa (WCAG 2.1). */
export function relativeLuminance(value: string): number {
  const { r, g, b } = hexToRgb(value);
  const linear = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** Razão de contraste entre duas cores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export const NEAR_BLACK = "#14161c";
export const WHITE = "#ffffff";

/**
 * Texto legível sobre `background`.
 *
 * Prefere branco quando empata porque o cardápio é visto no sol do salão —
 * mas nunca escolhe branco se quase-preto tiver contraste claramente melhor.
 */
export function readableOn(background: string, dark: string = NEAR_BLACK): string {
  return contrastRatio(WHITE, background) >= contrastRatio(dark, background) ? WHITE : dark;
}

/**
 * Ajusta `color` até ter `min` de contraste contra `background`.
 *
 * Clareia ou escurece em passos de 6% na direção que mais afasta o fundo — é o
 * suficiente para chegar em 4.5:1 sem transformar a cor escolhida em outra
 * coisa (um azul continua azul).
 */
export function ensureContrast(color: string, background: string, min = 4.5): string {
  const start = normalizeHex(color) ?? color;
  if (contrastRatio(start, background) >= min) return start;

  const towardsLight = relativeLuminance(background) < 0.5 ? WHITE : "#000000";
  let best = start;

  for (let amount = 0.06; amount <= 1.0001; amount += 0.06) {
    const candidate = mix(start, towardsLight, amount);
    best = candidate;
    if (contrastRatio(candidate, background) >= min) return candidate;
  }

  return best;
}

/** Cor de borda/divisória coerente com o fundo do tema. */
export function borderFor(background: string, text: string): string {
  return mix(background, text, 0.14);
}

/* -------------------------------------------------------------------------- */
/* Presets de tema                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Temas prontos.
 *
 * Cada preset é um ponto de partida: o restaurante escolhe e depois ajusta
 * qualquer cor. Por isso todos os campos vêm preenchidos — um preset nunca
 * produz tema "meio configurado".
 */
export type ThemePreset = {
  id: ThemePresetId;
  name: string;
  description: string;
  /** Três cores para o seletor mostrar a paleta sem abrir o tema. */
  swatch: [string, string, string];
  theme: Omit<RestaurantTheme, "logo_url" | "cover_url">;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "moderno",
    name: "Moderno",
    description: "Verde vivo, cantos arredondados. O padrão do Menuvo.",
    swatch: ["#0f9250", "#eefdf3", "#ffffff"],
    theme: {
      preset: "moderno",
      primary_color: "#0f9250",
      secondary_color: "#41cf80",
      background_color: "#ffffff",
      text_color: "#14161c",
      button_color: "#0f9250",
      card_style: "rounded",
      button_style: "solid",
    },
  },
  {
    id: "elegante",
    name: "Elegante",
    description: "Vinho e dourado, cantos suaves. Para jantar à luz de vela.",
    swatch: ["#7c2d3a", "#c8a24a", "#fbf8f3"],
    theme: {
      preset: "elegante",
      primary_color: "#7c2d3a",
      secondary_color: "#c8a24a",
      background_color: "#fbf8f3",
      text_color: "#241a1c",
      button_color: "#7c2d3a",
      card_style: "soft",
      button_style: "solid",
    },
  },
  {
    id: "dark",
    name: "Dark",
    description: "Fundo escuro e acento cítrico. Salão à noite, bar.",
    swatch: ["#f4b942", "#16181d", "#23262e"],
    theme: {
      preset: "dark",
      primary_color: "#f4b942",
      secondary_color: "#7fd1ae",
      background_color: "#16181d",
      text_color: "#f4f5f7",
      button_color: "#f4b942",
      card_style: "rounded",
      button_style: "solid",
    },
  },
  {
    id: "minimalista",
    name: "Minimalista",
    description: "Preto, branco e muito espaço. Cardápio de bistrô.",
    swatch: ["#14161c", "#ffffff", "#f2f2f2"],
    theme: {
      preset: "minimalista",
      primary_color: "#14161c",
      secondary_color: "#6c7080",
      background_color: "#ffffff",
      text_color: "#14161c",
      button_color: "#14161c",
      card_style: "flat",
      button_style: "solid",
    },
  },
  {
    id: "restaurante",
    name: "Restaurante",
    description: "Terracota e creme. Casa de comida caseira.",
    swatch: ["#c05621", "#f7efe2", "#3a2a1f"],
    theme: {
      preset: "restaurante",
      primary_color: "#c05621",
      secondary_color: "#8a6a4f",
      background_color: "#f7efe2",
      text_color: "#3a2a1f",
      button_color: "#c05621",
      card_style: "rounded",
      button_style: "outline",
    },
  },
  {
    id: "fastfood",
    name: "Fast food",
    description: "Vermelho e amarelo, botões enormes. Delivery e lanchonete.",
    swatch: ["#d92626", "#ffc400", "#ffffff"],
    theme: {
      preset: "fastfood",
      primary_color: "#d92626",
      secondary_color: "#ffc400",
      background_color: "#ffffff",
      text_color: "#1c1c1c",
      button_color: "#d92626",
      card_style: "flat",
      button_style: "solid",
    },
  },
];

/** Tema padrão: o "Moderno". Usado quando o restaurante nunca personalizou. */
export const DEFAULT_THEME: RestaurantTheme = {
  ...THEME_PRESETS[0]!.theme,
  preset: null,
  logo_url: null,
  cover_url: null,
};

export const THEME_PRESET_IDS = THEME_PRESETS.map((preset) => preset.id);

export function getThemePreset(id: ThemePresetId | null | undefined): ThemePreset | null {
  if (!id) return null;
  return THEME_PRESETS.find((preset) => preset.id === id) ?? null;
}

export const CARD_STYLES: { id: CardStyle; label: string; hint: string }[] = [
  { id: "rounded", label: "Arredondado", hint: "Cantos generosos, cara de app" },
  { id: "soft", label: "Suave", hint: "Cantos discretos e sombra leve" },
  { id: "flat", label: "Plano", hint: "Sem sombra, separado por linha" },
];

export const BUTTON_STYLES: { id: ButtonStyle; label: string; hint: string }[] = [
  { id: "solid", label: "Sólido", hint: "Preenchido com a cor dos botões" },
  { id: "outline", label: "Contorno", hint: "Fundo claro e borda colorida" },
  { id: "pill", label: "Pílula", hint: "Bem arredondado, destaque máximo" },
];

/* -------------------------------------------------------------------------- */
/* Normalização — o banco é a única fonte de verdade                          */
/* -------------------------------------------------------------------------- */

const HEX_KEYS = [
  "primary_color",
  "secondary_color",
  "background_color",
  "text_color",
  "button_color",
] as const;

const cardStyleSet = new Set(CARD_STYLES.map((style) => style.id));
const buttonStyleSet = new Set(BUTTON_STYLES.map((style) => style.id));
const presetSet = new Set<string>(THEME_PRESET_IDS);

/**
 * Transforma qualquer coisa parecida com tema em tema válido.
 *
 * Três garantias:
 *   1. campo ausente ou cor inválida usa o valor do tema padrão;
 *   2. `card_style` / `button_style` fora da lista caem no padrão;
 *   3. URLs só sobrevivem se forem https de verdade (upload nosso) — nada de
 *      `javascript:` vindo de um campo de texto.
 *
 * Recebe `unknown` de propósito: as linhas vêm do PostgREST sem tipagem.
 */
export function normalizeTheme(input: unknown): RestaurantTheme {
  const raw = (input ?? {}) as Record<string, unknown>;

  const theme: RestaurantTheme = { ...DEFAULT_THEME };

  for (const key of HEX_KEYS) {
    const value = typeof raw[key] === "string" ? normalizeHex(raw[key] as string) : null;
    if (value) theme[key] = value;
  }

  const cardStyle = typeof raw.card_style === "string" ? raw.card_style : null;
  if (cardStyle && cardStyleSet.has(cardStyle as CardStyle)) {
    theme.card_style = cardStyle as CardStyle;
  }

  const buttonStyle = typeof raw.button_style === "string" ? raw.button_style : null;
  if (buttonStyle && buttonStyleSet.has(buttonStyle as ButtonStyle)) {
    theme.button_style = buttonStyle as ButtonStyle;
  }

  const preset = typeof raw.preset === "string" ? raw.preset : null;
  theme.preset = preset && presetSet.has(preset) ? (preset as ThemePresetId) : null;

  theme.logo_url = safeImageUrl(raw.logo_url);
  theme.cover_url = safeImageUrl(raw.cover_url);

  return theme;
}

/**
 * Aceita apenas URLs http(s). O upload sempre gera uma URL do nosso storage;
 * isto é a barreira para o caso de o campo chegar de outro lugar.
 */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** O restaurante já personalizou alguma coisa? */
export function hasCustomTheme(theme: RestaurantTheme | null | undefined): boolean {
  if (!theme) return false;
  return Boolean(theme.preset || theme.logo_url || theme.cover_url);
}

/* -------------------------------------------------------------------------- */
/* Tokens → CSS                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Deriva as variáveis CSS do tema.
 *
 * Separado de `themeToCssVars` porque o preview do painel precisa dos mesmos
 * valores em JS (para pintar sem <style> global) e os testes precisam comparar
 * números, não strings.
 */
export function themeTokens(theme: RestaurantTheme): ThemeTokens {
  const background = theme.background_color;
  const isDark = relativeLuminance(background) < 0.45;

  // Superfícies: no tema claro o card é branco "puro" sobre fundo colorido; no
  // escuro ele sobe um degrau de luminância para destacar do fundo.
  const surface = isDark ? mix(background, WHITE, 0.07) : mix(background, WHITE, 0.85);
  const surfaceMuted = isDark ? mix(background, WHITE, 0.03) : mix(background, "#000000", 0.035);

  // Texto escolhido pelo usuário pode não contrastar com o próprio fundo dele.
  // Ajustamos — e o texto secundário sai dessa mesma cor, mais apagado.
  const text = ensureContrast(theme.text_color, background, 4.5);
  const textMuted = ensureContrast(mix(text, background, 0.34), background, 3);

  const button = theme.button_color;
  const buttonText = readableOn(button);
  const buttonTextMuted = mix(button, buttonText, 0.22);

  // "onPrimary": texto sobre a cor principal (cabeçalho, destaques).
  const onPrimary = readableOn(theme.primary_color);
  const primarySoft = mix(theme.primary_color, background, isDark ? 0.78 : 0.9);

  return {
    primary: theme.primary_color,
    secondary: theme.secondary_color,
    background,
    surface,
    surfaceMuted,
    text,
    textMuted,
    border: borderFor(surface, text),
    button,
    buttonText,
    buttonTextMuted,
    onPrimary,
    primarySoft,
    isDark,
    cardStyle: theme.card_style,
    buttonStyle: theme.button_style,
  };
}

/** Raio dos cards, por estilo. */
export function cardRadius(style: CardStyle): string {
  if (style === "flat") return "0.5rem";
  if (style === "soft") return "0.875rem";
  return "1.25rem";
}

/** Raio dos botões, por estilo. */
export function buttonRadius(style: ButtonStyle): string {
  if (style === "pill") return "999px";
  if (style === "outline") return "0.75rem";
  return "0.75rem";
}

/** Sombra dos cards, por estilo (plano não tem sombra). */
export function cardShadow(style: CardStyle): string {
  if (style === "flat") return "none";
  if (style === "soft") return "0 1px 2px rgba(16,24,40,0.05), 0 6px 16px -12px rgba(16,24,40,0.16)";
  return "0 1px 2px rgba(16,24,40,0.04), 0 8px 24px -14px rgba(16,24,40,0.18)";
}

/**
 * Tema → objeto de CSS custom properties.
 *
 * Prefixo `--mv-`: nada aqui colide com os tokens de marca do painel (`brand-*`,
 * `ink-*`), então uma página pública tematizada não vaza estilo para o resto
 * do app — e vice-versa.
 */
export function themeToCssVars(theme: RestaurantTheme): Record<string, string> {
  const tokens = themeTokens(theme);

  return {
    "--mv-primary": tokens.primary,
    "--mv-secondary": tokens.secondary,
    "--mv-bg": tokens.background,
    "--mv-surface": tokens.surface,
    "--mv-surface-muted": tokens.surfaceMuted,
    "--mv-text": tokens.text,
    "--mv-text-muted": tokens.textMuted,
    "--mv-border": tokens.border,
    "--mv-button": tokens.button,
    "--mv-button-text": tokens.buttonText,
    "--mv-button-text-muted": tokens.buttonTextMuted,
    "--mv-on-primary": tokens.onPrimary,
    "--mv-primary-soft": tokens.primarySoft,
    "--mv-card-radius": cardRadius(theme.card_style),
    "--mv-button-radius": buttonRadius(theme.button_style),
    "--mv-card-shadow": cardShadow(theme.card_style),
    "--mv-card-border": theme.card_style === "flat" ? tokens.border : "transparent",
  };
}

/** `style` pronto para o JSX (aceita CSS custom properties). */
export function themeStyle(theme: RestaurantTheme): React.CSSProperties {
  return themeToCssVars(theme) as unknown as React.CSSProperties;
}

/**
 * CSS em texto — só para o `generateMetadata`/`themeColor` e para quem precisa
 * de uma string. A página usa `themeStyle`, que não exige parser de CSS.
 */
export function themeToCssText(theme: RestaurantTheme, selector = ":root"): string {
  const vars = themeToCssVars(theme);
  const body = Object.entries(vars)
    .map(([key, value]) => `${key}:${value};`)
    .join("");
  return `${selector}{${body}}`;
}
