import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormAlert } from "@/components/ui/form";
import { LoginForm } from "./login-form";
import { safeRedirectPath } from "@/lib/env";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Acesse o painel do seu restaurante.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erro?: string; aviso?: string }>;
}) {
  const { next, erro, aviso } = await searchParams;
  // A regra de redirect seguro vive num lugar só (`lib/env`), para que a tela e
  // a action não divirjam — divergir aqui é o que abre redirect aberto.
  const safeNext = safeRedirectPath(next);

  return (
    <AuthShell
      title="Bem-vindo de volta"
      subtitle="Entre para gerenciar o cardápio e o salão do seu restaurante."
      backHref="/"
      backLabel="Início"
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/criar-conta" className="font-semibold text-brand-700 hover:text-brand-800">
            Criar conta grátis
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        {erro === "link-invalido" && (
          <FormAlert tone="error">
            O link expirou ou já foi usado. Solicite um novo e-mail de recuperação.
          </FormAlert>
        )}
        {aviso === "senha-redefinida" && (
          <FormAlert tone="success">Senha alterada. Entre com a nova senha.</FormAlert>
        )}
        <LoginForm next={safeNext} />
      </div>
    </AuthShell>
  );
}
