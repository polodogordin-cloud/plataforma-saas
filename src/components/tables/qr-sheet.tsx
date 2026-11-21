"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, Printer, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrPrintCard } from "@/components/tables/qr-print-card";
import { rotateTableToken } from "@/actions/tables";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/types";

/**
 * Cartão da mesa com o QR Code, pronto para mostrar ou imprimir.
 *
 * O QR vem do servidor como imagem (`/app/mesas/{id}/qr`), não é desenhado
 * aqui: assim o mesmo código que valida o acesso também gera a imagem, e o
 * link nunca é montado com dados que o navegador possa adulterar.
 */
export function QrSheet({
  table,
  open,
  onClose,
  tableUrl,
}: {
  table: RestaurantTable | null;
  open: boolean;
  onClose: () => void;
  /** URL absoluta já montada no servidor (origem + slug + token). */
  tableUrl: string;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState<"link" | "yes" | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Reinicia o estado a cada abertura de mesa diferente.
  useEffect(() => {
    if (!open) return;
    setCopied(null);
    setConfirmRotate(false);
    setError(null);
  }, [open, table?.id]);

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

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tableUrl);
      setCopied("link");
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Não foi possível copiar. Toque e segure no link para copiar.");
    }
  }, [tableUrl]);

  const rotate = useCallback(() => {
    if (!table) return;
    startTransition(async () => {
      const result = await rotateTableToken(table.id);
      if (!result.ok) {
        setError(result.message ?? "Não foi possível gerar um novo código.");
        return;
      }
      setConfirmRotate(false);
      router.refresh();
    });
  }, [table, router]);

  if (!mounted || !open || !table) return null;

  const qrSrc = `/app/mesas/${table.id}/qr`;

  return createPortal(
    <>
      {/* Só aparece no papel — ver @media print em globals.css */}
      <div className="print-sheet" aria-hidden="true">
        <QrPrintCard table={table} />
      </div>

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
        aria-label={`QR Code da ${table.name}`}
        tabIndex={-1}
        className="relative flex max-h-[94dvh] w-full animate-pop-in flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-2xl outline-none sm:max-w-sm sm:rounded-3xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pb-1 pt-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-ink-900">{table.name}</h2>
            <p className="text-xs text-ink-500">
              {table.code ? `Código ${table.code} · ` : ""}Escaneie para acessar o cardápio
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
          {/* Cartão imprimível */}
          <div className="mt-3 rounded-2xl border-2 border-ink-900/10 bg-white p-4 text-center">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-ink-400">
              Aponte a câmera
            </p>

            <div className="relative mx-auto mt-3 aspect-square w-full max-w-[15rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc}
                alt={`QR Code da ${table.name}`}
                width={720}
                height={720}
                className="size-full rounded-lg object-contain"
              />
            </div>

            <p className="mt-3 text-[0.95rem] font-bold uppercase tracking-wide text-ink-900">
              {table.name}
            </p>
            <p className="mt-0.5 text-[0.7rem] text-ink-500">Cardápio digital</p>
          </div>

          {/* Link */}
          <div className="mt-3">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400">
              Link da mesa
            </p>
            <p className="mt-1 select-all break-all rounded-lg bg-ink-100 px-2.5 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-600">
              {tableUrl}
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* Confirmação destrutiva */}
          {confirmRotate ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
              <p className="text-sm font-semibold text-amber-900">Gerar um novo código?</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                O QR Code atual e qualquer TAG NFC deixam de funcionar assim que você
                imprimir o novo. Os cartões já colados nas mesas precisarão ser substituídos.
                Quem estiver com o cardápio aberto continua navegando por 30 minutos.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  block
                  onClick={() => setConfirmRotate(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button size="sm" block onClick={rotate} loading={pending}>
                  Gerar novo
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <footer
          className="shrink-0 space-y-2 border-t border-ink-100 bg-white px-5 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <div className="flex gap-2">
            <a
              href={`${qrSrc}?format=png`}
              download
              className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(15,146,80,0.9)] active:scale-[0.98]"
            >
              <Download className="size-4" aria-hidden="true" />
              PNG
            </a>
            <a
              href={`${qrSrc}?format=svg`}
              download
              className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 active:scale-[0.98]"
            >
              <Download className="size-4" aria-hidden="true" />
              SVG
            </a>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={copyLink}
              className={cn(
                "tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors",
                copied === "link"
                  ? "border-brand-600 bg-brand-50 text-brand-800"
                  : "border-ink-200 bg-white text-ink-700",
              )}
            >
              {copied === "link" ? (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="size-4" aria-hidden="true" />
                  Copiar link
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="tap-target inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700"
            >
              <Printer className="size-4" aria-hidden="true" />
              Imprimir
            </button>
          </div>

          {!confirmRotate && (
            <button
              type="button"
              onClick={() => setConfirmRotate(true)}
              className="tap-target inline-flex w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-ink-400 hover:text-ink-600"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Gerar novamente
            </button>
          )}
        </footer>
        </div>
      </div>
    </>,
    document.body,
  );
}
