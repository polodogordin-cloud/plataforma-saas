import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatUsage,
  isLimitReached,
  isLimitWarning,
  usagePercent,
  usageRatio,
} from "@/lib/plan-rules";
import type { UsageCounter } from "@/lib/types";

/**
 * Barra de uso vs. limite — Etapa 11.
 *
 * A conta vem pronta do banco (`restaurant_usage`), que usa exatamente a mesma
 * aritmética do trigger. Aqui só desenhamos: se esta barra dissesse "12 de 50"
 * e o banco contasse 51, o dono perderia a confiança na tela inteira.
 */

export function UsageMeter({
  label,
  counter,
  hint,
}: {
  label: string;
  counter: UsageCounter;
  hint?: string;
}) {
  const reached = isLimitReached(counter);
  const warning = isLimitWarning(counter);
  const percent = usagePercent(counter);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span
          className={cn(
            "text-sm tabular-nums",
            reached ? "font-semibold text-red-600" : warning ? "font-semibold text-amber-700" : "text-ink-500",
          )}
        >
          {formatUsage(counter)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${label}: ${formatUsage(counter)}`}
        className="h-2 overflow-hidden rounded-full bg-ink-100"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            reached ? "bg-red-500" : warning ? "bg-amber-500" : "bg-brand-500",
          )}
          style={{ width: `${counter.limit === null ? 0 : Math.max(percent, 4)}%` }}
        />
      </div>

      {hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * Aviso de limite atingido, com o caminho de saída.
 *
 * O escopo pede a mensagem **e** o botão "Ver planos": um bloqueio sem saída
 * transforma limite de plano em bug na cabeça de quem usa.
 */
/** Miolo do aviso, reaproveitado dentro de sheets onde um <a> aninhado seria inválido. */
export function LimitNoticeBody({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-900",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <p className="text-sm font-medium leading-relaxed">{message}</p>
    </div>
  );
}

export function LimitReachedNotice({
  message,
  href = "/planos",
  actionLabel = "Ver planos",
  className,
}: {
  message: string;
  href?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium leading-relaxed">{message}</p>
      </div>

      <Link
        href={href}
        className="tap-target inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-amber-900 px-4 text-sm font-semibold text-white"
      >
        {actionLabel}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** Uso resumido para o dashboard, quando o espaço é curto. */
export function UsageSummary({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const percent = usagePercent({ used, limit });
  return (
    <span className="text-xs text-ink-500">
      {label}: {limit === null ? `${used}` : `${used}/${limit}`}
      {limit !== null && percent >= 100 && <span className="ml-1 font-semibold text-red-600">limite</span>}
    </span>
  );
}

export { usageRatio };
