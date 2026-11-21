"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updatePassword } from "@/actions/auth";
import { PasswordField } from "@/components/ui/field";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = { ok: false };

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      const timer = setTimeout(() => {
        router.push("/entrar?aviso=senha-redefinida");
      }, 1600);
      return () => clearTimeout(timer);
    }
  }, [state.ok, router]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message && (
        <FormAlert tone={state.ok ? "success" : "error"}>{state.message}</FormAlert>
      )}

      <PasswordField
        label="Nova senha"
        name="password"
        autoComplete="new-password"
        placeholder="Mínimo de 8 caracteres"
        required
        error={state.fieldErrors?.password?.[0]}
      />

      <PasswordField
        label="Confirmar nova senha"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="Repita a nova senha"
        required
        error={state.fieldErrors?.confirmPassword?.[0]}
      />

      <SubmitButton pendingLabel="Salvando…">Salvar nova senha</SubmitButton>
    </form>
  );
}
