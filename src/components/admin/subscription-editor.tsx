"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { setSubscription } from "@/actions/billing";
import {
  BILLING_INTERVAL_LABEL,
  SUBSCRIPTION_STATE_LABEL,
  type BillingInterval,
  type SubscriptionState,
} from "@/lib/types";

/**
 * Ajuste manual de assinatura pelo painel master — Etapa 11.
 *
 * É o substituto honesto do checkout: enquanto não há gateway, a plataforma
 * define plano, status e período, e o banco registra em `admin_audit_log`
 * (`subscription.updated`). Quando o gateway entrar, este sheet continua
 * existindo para suporte — cobrança automática não elimina a necessidade de
 * um ajuste manual auditado.
 */
export function SubscriptionEditor({
  restaurantId,
  restaurantName,
  plans,
  currentPlanId,
  currentStatus,
  currentInterval,
}: {
  restaurantId: string;
  restaurantName: string;
  plans: Array<{ id: string; name: string }>;
  currentPlanId: string;
  currentStatus: SubscriptionState;
  currentInterval: BillingInterval;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Ajustar assinatura
      </Button>

      {feedback && (
        <p
          role="status"
          className={
            feedback.ok
              ? "rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs text-brand-800"
              : "rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
          }
        >
          {feedback.text}
        </p>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Assinatura · ${restaurantName}`}
        description="Sem cobrança automática: o ajuste vale na hora e fica registrado na auditoria."
      >
        <form
          action={(formData) => {
            formData.set("restaurantId", restaurantId);
            startTransition(async () => {
              const result = await setSubscription(formData);
              setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
              if (result.ok) {
                setOpen(false);
                router.refresh();
              }
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor={`plan-${restaurantId}`} className="block text-sm font-medium text-ink-700">
              Plano
            </label>
            <select
              id={`plan-${restaurantId}`}
              name="planId"
              defaultValue={currentPlanId}
              className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`status-${restaurantId}`} className="block text-sm font-medium text-ink-700">
              Status
            </label>
            <select
              id={`status-${restaurantId}`}
              name="status"
              defaultValue={currentStatus}
              className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            >
              {(Object.keys(SUBSCRIPTION_STATE_LABEL) as SubscriptionState[]).map((status) => (
                <option key={status} value={status}>
                  {SUBSCRIPTION_STATE_LABEL[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`interval-${restaurantId}`} className="block text-sm font-medium text-ink-700">
                Cobrança
              </label>
              <select
                id={`interval-${restaurantId}`}
                name="interval"
                defaultValue={currentInterval}
                className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              >
                {(Object.keys(BILLING_INTERVAL_LABEL) as BillingInterval[]).map((interval) => (
                  <option key={interval} value={interval}>
                    {BILLING_INTERVAL_LABEL[interval]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`days-${restaurantId}`} className="block text-sm font-medium text-ink-700">
                Período (dias)
              </label>
              <input
                id={`days-${restaurantId}`}
                name="periodDays"
                type="number"
                min={1}
                max={730}
                defaultValue={30}
                className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </div>
          </div>

          <Button type="submit" size="lg" block loading={pending}>
            Salvar assinatura
          </Button>
        </form>
      </Sheet>
    </div>
  );
}
