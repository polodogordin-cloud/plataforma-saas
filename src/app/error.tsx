"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Em produção, enviar para observabilidade (ex.: Sentry) em vez do console.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <div className="app-shell px-5 pt-6">
        <Logo href="/" size="sm" />
      </div>
      <div className="app-shell flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-red-50 text-red-500">
          <TriangleAlert className="size-8" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
          Algo saiu do prato
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-500">
          Tivemos um problema ao carregar esta tela. Tente novamente — se continuar,
          recarregue a página.
        </p>
        <Button onClick={reset} size="lg" className="mt-6 w-full max-w-xs">
          <RotateCcw className="size-4.5" aria-hidden="true" />
          Tentar novamente
        </Button>
      </div>
    </main>
  );
}
