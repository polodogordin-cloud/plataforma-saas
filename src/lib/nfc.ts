import type { TableNfcTag } from "@/lib/types";

/**
 * Consolida várias TAGs em uma visão por mesa.
 *
 * Módulo neutro (sem `server-only`): o painel usa isto no cliente para resumir
 * o cartão da mesa. Uma mesa pode ter várias TAGs — placa com QR + NFC, TAG
 * reserva — e o cartão mostra o estado consolidado.
 *
 * A "principal" é a mais recente que ainda está utilizável, ou seja, a que o
 * dono acabou de gravar.
 */
export type TableNfcSummary = {
  tags: TableNfcTag[];
  primary: TableNfcTag | null;
  activeCount: number;
  hasStale: boolean;
  configured: boolean;
};

export function summarizeTableNfc(tags: TableNfcTag[]): TableNfcSummary {
  const active = tags.filter((tag) => tag.is_active && tag.status !== "disabled");
  const primary =
    active.find((tag) => !tag.needs_rerecord) ?? active[0] ?? tags[0] ?? null;

  return {
    tags,
    primary,
    activeCount: active.length,
    hasStale: tags.some((tag) => tag.needs_rerecord),
    configured: tags.some((tag) => tag.configured_at !== null),
  };
}
