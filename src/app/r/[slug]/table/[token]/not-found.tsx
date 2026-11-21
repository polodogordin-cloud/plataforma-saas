import type { Metadata } from "next";
import Link from "next/link";
import { ScanLine } from "lucide-react";
import { Logo } from "@/components/ui/logo";

/**
 * Mesa não encontrada — `/r/{slug}/table/{token}` com token que não resolve.
 *
 * ─── Por que a mensagem é vaga de propósito ───────────────────────────────
 *
 * Token inválido, mesa desativada e casa fechada produzem **a mesma** tela.
 * Diferenciar as três transformaria este endereço num oráculo: bastaria
 * varrer tokens para descobrir quais existem — e um token válido dá acesso ao
 * pedido daquela mesa.
 *
 * O texto é do cliente no salão (celular na mão, possivelmente sem entender o
 * que é QR Code), então a saída é sempre humana: chame alguém.
 *
 * Serve como `not-found` do segmento de mesa e como tela de motivo `table` em
 * `MenuUnavailable`; os dois casos são o mesmo para quem lê.
 */
export const metadata: Metadata = {
  title: "Mesa não encontrada",
  // Não é conteúdo: não deve aparecer em busca nem ser seguido.
  robots: { index: false, follow: false },
};

export default function TableNotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-ink-50">
      <div className="app-shell px-5 pt-6">
        <Logo href="/" size="sm" />
      </div>

      <div className="app-shell flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-white text-amber-600 shadow-[var(--shadow-soft)]">
          <ScanLine className="size-8" aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900 text-balance">
          Não encontramos esta mesa
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          O QR Code pode estar desatualizado ou a mesa foi desativada. Peça um
          novo QR Code no balcão ou chame um atendente — ele resolve na hora.
        </p>

        <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
          <Link
            href="/"
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-brand-700 shadow-[var(--shadow-soft)] hover:bg-brand-50"
          >
            Conhecer o Menuvo
          </Link>
        </div>
      </div>
    </main>
  );
}
