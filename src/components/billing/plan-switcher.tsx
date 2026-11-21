"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { changeMyPlan, startMyTrial } from "@/actions/billing";
import { PLAN_FEATURE_LABEL, isPlanFeatureKey, type PlanCatalogEntry } from "@/lib/types";
import { formatPrice } from "@/lib/validation";
import { comparePlans, limitOf } from "@/lib/plan-rules";
import { cn } from "@/lib/utils";

/**
 * Controles da tela "Meu plano" — Etapa 11.
 *
 * O botão "Trocar plano" abre um sheet com os planos disponíveis. Antes de
 * confirmar, a tela mostra **o que se ganha e o que se perde** (recursos e
 * limites), porque um downgrade que estoura o uso atual é recusado pelo banco
 * (`plan_downgrade_too_small`) e é melhor explicar antes do erro.
 *
 * Nada aqui é autorização: as Server Actions revalidam o vínculo e o banco
 * revalida limites. `canManage` só decide se os botões aparecem.
 */

export function PlanSwitcher({
  currentPlanId,
  plans,
  canManage,
  blockedPlans,
}: {
  currentPlanId: string;
  plans: PlanCatalogEntry[];
  canManage: boolean;
  /** Plano → motivo pelo qual não pode ser escolhido agora (opcional). */
  blockedPlans: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = plans.find((plan) => plan.id === currentPlanId);

  const choose = (plan: PlanCatalogEntry) => {
    if (blockedPlans[plan.id]) return;
    setPendingId(plan.id);
    setFeedback(null);

    startTransition(async () => {
      const result = await changeMyPlan({ planId: plan.id, interval: plan.interval });
      setPendingId(null);
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        size="lg"
        block
        onClick={() => setOpen(true)}
        disabled={!canManage}
      >
        {canManage ? "Gerenciar plano" : "Somente o proprietário altera o plano"}
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>

      {!canManage && (
        <p className="text-xs text-ink-500">
          Seu perfil pode consultar o plano, mas a troca é feita pelo proprietário da casa.
        </p>
      )}

      {feedback && (
        <p
          role="status"
          className={cn(
            "rounded-xl px-3 py-2 text-sm",
            feedback.ok ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700",
          )}
        >
          {feedback.text}
        </p>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Trocar de plano"
        description="A cobrança automática entra em uma próxima etapa. Por enquanto a troca é registrada e vale na hora."
        size="tall"
      >
        <ul className="space-y-3">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const blocked = blockedPlans[plan.id];
            const diff = current ? comparePlans(current, plan) : null;

            return (
              <li
                key={plan.id}
                className={cn(
                  "rounded-[var(--radius-card)] border p-4",
                  isCurrent ? "border-brand-300 bg-brand-50/50" : "border-ink-200 bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink-900">{plan.name}</p>
                    <p className="text-sm text-ink-500">
                      {plan.price <= 0 ? "Grátis" : `${formatPrice(plan.price)} por mês`}
                    </p>
                  </div>
                  {isCurrent && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-white">
                      Atual
                    </span>
                  )}
                </div>

                {diff && !isCurrent && (
                  <div className="mt-3 space-y-1 text-xs text-ink-600">
                    {diff.gained.length > 0 && (
                      <p className="text-brand-700">
                        Ganha: {diff.gained.map((f) => (isPlanFeatureKey(f) ? PLAN_FEATURE_LABEL[f] : f)).join(", ")}
                      </p>
                    )}
                    {diff.lost.length > 0 && (
                      <p className="text-amber-700">
                        Perde: {diff.lost.map((f) => (isPlanFeatureKey(f) ? PLAN_FEATURE_LABEL[f] : f)).join(", ")}
                      </p>
                    )}
                    <p>
                      Mesas:{" "}
                      {limitOf(plan.limits, "max_tables") ?? "sem limite"} · Produtos:{" "}
                      {limitOf(plan.limits, "max_products") ?? "sem limite"}
                    </p>
                  </div>
                )}

                {blocked && <p className="mt-2 text-xs font-medium text-red-600">{blocked}</p>}

                <Button
                  className="mt-3"
                  block
                  size="sm"
                  variant={isCurrent ? "ghost" : "primary"}
                  disabled={isCurrent || Boolean(blocked) || pending}
                  onClick={() => choose(plan)}
                >
                  {pending && pendingId === plan.id ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Alterando…
                    </>
                  ) : isCurrent ? (
                    "Plano atual"
                  ) : (
                    "Escolher este plano"
                  )}
                </Button>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-center text-xs text-ink-500">
          <Link href="/planos" className="font-semibold text-brand-700">
            Ver comparação completa
          </Link>
        </p>
      </Sheet>
    </div>
  );
}

/** Botão de iniciar teste quando a casa nunca assinou. */
export function StartTrialButton({ days }: { days: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        size="lg"
        block
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startMyTrial();
            setFeedback(result.ok ? result.message : result.error);
            if (result.ok) router.refresh();
          })
        }
      >
        Começar teste de {days} {days === 1 ? "dia" : "dias"}
      </Button>
      {feedback && (
        <p role="status" className="text-center text-sm text-ink-600">
          {feedback}
        </p>
      )}
    </div>
  );
}
