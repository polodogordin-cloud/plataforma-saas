"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet para celular / modal centrado no desktop.
 *
 * - Abre de baixo no mobile (padrão de app), com alça de arrastar.
 * - Fecha com Esc, clique no fundo, gesto de arrastar para baixo ou botão X.
 * - Bloqueia o scroll do body e prende o foco dentro do painel.
 * - Respeita a área segura do iPhone.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "default" | "tall";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  // Esc + bloqueio de scroll
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    // Foco inicial no painel
    const timer = window.setTimeout(() => panelRef.current?.focus(), 60);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  // Foco preso dentro do painel
  const trapFocus = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      {/* Fundo */}
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-ink-950/45 backdrop-blur-[2px]"
      />

      {/* Painel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? "sheet-description" : undefined}
        tabIndex={-1}
        onKeyDown={trapFocus}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-white shadow-2xl outline-none",
          "animate-pop-in rounded-t-[1.5rem] sm:max-w-lg sm:rounded-[1.25rem]",
          size === "tall" ? "max-h-[92dvh]" : "max-h-[88dvh]",
          dragY === 0 && "transition-transform duration-200",
        )}
      >
        {/* Alça de arrastar (mobile) */}
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center bg-white pb-1 pt-2.5 sm:hidden"
          onPointerDown={(event) => {
            dragStart.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragStart.current === null) return;
            const delta = event.clientY - dragStart.current;
            if (delta > 0) setDragY(delta);
          }}
          onPointerUp={() => {
            if (dragY > 110) onClose();
            setDragY(0);
            dragStart.current = null;
          }}
          aria-hidden="true"
        >
          <span className="h-1.5 w-10 rounded-full bg-ink-200" />
        </div>

        <header className="flex shrink-0 items-start gap-3 border-b border-ink-100 px-4 pb-3 pt-2 sm:pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.05rem] font-semibold leading-tight text-ink-900">{title}</h2>
            {description && (
              <p id="sheet-description" className="mt-0.5 text-sm text-ink-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="tap-target -mr-1.5 grid size-11 shrink-0 place-items-center rounded-xl text-ink-500 hover:bg-ink-100"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>

        {footer && (
          <footer
            className="shrink-0 border-t border-ink-100 bg-white px-4 py-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
