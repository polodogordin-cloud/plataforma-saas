import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={cn("card p-4 sm:p-5", className)}>{children}</Tag>;
}

export function SectionTitle({
  title,
  action,
  description,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[1.05rem] font-semibold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Selo de status colorido e legível. */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "info" | "muted" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-700 ring-ink-200",
    success: "bg-brand-50 text-brand-700 ring-brand-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    muted: "bg-ink-50 text-ink-500 ring-ink-200",
    // Vermelho de bloqueio: usado para suspensão, onde nada está "quase certo".
    danger: "bg-red-50 text-red-700 ring-red-200",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}
