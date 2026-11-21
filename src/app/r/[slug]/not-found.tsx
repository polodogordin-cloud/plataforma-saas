import Link from "next/link";
import { Store } from "lucide-react";
import { Logo } from "@/components/ui/logo";

/**
 * 404 do cardápio público.
 *
 * O visitante é um cliente com o celular na mão, não um administrador:
 * nada de "ir para o painel". Só a explicação e um caminho de volta.
 *
 * Também cobre o restaurante que existe mas está em rascunho/pausado — para o
 * público, "não publicado" e "não existe" são a mesma resposta, e isso evita
 * descobrir quais slugs estão cadastrados.
 */
export default function PublicMenuNotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-ink-50">
      <div className="app-shell px-5 pt-safe pt-6">
        <Logo href="/" size="sm" />
      </div>

      <div className="app-shell flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-white text-ink-400 shadow-[var(--shadow-soft)]">
          <Store className="size-8" aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900 text-balance">
          Cardápio não encontrado
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          Este link não está ativo. Confira com o restaurante se o endereço está correto ou
          peça o QR Code na mesa.
        </p>

        <Link
          href="/"
          className="tap-target mt-6 inline-flex items-center justify-center rounded-xl px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          Conhecer o Menuvo
        </Link>
      </div>
    </main>
  );
}
