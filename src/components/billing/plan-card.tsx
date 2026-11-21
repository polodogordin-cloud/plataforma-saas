import Link from "next/link";
import { Check, Minus } from "lucide-react";
import {
  BILLING_INTERVAL_LABEL,
  SUBSCRIPTION_STATE_LABEL,
  SUBSCRIPTION_STATE_TONE,
  type BillingInterval,
  type PlanCatalogEntry,
  type SubscriptionState,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";
import { featureLabels } from "@/lib/plan-rules";

/**
 * Peças visuais de plano — Etapa 11.
 *
 * Todas server-safe (sem "use client"): a vitrine `/planos` é pública e deve
 * sair pronta do servidor; a tela "Meu plano" mistura estas peças com os
 * botões client. Nada aqui decide autorização — só descreve o plano.
 */

const TONE_CLASS: Record<string, string> = {
  success: "bg-brand-50 text-brand-700 ring-brand-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
};

export function SubscriptionBadge({
  status,
  className,
}: {
  status: SubscriptionState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        TONE_CLASS[SUBSCRIPTION_STATE_TONE[status]],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {SUBSCRIPTION_STATE_LABEL[status]}
    </span>
  );
}

/** Lista de recursos com ✓ — o "checklist" que o escopo pede no card. */
export function FeatureList({
  features,
  limit,
  className,
}: {
  features: string[];
  limit?: number;
  className?: string;
}) {
  const labels = featureLabels(features);
  const visible = typeof limit === "number" ? labels.slice(0, limit) : labels;
  const rest = labels.length - visible.length;

  return (
    <ul className={cn("space-y-1.5 text-sm text-ink-700", className)}>
      {visible.map((label) => (
        <li key={label} className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span>{label}</span>
        </li>
      ))}
      {rest > 0 && (
        <li className="flex items-start gap-2 text-ink-500">
          <Minus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>e mais {rest}</span>
        </li>
      )}
    </ul>
  );
}

export function PlanPrice({
  price,
  interval,
  size = "md",
}: {
  price: number;
  interval: BillingInterval;
  size?: "sm" | "md" | "lg";
}) {
  if (price <= 0) {
    return <span className="text-2xl font-bold tracking-tight text-ink-900">Grátis</span>;
  }

  return (
    <span className="flex flex-wrap items-baseline gap-1">
      <span
        className={cn(
          "font-bold tracking-tight text-ink-900",
          size === "lg" ? "text-[2rem]" : size === "sm" ? "text-xl" : "text-2xl",
        )}
      >
        {formatPrice(price)}
      </span>
      <span className="text-sm text-ink-500">{BILLING_INTERVAL_LABEL[interval]}</span>
    </span>
  );
}

/**
 * Card de plano da vitrine.
 *
 * Vertical em qualquer largura: o escopo proíbe tabela de comparação, e no
 * celular um card por linha é o que se lê sem zoom.
 */
export function PlanCard({
  plan,
  highlighted,
  featuredLabel,
  cta,
  footer,
}: {
  plan: PlanCatalogEntry;
  highlighted?: boolean;
  featuredLabel?: string;
  cta: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "card flex flex-col gap-4 p-5",
        highlighted && "ring-2 ring-brand-500 ring-offset-2 ring-offset-ink-50",
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-ink-900">{plan.name}</h3>
          {highlighted && featuredLabel && (
            <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wide text-white">
              {featuredLabel}
            </span>
          )}
        </div>
        {plan.description && <p className="text-sm text-ink-500">{plan.description}</p>}
      </div>

      <PlanPrice price={plan.price} interval={plan.interval} />

      <FeatureList features={plan.features} />

      <div className="mt-auto space-y-2 pt-2">{cta}</div>
      {footer}
    </li>
  );
}

/** Link discreto usado em "Ver planos" / "Comparar planos". */
export function SeePlansLink({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Link
      href="/planos"
      className={cn("inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700", className)}
    >
      {children ?? "Ver planos"}
    </Link>
  );
}
