"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeGrowth, formatMoney } from "@/lib/analytics";

/**
 * Card de métrica com indicação de crescimento.
 *
 * Separado do `StatCard` (etapa 1) e do `MetricCard` (etapa 10) de propósito:
 * os dois mostram um número e pronto. Aqui o número precisa de contexto —
 * "R$ 1.2 mil" sem "↓ 8% vs. período anterior" não diz se a casa está indo bem.
 * Reaproveitar os existentes significaria empurrar quatro props opcionais em
 * componentes usados em seis telas; um card novo é menor que o risco.
 */

export function AnalyticsMetric({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  growth,
  rawValue,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "brand" | "amber" | "sky" | "danger";
  /** Já calculado com `computeGrowth`; ausente quando não há comparação. */
  growth?: { current: number; previous: number; hasPreviousData: boolean };
  /** Valor completo para o `title` quando `value` é abreviado. */
  rawValue?: string;
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-600",
    brand: "bg-brand-50 text-brand-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
    danger: "bg-red-50 text-red-700",
  }[tone];

  const computed = growth
    ? computeGrowth(growth.current, growth.previous, growth.hasPreviousData)
    : null;

  return (
    <div className="flex flex-col rounded-xl border border-ink-200/70 bg-white p-3 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-1.5">
        {Icon && (
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", tones)}>
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 truncate text-[0.7rem] font-semibold leading-tight text-ink-500">
          {label}
        </span>
      </div>

      <p
        className="mt-2 text-[1.35rem] leading-none font-semibold tabular-nums tracking-tight text-ink-900"
        title={rawValue}
      >
        {value}
      </p>

      {computed && (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1 text-[0.68rem] font-semibold",
            computed.direction === "up" && "text-brand-700",
            computed.direction === "down" && "text-red-600",
            computed.direction === "flat" && "text-ink-400",
          )}
        >
          {computed.direction === "up" && <ArrowUpRight className="size-3" aria-hidden="true" />}
          {computed.direction === "down" && <ArrowDownRight className="size-3" aria-hidden="true" />}
          {computed.direction === "flat" && <Minus className="size-3" aria-hidden="true" />}
          <span>{computed.label}</span>
          <span className="font-normal text-ink-400">vs. anterior</span>
        </p>
      )}

      {hint && <p className="mt-1 text-[0.68rem] leading-tight text-ink-400">{hint}</p>}
    </div>
  );
}

/**
 * Botão "Atualizar dados".
 *
 * `router.refresh()` refaz a renderização do servidor mantendo o período da
 * URL — o dono que está olhando "mês passado" atualiza e continua no mês
 * passado. Sem `revalidatePath` e sem recarregar a página inteira.
 *
 * O giro do ícone e o `aria-live` existem porque a tela usa ISR/cache do
 * servidor: a resposta pode levar alguns décimos, e sem retorno visual a pessoa
 * toca três vezes.
 */
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      aria-label="Atualizar dados"
      className={cn(
        "tap-target inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 text-[0.78rem] font-semibold text-ink-600 transition hover:border-ink-300 active:bg-ink-50 disabled:opacity-60",
        className,
      )}
    >
      <RefreshCw
        className={cn("size-3.5", pending && "animate-spin")}
        aria-hidden="true"
      />
      <span>{pending ? "Atualizando" : "Atualizar"}</span>
      <span className="sr-only" aria-live="polite">
        {pending ? "Carregando dados" : ""}
      </span>
    </button>
  );
}

/** Linha de detalhe: rótulo à esquerda, valor tabular à direita. */
export function MetricRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "brand" | "danger" | "warning";
}) {
  const colors = {
    neutral: "text-ink-900",
    brand: "text-brand-700",
    danger: "text-red-600",
    warning: "text-amber-700",
  }[tone];

  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 text-[0.82rem] text-ink-600">{label}</span>
      <span className={cn("shrink-0 text-[0.85rem] font-semibold tabular-nums", colors)}>
        {value}
      </span>
    </div>
  );
}

/** Mostra o valor completo quando o card uso a forma compacta. */
export function compactHint(value: number): string {
  return formatMoney(value);
}
