"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { NfcPanel } from "@/components/tables/nfc-panel";
import type { NfcEvent, RestaurantTable, TableNfcTag } from "@/lib/types";

/**
 * Painel NFC em bottom sheet.
 *
 * Mesmo padrão do QR (Etapa 4): nada de página separada, nada de modal de
 * desktop. O dono está em pé no salão, com uma mão no celular e a TAG na
 * outra — o fluxo inteiro tem que caber numa folha que sobe e desce.
 */
export function NfcSheet({
  table,
  tags,
  history,
  origin,
  canEdit,
  open,
  onClose,
}: {
  table: RestaurantTable | null;
  tags: TableNfcTag[];
  history: NfcEvent[];
  origin: string;
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => panelRef.current?.focus(), 60);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!mounted || !open || !table) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`NFC da ${table.name}`}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full animate-pop-in flex-col overflow-hidden rounded-t-[1.75rem] bg-ink-50 shadow-2xl outline-none sm:max-w-md sm:rounded-3xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-200/70 bg-white px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">
              NFC
            </p>
            <h2 className="truncate text-lg font-semibold leading-tight text-ink-900">
              {table.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-2 grid size-10 shrink-0 place-items-center rounded-xl text-ink-500 hover:bg-ink-100"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          <NfcPanel
            tableId={table.id}
            tableName={table.name}
            origin={origin}
            tags={tags}
            history={history}
            canEdit={canEdit}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
