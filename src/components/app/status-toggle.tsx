"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { setRestaurantStatus } from "@/actions/restaurant";
import { Badge } from "@/components/ui/card";
import { RESTAURANT_STATUS_LABEL, type RestaurantStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const tone: Record<RestaurantStatus, "success" | "warning" | "muted" | "danger"> = {
  published: "success",
  draft: "warning",
  paused: "muted",
  closed: "muted",
  suspended: "danger",
};

/**
 * Liga/desliga a visibilidade do cardápio.
 * Nesta etapa altera apenas o status — a publicação pública chega na Etapa 3.
 */
export function StatusToggle({ status }: { status: RestaurantStatus }) {
  const [pending, startTransition] = useTransition();
  const isPublished = status === "published";
  // Suspenso: a decisão não é do restaurante. O banco recusaria a escrita
  // (trigger `guard_restaurant_admin_fields`), então nem oferecemos o botão —
  // um controle que sempre falha é pior do que nenhum controle.
  const isSuspended = status === "suspended";

  const toggle = () => {
    startTransition(async () => {
      await setRestaurantStatus(isPublished ? "paused" : "published");
    });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="relative flex size-2.5" aria-hidden="true">
          {isPublished && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-75" />
          )}
          <span
            className={cn(
              "relative inline-flex size-2.5 rounded-full",
              isPublished ? "bg-brand-500" : status === "paused" ? "bg-ink-300" : "bg-amber-400",
            )}
          />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-900">
            {RESTAURANT_STATUS_LABEL[status]}
          </p>
          <p className="text-xs text-ink-500">
            {isSuspended
              ? "Fale com o suporte para reativar"
              : isPublished
                ? "Visível para seus clientes"
                : "Ainda não visível ao público"}
          </p>
        </div>
      </div>

      {isSuspended ? (
        <Badge tone="danger">Suspenso</Badge>
      ) : (

      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={isPublished}
        aria-label={isPublished ? "Pausar cardápio" : "Ativar cardápio"}
        className={cn(
          // Área de toque de 44px; a pílula visual tem 32px e fica centrada.
          "tap-target -mr-1.5 grid h-11 w-16 shrink-0 place-items-center rounded-full",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          pending && "opacity-70",
        )}
      >
        <span
          className={cn(
            "relative flex h-8 w-14 items-center rounded-full transition-colors duration-300",
            isPublished ? "bg-brand-600" : "bg-ink-300",
          )}
        >
          <span
            className={cn(
              "ml-1 inline-flex size-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-300 ease-[var(--ease-out-soft)]",
              isPublished && "translate-x-6",
            )}
          >
            {pending && (
              <Loader2 className="size-3.5 animate-spin text-ink-400" aria-hidden="true" />
            )}
          </span>
        </span>
      </button>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: RestaurantStatus }) {
  return <Badge tone={tone[status]}>{RESTAURANT_STATUS_LABEL[status]}</Badge>;
}
