import Link from "next/link";
import { Compass } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <div className="app-shell px-5 pt-6">
        <Logo href="/" size="sm" />
      </div>
      <div className="app-shell flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-ink-100 text-ink-400">
          <Compass className="size-8" aria-hidden="true" />
        </span>
        <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-400">Erro 404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">
          Página não encontrada
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          O endereço pode ter mudado ou a página ainda não existe nesta versão da plataforma.
        </p>
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
          <ButtonLink href="/app" size="lg" block>
            Ir para o painel
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
