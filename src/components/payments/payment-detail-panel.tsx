"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ExternalLink,
  FileText,
  XCircle,
} from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { confirmPayment, rejectPayment, cancelPendingPayment } from "@/actions/subscription-payments";
import { confirmWarning } from "@/lib/payments";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";
import {
  BILLING_INTERVAL_LABEL,
  PAYMENT_REQUEST_STATUS_LABEL,
  PAYMENT_REQUEST_STATUS_TONE,
  type AdminPaymentRequestDetail,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Detalhe e confirmação de pagamento — Etapa 19.
 *
 * Esta é a única tela da plataforma em que uma pessoa transforma "cliente diz
 * que pagou" em "cliente tem plano". Por isso:
 *
 *   • o aviso antes de confirmar é literal (**"Confirme somente após verificar o
 *     recebimento do PIX"**) e aparece antes do botão, não depois;
 *   • nada confirma sozinho — nem o comprovante enviado, nem abrir a tela, nem
 *     voltar para ela;
 *   • confirmar e rejeitar são ações distintas, nunca um botão que alterna;
 *   • a tela mostra o que o banco vai gravar (plano, valor, período) antes do
 *     clique. Depois, o backend é quem escreve a assinatura e a auditoria.
 *
 * O `restaurantId` nunca vai no payload: as ações recebem só o id da
 * solicitação, e a RPC resolve a casa a partir dela.
 */
export function PaymentDetailPanel({
  detail,
  receiptUrl,
  isMasterAdmin,
}: {
  detail: AdminPaymentRequestDetail;
  receiptUrl: string | null;
  isMasterAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reference, setReference] = useState(detail.transaction_reference ?? "");
  const [periodDays, setPeriodDays] = useState("");
  const [note, setNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [mode, setMode] = useState<"idle" | "confirm" | "reject">("idle");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const isPending = detail.status === "PENDING";
  const periodGuess = detail.billing_interval === "yearly" ? 365 : 30;
  const customDays = periodDays.trim() ? Math.trunc(Number(periodDays)) : null;

  const doConfirm = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await confirmPayment({
        requestId: detail.id,
        reference,
        periodDays: customDays,
        note,
      });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setMode("idle");
        router.refresh();
      }
    });
  };

  const doReject = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await rejectPayment({ requestId: detail.id, reason: rejectReason });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setMode("idle");
        router.refresh();
      }
    });
  };

  const doCancel = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await cancelPendingPayment({
        requestId: detail.id,
        reason: "cancelado pela plataforma",
      });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SectionTitle
          title={detail.restaurant_name}
          description={`Solicitação de ${detail.requester_name ?? "responsável"} · ${detail.requester_email ?? "sem e-mail"}`}
          action={
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                {
                  success: "bg-brand-50 text-brand-700 ring-brand-200",
                  warning: "bg-amber-50 text-amber-700 ring-amber-200",
                  danger: "bg-red-50 text-red-700 ring-red-200",
                  info: "bg-sky-50 text-sky-700 ring-sky-200",
                  neutral: "bg-ink-50 text-ink-600 ring-ink-200",
                }[PAYMENT_REQUEST_STATUS_TONE[detail.status]],
              )}
            >
              {PAYMENT_REQUEST_STATUS_LABEL[detail.status]}
            </span>
          }
        />

        <dl className="space-y-1.5 text-sm">
          <Row label="Plano" value={`${detail.plan_name} (${BILLING_INTERVAL_LABEL[detail.billing_interval]})`} />
          <Row label="Valor" value={formatPrice(detail.amount)} strong />
          <Row label="Método" value="PIX manual" />
          <Row label="Solicitado em" value={formatDate(detail.created_at)} />
          <Row
            label="Assinatura atual"
            value={`${detail.subscription.plan_id ?? "—"} · ${detail.subscription.status}`}
          />
          {detail.subscription.period_end && (
            <Row label="Vence em" value={formatDate(detail.subscription.period_end)} />
          )}
          {detail.confirmed_at && (
            <Row
              label="Confirmado em"
              value={`${formatDate(detail.confirmed_at)}${detail.confirmed_by_email ? ` por ${detail.confirmed_by_email}` : ""}`}
            />
          )}
          {detail.period_days && <Row label="Período concedido" value={`${detail.period_days} dias`} />}
          {detail.transaction_reference && (
            <Row label="Referência do PIX" value={detail.transaction_reference} />
          )}
        </dl>

        {detail.status === "REJECTED" && detail.rejection_reason && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            Motivo da rejeição: {detail.rejection_reason}
          </p>
        )}

        {detail.subscription_id && (
          <Link
            href="/admin/assinaturas"
            className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700"
          >
            Ver assinaturas
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </Card>

      {/* Comprovante */}
      <Card className="space-y-2.5">
        <SectionTitle
          title="Comprovante"
          description="Enviado pelo restaurante — opcional, e não é prova de recebimento"
        />
        {detail.receipt_path ? (
          <>
            {receiptUrl ? (
              <a
                href={receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="tap-target inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-100 px-3 text-sm font-semibold text-ink-800"
              >
                <FileText className="size-4" aria-hidden="true" />
                Abrir comprovante
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <p className="text-sm text-ink-500">
                O comprovante não pôde ser aberto agora. O arquivo está no bucket privado; recarregue
                a página.
              </p>
            )}
            {detail.receipt_uploaded_at && (
              <p className="text-xs text-ink-500">Enviado em {formatDate(detail.receipt_uploaded_at)}</p>
            )}
            {detail.receipt_note && (
              <p className="rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-700">
                “{detail.receipt_note}”
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-500">
            Sem comprovante anexado. Confirme apenas se o PIX apareceu na conta de recebimento.
          </p>
        )}
      </Card>

      {/* Ações */}
      {isPending ? (
        <Card className="space-y-3">
          <SectionTitle title="Conferência" description="Registre o que você viu no extrato" />

          <div className="space-y-1.5">
            <label htmlFor="reference" className="block text-sm font-medium text-ink-700">
              Referência do PIX (opcional)
            </label>
            <input
              id="reference"
              value={reference}
              onChange={(event) => setReference(event.target.value.slice(0, 140))}
              placeholder="ID fim-a-fim ou identificador do extrato"
              className="min-h-11 w-full rounded-xl border border-ink-200 px-3 font-mono text-sm text-ink-900"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="period" className="block text-sm font-medium text-ink-700">
              Período em dias (opcional)
            </label>
            <input
              id="period"
              inputMode="numeric"
              value={periodDays}
              onChange={(event) => setPeriodDays(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder={`${periodGuess} (padrão do plano)`}
              disabled={!isMasterAdmin}
              className="min-h-11 w-full rounded-xl border border-ink-200 px-3 text-sm text-ink-900 disabled:bg-ink-50"
            />
            <p className="text-xs text-ink-500">
              {isMasterAdmin
                ? `Em branco = ${periodGuess} dias (intervalo do plano). Alterar é privilégio do administrador master e fica registrado na auditoria.`
                : "Somente o administrador master pode alterar a duração do período."}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-note" className="block text-sm font-medium text-ink-700">
              Observação interna (opcional)
            </label>
            <textarea
              id="admin-note"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 280))}
              rows={2}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-900"
            />
          </div>

          {mode === "idle" && (
            <div className="space-y-2">
              <Button
                block
                size="lg"
                onClick={() => setMode("confirm")}
                className="bg-brand-700"
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Confirmar pagamento
              </Button>
              <Button block variant="secondary" onClick={() => setMode("reject")}>
                <XCircle className="size-4" aria-hidden="true" />
                Rejeitar pagamento
              </Button>
              <Button block variant="ghost" onClick={doCancel} loading={pending} className="text-ink-500">
                <Ban className="size-4" aria-hidden="true" />
                Cancelar solicitação
              </Button>
            </div>
          )}

          {mode === "confirm" && (
            <div
              role="alert"
              aria-live="assertive"
              className="space-y-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3"
            >
              <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Confirme somente após verificar o recebimento do PIX.
              </p>
              <p className="text-sm text-amber-900">
                {confirmWarning(detail.amount, detail.plan_name)}
              </p>
              <p className="text-xs text-amber-800">
                Período que será concedido: {customDays ?? periodGuess} dias,{" "}
                {detail.billing_interval === "yearly" ? "anual" : "mensal"}.
              </p>
              <div className="flex gap-2">
                <Button block loading={pending} onClick={doConfirm} disabled={pending}>
                  Sim, recebi o PIX
                </Button>
                <Button variant="ghost" onClick={() => setMode("idle")} disabled={pending}>
                  Voltar
                </Button>
              </div>
            </div>
          )}

          {mode === "reject" && (
            <div className="space-y-2.5 rounded-xl border border-red-200 bg-red-50 p-3">
              <label htmlFor="reject" className="block text-sm font-semibold text-red-900">
                Motivo da rejeição (o restaurante vê este texto)
              </label>
              <textarea
                id="reject"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value.slice(0, 280))}
                rows={2}
                placeholder="Ex.: comprovante não localizado na conta; valor divergente."
                className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm text-ink-900"
              />
              <div className="flex gap-2">
                <Button
                  block
                  variant="danger"
                  loading={pending}
                  onClick={doReject}
                  // O servidor já recusa motivo vazio (`invalid_reason`), mas um
                  // botão que "funciona" e volta erro é pior do que um botão que
                  // explica antes: quem rejeita precisa escrever o motivo.
                  disabled={pending || rejectReason.trim().length < 3}
                >
                  Rejeitar
                </Button>
                <Button variant="ghost" onClick={() => setMode("idle")} disabled={pending}>
                  Voltar
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-ink-600">
            Esta solicitação já foi analisada
            {detail.confirmed_by_email ? ` por ${detail.confirmed_by_email}` : ""}. O histórico não
            pode ser reescrito.
          </p>
        </Card>
      )}

      {feedback && (
        <p
          role="status"
          className={cn(
            "rounded-xl px-3 py-2 text-sm",
            feedback.ok ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700",
          )}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className={cn("min-w-0 break-words text-right text-ink-900", strong ? "font-bold" : "font-medium")}>
        {value}
      </dd>
    </div>
  );
}
