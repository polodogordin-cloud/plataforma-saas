"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reviewSubscriptions } from "@/actions/billing";

/**
 * Botão "revisar assinaturas" — Etapa 11.
 *
 * Mesma rotina que um cron executará diariamente: expira trials vencidos e
 * marca períodos atrasados depois da tolerância. Ter o botão agora permite
 * conferir a regra sem esperar o cron existir.
 */
export function ReviewSubscriptionsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reviewSubscriptions();
            setMessage(result.ok ? result.message : result.error);
            if (result.ok) router.refresh();
          })
        }
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Revisar
      </Button>
      {message && (
        <p role="status" className="max-w-40 text-right text-[0.7rem] leading-tight text-ink-500">
          {message}
        </p>
      )}
    </div>
  );
}
