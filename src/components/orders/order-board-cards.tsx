import Link from "next/link";
import { ArrowRight, BellRing, ChefHat, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Resumo de pedidos na home — Etapa 8 do escopo da Etapa 7: os três números que
 * a casa olha primeiro, cada um tocável para abrir a lista já filtrada.
 *
 * Os links levam a `/app/pedidos?tab=…`; o painel lê a aba da URL, então o
 * toque no dashboard cai direto no recorte certo em vez de "Pedidos: aba
 * padrão, procure você mesmo".
 */
export function OrderBoardCards({
  counts,
}: {
  counts: { pending: number; preparing: number; ready: number };
}) {
  const cards = [
    {
      id: "new" as const,
      label: "Novos",
      value: counts.pending,
      icon: BellRing,
      /** Alerta só quando existe algo de fato esperando. */
      urgent: counts.pending > 0,
      tone: "bg-red-50 text-red-700",
      ring: "border-red-200",
    },
    {
      id: "preparing" as const,
      label: "Em preparo",
      value: counts.preparing,
      icon: ChefHat,
      urgent: false,
      tone: "bg-amber-50 text-amber-800",
      ring: "border-ink-200/70",
    },
    {
      id: "ready" as const,
      label: "Prontos",
      value: counts.ready,
      icon: CheckCheck,
      urgent: false,
      tone: "bg-brand-50 text-brand-700",
      ring: "border-ink-200/70",
    },
  ];

  return (
    <section aria-labelledby="pedidos-resumo">
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 id="pedidos-resumo" className="text-[1.05rem] font-semibold text-ink-900">
          Pedidos
        </h2>
        <Link
          href="/app/pedidos"
          className="tap-target -my-1 inline-flex items-center gap-1 py-1 text-sm font-semibold text-brand-700"
        >
          Ver painel
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.id}
              href={`/app/pedidos?tab=${card.id}`}
              aria-label={`${card.label}: ${card.value} pedidos. Abrir lista.`}
              className={cn(
                "flex min-h-[5.75rem] flex-col rounded-2xl border bg-white p-2.5 shadow-[var(--shadow-soft)] transition-transform",
                "active:scale-[0.98]",
                card.urgent ? card.ring : "border-ink-200/70",
                card.urgent && "ring-1 ring-red-100",
              )}
            >
              <span className={cn("grid size-8 place-items-center rounded-lg", card.tone)}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="mt-2 text-2xl leading-none font-bold tabular-nums tracking-tight text-ink-900">
                {card.value}
              </span>
              <span className="mt-1 text-[0.7rem] leading-tight font-medium text-ink-500">
                {card.label}
              </span>
              {card.urgent && (
                <span className="mt-1 text-[0.65rem] font-semibold leading-tight text-red-700">
                  aguardando
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
