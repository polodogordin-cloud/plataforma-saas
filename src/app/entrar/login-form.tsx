"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "@/actions/auth";
import { Field, PasswordField } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.message && <FormAlert tone="error">{state.message}</FormAlert>}

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
        autoComplete="current-password"
        placeholder="Sua senha"
        required
        error={state.fieldErrors?.password?.[0]}
      />

      <div className="flex justify-end">
        <Link
          href="/recuperar-senha"
          className="tap-target inline-flex items-center text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          Esqueci minha senha
        </Link>
      </div>

      <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
    </form>
  );
}
