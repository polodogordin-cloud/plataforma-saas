"use client";

import { AppErrorScreen } from "@/components/app/app-error-screen";

/** Erro no painel master: mesma tela, rótulo diferente no log. */
export default function AdminSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorScreen error={error} reset={reset} area="admin" />;
}
