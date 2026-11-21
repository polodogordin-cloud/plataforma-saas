"use client";

import { useActionState, useMemo, useState } from "react";
import { createRestaurant } from "@/actions/restaurant";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { slugify, type ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

export function RestaurantSetupForm() {
  const [state, formAction] = useActionState(createRestaurant, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [showAddress, setShowAddress] = useState(false);

  const autoSlug = useMemo(() => slugify(name), [name]);
  const currentSlug = slugTouched ? slug : autoSlug;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message && <FormAlert tone="error">{state.message}</FormAlert>}

      <Field
        label="Nome do restaurante"
        name="name"
        placeholder="Ex.: Cantina da Praça"
        autoComplete="organization"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        error={state.fieldErrors?.name?.[0]}
      />

      <Field
        label="Link do cardápio"
        name="slug"
        placeholder="cantina-da-praca"
        prefix="menuvo.app/"
        autoCapitalize="none"
        autoCorrect="off"
        inputMode="url"
        value={currentSlug}
        onChange={(event) => {
          setSlugTouched(true);
          setSlug(slugify(event.target.value));
        }}
        hint="É o endereço público do seu cardápio. Pode mudar depois."
        required
        error={state.fieldErrors?.slug?.[0]}
      />

      <Textarea
        label="Descrição (opcional)"
        name="description"
        rows={3}
        maxLength={500}
        placeholder="Conte em uma frase o que seu restaurante serve."
        error={state.fieldErrors?.description?.[0]}
      />

      <Field
        label="Telefone / WhatsApp (opcional)"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(11) 99999-0000"
        error={state.fieldErrors?.phone?.[0]}
      />

      <div className="rounded-xl border border-ink-200 bg-ink-50/60">
        <button
          type="button"
          onClick={() => setShowAddress((value) => !value)}
          aria-expanded={showAddress}
          className="tap-target flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left text-sm font-semibold text-ink-800"
        >
          Endereço (opcional)
          <span className="text-xs font-medium text-brand-700">
            {showAddress ? "Ocultar" : "Adicionar"}
          </span>
        </button>

        {showAddress && (
          <div className="animate-fade-in space-y-4 border-t border-ink-200 px-4 py-4">
            <div className="grid grid-cols-[1fr_5.5rem] gap-3">
              <Field
                label="Rua"
                name="addressLine"
                autoComplete="address-line1"
                placeholder="Rua, avenida…"
                error={state.fieldErrors?.addressLine?.[0]}
              />
              <Field
                label="Número"
                name="addressNumber"
                inputMode="numeric"
                autoComplete="address-line2"
                placeholder="123"
                error={state.fieldErrors?.addressNumber?.[0]}
              />
            </div>

            <Field
              label="Bairro"
              name="district"
              autoComplete="address-level3"
              placeholder="Centro"
              error={state.fieldErrors?.district?.[0]}
            />

            <div className="grid grid-cols-[1fr_5.5rem] gap-3">
              <Field
                label="Cidade"
                name="city"
                autoComplete="address-level2"
                placeholder="São Paulo"
                error={state.fieldErrors?.city?.[0]}
              />
              <Field
                label="UF"
                name="state"
                maxLength={2}
                autoComplete="address-level1"
                autoCapitalize="characters"
                placeholder="SP"
                error={state.fieldErrors?.state?.[0]}
              />
            </div>

            <Field
              label="CEP"
              name="postalCode"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              error={state.fieldErrors?.postalCode?.[0]}
            />
          </div>
        )}
      </div>

      <SubmitButton pendingLabel="Criando restaurante…">
        Criar restaurante e continuar
      </SubmitButton>
    </form>
  );
}
