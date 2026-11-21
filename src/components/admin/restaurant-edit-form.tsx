"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { updateRestaurant } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { slugify } from "@/lib/validation";
import type { Plan, Restaurant } from "@/lib/types";

/**
 * Edição administrativa dos dados da casa.
 *
 * Dois cuidados que não existem no formulário do dono:
 *
 *   • **slug** é editável e avisado. Mudar o link quebra QR Codes impressos, e
 *     o aviso é explicitamente sobre isso — o admin precisa decidir sabendo.
 *   • **plano** é um seletor aqui (e não no painel do restaurante), porque
 *     plano é decisão da plataforma, não do cliente.
 */
export function RestaurantEditForm({
  restaurant,
  plans,
}: {
  restaurant: Restaurant;
  plans: Plan[];
}) {
  const router = useRouter();
  const [name, setName] = useState(restaurant.name);
  const [slug, setSlug] = useState(restaurant.slug);
  const [phone, setPhone] = useState(restaurant.phone ?? "");
  const [description, setDescription] = useState(restaurant.description ?? "");
  const [planId, setPlanId] = useState(restaurant.plan_id ?? "free");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const slugChanged = slug !== restaurant.slug;

  const save = () => {
    setError(null);
    setDone(false);

    startTransition(async () => {
      const result = await updateRestaurant({
        restaurantId: restaurant.id,
        name,
        slug,
        phone,
        description,
        planId,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(true);
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field
        label="Nome"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={120}
        required
        autoComplete="organization"
      />

      <div>
        <Field
          label="Link do cardápio"
          value={slug}
          onChange={(event) => setSlug(slugify(event.target.value))}
          maxLength={48}
          required
          inputMode="url"
          hint={`Cardápio público: /r/${slug || "…"}`}
        />
        {slugChanged && (
          <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[0.72rem] leading-snug text-amber-800">
            Mudar o link invalida QR Codes e TAGs NFC já gravados. Só faça isso
            se o restaurante for reimprimir.
          </p>
        )}
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setSlug(slugify(name))}
          className="tap-target rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
        >
          Gerar link a partir do nome
        </button>
      </div>

      <Field
        label="Telefone"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        maxLength={32}
        inputMode="tel"
        placeholder="(11) 99999-0000"
      />

      <Field
        label="Descrição"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={500}
        hint={`${description.length}/500`}
      />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-800">Plano</legend>
        <div className="space-y-2">
          {plans.map((plan) => (
            <label
              key={plan.id}
              className={
                planId === plan.id
                  ? "flex cursor-pointer items-start gap-3 rounded-xl border border-brand-300 bg-brand-50 p-3"
                  : "flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-3 hover:bg-ink-50"
              }
            >
              <input
                type="radio"
                name="plan"
                value={plan.id}
                checked={planId === plan.id}
                onChange={() => setPlanId(plan.id)}
                className="mt-1 size-4 accent-brand-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-900">{plan.name}</span>
                <span className="block text-xs text-ink-500">{plan.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-ink-500">
          O plano é registrado agora; cobrança e limites entram na próxima etapa.
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {done && (
        <p className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <Check className="size-4" aria-hidden="true" />
          Dados atualizados.
        </p>
      )}

      <Button type="submit" block size="lg" loading={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Salvando…
          </>
        ) : (
          "Salvar alterações"
        )}
      </Button>
    </form>
  );
}
