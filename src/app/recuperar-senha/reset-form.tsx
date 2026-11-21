"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/actions/auth";
import { Field } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

export function ResetForm() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message && (
        <FormAlert tone={state.ok ? "success" : "error"}>{state.message}</FormAlert>
      )}

      <Field
        label="E-mail da conta"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="voce@restaurante.com"
        required
        error={state.fieldErrors?.email?.[0]}
      />

      <SubmitButton pendingLabel="Enviando…">
        {state.ok ? "Enviar novamente" : "Enviar link de recuperação"}
      </SubmitButton>
    </form>
  );
}
