import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/data/restaurants";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Redefinir senha",
};

export default async function ResetPasswordPage() {
  // Só chega aqui com sessão criada pelo link do e-mail.
  const user = await getSessionUser();
  if (!user) redirect("/recuperar-senha");

  return (
    <AuthShell
      title="Criar nova senha"
      subtitle={`Definindo uma nova senha para ${user.email ?? "sua conta"}.`}
      backHref="/app"
      backLabel="Painel"
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
