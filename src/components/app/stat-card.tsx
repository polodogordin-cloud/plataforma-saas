import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Card de resumo com número grande — leitura rápida no celular. */
export function StatCard({
  label,
  value,
  icon: Icon,
  href,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  href?: string;
  tone?: "brand" | "neutral" | "amber" | "sky";
  hint?: string;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-700",
    neutral: "bg-ink-100 text-ink-600",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
  }[tone];

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid size-9 place-items-center rounded-lg", tones)}>
          <Icon className="size-[1.15rem]" aria-hidden="true" />
        </span>
        {href && (
          <ChevronRight
            className="mt-1 size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        )}
      </div>
      <p className="mt-3 text-[1.65rem] leading-none font-semibold tabular-nums tracking-tight text-ink-900">
        {value}
      </p>
      <p className="mt-1.5 text-[0.8rem] font-medium leading-tight text-ink-500">{label}</p>
      {hint && <p className="mt-1 text-[0.7rem] leading-tight text-ink-400">{hint}</p>}
    </>
  );

  const base =
    "group relative flex flex-col rounded-[var(--radius-card)] border border-ink-200/70 bg-white p-3.5 shadow-[var(--shadow-soft)] transition-all duration-200 ease-[var(--ease-out-soft)]";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(base, "hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] active:scale-[0.985]")}
      >
        {content}
      </Link>
    );
  }

  return <div className={base}>{content}</div>;
}
