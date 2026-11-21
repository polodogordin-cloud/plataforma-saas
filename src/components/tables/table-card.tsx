"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Loader2, Pencil, QrCode } from "lucide-react";
import { toggleTableActive } from "@/actions/tables";
import { TABLE_STATUS_LABEL, type RestaurantTable } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Card de mesa no painel.
 *
 * Sem tabela: o formato é o de app de celular — um cartão por mesa, com as
 * duas ações que importam (QR e editar) em alvos de 44px.
 */
export function TableCard({
  table,
  onShowQr,
  onEdit,
  canEdit,
  onActiveChange,
}: {
  table: RestaurantTable;
  onShowQr: () => void;
  onEdit: () => void;
  canEdit: boolean;
  /** Mantém a lista do painel em sincronia sem esperar recarregar a página. */
  onActiveChange?: (tableId: string, isActive: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !table.is_active;
    // Otimista: o interruptor responde na hora, o servidor confirma depois.
    onActiveChange?.(table.id, next);
    setPending(true);
    setError(null);

    const result = await toggleTableActive(table.id, next);

    if (!result.ok) {
      onActiveChange?.(table.id, !next); // desfaz
      setError(result.message ?? "Não foi possível atualizar a mesa.");
    }

    setPending(false);
    router.refresh();
  };

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white p-3 shadow-[var(--shadow-soft)] transition-colors",
        table.is_active ? "border-ink-200/80" : "border-ink-200/60 bg-ink-50/70",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            table.is_active ? "bg-brand-50 text-brand-700" : "bg-ink-200 text-ink-500",
          )}
          aria-hidden="true"
        >
          <Armchair className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "truncate text-[0.95rem] font-semibold leading-tight",
              table.is_active ? "text-ink-900" : "text-ink-500",
            )}
          >
            {table.name}
          </h3>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold",
                table.is_active
                  ? "bg-brand-50 text-brand-700"
                  : "bg-amber-50 text-amber-700",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  table.is_active ? "bg-brand-500" : "bg-amber-500",
                )}
                aria-hidden="true"
              />
              {table.is_active ? "Ativa" : "Desativada"}
            </span>

            {table.is_active && table.status !== "free" && (
              <span className="truncate">{TABLE_STATUS_LABEL[table.status]}</span>
            )}

            {table.code && <span className="truncate">· {table.code}</span>}
          </p>

          {table.notes && (
            <p className="mt-1 line-clamp-1 text-[0.7rem] text-ink-400">{table.notes}</p>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={onShowQr}
            className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-3 text-sm font-semibold text-white active:scale-[0.98]"
          >
            <QrCode className="size-4" aria-hidden="true" />
            QR Code
          </button>

          <button
            type="button"
            onClick={onEdit}
            aria-label={`Editar ${table.name}`}
            className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700 active:scale-[0.98]"
          >
            <Pencil className="size-4" aria-hidden="true" />
            Editar
          </button>

          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            aria-pressed={table.is_active}
            aria-label={
              table.is_active ? `Desativar ${table.name}` : `Ativar ${table.name}`
            }
            className="tap-target grid w-11 shrink-0 place-items-center rounded-xl border border-ink-200 bg-white"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  "h-4 w-7 rounded-full p-0.5 transition-colors",
                  table.is_active ? "bg-brand-600" : "bg-ink-300",
                )}
              >
                <span
                  className={cn(
                    "block size-3 rounded-full bg-white transition-transform",
                    table.is_active && "translate-x-3",
                  )}
                />
              </span>
            )}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[0.7rem] font-medium text-red-600">
          {error}
        </p>
      )}

      {!canEdit && (
        <button
          type="button"
          onClick={onShowQr}
          className="tap-target mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700"
        >
          <QrCode className="size-4" aria-hidden="true" />
          Ver QR Code
        </button>
      )}
    </article>
  );
}
