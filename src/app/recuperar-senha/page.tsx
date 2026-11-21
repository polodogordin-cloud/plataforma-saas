import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Recuperar senha",
  description: "Receba um link para redefinir a senha da sua conta.",
};

export default function RecoverPasswordPage() {
  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha."
      backHref="/entrar"
      backLabel="Entrar"
    >
      <ResetForm />
    </AuthShell>
  );
}
