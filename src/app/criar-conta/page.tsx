import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Criar conta",
  description: "Crie sua conta e coloque o cardápio digital do seu restaurante no ar.",
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Comece grátis"
      subtitle="Crie sua conta e cadastre o restaurante em menos de 2 minutos."
      backHref="/entrar"
      backLabel="Entrar"
      footer={
        <>
          Já tem uma conta?{" "}
          <Link href="/entrar" className="font-semibold text-brand-700 hover:text-brand-800">
            Entrar
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
