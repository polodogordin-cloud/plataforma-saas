"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  CheckCircle2,
  Clock3,
  FileUp,
  Hourglass,
  ReceiptText,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { submitPaymentReceipt } from "@/actions/subscription-payments";
import { getBrowserClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";
import {
  PAYMENT_STAGE_TITLE,
  PAYMENT_STAGE_TONE,
  RECEIPT_ACCEPT,
  RECEIPT_ISSUE_MESSAGE,
  paymentStage,
  paymentStageMessage,
  receiptPath,
  validateReceipt,
  confirmedPeriodMessage,
} from "@/lib/payments";
import {
  PAYMENT_REQUEST_STATUS_LABEL,
  PAYMENT_REQUEST_STATUS_TONE,
  type MyPaymentPanel,
  type PaymentRequestSummary,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Estado do pagamento no painel do restaurante — Etapa 19.
 *
 * Uma tela só responde as perguntas do dono, nesta ordem:
 *   1. em que estado estou? (sem plano / aguardando / confirmado / ativo / vencendo / expirado)
 *   2. quanto e de qual plano?
 *   3. o que faço agora?
 *
 * O estágio **não** é decidido aqui: vem de `paymentStage()`, no módulo neutro,
 * para o dashboard, esta tela e a "Meu plano" contarem a mesma história. E a
 * fonte do "vence em X dias" é o banco (`my_payment_panel`), não a tela.
 *
 * Nenhum botão desta tela muda status. O máximo que o cliente faz é enviar
 * comprovante — que é anexo, não confirmação.
 */
export function PaymentStatusCard({
  panel,
  justConfirmed = false,
  compact = false,
}: {
  panel: MyPaymentPanel | null;
  justConfirmed?: boolean;
  compact?: boolean;
}) {
  const stage = paymentStage(panel, justConfirmed);
  const days = panel?.subscription.days_left ?? null;
  const message = paymentStageMessage(stage, days);

  const Icon =
    stage === "pending"
      ? Hourglass
      : stage === "expired"
        ? AlertOctagon
        : stage === "expiring"
          ? TriangleAlert
          : stage === "confirmed" || stage === "active"
            ? CheckCircle2
            : ReceiptText;

  const tone = PAYMENT_STAGE_TONE[stage];
  const toneClass = {
    success: "border-brand-200 bg-brand-50 text-brand-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    info: "border-sky-200 bg-sky-50 text-sky-900",
    danger: "border-red-200 bg-red-50 text-red-800",
    neutral: "border-ink-200 bg-ink-50 text-ink-800",
  }[tone];

  return (
    <Card className={cn("space-y-3", toneClass)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-white/70">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{PAYMENT_STAGE_TITLE[stage]}</p>
          <p className="mt-0.5 text-sm leading-relaxed opacity-90">{message}</p>
        </div>
      </div>

      {panel?.pending && (
        <div className="rounded-xl bg-white/80 px-3 py-2.5 text-sm text-ink-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{panel.pending.plan_name}</p>
            <p className="font-bold">{formatPrice(panel.pending.amount)}</p>
          </div>
          <p className="mt-0.5 text-xs text-ink-600">
            Solicitado em {formatDate(panel.pending.created_at)} ·{" "}
            {panel.pending.billing_interval === "yearly" ? "anual" : "mensal"}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {panel.pending.receipt_path
              ? "Comprovante recebido. Aguardando conferência."
              : "Nenhum comprovante enviado ainda (opcional)."}
          </p>
        </div>
      )}

      {!compact && stage === "confirmed" && panel && (
        <p className="text-xs opacity-80">
          {confirmedPeriodMessage(panel.subscription.period_end, null)}
        </p>
      )}

      {stage === "pending" && (
        <p className="flex items-center gap-1.5 text-xs opacity-80">
          <Clock3 className="size-3.5" aria-hidden="true" />
          O prazo depende da conferência manual da plataforma.
        </p>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Histórico                                                                  */
/* -------------------------------------------------------------------------- */

/** Lista vertical (sem tabela): cada pagamento em um cartão com status em texto. */
export function PaymentHistoryList({ history }: { history: PaymentRequestSummary[] }) {
  if (history.length === 0) {
    return (
      <p className="rounded-xl bg-ink-50 px-3 py-3 text-sm text-ink-500">
        Nenhum pagamento anterior. O histórico começa na primeira solicitação.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {history.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-ink-900">
              {item.plan_name} · {formatPrice(item.amount)}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
                {
                  success: "bg-brand-50 text-brand-700 ring-brand-200",
                  warning: "bg-amber-50 text-amber-700 ring-amber-200",
                  danger: "bg-red-50 text-red-700 ring-red-200",
                  info: "bg-sky-50 text-sky-700 ring-sky-200",
                  neutral: "bg-ink-50 text-ink-600 ring-ink-200",
                }[PAYMENT_REQUEST_STATUS_TONE[item.status]],
              )}
            >
              {PAYMENT_REQUEST_STATUS_LABEL[item.status]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            {formatDate(item.created_at)} · {item.billing_interval === "yearly" ? "anual" : "mensal"}
            {item.confirmed_at ? ` · confirmado em ${formatDate(item.confirmed_at)}` : ""}
          </p>
          {item.rejection_reason && (
            <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
              Motivo: {item.rejection_reason}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Comprovante                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Envio de comprovante — **opcional** e **sem confirmação**.
 *
 * O arquivo vai para o bucket privado `payment-receipts` no caminho
 * `{restaurant_id}/receipts/{request_id}-{stamp}.{ext}`. A tela calcula o mesmo
 * caminho que a Server Action valida, então um caminho adulterado é recusado
 * duas vezes (na action e na RPC).
 *
 * O que a tela **não** faz: chamar `confirmPayment`, mostrar "pagamento
 * confirmado" ou sugerir que o envio resolve algo. Enviar comprovante só dá ao
 * admin o que olhar.
 */
export function ReceiptUpload({
  requestId,
  restaurantId,
  receiptPathValue,
  disabled,
}: {
  requestId: string;
  restaurantId: string;
  /** Caminho já enviado, se houver. */
  receiptPathValue: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const choose = (next: File | undefined) => {
    setError(null);
    setDone(null);
    if (!next) {
      setFile(null);
      return;
    }

    const checked = validateReceipt({ name: next.name, size: next.size, type: next.type });
    if (!checked.ok) {
      setError(RECEIPT_ISSUE_MESSAGE[checked.issue]);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setFile(next);
  };

  const send = () => {
    if (!file) return;
    setBusy(true);
    setError(null);

    startTransition(async () => {
      try {
        const checked = validateReceipt({ name: file.name, size: file.size, type: file.type });
        if (!checked.ok) {
          setError(RECEIPT_ISSUE_MESSAGE[checked.issue]);
          return;
        }

        const path = receiptPath(restaurantId, requestId, checked.extension);
        const supabase = getBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from("payment-receipts")
          .upload(path, file, { cacheControl: "3600", contentType: checked.contentType, upsert: false });

        if (uploadError) {
          setError("Não foi possível enviar o arquivo. Verifique sua conexão e tente de novo.");
          return;
        }

        const result = await submitPaymentReceipt({
          requestId,
          path,
          filename: file.name,
          size: file.size,
          mimeType: file.type,
          note,
        });

        if (!result.ok) {
          setError(result.error);
          return;
        }

        setDone(result.message);
        setFile(null);
        setNote("");
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-ink-200 bg-white p-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <FileUp className="size-4" aria-hidden="true" />
          Comprovante (opcional)
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          PNG, JPG, WEBP ou PDF até 5 MB. O envio <strong>não</strong> confirma o pagamento — a
          plataforma ainda confere o recebimento.
        </p>
      </div>

      {receiptPathValue && !file && (
        <p className="rounded-lg bg-brand-50 px-2.5 py-2 text-xs text-brand-800">
          Comprovante já enviado para esta solicitação.
        </p>
      )}

      <label
        className={cn(
          "tap-target flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink-300 px-3 py-2 text-sm font-medium text-ink-700",
          disabled && "pointer-events-none opacity-55",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={RECEIPT_ACCEPT}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => choose(event.target.files?.[0])}
        />
        {file ? file.name : "Escolher arquivo"}
      </label>

      {file && (
        <>
          <label htmlFor={`note-${requestId}`} className="block text-xs font-medium text-ink-600">
            Observação (opcional)
          </label>
          <textarea
            id={`note-${requestId}`}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 280))}
            rows={2}
            maxLength={280}
            placeholder="Ex.: paguei pelo Banco X, às 14h20."
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900"
          />
          <div className="flex gap-2">
            <Button block loading={busy} onClick={send} disabled={busy}>
              Enviar comprovante
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFile(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              disabled={busy}
              aria-label="Descartar arquivo escolhido"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-lg bg-brand-50 px-2.5 py-2 text-xs text-brand-800">
          {done}
        </p>
      )}
    </div>
  );
}

/** Selo compacto de status de pagamento (usado no histórico e no admin). */
export function PaymentStatusBadge({ status }: { status: PaymentRequestSummary["status"] }) {
  const tone = PAYMENT_REQUEST_STATUS_TONE[status];
  return (
    <Badge
      tone={tone === "success" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "muted"}
    >
      {PAYMENT_REQUEST_STATUS_LABEL[status]}
    </Badge>
  );
}
