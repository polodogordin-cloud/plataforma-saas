"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { savePlan } from "@/actions/billing";
import {
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABEL,
  PLAN_LIMIT_KEYS,
  PLAN_LIMIT_LABEL,
  type AdminPlanRow,
  type PlanLimitKey,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Editor de plano — Etapa 11, item 9 do escopo.
 *
 * Um único formulário serve para criar e editar: o `id` é editável só na
 * criação (há FKs apontando para ele). Limite em branco significa **sem
 * limite**, e isso é dito na tela — em branco nunca deve virar 0, que
 * bloquearia a criação do primeiro produto.
 *
 * Recursos são chips: o vocabulário é fechado (`PLAN_FEATURE_KEYS`) para que o
 * app saiba o que fazer com cada chave; um campo livre criaria `nfc_2` que o
 * código ignora em silêncio.
 */

type Mode = { type: "create" } | { type: "edit"; plan: AdminPlanRow };

export function NewPlanButton({ nextPosition }: { nextPosition: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Novo plano
      </Button>
      <PlanSheet
        mode={{ type: "create" }}
        open={open}
        onClose={() => setOpen(false)}
        nextPosition={nextPosition}
      />
    </>
  );
}

export function EditPlanButton({ plan }: { plan: AdminPlanRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Editar
      </Button>
      <PlanSheet mode={{ type: "edit", plan }} open={open} onClose={() => setOpen(false)} nextPosition={plan.position} />
    </>
  );
}

function PlanSheet({
  mode,
  open,
  onClose,
  nextPosition,
}: {
  mode: Mode;
  open: boolean;
  onClose: () => void;
  nextPosition: number;
}) {
  const router = useRouter();
  const plan = mode.type === "edit" ? mode.plan : null;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<string[]>(plan?.features ?? []);

  const toggleFeature = (key: string) => {
    setFeatures((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const submit = (formData: FormData) => {
    setError(null);
    formData.set("features", features.join(","));
    startTransition(async () => {
      const result = await savePlan(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode.type === "create" ? "Novo plano" : `Editar ${plan?.name}`}
      description="Nome, preço, limites e recursos são livres: nada disso está fixo no código."
      size="tall"
    >
      <form action={submit} className="space-y-4">
        <Field
          label="Identificador"
          name="id"
          defaultValue={plan?.id ?? ""}
          placeholder="profissional"
          hint={
            mode.type === "edit"
              ? "O identificador não muda depois de criado."
              : "Minúsculas, números e hífen. É o que aparece no banco."
          }
          readOnly={mode.type === "edit"}
          required
        />

        <Field label="Nome" name="name" defaultValue={plan?.name ?? ""} placeholder="Profissional" required />

        <div className="space-y-1.5">
          <label htmlFor="plan-description" className="block text-sm font-medium text-ink-700">
            Descrição
          </label>
          <textarea
            id="plan-description"
            name="description"
            defaultValue={plan?.description ?? ""}
            rows={2}
            maxLength={280}
            placeholder="Para quem já tem salão cheio"
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Preço"
            name="price"
            inputMode="decimal"
            prefix="R$"
            defaultValue={plan ? plan.price.toFixed(2).replace(".", ",") : "0,00"}
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="plan-interval" className="block text-sm font-medium text-ink-700">
              Cobrança
            </label>
            <select
              id="plan-interval"
              name="interval"
              defaultValue={plan?.interval ?? "monthly"}
              className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            >
              <option value="monthly">Por mês</option>
              <option value="yearly">Por ano</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Ordem"
            name="position"
            inputMode="numeric"
            defaultValue={String(plan?.position ?? nextPosition)}
            hint="Menor aparece primeiro"
          />
          <label className="flex min-h-12 items-center gap-2.5 self-end rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={plan ? plan.is_active : true}
              className="size-4 accent-brand-600"
            />
            Visível na vitrine
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-700">Limites</legend>
          <p className="text-xs text-ink-500">Deixe em branco para não limitar.</p>
          <div className="grid grid-cols-2 gap-3">
            {PLAN_LIMIT_KEYS.map((key: PlanLimitKey) => (
              <Field
                key={key}
                label={PLAN_LIMIT_LABEL[key]}
                name={`limit_${key}`}
                inputMode="numeric"
                defaultValue={plan?.limits[key] != null ? String(plan.limits[key]) : ""}
                placeholder="sem limite"
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-700">Recursos</legend>
          <div className="flex flex-wrap gap-2">
            {PLAN_FEATURE_KEYS.map((key) => {
              const on = features.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleFeature(key)}
                  className={cn(
                    "min-h-11 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition",
                    on
                      ? "bg-brand-600 text-white ring-brand-600"
                      : "bg-white text-ink-600 ring-ink-200",
                  )}
                >
                  {PLAN_FEATURE_LABEL[key]}
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" block loading={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          Salvar plano
        </Button>
      </form>
    </Sheet>
  );
}
