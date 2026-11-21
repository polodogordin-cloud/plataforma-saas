import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";

/**
 * Card de métrica do dashboard master.
 *
 * Igual em espírito ao `StatCard` do painel do restaurante — número grande,
 * rótulo embaixo, alvo de toque de 44px — mas com uma diferença: aceita `href`
 * para o filtro correspondente. "3 suspensos" não é um número decorativo, é um
 * atalho para a lista já filtrada.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  href,
  hint,
  tone = "neutral",
  format = "plain",
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  href?: string;
  hint?: string;
  tone?: "neutral" | "brand" | "amber" | "danger" | "sky";
  /**
   * `currency` formata em reais (Etapa 11: receita mensal). O valor chega como
   * número do banco — a decisão de exibir "R$ 199,80" fica na apresentação,
   * não no RPC.
   */
  format?: "plain" | "currency";
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-600",
    brand: "bg-brand-50 text-brand-700",
    amber: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
    sky: "bg-sky-50 text-sky-700",
  }[tone];

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid size-8 place-items-center rounded-lg", tones)}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {href && (
          <ChevronRight className="mt-1 size-4 shrink-0 text-ink-300" aria-hidden="true" />
        )}
      </div>
      <p className="mt-2.5 text-[1.55rem] leading-none font-semibold tabular-nums tracking-tight text-ink-900">
        {format === "currency" && typeof value === "number" ? formatPrice(value) : value}
      </p>
      <p className="mt-1.5 text-[0.78rem] font-medium leading-tight text-ink-500">{label}</p>
      {hint && <p className="mt-0.5 text-[0.68rem] leading-tight text-ink-400">{hint}</p>}
    </>
  );

  const base =
    "flex flex-col rounded-xl border border-ink-200/70 bg-white p-3 shadow-[var(--shadow-soft)]";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(base, "transition-all duration-200 active:scale-[0.985] hover:shadow-[var(--shadow-lift)]")}
      >
        {content}
      </Link>
    );
  }

  return <div className={base}>{content}</div>;
}
