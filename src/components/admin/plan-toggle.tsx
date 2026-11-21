"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { togglePlan } from "@/actions/billing";
import { Button } from "@/components/ui/button";

/**
 * Liga/desliga o plano na vitrine — Etapa 11.
 *
 * Desativar **não** derruba quem já assina: o plano continua no espelho
 * `restaurants.plan_id` e os limites seguem valendo. Só some de `/planos`.
 */
export function PlanToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={active ? "ghost" : "primary"}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await togglePlan(id, !active);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setError(null);
            router.refresh();
          })
        }
      >
        {active ? "Desativar" : "Ativar"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
