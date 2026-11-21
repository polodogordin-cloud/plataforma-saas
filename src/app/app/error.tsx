"use client";

import { AppErrorScreen } from "@/components/app/app-error-screen";

/**
 * Erro dentro do painel do restaurante.
 *
 * Mantém sessão e navegação: o dono pode tentar de novo ou ir para outra aba
 * sem refazer login. Erro de uma tela do painel não deve parecer que o produto
 * inteiro caiu.
 */
export default function AppSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorScreen error={error} reset={reset} area="app" />;
}
