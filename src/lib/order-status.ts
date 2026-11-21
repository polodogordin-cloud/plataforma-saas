import {
  BellRing,
  Check,
  CheckCheck,
  CircleSlash,
  ChefHat,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus } from "@/lib/types";

/**
 * Identidade visual dos status — módulo neutro (serve painel e home).
 *
 * Regra de acessibilidade: **cor nunca sozinha**. Todo status tem ícone e
 * texto, e o texto é quem carrega o significado. Quem não distingue vermelho de
 * verde lê "Novo pedido" e vê o sino; a cor é reforço para quem enxerga.
 *
 * Os tons seguem a paleta do app (não inventamos hex): vermelho/âmbar/verde
 * saem das famílias já usadas, sempre com contraste de texto alto no fundo
 * claro e fundo escuro o suficiente quando o tom é sólido.
 */
export type StatusTone = {
  /** Ícone do status. */
  icon: LucideIcon;
  /** Rótulo do card, em caixa alta como no painel. */
  label: string;
  /** Texto de apoio ("Aguardando confirmação"). */
  hint: string;
  /** Classes do selo (fundo claro + texto escuro). */
  badge: string;
  /** Cor do ponto/realce sólido. */
  dot: string;
  /** Borda do card quando o status pede atenção. */
  ring: string;
};

export const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  pending: {
    icon: BellRing,
    label: "Novo pedido",
    hint: "Aguardando confirmação",
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
    ring: "ring-red-200",
  },
  confirmed: {
    icon: Check,
    label: "Confirmado",
    hint: "Aceito pela casa",
    badge: "bg-sky-50 text-sky-700 ring-sky-200",
    dot: "bg-sky-500",
    ring: "ring-sky-200",
  },
  preparing: {
    icon: ChefHat,
    label: "Em preparo",
    hint: "Na cozinha agora",
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
    ring: "ring-amber-200",
  },
  ready: {
    icon: CheckCheck,
    label: "Pronto",
    hint: "Esperando o garçom",
    badge: "bg-brand-50 text-brand-700 ring-brand-200",
    dot: "bg-brand-500",
    ring: "ring-brand-200",
  },
  delivered: {
    icon: CheckCheck,
    label: "Entregue",
    hint: "Concluído",
    badge: "bg-ink-100 text-ink-600 ring-ink-200",
    dot: "bg-ink-400",
    ring: "ring-ink-200",
  },
  cancelled: {
    icon: CircleSlash,
    label: "Cancelado",
    hint: "Fora do fluxo",
    badge: "bg-ink-100 text-ink-500 ring-ink-200 line-through decoration-ink-300",
    dot: "bg-ink-300",
    ring: "ring-ink-200",
  },
};
