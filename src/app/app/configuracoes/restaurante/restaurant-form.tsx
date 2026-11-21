"use client";

import { useActionState, useMemo, useState } from "react";
import { updateRestaurant } from "@/actions/restaurant";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { slugify, type ActionState } from "@/lib/validation";
import type { Restaurant } from "@/lib/types";

const initialState: ActionState = { ok: false };

export function RestaurantSettingsForm({ restaurant }: { restaurant: Restaurant }) {
  const [state, formAction] = useActionState(updateRestaurant, initialState);
  const [name, setName] = useState(restaurant.name);
  const [slug, setSlug] = useState(restaurant.slug);
  const [slugTouched, setSlugTouched] = useState(false);

  const autoSlug = useMemo(() => slugify(name), [name]);
  const currentSlug = slugTouched ? slug : autoSlug;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="restaurantId" value={restaurant.id} />

      {state.message && (
        <FormAlert tone={state.ok ? "success" : "error"}>{state.message}</FormAlert>
      )}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Identificação
        </legend>

        <Field
          label="Nome do restaurante"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="organization"
          error={state.fieldErrors?.name?.[0]}
        />

        <Field
          label="Link do cardápio"
          name="slug"
          prefix="menuvo.app/"
          value={currentSlug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(slugify(event.target.value));
          }}
          autoCapitalize="none"
          autoCorrect="off"
          required
          hint="Endereço público. Use letras minúsculas, números e hífens."
          error={state.fieldErrors?.slug?.[0]}
        />

        <Textarea
          label="Descrição"
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={restaurant.description ?? ""}
          placeholder="Conte em uma frase o que seu restaurante serve."
          error={state.fieldErrors?.description?.[0]}
        />

        <Field
          label="Telefone / WhatsApp"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={restaurant.phone ?? ""}
          placeholder="(11) 99999-0000"
          error={state.fieldErrors?.phone?.[0]}
        />
      </fieldset>

      <fieldset className="space-y-4 border-t border-ink-100 pt-5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Endereço
        </legend>

        <div className="grid grid-cols-[1fr_5.5rem] gap-3">
          <Field
            label="Rua"
            name="addressLine"
            autoComplete="address-line1"
            defaultValue={restaurant.address_line ?? ""}
            error={state.fieldErrors?.addressLine?.[0]}
          />
          <Field
            label="Número"
            name="addressNumber"
            inputMode="numeric"
            autoComplete="address-line2"
            defaultValue={restaurant.address_number ?? ""}
            error={state.fieldErrors?.addressNumber?.[0]}
          />
        </div>

        <Field
          label="Bairro"
          name="district"
          autoComplete="address-level3"
          defaultValue={restaurant.district ?? ""}
          error={state.fieldErrors?.district?.[0]}
        />

        <div className="grid grid-cols-[1fr_5.5rem] gap-3">
          <Field
            label="Cidade"
            name="city"
            autoComplete="address-level2"
            defaultValue={restaurant.city ?? ""}
            error={state.fieldErrors?.city?.[0]}
          />
          <Field
            label="UF"
            name="state"
            maxLength={2}
            autoComplete="address-level1"
            autoCapitalize="characters"
            defaultValue={restaurant.state ?? ""}
            error={state.fieldErrors?.state?.[0]}
          />
        </div>

        <Field
          label="CEP"
          name="postalCode"
          inputMode="numeric"
          autoComplete="postal-code"
          defaultValue={restaurant.postal_code ?? ""}
          error={state.fieldErrors?.postalCode?.[0]}
        />
      </fieldset>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-1 px-1 pt-2">
        <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
      </div>
    </form>
  );
}
