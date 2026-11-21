import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash } from "lucide-react";
import { NFC_STATUS_LABEL, type NfcStatus, type TableNfcTag } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Selo de estado da TAG.
 *
 * Quatro estados do banco + uma combinação que importa na prática: a TAG está
 * "configurada", mas a URL mudou depois da gravação. Mostrar só "Configurado"
 * ali seria mentira útil — o cliente encosta o celular e cai em página de erro.
 */

type Tone = "neutral" | "brand" | "amber" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-600",
  brand: "bg-brand-50 text-brand-800",
  amber: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
};

export function resolveNfcDisplay(tag: TableNfcTag | null): {
  label: string;
  tone: Tone;
  icon: typeof CheckCircle2;
} {
  if (!tag) {
    return { label: "Não configurado", tone: "neutral", icon: CircleDashed };
  }
  if (tag.needs_rerecord) {
    return { label: "Precisa regravar", tone: "amber", icon: AlertTriangle };
  }
  if (!tag.is_active || tag.status === "disabled") {
    return { label: "Desativado", tone: "danger", icon: CircleSlash };
  }
  switch (tag.status) {
    case "tested":
      return { label: "Testado", tone: "brand", icon: CheckCircle2 };
    case "configured":
      return { label: "Configurado", tone: "brand", icon: CheckCircle2 };
    default:
      return { label: NFC_STATUS_LABEL.not_configured, tone: "neutral", icon: CircleDashed };
  }
}

export function NfcStatusBadge({
  tag,
  className,
  showDot = true,
}: {
  tag: TableNfcTag | null;
  className?: string;
  showDot?: boolean;
}) {
  const display = resolveNfcDisplay(tag);
  const Icon = display.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.7rem] font-semibold",
        TONE_CLASS[display.tone],
        className,
      )}
    >
      {showDot ? (
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            display.tone === "brand" && "bg-brand-500",
            display.tone === "amber" && "bg-amber-500",
            display.tone === "danger" && "bg-red-500",
            display.tone === "neutral" && "bg-ink-400",
          )}
          aria-hidden="true"
        />
      )}
      {display.label}
    </span>
  );
}

/** Mapa de cores por status para os chips de escolha. */
export const NFC_STATUS_CHIP: Record<NfcStatus, string> = {
  not_configured: "border-ink-200 bg-white text-ink-600",
  configured: "border-brand-600 bg-brand-50 text-brand-800",
  tested: "border-brand-600 bg-brand-600 text-white",
  disabled: "border-red-200 bg-red-50 text-red-700",
};
