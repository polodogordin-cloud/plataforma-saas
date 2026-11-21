"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Erro dentro do painel do restaurante e do painel master.
 *
 * Um `error.tsx` de segmento mantém a navegação: o dono do restaurante que
 * estava em `/app/pedidos` continua logado e pode ir a outra aba sem refazer o
 * login. O `global-error` existe para o caso extremo, em que nem o layout raiz
 * sobreviveu.
 *
 * O que a tela **não** mostra: mensagem da exceção, stack ou nome de tabela.
 * Só o `digest`, que é o que casa com o log do servidor sem entregar o mapa do
 * sistema a quem estiver olhando a tela de outra pessoa.
 */
export function AppErrorScreen({
  error,
  reset,
  area,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  area: string;
}) {
  useEffect(() => {
    console.error(`[${area}]`, error.digest ?? "sem digest", error.message);
  }, [area, error]);

  return (
    <main className="flex min-h-dvh flex-col bg-ink-50">
      <div className="app-shell flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-red-50 text-red-500">
          <TriangleAlert className="size-7" aria-hidden="true" />
        </span>

        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">
          Não foi possível carregar esta tela
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          Seus dados estão intactos. Tente de novo — se continuar, volte ao
          painel e abra a tela por lá.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-xs text-ink-400">Código: {error.digest}</p>
        )}

        <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
          <Button onClick={reset} size="lg" block>
            <RotateCcw className="size-4.5" aria-hidden="true" />
            Tentar novamente
          </Button>
          <ButtonLink href="/app" variant="secondary" size="lg" block>
            Voltar ao painel
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
