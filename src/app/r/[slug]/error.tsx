"use client";

import { useEffect } from "react";
import { RotateCcw, WifiOff } from "lucide-react";

/**
 * Erro no cardápio público.
 *
 * O visitante aqui é o cliente com o celular na mão, no salão, com fome. Ele
 * não tem conta, não tem painel e não vai entender termo técnico. A tela é:
 * uma frase, um botão grande, e nada que o faça achar que o restaurante fechou.
 *
 * Nada de link para `/app` — isso existe em outras telas de erro e aqui seria
 * um beco sem saída com cara de login.
 */
export default function PublicMenuError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[public-menu]", error.digest ?? "sem digest", error.message);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-ink-50 px-5 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700">
          <WifiOff className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-3 text-lg font-semibold text-ink-900">
          Não conseguimos abrir o cardápio
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Pode ser a conexão do salão. Tente de novo — se não abrir, chame um
          atendente que traz o cardápio.
        </p>

        {error.digest && (
          <p className="mt-2 font-mono text-[0.7rem] text-ink-400">{error.digest}</p>
        )}

        <button
          type="button"
          onClick={reset}
          className="tap-target mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition active:scale-[0.99]"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Tentar de novo
        </button>
      </div>
    </main>
  );
}
