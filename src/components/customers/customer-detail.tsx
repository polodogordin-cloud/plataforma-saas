"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Gift, Sparkles, Trash2, UserRound } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import {
  ACTIVITY_LABEL,
  MAX_ADJUST_NOTE,
  customerActivity,
  entryLabel,
  formatPhone,
} from "@/lib/loyalty";
import { adjustCustomerPoints as adjustPointsAction, awardBirthdayBonus as awardBirthdayAction, eraseCustomer } from "@/actions/loyalty";
import { formatPrice } from "@/lib/validation";
import type { CustomerDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Ficha do cliente no painel — Etapa 24.
 *
 * É uma página de detalhe, não um modal: o dono abre no celular, mostra para o
 * cliente ao lado do balcão e volta. Modal em tela pequena esconde o botão de
 * fechar atrás da barra do navegador, e essa tela é usada em pé, no salão.
 *
 * ─── O que aparece e por quê ─────────────────────────────────────────────
 *
 *   • **Resumo** — pedidos, total gasto, último pedido, frequência. É a
 *     pergunta que o dono faz antes de tudo: "esse cliente é bom?".
 *   • **Pontos** — saldo grande, com quanto vale em reais quando há regra de
 *     resgate. Saldo sem valor é um número que não significa nada.
 *   • **Extrato** — de onde vieram os pontos. Append-only no banco; aqui é
 *     leitura, sem editar nem apagar linha.
 *   • **Ações** — ajuste manual, bônus de aniversário e exclusão (LGPD).
 *
 * `erased` bloqueia ajuste e bônus: o cliente pediu exclusão, e voltar a
 * creditar pontos para um cadastro apagado seria ressuscitar o dado.
 */
export function CustomerDetailView({
  detail,
  loyaltyEnabled,
  redeemValue,
  birthdayBonus,
  timeZone,
}: {
  detail: CustomerDetail;
  loyaltyEnabled: boolean;
  redeemValue: number;
  birthdayBonus: number;
  timeZone: string;
}) {
  const { customer } = detail;
  const erased = Boolean(customer.erased_at);

  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Ajuste de pontos
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  // Confirmação de exclusão: dois toques, porque é irreversível.
  const [confirmErase, setConfirmErase] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const activity = customerActivity(detail.last_order_at);
  const value = useMemo(
    () => Math.round(detail.balance * redeemValue * 100) / 100,
    [detail.balance, redeemValue],
  );

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone,
      }),
    [timeZone],
  );

  const formatDate = (iso: string | null) => (iso ? formatter.format(new Date(iso)) : "—");

  const copyPhone = async () => {
    if (!customer.phone) return;
    try {
      await navigator.clipboard.writeText(formatPhone(customer.phone));
      setCopied(true);
    } catch {
      setFeedback({ ok: false, text: "Não foi possível copiar o telefone." });
    }
  };

  const handleAdjust = () => {
    const delta = Number(adjustValue.replace(",", "."));
    if (!Number.isInteger(delta) || delta === 0) {
      setFeedback({ ok: false, text: "Informe uma quantidade de pontos (pode ser negativa)." });
      return;
    }
    startTransition(async () => {
      const result = await adjustPointsAction({
        customerId: customer.id,
        delta,
        note: adjustNote.slice(0, MAX_ADJUST_NOTE),
      });
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setAdjustOpen(false);
        setAdjustValue("");
        setAdjustNote("");
      }
    });
  };

  const handleBirthday = () => {
    startTransition(async () => {
      const result = await awardBirthdayAction(customer.id);
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
    });
  };

  const handleErase = () => {
    startTransition(async () => {
      const result = await eraseCustomer(customer.id);
      setFeedback({ ok: result.ok, text: result.ok ? result.message : result.error });
      setConfirmErase(false);
    });
  };

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- cabeçalho */}
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-700">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-ink-900">
              {customer.name ?? "Cliente sem nome"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {erased ? (
                <Badge tone="neutral">Dados excluídos</Badge>
              ) : (
                <Badge tone={activity === "active" ? "success" : activity === "dormant" ? "neutral" : "warning"}>
                  {ACTIVITY_LABEL[activity]}
                </Badge>
              )}
              {customer.consent_at && !erased && <Badge tone="neutral">Consentimento {customer.consent_version}</Badge>}
            </div>
          </div>
        </div>

        {customer.phone && (
          <button
            type="button"
            onClick={copyPhone}
            className="flex w-full items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 py-2 text-left active:scale-[0.99]"
          >
            <span className="text-sm font-medium tabular-nums text-ink-800">{formatPhone(customer.phone)}</span>
            <span className="flex items-center gap-1 text-xs font-semibold text-ink-500">
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {copied ? "Copiado" : "Copiar"}
            </span>
          </button>
        )}

        {customer.email && <p className="truncate text-sm text-ink-500">{customer.email}</p>}

        {erased && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800">
            Este cliente pediu a exclusão dos dados. Nome, telefone e e-mail foram apagados; os
            pedidos continuam no histórico da casa, sem identificação.
          </p>
        )}
      </Card>

      {/* ----------------------------------------------------------- resumo */}
      <div>
        <SectionTitle title="Histórico" />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Pedidos" value={String(detail.orders_count)} />
          <Stat label="Total gasto" value={formatPrice(detail.customer.total_spent)} />
          <Stat label="Último pedido" value={formatDate(detail.last_order_at)} />
          <Stat
            label="Frequência"
            value={
              detail.orders_per_month === null
                ? "Primeiro pedido"
                : `${detail.orders_per_month.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/mês`
            }
          />
        </div>
      </div>

      {/* ----------------------------------------------------------- pontos */}
      <div>
        <SectionTitle title="Pontos" />
        <Card className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-bold tabular-nums text-ink-900">
                {detail.balance.toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-ink-500">pontos disponíveis</p>
            </div>
            {redeemValue > 0 && (
              <p className="text-right text-xs text-ink-500">
                valem <span className="font-semibold text-ink-800">{formatPrice(value)}</span>
              </p>
            )}
          </div>

          {!loyaltyEnabled && (
            <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs leading-snug text-ink-500">
              O programa está desativado. O saldo continua guardado — reative em Configurações para
              voltar a acumular.
            </p>
          )}

          {!erased && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAdjustOpen((open) => !open)}
                disabled={pending}
                className="flex min-h-10 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-xs font-semibold text-ink-700 active:scale-[0.99] disabled:opacity-60"
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                Ajustar pontos
              </button>
              {birthdayBonus > 0 && (
                <button
                  type="button"
                  onClick={handleBirthday}
                  disabled={pending}
                  className="flex min-h-10 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-xs font-semibold text-ink-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <Gift className="size-3.5" aria-hidden="true" />
                  Bônus de aniversário
                </button>
              )}
            </div>
          )}

          {adjustOpen && !erased && (
            <div className="space-y-2 rounded-xl border border-ink-200 p-3">
              <label className="block">
                <span className="text-xs font-medium text-ink-500">Pontos (use negativo para descontar)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={adjustValue}
                  onChange={(event) => setAdjustValue(event.target.value.slice(0, 8))}
                  placeholder="Ex.: 50 ou -20"
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm tabular-nums text-ink-900 focus:border-brand-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-ink-500">Motivo (opcional)</span>
                <input
                  type="text"
                  value={adjustNote}
                  onChange={(event) => setAdjustNote(event.target.value.slice(0, MAX_ADJUST_NOTE))}
                  maxLength={MAX_ADJUST_NOTE}
                  placeholder="Ex.: cortesia por atraso"
                  className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={handleAdjust}
                disabled={pending}
                className="min-h-11 w-full rounded-xl bg-brand-600 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-60"
              >
                {pending ? "Salvando…" : "Confirmar ajuste"}
              </button>
            </div>
          )}

          {feedback && (
            <p
              role="status"
              className={cn(
                "rounded-xl px-3 py-2 text-xs leading-snug",
                feedback.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
              )}
            >
              {feedback.text}
            </p>
          )}
        </Card>
      </div>

      {/* ---------------------------------------------------------- extrato */}
      <div>
        <SectionTitle title="Extrato" />
        {detail.entries.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">
              Nenhum ponto ainda. Os pontos entram quando um pedido deste cliente é entregue.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-ink-100 p-0">
            {detail.entries.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{entryLabel(entry.kind, entry.source)}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {formatDate(entry.created_at)}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm font-bold tabular-nums",
                    entry.delta > 0 ? "text-emerald-700" : "text-ink-500",
                  )}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : `−${Math.abs(entry.delta)}`}
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* ------------------------------------------------------- privacidade */}
      <div>
        <SectionTitle title="Privacidade" />
        <Card className="space-y-3">
          <div className="space-y-1 text-xs leading-snug text-ink-500">
            <p>
              Consentimento: {customer.consent_at ? formatDate(customer.consent_at) : "não registrado"}
              {customer.consent_version ? ` (versão ${customer.consent_version})` : ""}.
            </p>
            {customer.consent_revoked_at && <p>Revogado em {formatDate(customer.consent_revoked_at)}.</p>}
          </div>

          {!erased && (
            <>
              {!confirmErase ? (
                <button
                  type="button"
                  onClick={() => setConfirmErase(true)}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-semibold text-red-700 active:scale-[0.99]"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Excluir dados do cliente
                </button>
              ) : (
                <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs leading-snug text-red-800">
                    O nome, o WhatsApp e o e-mail serão apagados de vez. Os pedidos continuam no
                    histórico da casa, sem identificação. Não dá para desfazer.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleErase}
                      disabled={pending}
                      className="min-h-10 flex-1 rounded-xl bg-red-600 text-xs font-bold text-white active:scale-[0.99] disabled:opacity-60"
                    >
                      {pending ? "Excluindo…" : "Excluir mesmo assim"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmErase(false)}
                      className="min-h-10 flex-1 rounded-xl border border-red-200 text-xs font-semibold text-red-700"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Link href="/app/clientes" className="block pb-2 text-center text-xs font-semibold text-ink-500 underline">
        Voltar para clientes
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
