"use client";

import { useEffect, useState } from "react";
import { Banknote, Check, CreditCard, Plus, QrCode, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/analytics";
import {
  PAYMENT_METHOD_LABEL,
  type OrderPayment,
  type PaymentMethod,
  type PanelOrder,
} from "@/lib/types";

/**
 * Pagamentos dentro do detalhe do pedido — Etapa 16.
 *
 * ─── O problema de produto que este componente resolve ─────────────────────
 *
 * Antes desta etapa, "entregue" era a única informação sobre o destino do
 * pedido, e o dono não tinha como responder "quanto entrou hoje?". Aqui a
 * equipe registra o recebimento: valor, método e (opcionalmente) observação.
 *
 * Duas regras de desenho que vieram do escopo:
 *
 *   • **nunca marcar como pago sozinho.** Não existe botão que grave um valor
 *     deduzido do total. Se a conta foi R$ 45 e o cliente pagou R$ 40, a única
 *     forma de registrar isso é lançar R$ 40 — o sistema mostra R$ 5 em aberto.
 *   • **pagamento parcial é o caso normal.** O campo já sugere o que falta, e
 *     aceita vários lançamentos (dois pagam a mesma conta).
 *
 * O teto é conferido no banco (`amount_exceeds_total`); o `max` do input só
 * evita o erro previsível.
 */

const METHODS: Array<{ id: PaymentMethod; icon: typeof Banknote }> = [
  { id: "cash", icon: Banknote },
  { id: "pix", icon: QrCode },
  { id: "card", icon: CreditCard },
  { id: "other", icon: Plus },
];

export function PaymentSection({
  order,
  payments,
  onRecord,
  onRefund,
}: {
  order: PanelOrder;
  /** Lista atual, mantida pelo chamador (que relê do banco após cada ação). */
  payments: OrderPayment[];
  /** `null` em sucesso; a mensagem de erro em caso de recusa. */
  onRecord: (input: {
    amount: string;
    method: PaymentMethod;
    note?: string;
  }) => Promise<string | null>;
  onRefund: (paymentId: string) => Promise<string | null>;
}) {
  const paid = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amount, 0);

  const total = Number(order.total);
  const outstanding = Math.max(0, total - paid);
  const settled = outstanding <= 0.005;

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  /*
   * O campo nasce com o valor que falta, e é ressincronizado quando o saldo
   * muda. Sem isso, o segundo lançamento de uma conta dividida sairia com o
   * valor cheio e o banco recusaria por excedente — o operador veria um erro
   * que parece bug do sistema.
   */
  useEffect(() => {
    setAmount(outstanding > 0 ? outstanding.toFixed(2) : "");
  }, [outstanding, open]);

  const submit = async () => {
    setBusy(true);
    setError(null);

    const problem = await onRecord({ amount, method, note: note.trim() || undefined });

    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }

    setNote("");
    setOpen(false);
  };

  const refund = async (paymentId: string) => {
    setError(null);
    const problem = await onRefund(paymentId);
    if (problem) setError(problem);
  };

  return (
    <section aria-labelledby="detail-payments" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3
          id="detail-payments"
          className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-400"
        >
          Pagamento
        </h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
            settled ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-700",
          )}
        >
          {settled ? "Recebido" : `${formatMoney(outstanding)} em aberto`}
        </span>
      </div>

      {/* Resumo: total congelado do pedido, o que já entrou e o saldo. */}
      <dl className="space-y-1 rounded-2xl bg-ink-50 px-3.5 py-3 text-sm">
        <div className="flex items-baseline justify-between">
          <dt className="text-ink-600">Total do pedido</dt>
          <dd className="font-medium tabular-nums text-ink-900">{formatMoney(total)}</dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-ink-600">Recebido</dt>
          <dd className="font-semibold tabular-nums text-brand-700">{formatMoney(paid)}</dd>
        </div>
        {!settled && (
          <div className="flex items-baseline justify-between border-t border-ink-200 pt-1">
            <dt className="text-ink-600">Em aberto</dt>
            <dd className="font-semibold tabular-nums text-amber-700">{formatMoney(outstanding)}</dd>
          </div>
        )}
      </dl>

      {payments.length > 0 && (
        <ul className="space-y-1.5">
          {payments.map((payment) => (
            <li
              key={payment.payment_id}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-2.5 py-2",
                payment.status === "refunded"
                  ? "border-ink-200 bg-ink-50 opacity-70"
                  : "border-ink-200 bg-white",
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                <Check className="size-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8rem] font-semibold tabular-nums text-ink-900">
                  {formatMoney(payment.amount)}
                  {payment.status === "refunded" && (
                    <span className="ml-1.5 text-[0.68rem] font-normal text-ink-400">
                      estornado
                    </span>
                  )}
                </span>
                <span className="block truncate text-[0.68rem] text-ink-400">
                  {PAYMENT_METHOD_LABEL[payment.method]}
                  {payment.note ? ` · ${payment.note}` : ""}
                </span>
              </span>
              {payment.status === "paid" && (
                <button
                  type="button"
                  onClick={() => void refund(payment.payment_id)}
                  className="tap-target shrink-0 rounded-md px-1.5 text-ink-400 transition hover:text-red-600"
                  aria-label={`Estornar pagamento de ${formatMoney(payment.amount)}`}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-[0.75rem] font-medium text-red-600">
          {error}
        </p>
      )}

      {!settled && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tap-target inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-600 bg-brand-50 px-3 text-[0.82rem] font-semibold text-brand-700 transition active:scale-[0.99]"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Registrar recebimento
        </button>
      )}

      {open && (
        <div className="space-y-2.5 rounded-xl border border-ink-200 p-3">
          <label className="block">
            <span className="mb-1 block text-[0.7rem] font-semibold text-ink-500">
              Valor recebido
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={outstanding.toFixed(2)}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-lg border border-ink-200 px-2.5 py-2 text-base font-semibold tabular-nums text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </label>

          {/* Quatro botões em vez de select: o picker nativo do iOS abre em tela
              cheia e esconde o valor que a pessoa acabou de digitar. */}
          <div role="group" aria-label="Forma de pagamento" className="grid grid-cols-4 gap-1.5">
            {METHODS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMethod(id)}
                aria-pressed={method === id}
                className={cn(
                  "tap-target flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-[0.62rem] font-semibold transition",
                  method === id
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-ink-200 bg-white text-ink-500",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {PAYMENT_METHOD_LABEL[id]}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder="Observação (opcional)"
            className="w-full rounded-lg border border-ink-200 px-2.5 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="tap-target flex-1 rounded-lg border border-ink-200 px-3 text-sm font-semibold text-ink-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !amount}
              className="tap-target flex-1 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? "Salvando…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
