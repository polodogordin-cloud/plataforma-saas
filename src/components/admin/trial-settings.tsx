"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlatformSetting } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

type PlanOption = { id: string; name: string; price: number };

/**
 * Configuração global de trial — Etapa 11, itens 7 e 9.
 *
 * Cada número tem formulário próprio: salvar o trial não reenvia a tolerância
 * (e vice-versa). Tudo é lido pelo banco, então um teste novo já sai com o
 * valor alterado.
 *
 * O **plano do teste** ganhou controle aqui por um motivo concreto: conceder o
 * plano mais caro no trial funciona contra o próprio negócio e, quando o teste
 * vence, o cliente pode estar acima do limite do plano que consegue pagar —
 * ficaria preso sem conseguir assinar. O padrão é o plano pago mais barato.
 */
export function TrialSettingsForm({
  trialDays,
  graceDays,
  trialPlanId,
  plans,
}: {
  trialDays: number;
  graceDays: number;
  trialPlanId: string | null;
  plans: PlanOption[];
}) {
  return (
    <div className="space-y-3">
      <SettingRow
        settingKey="trial_days"
        label="Dias de teste gratuito"
        hint="Aplicado ao criar a casa e ao iniciar o teste manualmente."
        value={trialDays}
      />
      <SettingRow
        settingKey="grace_days"
        label="Dias de tolerância após o vencimento"
        hint="Antes de marcar a assinatura como atrasada pelo banco."
        value={graceDays}
      />
      <TrialPlanRow plans={plans} value={trialPlanId} />
    </div>
  );
}

function TrialPlanRow({ plans, value }: { plans: PlanOption[]; value: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  // O valor vazio deixa o banco escolher: plano pago mais barato da vitrine.
  const current = plans.some((plan) => plan.id === value) ? (value as string) : "";

  return (
    <form
      action={(formData) => {
        startTransition(async () => {
          const result = await setPlatformSetting(formData);
          setFeedback(result.ok ? result.message : result.error);
          if (result.ok) router.refresh();
        });
      }}
      className="flex items-end gap-3"
    >
      <input type="hidden" name="key" value="trial_plan_id" />
      <div className="min-w-0 flex-1">
        <label
          htmlFor="trial-plan"
          className="mb-1.5 block text-sm font-medium text-ink-700"
        >
          Plano do teste gratuito
        </label>
        <select
          id="trial-plan"
          name="value"
          defaultValue={current}
          className="min-h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900"
          aria-describedby="trial-plan-hint"
        >
          <option value="">Automático (plano pago mais barato)</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
        <p id="trial-plan-hint" className="mt-1.5 text-xs leading-relaxed text-ink-500">
          Evite conceder o plano mais caro no teste: o cliente pode terminar o período acima dos
          limites do plano que conseguiria pagar.
        </p>
      </div>
      <Button type="submit" variant="secondary" loading={pending} className="shrink-0">
        Salvar
      </Button>
      {feedback && (
        <p role="status" className="text-xs text-ink-500">
          {feedback}
        </p>
      )}
    </form>
  );
}

function SettingRow({
  settingKey,
  label,
  hint,
  value,
}: {
  settingKey: "trial_days" | "grace_days";
  label: string;
  hint: string;
  value: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        formData.set("key", settingKey);
        startTransition(async () => {
          const result = await setPlatformSetting(formData);
          setFeedback(result.ok ? result.message : result.error);
          if (result.ok) router.refresh();
        });
      }}
      className="flex items-end gap-3"
    >
      <div className="min-w-0 flex-1">
        <Field
          label={label}
          name="value"
          inputMode="numeric"
          type="number"
          min={0}
          max={365}
          defaultValue={String(value)}
          hint={hint}
        />
      </div>
      <Button type="submit" variant="secondary" loading={pending} className="mb-6 shrink-0">
        Salvar
      </Button>
      {feedback && (
        <p role="status" className="mb-6 text-xs text-ink-500">
          {feedback}
        </p>
      )}
    </form>
  );
}
