"use client";

import { useActionState } from "react";
import { updateProfile } from "@/actions/restaurant";
import { Field } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

export function AccountForm({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string;
  email: string;
}) {
  const [state, formAction] = useActionState(updateProfile, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message && (
        <FormAlert tone={state.ok ? "success" : "error"}>{state.message}</FormAlert>
      )}

      <Field
        label="Nome completo"
        name="fullName"
        defaultValue={fullName}
        autoComplete="name"
        required
        error={state.fieldErrors?.fullName?.[0]}
      />

      <Field
        label="Telefone"
        name="phone"
        type="tel"
        inputMode="tel"
        defaultValue={phone}
        autoComplete="tel"
        placeholder="(11) 99999-0000"
        error={state.fieldErrors?.phone?.[0]}
      />

      <Field
        label="E-mail"
        defaultValue={email}
        readOnly
        disabled
        hint="O e-mail de acesso não pode ser alterado nesta etapa."
      />

      <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
    </form>
  );
}
