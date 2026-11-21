"use client";

import { useState, useTransition } from "react";
import { BellRing, Check, Clock, Receipt } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { createTableRequest, readTableRequestState } from "@/actions/table-requests";
import { alreadySentLabel, cooldownLabel, requestAvailability } from "@/lib/table-request";
import type { TableRequestState, TableRequestType } from "@/lib/types";

const COPY = {
  waiter: {
    title: "Chamar garçom",
    question: "Você deseja chamar um garçom para esta mesa?",
    confirm: "Chamar garçom",
    confirmLong: "Chamar garçom",
    icon: BellRing,
    success: "Garçom a caminho!",
    successDetail: "Alguém da equipe foi avisado e vai até a mesa.",
  },
  bill: {
    title: "Pedir a conta",
    question: "Você deseja solicitar a conta desta mesa?",
    confirm: "Solicitar conta",
    confirmLong: "Solicitar conta",
    icon: Receipt,
    success: "Conta solicitada!",
    successDetail: "A equipe já foi avisada e vai levar a conta até a mesa.",
  },
} as const;

/**
 * Bottom sheet de confirmação das solicitações da mesa.
 *
 * Um toque no botão da barra abre este sheet; o envio de fato acontece só no
 * botão de confirmação — é o "tem certeza?" do escopo, sem `window.confirm`.
 *
 * Três estados aparecem aqui:
 *
 *  1. **pedido** — a pergunta + CANCELAR / CHAMAR GARÇOM;
 *  2. **já enviada** — o banco disse que existe solicitação viva (ou o cliente
 *     tocou duas vezes). Nada é criado, e a tela diz desde quando;
 *  3. **sucesso** — "Conta solicitada!" com um ✓ e o detalhe do que acontece.
 *
 * O estado da mesa é relido ao abrir (`readTableRequestState`), porque o
 * cliente pode ter deixado a página aberta enquanto a equipe atendia.
 */
export function TableRequestSheet({
  open,
  type,
  tableToken,
  initialState,
  onClose,
  onSent,
}: {
  open: boolean;
  type: TableRequestType;
  tableToken: string;
  initialState: TableRequestState | null;
  onClose: () => void;
  onSent: (type: TableRequestType) => void;
}) {
  const copy = COPY[type];
  const Icon = copy.icon;

  const [state, setState] = useState<TableRequestState | null>(initialState);
  const [justSent, setJustSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const availability = requestAvailability(state, type);

  /** Relê o estado ao abrir: a equipe pode ter atendido enquanto isso. */
  function handleOpenChange(next: boolean) {
    if (next) {
      setError(null);
      setJustSent(false);
      readTableRequestState(tableToken).then((fresh) => {
        if (fresh) setState(fresh);
      });
    }
    if (!next) onClose();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createTableRequest({ tableToken, type });

      if (!result.ok) {
        setError(result.error);
        // Recusa por cooldown/duplicata: o estado local estava velho.
        const fresh = await readTableRequestState(tableToken);
        if (fresh) setState(fresh);
        return;
      }

      // O banco pode devolver a solicitação que JÁ existia (duplo toque).
      const alreadyExisted = result.request.status !== "pending" || justSent;
      setJustSent(true);
      setState((prev) => ({
        waiter_status: type === "waiter" ? result.request.status : (prev?.waiter_status ?? null),
        waiter_since: type === "waiter" ? result.request.created_at : (prev?.waiter_since ?? null),
        bill_status: type === "bill" ? result.request.status : (prev?.bill_status ?? null),
        bill_since: type === "bill" ? result.request.created_at : (prev?.bill_since ?? null),
        cooldown_until: prev?.cooldown_until ?? null,
      }));
      if (!alreadyExisted) onSent(type);
    });
  }

  const sentNow = justSent && availability.alreadySent;

  return (
    <Sheet
      open={open}
      onClose={() => handleOpenChange(false)}
      title={sentNow ? copy.success : copy.title}
      footer={
        sentNow ? (
          <Button variant="primary" size="lg" block onClick={() => handleOpenChange(false)}>
            Entendi
          </Button>
        ) : availability.alreadySent ? (
          <Button variant="ghost" size="lg" block onClick={() => handleOpenChange(false)}>
            Fechar
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              block
              loading={pending}
              disabled={!availability.canSend}
              onClick={submit}
            >
              {availability.canSend ? copy.confirmLong : cooldownLabel(availability.cooldownLeft)}
            </Button>
            <Button
              variant="ghost"
              size="md"
              block
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
          </div>
        )
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            sentNow
              ? "grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"
              : "grid size-11 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700"
          }
        >
          {sentNow ? (
            <Check className="size-5" aria-hidden="true" strokeWidth={3} />
          ) : (
            <Icon className="size-5" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1 text-sm leading-relaxed text-ink-600">
          {sentNow ? (
            <p>{copy.successDetail}</p>
          ) : availability.alreadySent ? (
            <>
              <p className="font-medium text-ink-800">Solicitação já enviada.</p>
              <p className="mt-1">{alreadySentLabel(availability.liveStatus ?? "pending")}</p>
            </>
          ) : (
            <p>{copy.question}</p>
          )}
        </div>
      </div>

      {!sentNow && availability.alreadySent && availability.since && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          Enviada às{" "}
          {new Date(availability.since).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}

      {!sentNow && !availability.alreadySent && availability.cooldownLeft > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Uma solicitação foi enviada há pouco. Aguarde {availability.cooldownLeft}s para chamar de
          novo.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </Sheet>
  );
}
