"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlatformSetting } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/**
 * Configuração global de trial — Etapa 11, item 7.
 *
 * Dois números, dois formulários independentes: salvar o trial não deve
 * reenviar a tolerância (e vice-versa). Ambos são lidos pelo banco, então a
 * data de fim de um teste novo já sai com o valor alterado.
 */
export function TrialSettingsForm({ trialDays, graceDays }: { trialDays: number; graceDays: number }) {
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
    </div>
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
