import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

/**
 * Acesso negado (403) — Etapa 20.
 *
 * ─── Por que esta página existe separada do 404 ────────────────────────────
 *
 * O app já protege rota de três formas: middleware (sem sessão → `/entrar`),
 * layout (`/admin` sem papel → volta para `/app`) e banco (`admin_forbidden`).
 * Faltava a tela para o caso "estou logado, mas esta área não é minha" quando
 * quem redireciona é uma regra de negócio e não o middleware.
 *
 * Confundir 403 com 404 é uma escolha de segurança em alguns casos (não revelar
 * que o recurso existe). Aqui não: o usuário sabe que o painel da plataforma
 * existe, e fingir que não existe só gera ticket. O que a tela **não** diz é o
 * que existe dentro da área negada.
 *
 * `robots: noindex` porque não é conteúdo.
 */
export const metadata: Metadata = {
  title: "Acesso restrito",
  robots: { index: false, follow: false },
};

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <div className="app-shell px-5 pt-6">
        <Logo href="/" size="sm" />
      </div>

      <div className="app-shell flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <LockKeyhole className="size-8" aria-hidden="true" />
        </span>

        <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-400">Erro 403</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 text-balance">
          Esta área não é do seu acesso
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          Sua conta está ativa, mas o seu perfil não tem permissão para abrir esta
          tela. Se você precisa dela, fale com o proprietário do restaurante.
        </p>

        <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
          <ButtonLink href="/app" size="lg" block>
            Ir para o meu painel
          </ButtonLink>
          <Link
            href="/"
            className="tap-target inline-flex items-center justify-center rounded-xl px-4 text-sm font-semibold text-ink-600 hover:bg-ink-100"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
