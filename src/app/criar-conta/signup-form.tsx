"use client";

import { useActionState } from "react";
import { signUp } from "@/actions/auth";
import { Field, PasswordField } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

export function SignUpForm() {
  const [state, formAction] = useActionState(signUp, initialState);

  if (state.ok && state.message) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{state.message}</FormAlert>
        <p className="text-sm leading-relaxed text-ink-500">
          Abra o e-mail e toque no link de confirmação. Em seguida você vai cadastrar
          as informações do seu restaurante.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message && <FormAlert tone="error">{state.message}</FormAlert>}

      <Field
        label="Seu nome"
        name="fullName"
        autoComplete="name"
        placeholder="Como devemos te chamar"
        required
        error={state.fieldErrors?.fullName?.[0]}
      />

      <Field
        label="E-mail"
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

      <PasswordField
        label="Senha"
        name="password"
        autoComplete="new-password"
        placeholder="Mínimo de 8 caracteres"
        hint="Use pelo menos 8 caracteres."
        required
        error={state.fieldErrors?.password?.[0]}
      />

      <PasswordField
        label="Confirmar senha"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="Repita a senha"
        required
        error={state.fieldErrors?.confirmPassword?.[0]}
      />

      <SubmitButton pendingLabel="Criando conta…">Criar conta</SubmitButton>

      <p className="text-center text-xs leading-relaxed text-ink-400">
        Ao criar a conta você concorda com os Termos de Uso e a Política de Privacidade.
      </p>
    </form>
  );
}
