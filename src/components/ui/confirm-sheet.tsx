"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * Confirmação de ação destrutiva em bottom sheet —
 * nunca window.confirm(), que no celular quebra o fluxo visual.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Excluir",
  onConfirm,
  destructive = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
  destructive?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm();
        onClose();
      } catch {
        setError("Não foi possível concluir. Tente novamente.");
      }
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant={destructive ? "danger" : "primary"}
            size="lg"
            block
            loading={pending}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" size="md" block onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            destructive
              ? "grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600"
              : "grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"
          }
        >
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <div className="text-sm leading-relaxed text-ink-600">{description}</div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </Sheet>
  );
}
